import {
	AgentRole,
	type ClassificationResult,
	ClusterOrchestrator,
	TaskClassifier,
	TaskComplexity,
	type ValidationResult,
} from "@takumi/agent";
import type { Message, OrchestrationConfig, ToolDefinition } from "@takumi/core";
import { createLogger } from "@takumi/core";
import { effect } from "@takumi/render";
import type { AgentRunner } from "./agent-runner.js";
import {
	ensureCanonicalSessionBinding,
	getBoundSessionId,
	observeExecutorEvents,
} from "./chitragupta-executor-runtime.js";
import { handleClusterCommand } from "./coding-agent-cluster-command.js";
import { createPullRequestViaGh } from "./coding-agent-gh.js";
import { maybeEscalateMeshSabha, maybeEscalateWeakConsensusToSabha, prepareMeshCluster } from "./coding-agent-mesh.js";
import { resolveTaskModelPlan } from "./coding-agent-model-routing.js";
import { resolveRoutingOverrides } from "./coding-agent-routing.js";
import { PHASE_LABELS, runSingleAgentFlow } from "./coding-agent-single-flow.js";
import {
	appendRoutingDecisions,
	summarizeTakumiCapabilityHealth,
	upsertCapabilityHealthSnapshot,
} from "./control-plane-state.js";
import type { AppState, ClusterCommandEvent } from "./state.js";

const log = createLogger("coding-agent");

export type CodingPhase =
	| "idle"
	| "planning"
	| "branching"
	| "executing"
	| "validating"
	| "reviewing"
	| "committing"
	| "done";

export interface CodingTask {
	description: string;
	phase: CodingPhase;
	branchName: string | null;
	plan: string | null;
	filesModified: string[];
	testsPassed: boolean | null;
	error: string | null;
	// Multi-agent orchestration fields
	orchestrationMode: "single" | "multi";
	complexity?: TaskComplexity;
	validationAttempt?: number;
	validationResults?: ValidationResult[];
	clusterId?: string;
}

export interface CodingAgentOptions {
	/** Enable multi-agent orchestration (default: false) */
	enableOrchestration?: boolean;
	/** Maximum validation retry attempts (default: 3) */
	maxValidationRetries?: number;
	/** Auto-create a GitHub PR when the task completes successfully (default: false) */
	autoPr?: boolean;
	/** Auto-create + auto-merge PR (implies autoPr, default: false) */
	autoShip?: boolean;
	/** Full orchestration config for topology / Lucy / Scarlett policy. */
	orchestrationConfig?: OrchestrationConfig;
}

export class CodingAgent {
	private state: AppState;
	private runner: AgentRunner;
	private task: CodingTask | null = null;
	private messageSeq = 0;
	private options: CodingAgentOptions;
	private classifier: TaskClassifier | null = null;
	private orchestrator: ClusterOrchestrator | null = null;
	private _disposeCommandEffect: (() => void) | null = null;
	private stopRequestedReason: string | null = null;

	constructor(state: AppState, runner: AgentRunner, options: CodingAgentOptions = {}) {
		this.state = state;
		this.runner = runner;
		this.options = {
			enableOrchestration: options.enableOrchestration ?? false,
			maxValidationRetries: options.maxValidationRetries ?? 3,
			autoPr: options.autoPr ?? false,
			autoShip: options.autoShip ?? false,
			orchestrationConfig: options.orchestrationConfig,
		};

		if (this.options.enableOrchestration) {
			const sendFn = this.runner.getSendMessageFn();
			this.classifier = new TaskClassifier({
				sendMessage: (messages, system, options) => sendFn(messages, system, undefined, undefined, options),
				currentModel: this.state.model.value,
				classificationModel: this.options.orchestrationConfig?.modelRouting?.classifier,
			});

			const chitragupta = this.state.chitraguptaBridge.value;
			this.orchestrator = new ClusterOrchestrator({
				sendMessage: (messages, system, tools, signal, options) =>
					sendFn(messages, system, tools as ToolDefinition[] | undefined, signal, options),
				chitragupta: chitragupta ?? undefined,
				enableCheckpoints: true,
				chitraguptaMemory: this.state.chitraguptaMemory.value || undefined,
				tools: this.runner.getTools(),
				orchestrationConfig: this.options.orchestrationConfig,
				onMeshSizeChange: (size: number) => {
					this.state.akashaMeshSize.value = size;
				},
			});
		}

		this._disposeCommandEffect = effect(() => {
			const cmd = this.state.clusterCommand.value;
			if (!cmd) return undefined;
			this.state.clusterCommand.value = null;
			void this.handleClusterCommand(cmd);
			return undefined;
		});

		const vd = this.state.validationResultsDialog;
		vd.onRetry = () => {
			this.state.clusterCommand.value = { type: "retry" };
		};
		vd.onRevalidate = () => {
			this.state.clusterCommand.value = { type: "validate" };
		};
		vd.onViewFile = (file: string) => {
			this.state.previewFile.value = file;
			this.state.previewVisible.value = true;
		};
	}

	get currentTask(): CodingTask | null {
		return this.task;
	}

	get isActive(): boolean {
		return this.task !== null && this.task.phase !== "idle" && this.task.phase !== "done";
	}

	async cancel(reason = "Task cancelled."): Promise<void> {
		if (!this.isActive && !this.orchestrator) {
			return;
		}

		this.stopRequestedReason = reason;
		this.state.clusterCommand.value = null;
		this.runner.cancel();
		if (this.orchestrator) {
			await this.orchestrator.shutdown();
		}
	}

	async start(description: string, forceMode?: "single" | "multi"): Promise<void> {
		await ensureCanonicalSessionBinding(this.state);
		const boundSessionId = getBoundSessionId(this.state);
		const runId = `code-${Date.now().toString(36)}`;
		let orchestrationMode: "single" | "multi" = "single";
		let complexity: TaskComplexity | undefined;
		let classificationResult: ClassificationResult | null = null;

		if (forceMode) {
			orchestrationMode = forceMode;
		} else if (this.options.enableOrchestration && this.classifier) {
			try {
				const result = await this.classifier.classifyAndGetTopology(description);
				classificationResult = result;
				complexity = result.classification.complexity;
				const routingPlan = await resolveRoutingOverrides({
					observer: this.state.chitraguptaObserver.value,
					sessionId: boundSessionId,
					currentModel: this.state.model.value,
					router: this.classifier.router,
					classification: result.classification,
				});
				this.state.routingDecisions.value = appendRoutingDecisions(
					this.state.routingDecisions.value,
					routingPlan.decisions,
				);
				this.state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
					this.state.capabilityHealthSnapshots.value,
					summarizeTakumiCapabilityHealth({
						connected: this.state.chitraguptaConnected.value,
						anomalySeverity: this.state.chitraguptaAnomaly.value?.severity,
						routingDecisions: this.state.routingDecisions.value,
					}),
				);
				for (const note of routingPlan.notes) {
					this.addSystemMessage(note);
				}

				if (this.orchestrator && complexity) {
					const modelPlan = resolveTaskModelPlan(
						this.classifier.router,
						result.classification,
						this.options.orchestrationConfig,
					);
					this.orchestrator.setModelOverrides({
						[AgentRole.WORKER]: modelPlan.roleOverrides[AgentRole.WORKER] ?? result.recommendedModel.model,
						[AgentRole.PLANNER]: modelPlan.roleOverrides[AgentRole.PLANNER],
						[AgentRole.VALIDATOR_REQUIREMENTS]: modelPlan.roleOverrides[AgentRole.VALIDATOR_REQUIREMENTS],
						[AgentRole.VALIDATOR_CODE]: modelPlan.roleOverrides[AgentRole.VALIDATOR_CODE],
						[AgentRole.VALIDATOR_SECURITY]: modelPlan.roleOverrides[AgentRole.VALIDATOR_SECURITY],
						[AgentRole.VALIDATOR_TESTS]: modelPlan.roleOverrides[AgentRole.VALIDATOR_TESTS],
						[AgentRole.VALIDATOR_ADVERSARIAL]: modelPlan.roleOverrides[AgentRole.VALIDATOR_ADVERSARIAL],
						...routingPlan.overrides,
					});
				}

				if (complexity === TaskComplexity.STANDARD || complexity === TaskComplexity.CRITICAL) {
					orchestrationMode = "multi";
				}

				const strategy = result.plan.strategy;
				const subtaskCount = result.subtasks.length;
				this.addSystemMessage(
					`Task classified as ${complexity} (confidence: ${(result.classification.confidence * 100).toFixed(0)}%) ` +
						`— niyanta strategy: ${strategy}, ${subtaskCount} subtask(s)`,
				);
				log.debug(`niyanta plan: ${result.plan.name}, subtasks: ${subtaskCount}`);
			} catch (err) {
				log.warn("Task classification failed, using single-agent mode", err);
			}
		}

		this.task = {
			description,
			phase: "planning",
			branchName: null,
			plan: null,
			filesModified: [],
			testsPassed: null,
			error: null,
			orchestrationMode,
			complexity,
			validationAttempt: 0,
			validationResults: [],
		};

		if (orchestrationMode === "multi" && this.orchestrator) {
			this.orchestrator.setChitraguptaMemory(this.state.chitraguptaMemory.value || undefined);
			const cfg = prepareMeshCluster({
				description,
				result: classificationResult ?? (await this.classifier!.classifyAndGetTopology(description)),
				state: this.state,
				orchestrationConfig: this.options.orchestrationConfig,
				maxValidationRetries: this.options.maxValidationRetries ?? 3,
			});
			for (const reason of cfg.reasons) {
				this.addSystemMessage(reason);
			}
			if (cfg.escalateToSabha) {
				const escalated = await maybeEscalateMeshSabha(
					this.state.chitraguptaObserver.value,
					`Mesh integrity escalation: ${description}`,
					this.state.scarlettIntegrityReport.value.summary,
				);
				if (escalated) this.addSystemMessage("Scarlett requested Sabha oversight before mesh execution.");
			}
			const cs = await this.orchestrator.spawn(cfg);
			this.task.clusterId = cs.id;
			this.state.clusterId.value = cs.id;
			this.state.clusterAgentCount.value = cs.agents.size;
			this.state.clusterPhase.value = cs.phase;
			this.orchestrator.on((evt) => {
				if (evt.type === "phase_change") {
					this.state.clusterPhase.value = evt.newPhase;
					this.state.streamingText.value = "";
					this.state.agentPhase.value = `Cluster ${evt.newPhase}`;
				} else if (evt.type === "validation_complete") {
					this.state.clusterValidationAttempt.value = evt.attempt;
				}
			});
		}

		this.state.codingPhase.value = "planning";
		this.addSystemMessage(`Starting coding task (${orchestrationMode} mode): ${description}`);
		await observeExecutorEvents(this.state, [
			{
				type: "executor_run",
				runId,
				status: "started",
				sessionId: boundSessionId,
				projectPath: process.cwd(),
				mode: orchestrationMode,
				description,
				laneIds: Object.values(this.state.routingDecisions.value)
					.map((decision) => decision.selected?.id)
					.filter((value): value is string => Boolean(value)),
				timestamp: Date.now(),
			},
		]);

		try {
			if (orchestrationMode === "multi" && this.orchestrator && this.task.clusterId) {
				this.addSystemMessage(PHASE_LABELS.planning);
				this.state.isStreaming.value = true;
				this.state.streamingText.value = "";
				this.state.agentPhase.value = "Cluster running...";
				this.orchestrator.onAgentText = (_agentId, delta) => {
					this.state.isStreaming.value = true;
					this.state.streamingText.value += delta;
				};
				for await (const evt of this.orchestrator.execute(description)) {
					if (evt.type === "phase_change") {
						this.state.clusterPhase.value = evt.newPhase;
						this.state.codingPhase.value = evt.newPhase.toLowerCase() as CodingPhase;
					} else if (evt.type === "validation_complete") {
						this.state.clusterValidationAttempt.value = evt.attempt;
						this.task.validationAttempt = evt.attempt;
						this.task.validationResults = evt.results;
						const rejections = evt.results.filter((r) => r.decision === "REJECT");
						const passed = rejections.length === 0;
						this.addSystemMessage(
							`Validation attempt ${evt.attempt}: ${passed ? "✓ Approved" : `✗ Rejected by ${rejections.length} validator(s)`}`,
						);
						if (!passed) {
							void maybeEscalateWeakConsensusToSabha({
								observer: this.state.chitraguptaObserver.value,
								description,
								results: evt.results,
								attempt: evt.attempt,
								orchestrationConfig: this.options.orchestrationConfig,
							}).then((escalated) => {
								if (escalated) this.addSystemMessage("Weak mesh consensus escalated to Sabha.");
							});
						}
						// Surface results dialog when any validator rejects
						if (!passed) {
							this.state.validationResultsDialog.open(evt.results);
							this.state.pushDialog("validation-results");
						}
					} else if (evt.type === "cluster_complete") {
						this.addSystemMessage(
							evt.success
								? "Multi-agent task completed successfully!"
								: "Cluster finished (validation not fully passed).",
						);
					} else if (evt.type === "cluster_error") {
						throw new Error(evt.error);
					}
				}
			} else {
				this.addSystemMessage(PHASE_LABELS.planning);
				await runSingleAgentFlow({
					task: this.task,
					state: this.state,
					runner: this.runner,
					addSystemMessage: (text) => this.addSystemMessage(text),
				});
			}

			if (this.stopRequestedReason) {
				this.finalizeStop(this.stopRequestedReason);
				return;
			}

			this.task.phase = "done";
			this.state.codingPhase.value = "done";
			this.addSystemMessage("Coding task complete!");
			await observeExecutorEvents(this.state, [
				{
					type: "executor_artifact",
					artifactType: "summary",
					sessionId: boundSessionId,
					projectPath: process.cwd(),
					summary: description,
					metadata: {
						orchestrationMode,
						clusterId: this.task.clusterId,
						validationAttempts: this.task.validationAttempt ?? 0,
					},
					timestamp: Date.now(),
				},
				{
					type: "executor_run",
					runId,
					status: "completed",
					sessionId: boundSessionId,
					projectPath: process.cwd(),
					mode: orchestrationMode,
					description,
					artifacts: ["summary"],
					validationStatus:
						(this.task.validationResults?.length ?? 0) === 0
							? "not-run"
							: this.task.validationResults?.some((result) => result.decision === "REJECT")
								? "failed"
								: "passed",
					timestamp: Date.now(),
				},
			]);
			await this.recordSabhaOutcome(boundSessionId, 0.85);
			if (this.options.autoPr || this.options.autoShip) {
				await createPullRequestViaGh(
					this.task?.description ?? "Automated changes",
					this.options.autoShip ?? false,
					(t) => this.addSystemMessage(t),
				);
			}
		} catch (err) {
			if (this.stopRequestedReason) {
				this.finalizeStop(this.stopRequestedReason);
				log.info(`Coding task stopped: ${this.stopRequestedReason}`);
				return;
			}

			const message = err instanceof Error ? err.message : String(err);
			this.task.error = message;
			this.task.phase = "idle";
			this.state.codingPhase.value = "idle";
			this.addSystemMessage(`Coding task failed: ${message}`);
			await observeExecutorEvents(this.state, [
				{
					type: "executor_artifact",
					artifactType: "postmortem",
					sessionId: boundSessionId,
					projectPath: process.cwd(),
					summary: message,
					timestamp: Date.now(),
				},
				{
					type: "executor_run",
					runId,
					status: "failed",
					sessionId: boundSessionId,
					projectPath: process.cwd(),
					mode: orchestrationMode,
					description,
					artifacts: ["postmortem"],
					validationStatus: "failed",
					timestamp: Date.now(),
				},
			]);
			await this.recordSabhaOutcome(boundSessionId, 0.35);
			log.error("Coding task failed", err);
		} finally {
			if (this.orchestrator && this.task?.clusterId) {
				await this.orchestrator.shutdown();
			}
			this.state.isStreaming.value = false;
			this.state.streamingText.value = "";
			this.state.agentPhase.value = "idle";
			this.state.clusterId.value = null;
			this.state.clusterPhase.value = "idle";
			this.state.clusterAgentCount.value = 0;
			this.state.clusterValidationAttempt.value = 0;
			this.stopRequestedReason = null;
		}
	}

	async resume(clusterId: string): Promise<void> {
		if (!this.orchestrator) {
			this.addSystemMessage("Orchestration is not enabled — use /code with orchestration.");
			return;
		}
		this.orchestrator.setChitraguptaMemory(this.state.chitraguptaMemory.value || undefined);
		const state = await this.orchestrator.resume(clusterId);
		if (!state) {
			this.addSystemMessage(`No checkpoint found for cluster: ${clusterId}`);
			return;
		}
		this.state.clusterId.value = state.id;
		this.state.clusterPhase.value = state.phase;
		this.state.clusterAgentCount.value = state.agents.size;
		this.state.clusterValidationAttempt.value = state.validationAttempt;
		this.addSystemMessage(`Resuming cluster ${clusterId} from phase ${state.phase}…`);

		try {
			this.state.isStreaming.value = true;
			this.state.streamingText.value = "";
			this.state.agentPhase.value = "Cluster running...";
			this.orchestrator.onAgentText = (_agentId, delta) => {
				this.state.isStreaming.value = true;
				this.state.streamingText.value += delta;
			};
			for await (const evt of this.orchestrator.execute(state.config.taskDescription)) {
				if (evt.type === "phase_change") {
					this.state.clusterPhase.value = evt.newPhase;
				} else if (evt.type === "validation_complete") {
					this.state.clusterValidationAttempt.value = evt.attempt;
				} else if (evt.type === "cluster_complete") {
					if (this.stopRequestedReason) {
						this.addSystemMessage(`Cluster resume stopped: ${this.stopRequestedReason}`);
						return;
					}
					this.addSystemMessage(`Cluster resumed and completed — success: ${evt.success}`);
				} else if (evt.type === "cluster_error") {
					this.addSystemMessage(`Cluster error: ${evt.error}`);
				}
			}
			if (this.stopRequestedReason) {
				this.addSystemMessage(`Cluster resume stopped: ${this.stopRequestedReason}`);
			}
		} catch (err) {
			if (this.stopRequestedReason) {
				this.addSystemMessage(`Cluster resume stopped: ${this.stopRequestedReason}`);
				return;
			}
			throw err;
		} finally {
			this.state.isStreaming.value = false;
			this.state.streamingText.value = "";
			this.state.agentPhase.value = "idle";
			this.state.clusterId.value = null;
			this.state.clusterPhase.value = "idle";
			this.stopRequestedReason = null;
		}
	}

	async shutdown(): Promise<void> {
		this._disposeCommandEffect?.();
		this._disposeCommandEffect = null;
		if (this.isActive && !this.stopRequestedReason) {
			await this.cancel("Coding task shutdown requested.");
		}
		if (this.orchestrator) {
			await this.orchestrator.shutdown();
		}
	}

	getOrchestrator(): ClusterOrchestrator | null {
		return this.orchestrator;
	}

	async dispose(): Promise<void> {
		this._disposeCommandEffect?.();
		this._disposeCommandEffect = null;
		await this.shutdown();
	}

	private async handleClusterCommand(cmd: ClusterCommandEvent): Promise<void> {
		await handleClusterCommand(
			{
				orchestrator: this.orchestrator,
				state: this.state,
				isActive: () => this.isActive,
				resume: async (taskId) => this.resume(taskId),
				addSystemMessage: (text) => this.addSystemMessage(text),
			},
			cmd,
		);
	}

	private addSystemMessage(text: string): void {
		const msg: Message = {
			id: `code-${Date.now()}-${this.messageSeq++}`,
			role: "assistant",
			content: [{ type: "text", text: `[/code] ${text}` }],
			timestamp: Date.now(),
		};
		this.state.addMessage(msg);
	}

	private finalizeStop(reason: string): void {
		if (this.task) {
			this.task.error = reason;
			this.task.phase = "idle";
		}
		this.state.codingPhase.value = "idle";
		this.addSystemMessage(`Coding task stopped: ${reason}`);
	}

	private async recordSabhaOutcome(sessionId: string, confidence: number): Promise<void> {
		const sabhaId = this.state.lastSabhaId.value;
		const observer = this.state.chitraguptaObserver.value;
		if (!sabhaId || !observer) {
			return;
		}

		try {
			await observer.sabhaRecord({
				id: sabhaId,
				sessionId,
				project: process.cwd(),
				category: "executor-run",
				confidence,
			});
		} catch (error) {
			log.debug(`Failed to record Sabha executor outcome: ${(error as Error).message}`);
		}
	}
}
