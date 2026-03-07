import type { ChitraguptaBridge } from "@takumi/bridge";
import type { AgentEvent, OrchestrationConfig } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { OrchestratorTask } from "@yugenlab/chitragupta/niyanta";
import { AgentEvaluator, AutonomousOrchestrator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload } from "../loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import { AgentBus, buildTaskResult } from "./agent-bus.js";
import { AgentProfileStore, type TaskOutcome } from "./agent-identity.js";
import { CheckpointManager } from "./checkpoint.js";
import { ChitraguptaBusBridge } from "./chitragupta-bus-bridge.js";
import { createIsolationContext, type IsolationContext } from "./isolation.js";
import { adaptTopologyAfterRejection } from "./mesh-policy.js";
import {
	applyStrategy,
	buildStats,
	createNiyantaTask,
	recordBanditOutcome,
	registerStrategies,
} from "./orchestrator-bandit.js";
import { getProfileBiasedModel, inferRoutingCaps, lucyBiasTopology } from "./orchestrator-profile.js";
import { ClusterPhaseRunner, type PhaseContext } from "./phases.js";
import {
	type AgentInstance,
	AgentRole,
	AgentStatus,
	type ClusterConfig,
	type ClusterEvent,
	ClusterPhase,
	type ClusterState,
	ValidationDecision,
} from "./types.js";

const log = createLogger("cluster-orchestrator");

export interface OrchestratorOptions {
	sendMessage: (
		messages: MessagePayload[],
		system: string,
		tools?: unknown[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<AgentEvent>;
	chitragupta?: ChitraguptaBridge;
	enableCheckpoints?: boolean;
	modelOverrides?: Partial<Record<AgentRole, string>>;
	chitraguptaMemory?: string;
	tools?: ToolRegistry;
	banditStatePath?: string;
	onMeshSizeChange?: (size: number) => void;
	orchestrationConfig?: OrchestrationConfig;
	/** Shared agent message bus (created if not provided). */
	bus?: AgentBus;
	/** Persistent agent profile store (created if not provided). */
	profileStore?: AgentProfileStore;
}

export class ClusterOrchestrator {
	private readonly sendMessage: OrchestratorOptions["sendMessage"];
	private readonly chitragupta?: ChitraguptaBridge;
	private readonly enableCheckpoints: boolean;
	private modelOverrides?: Partial<Record<AgentRole, string>>;
	private chitraguptaMemory?: string;
	private tools?: ToolRegistry;
	private orchestrationConfig?: OrchestrationConfig;
	private readonly autonomous: AutonomousOrchestrator;
	private readonly evaluator: AgentEvaluator;
	private readonly runner: ClusterPhaseRunner;
	private readonly checkpoints: CheckpointManager;
	readonly bus: AgentBus;
	readonly profileStore: AgentProfileStore;
	private readonly busBridge: ChitraguptaBusBridge | null;
	private state: ClusterState | null = null;
	private isolationCtx: IsolationContext | null = null;
	private eventListeners: Array<(event: ClusterEvent) => void> = [];
	private niyantaTask: OrchestratorTask | null = null;
	private runStartMs = 0;
	private totalInputTokens = 0;
	private totalOutputTokens = 0;
	onAgentText?: (agentId: string, delta: string) => void;
	private onMeshSizeChange?: (size: number) => void;

	constructor(options: OrchestratorOptions) {
		this.sendMessage = options.sendMessage;
		this.chitragupta = options.chitragupta;
		this.enableCheckpoints = options.enableCheckpoints ?? true;
		this.modelOverrides = options.modelOverrides;
		this.chitraguptaMemory = options.chitraguptaMemory;
		this.tools = options.tools;
		this.orchestrationConfig = options.orchestrationConfig;
		this.onMeshSizeChange = options.onMeshSizeChange;
		this.bus = options.bus ?? new AgentBus();
		this.profileStore = options.profileStore ?? new AgentProfileStore();
		this.busBridge = options.chitragupta != null ? new ChitraguptaBusBridge(this.bus, options.chitragupta) : null;

		const statePath = options.banditStatePath ?? `${process.env.HOME ?? "~"}/.takumi/bandit-state.json`;
		this.autonomous = new AutonomousOrchestrator({
			banditMode: "thompson",
			autoSaveInterval: 5,
			autoSavePath: statePath,
		});
		this.autonomous.loadState(statePath).catch(() => {});

		this.evaluator = new AgentEvaluator({
			weights: { correctness: 3, completeness: 2, relevance: 2, clarity: 1, efficiency: 1 },
		});

		this.checkpoints = new CheckpointManager({ chitragupta: options.chitragupta });

		const orch = this;
		const phaseCtx: PhaseContext = {
			getState: () => orch.state!,
			setPhase: (p) => orch.setPhase(p),
			updateAgentStatus: (id, s, msg) => orch.updateAgentStatus(id, s, msg),
			emitEvent: (e) => orch.emitEvent(e),
			saveCheckpoint: () => orch.saveCheckpoint(),
			sendMessage: (msgs, sys, tools, signal, options) => orch.sendMessage(msgs, sys, tools, signal, options),
			get workDir() {
				return orch.workDir;
			},
			get chitraguptaMemory() {
				return orch.chitraguptaMemory;
			},
			get chitragupta() {
				return orch.chitragupta;
			},
			get tools() {
				return orch.tools;
			},
			getModelForRole: (role) =>
				getProfileBiasedModel(role, orch.modelOverrides, orch.profileStore, orch.state?.config.taskDescription ?? ""),
			onAgentText: (id, delta) => orch.onAgentText?.(id, delta),
			onTokenUsage: (i, o) => {
				orch.totalInputTokens += i;
				orch.totalOutputTokens += o;
			},
			orchestrationConfig: orch.orchestrationConfig,
			bus: orch.bus,
		};
		this.runner = new ClusterPhaseRunner(phaseCtx, this.evaluator);
	}

	async spawn(config: ClusterConfig): Promise<ClusterState> {
		// Lucy profile bias: if we have reliable topology history, use it
		const biasedTopology = lucyBiasTopology(config.topology, this.profileStore);
		const finalConfig = biasedTopology !== config.topology ? { ...config, topology: biasedTopology } : config;
		log.info(`Spawning cluster: ${finalConfig.roles.length} agents, strategy=${finalConfig.validationStrategy}`);

		const clusterId = `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const now = Date.now();

		const isoMode = finalConfig.isolationMode ?? "none";
		this.isolationCtx = await createIsolationContext(isoMode, process.cwd(), clusterId, finalConfig.dockerConfig);
		log.info(`Isolation mode: ${this.isolationCtx.mode}, workDir: ${this.isolationCtx.workDir}`);

		this.niyantaTask = createNiyantaTask(clusterId, finalConfig.taskDescription);
		this.runStartMs = now;

		this.state = {
			id: clusterId,
			config: finalConfig,
			phase: ClusterPhase.INITIALIZING,
			agents: new Map(),
			validationAttempt: 0,
			plan: null,
			workProduct: null,
			validationResults: [],
			finalDecision: null,
			createdAt: now,
			updatedAt: now,
		};

		for (const role of finalConfig.roles) {
			const agent = this.createAgent(role, finalConfig.taskDescription);
			this.state.agents.set(agent.id, agent);
		}

		this.onMeshSizeChange?.(1 + this.state.agents.size);
		this.busBridge?.attach();

		this.emitEvent({
			type: "phase_change",
			clusterId,
			oldPhase: ClusterPhase.INITIALIZING,
			newPhase: ClusterPhase.INITIALIZING,
			timestamp: now,
		});

		await this.saveCheckpoint();
		return this.state;
	}

	async *execute(_taskDescription: string): AsyncGenerator<ClusterEvent> {
		if (!this.state) throw new Error("Cluster not spawned — call spawn() first.");

		this.totalInputTokens = 0;
		this.totalOutputTokens = 0;
		this.runStartMs = Date.now();

		registerStrategies(this.orchestrationConfig, log);

		const stats = buildStats(this.state?.agents.size ?? 0);
		const strategy = this.niyantaTask ? this.autonomous.selectStrategy(this.niyantaTask, stats) : "standard";

		log.info(`Bandit selected strategy: ${strategy}`);
		applyStrategy(strategy, log);

		try {
			if (this.hasRole(AgentRole.PLANNER)) yield* this.runner.runPlanningPhase();
			yield* this.runner.runExecutionPhase();
			let validationPassed = false;
			while (!validationPassed && this.state.validationAttempt < this.state.config.maxRetries) {
				yield* this.runner.runValidationPhase();

				if (this.state.finalDecision === ValidationDecision.APPROVE) {
					validationPassed = true;
				} else if (this.state.finalDecision === ValidationDecision.REJECT) {
					const nextTopology = adaptTopologyAfterRejection(
						this.state.config.topology,
						this.state.validationAttempt,
						this.orchestrationConfig?.mesh,
					);
					if (nextTopology !== this.state.config.topology) {
						log.info(`Lucy adapted mesh topology: ${this.state.config.topology} -> ${nextTopology}`);
						this.state.config.topology = nextTopology;
					}
					yield* this.runner.runFixingPhase();
				}
			}

			this.setPhase(ClusterPhase.DONE);
			recordBanditOutcome(
				this.autonomous,
				this.niyantaTask,
				this.state,
				this.runStartMs,
				this.totalInputTokens,
				this.totalOutputTokens,
				validationPassed,
				strategy,
				log,
			);
			this.recordAgentProfiles(validationPassed);
			yield {
				type: "cluster_complete",
				clusterId: this.state.id,
				success: validationPassed,
				workProduct: this.state.workProduct,
				timestamp: Date.now(),
			};
		} catch (err) {
			log.error("Cluster execution failed", err);
			this.setPhase(ClusterPhase.FAILED);
			recordBanditOutcome(
				this.autonomous,
				this.niyantaTask,
				this.state,
				this.runStartMs,
				this.totalInputTokens,
				this.totalOutputTokens,
				false,
				strategy,
				log,
			);
			this.recordAgentProfiles(false);
			yield {
				type: "cluster_error",
				clusterId: this.state.id,
				error: err instanceof Error ? err.message : String(err),
				timestamp: Date.now(),
			};
		}
	}

	getState(): ClusterState | null {
		return this.state;
	}

	setModelOverrides(overrides?: Partial<Record<AgentRole, string>>): void {
		this.modelOverrides = overrides;
	}

	setChitraguptaMemory(memory?: string): void {
		this.chitraguptaMemory = memory;
	}

	on(listener: (event: ClusterEvent) => void): void {
		this.eventListeners.push(listener);
	}

	async shutdown(): Promise<void> {
		if (this.state) {
			await this.saveCheckpoint();
			this.state = null;
			this.onMeshSizeChange?.(1);
		}
		if (this.isolationCtx) {
			await this.isolationCtx.cleanup();
			this.isolationCtx = null;
		}
		this.busBridge?.detach();
		this.bus.reset();
		this.profileStore.save();
		this.eventListeners = [];
		this.niyantaTask = null;
	}

	get workDir(): string {
		return this.isolationCtx?.workDir ?? process.cwd();
	}

	private createAgent(role: AgentRole, taskDescription: string): AgentInstance {
		return {
			id: `agent-${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
			role,
			status: AgentStatus.IDLE,
			messages: [],
			context: { taskDescription },
			startedAt: Date.now(),
			completedAt: null,
			error: null,
		};
	}

	private hasRole(role: AgentRole): boolean {
		return !!this.state && Array.from(this.state.agents.values()).some((a) => a.role === role);
	}

	private setPhase(newPhase: ClusterPhase): void {
		if (!this.state) return;
		const oldPhase = this.state.phase;
		this.state.phase = newPhase;
		this.state.updatedAt = Date.now();
		this.emitEvent({ type: "phase_change", clusterId: this.state.id, oldPhase, newPhase, timestamp: Date.now() });
	}

	private updateAgentStatus(agentId: string, status: AgentStatus, message?: string): void {
		if (!this.state) return;
		const agent = this.state.agents.get(agentId);
		if (!agent) return;
		agent.status = status;
		this.state.updatedAt = Date.now();
		this.emitEvent({
			type: "agent_update",
			clusterId: this.state.id,
			agentId,
			role: agent.role,
			status,
			message,
			timestamp: Date.now(),
		});
	}

	private emitEvent(event: ClusterEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (err) {
				log.error("Event listener threw", err);
			}
		}
		// Mirror cluster events onto the agent bus as discovery shares
		this.bus.publish({
			type: "discovery_share",
			id: `cls-${Date.now()}`,
			from: this.state?.id ?? "orchestrator",
			topic: `cluster.${event.type}`,
			payload: event as unknown as Record<string, unknown>,
			timestamp: Date.now(),
		});
	}

	private recordAgentProfiles(success: boolean): void {
		if (!this.state) return;
		const durationMs = Date.now() - this.runStartMs;
		const taskCaps = inferRoutingCaps(this.state.config.taskDescription);
		this.profileStore.recordTopologyOutcome(this.state.config.topology, success);
		const agentCount = this.state.agents.size;
		const tokensPerAgent =
			agentCount > 0 ? Math.round((this.totalInputTokens + this.totalOutputTokens) / agentCount) : 0;
		for (const agent of this.state.agents.values()) {
			const model = this.modelOverrides?.[agent.role] ?? "default";
			const outcome: TaskOutcome = {
				role: agent.role,
				model,
				success,
				capabilities: taskCaps,
				durationMs,
				tokensUsed: tokensPerAgent,
			};
			this.profileStore.recordOutcome(outcome);
		}
		// save() is also called in shutdown(); skip the extra sync write here
	}

	private async saveCheckpoint(): Promise<void> {
		if (!this.enableCheckpoints || !this.state) return;
		await this.checkpoints.save(CheckpointManager.fromState(this.state));
	}

	async resume(clusterId: string): Promise<ClusterState | null> {
		const cp = await this.checkpoints.load(clusterId);
		if (!cp) {
			log.warn(`No checkpoint found for cluster ${clusterId}`);
			return null;
		}

		log.info(`Resuming cluster ${clusterId} from phase ${cp.phase}`);
		this.state = {
			id: cp.clusterId,
			config: cp.config,
			phase: cp.phase,
			agents: new Map(),
			validationAttempt: cp.validationAttempt,
			plan: cp.plan,
			workProduct: cp.workProduct,
			validationResults: cp.validationResults,
			finalDecision: cp.finalDecision,
			createdAt: cp.savedAt,
			updatedAt: Date.now(),
		};
		for (const role of cp.config.roles) {
			const agent = this.createAgent(role, cp.config.taskDescription);
			this.state.agents.set(agent.id, agent);
		}
		return this.state;
	}

	async listCheckpoints() {
		return this.checkpoints.list();
	}
}
