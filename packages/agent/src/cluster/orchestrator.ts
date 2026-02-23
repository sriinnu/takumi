/**
 * @file orchestrator.ts
 * @module cluster/orchestrator
 *
 * Multi-agent Cluster Orchestrator — coordinates PLANNER → WORKER → VALIDATORS
 * workflow with blind validation and Chitragupta state persistence.
 *
 * ## Niyanta integration
 * - {@link AutonomousOrchestrator} provides bandit-driven strategy selection
 *   (UCB1 / Thompson / LinUCB). It learns which coordination strategies perform
 *   best and auto-bans consistently failing ones.
 * - {@link AgentEvaluator} gives zero-LLM heuristic pre-screening of the
 *   worker's output before the expensive LLM validators run. Work scoring below
 *   the threshold skips straight to the fixing phase.
 *
 * ## Blind validation
 * Validators receive ONLY the task description + final work-product summary.
 * They never see the worker's conversation history, preventing anchoring bias.
 *
 * @see prompts.ts for all system-prompt strings
 * @see types.ts for all shared type definitions
 */

import type { ChitraguptaBridge } from "@takumi/bridge";
import type { AgentEvent, OrchestrationConfig } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { OrchestratorStats, OrchestratorTask, TaskResult } from "@yugenlab/chitragupta/niyanta";
import { AgentEvaluator, AutonomousOrchestrator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload } from "../loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import { CheckpointManager } from "./checkpoint.js";
import { createIsolationContext, type IsolationContext } from "./isolation.js";
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

// ─── Orchestrator Options ────────────────────────────────────────────────────

/** Construction options for {@link ClusterOrchestrator}. */
export interface OrchestratorOptions {
	/** Sends a message batch to the LLM and streams back {@link AgentEvent}s. */
	sendMessage: (
		messages: MessagePayload[],
		system: string,
		tools?: unknown[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<AgentEvent>;
	/** Optional Chitragupta bridge for checkpoint persistence. */
	chitragupta?: ChitraguptaBridge;
	/** Whether to save checkpoints after each phase (default: true). */
	enableCheckpoints?: boolean;
	/** Optional per-role model overrides (e.g., from TaskClassifier router). */
	modelOverrides?: Partial<Record<AgentRole, string>>;
	/** Optional Chitragupta memory string to inject into agent system prompts. */
	chitraguptaMemory?: string;
	/** Tool registry for agents to use tools (e.g. Worker editing files). */
	tools?: ToolRegistry;
	/**
	 * Path to persist the AutonomousOrchestrator's bandit state across runs.
	 * Defaults to `~/.takumi/bandit-state.json`.
	 */
	banditStatePath?: string;
	/**
	 * Optional callback invoked when the cluster mesh size changes (agents spawn/despawn).
	 * Useful for updating UI indicators like the statusline.
	 */
	onMeshSizeChange?: (size: number) => void;
	/** Optional orchestration config for advanced multi-agent strategies. */
	orchestrationConfig?: OrchestrationConfig;
}

// ─── Cluster Orchestrator ────────────────────────────────────────────────────

/**
 * Coordinates a multi-agent cluster: PLANNING → EXECUTING → VALIDATING → FIXING.
 *
 * Uses niyanta's **AutonomousOrchestrator** (bandit strategy selection) and
 * **AgentEvaluator** (zero-LLM heuristic pre-screening) internally.
 *
 * @example
 * ```ts
 * const orch = new ClusterOrchestrator({ sendMessage: myLlmFn });
 * await orch.spawn({ roles: [AgentRole.PLANNER, AgentRole.WORKER], ... });
 * for await (const evt of orch.execute("add OAuth login")) { ... }
 * ```
 */
export class ClusterOrchestrator {
	/** LLM communication function injected by the caller. */
	private readonly sendMessage: OrchestratorOptions["sendMessage"];
	/** Optional Chitragupta for checkpoints. */
	private readonly chitragupta?: ChitraguptaBridge;
	/** Whether to write checkpoints. */
	private readonly enableCheckpoints: boolean;
	/** Optional per-role model overrides (planner/worker/validators). */
	private modelOverrides?: Partial<Record<AgentRole, string>>;
	/** Optional Chitragupta memory context injected into system prompts. */
	private chitraguptaMemory?: string;
	/** Tool registry for agents to use tools. */
	private tools?: ToolRegistry;
	/** Optional orchestration config for advanced multi-agent strategies. */
	private orchestrationConfig?: OrchestrationConfig;
	/** Niyanta bandit — learns best coordination strategy per task type. */
	private readonly autonomous: AutonomousOrchestrator;
	/** Niyanta heuristic evaluator — pre-screens output before LLM validators. */
	private readonly evaluator: AgentEvaluator;
	/** Phase runner — executes PLANNING/EXECUTING/VALIDATING/FIXING phases. */
	private readonly runner: ClusterPhaseRunner;
	/** Checkpoint manager — save/load/resume cluster state. */
	private readonly checkpoints: CheckpointManager;
	/** Live cluster state, null between runs. */
	private state: ClusterState | null = null;
	/** Active isolation context for the current run. */
	private isolationCtx: IsolationContext | null = null;
	/** Registered event listeners. */
	private eventListeners: Array<(event: ClusterEvent) => void> = [];
	/** niyanta task descriptor for the current run (used for bandit feedback). */
	private niyantaTask: OrchestratorTask | null = null;
	/** Wall-clock start time for the current run (ms). */
	private runStartMs = 0;
	/** Accumulated input tokens across all agent calls in the current run. */
	private totalInputTokens = 0;
	/** Accumulated output tokens across all agent calls in the current run. */
	private totalOutputTokens = 0;
	/**
	 * Optional streaming callback forwarded from the TUI layer.
	 * Set before calling {@link execute} to receive per-token text updates.
	 */
	onAgentText?: (agentId: string, delta: string) => void;
	/**
	 * Optional callback invoked when the cluster mesh size changes.
	 */
	private onMeshSizeChange?: (size: number) => void;
	/**
	 * Available strategy arms for bandit selection.
	 * Dynamically populated based on enabled orchestration config.
	 */
	private availableStrategies: {
		execution: string[];
		validation: string[];
	} = { execution: ["standard"], validation: ["standard_validation"] };

	constructor(options: OrchestratorOptions) {
		this.sendMessage = options.sendMessage;
		this.chitragupta = options.chitragupta;
		this.enableCheckpoints = options.enableCheckpoints ?? true;
		this.modelOverrides = options.modelOverrides;
		this.chitraguptaMemory = options.chitraguptaMemory;
		this.tools = options.tools;
		this.orchestrationConfig = options.orchestrationConfig;
		this.onMeshSizeChange = options.onMeshSizeChange;

		// Niyanta: bandit learns which strategy works best over time
		const statePath = options.banditStatePath ?? `${process.env.HOME ?? "~"}/.takumi/bandit-state.json`;
		this.autonomous = new AutonomousOrchestrator({
			banditMode: "thompson", // Thompson sampling — good exploration/exploit balance
			autoSaveInterval: 5, // persist every 5 tasks
			autoSavePath: statePath,
		});
		// Load persisted bandit state (fire-and-forget; ok if file missing)
		this.autonomous.loadState(statePath).catch(() => {});

		// Niyanta: heuristic evaluator (weights favour correctness for code tasks)
		this.evaluator = new AgentEvaluator({
			weights: { correctness: 3, completeness: 2, relevance: 2, clarity: 1, efficiency: 1 },
		});

		// Checkpoint manager — wraps both local FS and Chitragupta Akasha
		this.checkpoints = new CheckpointManager({ chitragupta: options.chitragupta });

		// Build the PhaseContext bridge so ClusterPhaseRunner can call back into us.
		// Capture `this` as `orch` so object-literal getters can reference it via closure.
		const orch = this;
		const phaseCtx: PhaseContext = {
			getState: () => orch.state!,
			setPhase: (p) => orch.setPhase(p),
			updateAgentStatus: (id, s, msg) => orch.updateAgentStatus(id, s, msg),
			emitEvent: (e) => orch.emitEvent(e),
			saveCheckpoint: () => orch.saveCheckpoint(),
			sendMessage: (msgs, sys, tools, signal, options) => orch.sendMessage(msgs, sys, tools, signal, options),
			// Lazy getter: isolation context is set in spawn() AFTER the ctor, so we
			// read it on demand rather than capturing a stale process.cwd() reference.
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
			getModelForRole: (role) => orch.modelOverrides?.[role],
			onAgentText: (id, delta) => orch.onAgentText?.(id, delta),
			onTokenUsage: (i, o) => {
				orch.totalInputTokens += i;
				orch.totalOutputTokens += o;
			},
			orchestrationConfig: orch.orchestrationConfig,
		};
		this.runner = new ClusterPhaseRunner(phaseCtx, this.evaluator);
	}

	/**
	 * Spawn a new cluster for the given configuration.
	 * Call this before {@link execute}.
	 *
	 * @param config - Roles, topology, validation strategy, and task description.
	 * @returns The freshly initialised {@link ClusterState}.
	 */
	async spawn(config: ClusterConfig): Promise<ClusterState> {
		log.info(`Spawning cluster: ${config.roles.length} agents, strategy=${config.validationStrategy}`);

		const clusterId = `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const now = Date.now();

		// Set up isolation sandbox (worktree / docker / none)
		const isoMode = config.isolationMode ?? "none";
		this.isolationCtx = await createIsolationContext(isoMode, process.cwd(), clusterId, config.dockerConfig);
		log.info(`Isolation mode: ${this.isolationCtx.mode}, workDir: ${this.isolationCtx.workDir}`);

		// Build niyanta task descriptor — used for strategy selection + outcome recording
		this.niyantaTask = {
			id: clusterId,
			type: "prompt",
			description: config.taskDescription,
			priority: "normal",
			status: "pending",
		};
		this.runStartMs = now;

		this.state = {
			id: clusterId,
			config,
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

		// Instantiate agent slots
		for (const role of config.roles) {
			const agent = this.createAgent(role, config.taskDescription);
			this.state.agents.set(agent.id, agent);
		}

		// Notify UI of mesh size change (1 local + N cluster agents)
		this.onMeshSizeChange?.(1 + this.state.agents.size);

		// Emit init event so the TUI can render the cluster immediately
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

	/**
	 * Execute the full cluster workflow, yielding events as phases complete.
	 * Must call {@link spawn} first.
	 *
	 * @param taskDescription - The task to execute (echoed into agent prompts).
	 * @yields {@link ClusterEvent} — phase changes, agent updates, validation results.
	 */
	async *execute(_taskDescription: string): AsyncGenerator<ClusterEvent> {
		if (!this.state) throw new Error("Cluster not spawned — call spawn() first.");

		// Reset run metrics so bandit sees fresh totals for this execution.
		this.totalInputTokens = 0;
		this.totalOutputTokens = 0;
		this.runStartMs = Date.now();

		// Register strategies based on enabled config
		this.registerStrategies();

		// Use bandit to choose strategy
		const stats = this.buildStats();
		const strategy = this.niyantaTask ? this.autonomous.selectStrategy(this.niyantaTask, stats) : "standard";

		log.info(`Bandit selected strategy: ${strategy}`);
		this.applyStrategy(strategy);

		try {
			// ── Phase 1: Planning (delegated to ClusterPhaseRunner) ──────────
			if (this.hasRole(AgentRole.PLANNER)) yield* this.runner.runPlanningPhase();

			// ── Phase 2: Execution ───────────────────────────────────────────
			yield* this.runner.runExecutionPhase();

			// ── Phase 3: Validate + Fix loop ─────────────────────────────────
			let validationPassed = false;
			while (!validationPassed && this.state.validationAttempt < this.state.config.maxRetries) {
				yield* this.runner.runValidationPhase();

				if (this.state.finalDecision === ValidationDecision.APPROVE) {
					validationPassed = true;
				} else if (this.state.finalDecision === ValidationDecision.REJECT) {
					yield* this.runner.runFixingPhase();
				}
			}

			// ── Phase 4: Done — record outcome for bandit learning ───────────
			this.setPhase(ClusterPhase.DONE);
			this.recordBanditOutcome(validationPassed, strategy);
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
			// Record failure so bandit penalises the chosen strategy
			this.recordBanditOutcome(false, strategy);
			yield {
				type: "cluster_error",
				clusterId: this.state.id,
				error: err instanceof Error ? err.message : String(err),
				timestamp: Date.now(),
			};
		}
	}

	/**
	 * Returns the current cluster state snapshot, or `null` between runs.
	 */
	getState(): ClusterState | null {
		return this.state;
	}

	/** Update per-role model overrides (e.g., from TaskClassifier router). */
	setModelOverrides(overrides?: Partial<Record<AgentRole, string>>): void {
		this.modelOverrides = overrides;
	}

	/** Update the Chitragupta memory context used in system prompts. */
	setChitraguptaMemory(memory?: string): void {
		this.chitraguptaMemory = memory;
	}

	/**
	 * Subscribe to cluster events emitted during {@link execute}.
	 *
	 * @param listener - Callback invoked synchronously for each event.
	 */
	on(listener: (event: ClusterEvent) => void): void {
		this.eventListeners.push(listener);
	}

	/**
	 * Flush the final checkpoint and release cluster state.
	 * Safe to call multiple times.
	 */
	async shutdown(): Promise<void> {
		if (this.state) {
			await this.saveCheckpoint();
			this.state = null;
			// Reset mesh size to 1 (just the local agent)
			this.onMeshSizeChange?.(1);
		}
		// Release isolation sandbox (removes worktree / temp dir)
		if (this.isolationCtx) {
			await this.isolationCtx.cleanup();
			this.isolationCtx = null;
		}
		this.eventListeners = [];
		this.niyantaTask = null;
	}

	/**
	 * The working directory the cluster agents should operate in.
	 * Equals `process.cwd()` when isolation mode is `"none"`.
	 */
	get workDir(): string {
		return this.isolationCtx?.workDir ?? process.cwd();
	}

	// ─── Private Helpers ────────────────────────────────────────────────────────

	/** Instantiate a blank agent for the given role. */
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

	/** True if the cluster has at least one agent with {@link role}. */
	private hasRole(role: AgentRole): boolean {
		return !!this.state && Array.from(this.state.agents.values()).some((a) => a.role === role);
	}

	/** Transition cluster phase and broadcast a `phase_change` event. */
	private setPhase(newPhase: ClusterPhase): void {
		if (!this.state) return;
		const oldPhase = this.state.phase;
		this.state.phase = newPhase;
		this.state.updatedAt = Date.now();
		this.emitEvent({ type: "phase_change", clusterId: this.state.id, oldPhase, newPhase, timestamp: Date.now() });
	}

	/** Update a single agent's status and broadcast an `agent_update` event. */
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

	/** Broadcast an event to all registered listeners. Errors in listeners are swallowed. */
	private emitEvent(event: ClusterEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (err) {
				log.error("Event listener threw", err);
			}
		}
	}

	/**
	 * Persist a checkpoint via {@link CheckpointManager}.
	 * Silently skips if checkpoints are disabled or no state exists.
	 */
	private async saveCheckpoint(): Promise<void> {
		if (!this.enableCheckpoints || !this.state) return;
		await this.checkpoints.save(CheckpointManager.fromState(this.state));
	}

	/**
	 * Restore a previously saved cluster and re-enter its last phase.
	 * Call `execute(state.config.taskDescription)` after this to resume.
	 *
	 * @param clusterId - ID of the cluster to restore.
	 * @returns The restored {@link ClusterState}, or `null` if not found.
	 */
	async resume(clusterId: string): Promise<ClusterState | null> {
		const cp = await this.checkpoints.load(clusterId);
		if (!cp) {
			log.warn(`No checkpoint found for cluster ${clusterId}`);
			return null;
		}

		log.info(`Resuming cluster ${clusterId} from phase ${cp.phase}`);
		// Reconstruct state; agents map is rebuilt from config roles
		this.state = {
			id: cp.clusterId,
			config: cp.config,
			phase: cp.phase,
			agents: new Map(), // agents are stateless; recreate from config
			validationAttempt: cp.validationAttempt,
			plan: cp.plan,
			workProduct: cp.workProduct,
			validationResults: cp.validationResults,
			finalDecision: cp.finalDecision,
			createdAt: cp.savedAt,
			updatedAt: Date.now(),
		};
		// Recreate agent slots from saved config
		for (const role of cp.config.roles) {
			const agent = this.createAgent(role, cp.config.taskDescription);
			this.state.agents.set(agent.id, agent);
		}
		return this.state;
	}

	/**
	 * List all locally stored checkpoints (for `/checkpoint list` commands).
	 */
	async listCheckpoints() {
		return this.checkpoints.list();
	}

	/**
	 * Build a minimal {@link OrchestratorStats} snapshot for the bandit context.
	 * Pulls live data from the current cluster state.
	 */
	private buildStats(): OrchestratorStats {
		const agentCount = this.state?.agents.size ?? 0;
		return {
			totalTasks: 1,
			pendingTasks: 0,
			runningTasks: 1,
			completedTasks: 0,
			failedTasks: 0,
			activeAgents: agentCount,
			totalCost: 0,
			totalTokens: 0,
			averageLatency: 0,
			throughput: 0,
		};
	}

	/**
	 * Registers enabled multi-agent strategies with Niyanta bandit.
	 * Called during execute() after config is available.
	 */
	private registerStrategies(): void {
		const config = this.orchestrationConfig;
		if (!config) return;

		// Register execution strategies (mutually exclusive)
		const executionArms: string[] = ["standard"];
		if (config.ensemble?.enabled) {
			const arm = `ensemble_k${config.ensemble.workerCount}_t${config.ensemble.temperature}`;
			executionArms.push(arm);
		}
		if (config.progressiveRefinement?.enabled) {
			const arm = `progressive_i${config.progressiveRefinement.maxIterations}_t${config.progressiveRefinement.targetScore}`;
			executionArms.push(arm);
		}

		// Register validation strategies (mutually exclusive)
		const validationArms: string[] = ["standard_validation"];
		if (config.moA?.enabled) {
			const arm = `moa_r${config.moA.rounds}_v${config.moA.validatorCount}`;
			validationArms.push(arm);
		}

		// Store available arms for eligibility filtering
		this.availableStrategies = {
			execution: executionArms,
			validation: validationArms,
		};

		log.info(
			`Registered strategies: execution=[${executionArms.join(", ")}] validation=[${validationArms.join(", ")}]`,
		);
	}

	/**
	 * Parses bandit strategy string and applies to phase runner.
	 * Example: "ensemble_k3_t0.9" → enables ensemble with K=3, temp=0.9
	 *
	 * @param strategy - Bandit-selected strategy identifier
	 */
	private applyStrategy(strategy: string): void {
		// Parse execution strategies
		if (strategy.startsWith("ensemble_")) {
			const match = strategy.match(/ensemble_k(\d+)_t([\d.]+)/);
			if (match && this.orchestrationConfig?.ensemble) {
				// Bandit override (optional): could adjust K or temp dynamically
				// For now, just use config values as-is
				log.info(`Bandit selected: ${strategy} (using config values)`);
			}
		} else if (strategy.startsWith("progressive_")) {
			log.info(`Bandit selected: ${strategy} (using config values)`);
		} else if (strategy === "standard") {
			log.info("Bandit selected: standard single-worker execution");
		}

		// Parse validation strategies
		if (strategy.startsWith("moa_")) {
			log.info(`Bandit selected: ${strategy} (using config values)`);
		} else if (strategy === "standard_validation") {
			log.info("Bandit selected: standard single-round validation");
		}

		// Note: Actual strategy enablement already handled by config flags
		// This method primarily logs bandit decisions for observability
	}

	/** Feed run outcome back into the bandit so it learns over time. */
	private recordBanditOutcome(success: boolean, strategy: string): void {
		if (!this.niyantaTask) return;

		const durationMs = Date.now() - this.runStartMs;
		const totalTokens = this.totalInputTokens + this.totalOutputTokens;
		const cost = (this.totalInputTokens * 3 + this.totalOutputTokens * 15) / 1_000_000;

		// Extract quality metrics from work product and validation for logging
		const heuristicScore = this.state?.workProduct?.heuristicScore ?? 0;
		const consensusScore =
			this.state?.workProduct?.metadata?.consensusScore ??
			this.state?.workProduct?.metadata?.moaConsensus ??
			0;

		const result: TaskResult = {
			success,
			output: success ? "Cluster completed" : "Cluster failed",
			metrics: {
				startTime: this.runStartMs,
				endTime: Date.now(),
				tokenUsage: totalTokens,
				cost,
				toolCalls: 0,
				retries: this.state?.validationAttempt ?? 0,
			},
		};

		this.autonomous.recordOutcome(this.niyantaTask, result, strategy as never);
		log.info(
			`Bandit feedback: ${strategy} → ${success ? "SUCCESS" : "FAIL"} ` +
				`(heuristic=${heuristicScore.toFixed(2)}, consensus=${consensusScore.toFixed(2)}, ` +
				`tokens=${totalTokens}, latency=${durationMs}ms)`,
		);
	}
}
