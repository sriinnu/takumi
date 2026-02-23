/**
 * CodingAgent -- structured coding workflow.
 * Plan -> Branch -> Execute -> Validate -> Review -> Commit
 *
 * Supports both single-agent and multi-agent orchestration modes.
 */

import {
	AgentRole,
	type ClusterConfig,
	ClusterOrchestrator,
	TaskClassifier,
	TaskComplexity,
	type ValidationResult,
} from "@takumi/agent";
import type { Message, ToolDefinition } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AgentRunner } from "./agent-runner.js";
import type { AppState } from "./state.js";

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

const PHASE_LABELS: Record<CodingPhase, string> = {
	idle: "Idle",
	planning: "Phase 1/6: Planning...",
	branching: "Phase 2/6: Creating branch...",
	executing: "Phase 3/6: Executing changes...",
	validating: "Phase 4/6: Validating...",
	reviewing: "Phase 5/6: Self-review...",
	committing: "Phase 6/6: Committing...",
	done: "Done",
};

export interface CodingAgentOptions {
	/** Enable multi-agent orchestration (default: false) */
	enableOrchestration?: boolean;
	/** Maximum validation retry attempts (default: 3) */
	maxValidationRetries?: number;
}

export class CodingAgent {
	private state: AppState;
	private runner: AgentRunner;
	private task: CodingTask | null = null;
	private messageSeq = 0;
	private options: CodingAgentOptions;
	private classifier: TaskClassifier | null = null;
	private orchestrator: ClusterOrchestrator | null = null;

	constructor(state: AppState, runner: AgentRunner, options: CodingAgentOptions = {}) {
		this.state = state;
		this.runner = runner;
		this.options = {
			enableOrchestration: options.enableOrchestration ?? false,
			maxValidationRetries: options.maxValidationRetries ?? 3,
		};

		// Initialize classifier and orchestrator if orchestration is enabled
		if (this.options.enableOrchestration) {
			// Use the public getter — avoids unsafe bracket-notation private access
			const sendFn = this.runner.getSendMessageFn();
			this.classifier = new TaskClassifier({
				sendMessage: (messages, system) => sendFn(messages, system),
				// Pass active model so router infers the right provider family
				currentModel: this.state.model.value,
			});

			const chitragupta = this.state.chitraguptaBridge.value;
			this.orchestrator = new ClusterOrchestrator({
				sendMessage: (messages, system, tools, signal, options) =>
					sendFn(messages, system, tools as ToolDefinition[] | undefined, signal, options),
				chitragupta: chitragupta ?? undefined,
				enableCheckpoints: true,
				chitraguptaMemory: this.state.chitraguptaMemory.value || undefined,
				tools: this.runner.getTools(),
			});
		}
	}

	get currentTask(): CodingTask | null {
		return this.task;
	}

	get isActive(): boolean {
		return this.task !== null && this.task.phase !== "idle" && this.task.phase !== "done";
	}

	/** Start a new coding task. */
	async start(description: string, forceMode?: "single" | "multi"): Promise<void> {
		// Determine orchestration mode
		let orchestrationMode: "single" | "multi" = "single";
		let complexity: TaskComplexity | undefined;

		if (forceMode) {
			orchestrationMode = forceMode;
		} else if (this.options.enableOrchestration && this.classifier) {
			// Auto-classify using niyanta plan + LLM complexity classification in parallel
			try {
				const result = await this.classifier.classifyAndGetTopology(description);
				complexity = result.classification.complexity;

				// Apply per-role model overrides from the router
				if (this.orchestrator && complexity) {
					const router = this.classifier.router;
					this.orchestrator.setModelOverrides({
						[AgentRole.WORKER]: result.recommendedModel.model,
						[AgentRole.PLANNER]: router.recommend(complexity, "PLANNER").model,
						[AgentRole.VALIDATOR_REQUIREMENTS]: router.recommend(complexity, "VALIDATOR_REQUIREMENTS").model,
						[AgentRole.VALIDATOR_CODE]: router.recommend(complexity, "VALIDATOR_CODE").model,
						[AgentRole.VALIDATOR_SECURITY]: router.recommend(complexity, "VALIDATOR_SECURITY").model,
						[AgentRole.VALIDATOR_TESTS]: router.recommend(complexity, "VALIDATOR_TESTS").model,
						[AgentRole.VALIDATOR_ADVERSARIAL]: router.recommend(complexity, "VALIDATOR_ADVERSARIAL").model,
					});
				}

				// Use multi-agent for STANDARD and CRITICAL tasks
				if (complexity === TaskComplexity.STANDARD || complexity === TaskComplexity.CRITICAL) {
					orchestrationMode = "multi";
				}

				// Log niyanta's recommended coordination strategy for observability
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

		// Wire cluster signals when running in multi-agent mode
		if (orchestrationMode === "multi" && this.orchestrator) {
			// Refresh Chitragupta memory before spawning
			this.orchestrator.setChitraguptaMemory(this.state.chitraguptaMemory.value || undefined);
			const cfg: ClusterConfig = {
				roles: [AgentRole.PLANNER, AgentRole.WORKER, AgentRole.VALIDATOR_CODE, AgentRole.VALIDATOR_REQUIREMENTS],
				topology: "hierarchical",
				validationStrategy: "majority",
				maxRetries: this.options.maxValidationRetries ?? 3,
				taskDescription: description,
				isolationMode: this.state.isolationMode.value,
			};
			const cs = await this.orchestrator.spawn(cfg);
			this.task.clusterId = cs.id;
			this.state.clusterId.value = cs.id;
			this.state.clusterAgentCount.value = cs.agents.size;
			this.state.clusterPhase.value = cs.phase;
			// Keep signals in sync with cluster events
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

		try {
			if (orchestrationMode === "multi" && this.orchestrator && this.task.clusterId) {
				// ── Multi-agent path ─────────────────────────────────────────────
				// Drive the cluster through PLANNING → EXECUTING → VALIDATING → DONE.
				// Events are forwarded to state signals so the TUI stays in sync.
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
						const passed = evt.decision === "APPROVE";
						this.addSystemMessage(
							`Validation attempt ${evt.attempt}: ${passed ? "✓ Approved" : `✗ Rejected by ${evt.results.filter((r) => r.decision === "REJECT").length} validator(s)`}`,
						);
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
				// ── Single-agent path ────────────────────────────────────────────
				this.addSystemMessage(PHASE_LABELS.planning);
				await this.plan();
				await this.branch();
				await this.execute();
				await this.validate();
				await this.review();
				await this.commit();
			}

			this.task.phase = "done";
			this.state.codingPhase.value = "done";
			this.addSystemMessage("Coding task complete!");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.task.error = message;
			this.task.phase = "idle";
			this.state.codingPhase.value = "idle";
			this.addSystemMessage(`Coding task failed: ${message}`);
			log.error("Coding task failed", err);
		} finally {
			// Clear cluster signals and clean up orchestrator
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
		}
	}

	/**
	 * Resume a previously checkpointed cluster and continue execution.
	 * If the orchestrator is not enabled, shows an error message.
	 *
	 * @param clusterId - The cluster ID from a prior checkpoint.
	 */
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
		// Update signals to reflect resumed state
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
					this.addSystemMessage(`Cluster resumed and completed — success: ${evt.success}`);
				} else if (evt.type === "cluster_error") {
					this.addSystemMessage(`Cluster error: ${evt.error}`);
				}
			}
		} finally {
			this.state.isStreaming.value = false;
			this.state.streamingText.value = "";
			this.state.agentPhase.value = "idle";
			this.state.clusterId.value = null;
			this.state.clusterPhase.value = "idle";
		}
	}

	/** Cleanly shut down the orchestrator (used by /code guard). */
	async shutdown(): Promise<void> {
		if (this.orchestrator) {
			await this.orchestrator.shutdown();
		}
	}

	/** Expose the orchestrator for TUI commands (e.g. /cluster status). */
	getOrchestrator(): ClusterOrchestrator | null {
		return this.orchestrator;
	}

	private async plan(): Promise<void> {
		this.task!.phase = "planning";
		this.state.codingPhase.value = "planning";

		const prompt = `I need you to create a detailed implementation plan for the following task.
Do NOT make any changes yet -- just analyze the codebase and produce a step-by-step plan.

Task: ${this.task!.description}

Output your plan as a numbered list of specific changes to make, including file paths.`;

		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.branching);
	}

	private async branch(): Promise<void> {
		this.task!.phase = "branching";
		this.state.codingPhase.value = "branching";

		// Generate a branch name from the description
		const slug = this.task!.description.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40);
		this.task!.branchName = `feat/${slug}`;

		const prompt = `Create a new git branch named "${this.task!.branchName}" from the current HEAD. Use the bash tool to run: git checkout -b ${this.task!.branchName}`;
		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.executing);
	}

	private async execute(): Promise<void> {
		this.task!.phase = "executing";
		this.state.codingPhase.value = "executing";

		const prompt =
			"Now implement the plan. Make all the necessary code changes using the edit and write tools. Be thorough and precise.";
		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.validating);
	}

	private async validate(): Promise<void> {
		this.task!.phase = "validating";
		this.state.codingPhase.value = "validating";

		const prompt = `Validate the changes you just made:
1. Run the build command to check for type errors
2. Run the test suite to check for regressions
3. Report the results

If there are failures, fix them before proceeding.`;

		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.reviewing);
	}

	private async review(): Promise<void> {
		this.task!.phase = "reviewing";
		this.state.codingPhase.value = "reviewing";

		const prompt = `Review all the changes you've made:
1. Run git diff to see all changes
2. Check for any issues: missing error handling, security concerns, style problems
3. Fix any issues you find
4. List all files that were modified`;

		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.committing);
	}

	private async commit(): Promise<void> {
		this.task!.phase = "committing";
		this.state.codingPhase.value = "committing";

		const prompt = `Commit all changes with a descriptive commit message that summarizes what was done. Use the bash tool to:
1. git add the modified files
2. git commit with a good message`;

		await this.runner.submit(prompt);
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
}
