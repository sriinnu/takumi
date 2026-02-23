/**
 * @file phases.ts
 * @module cluster/phases
 *
 * ClusterPhaseRunner — executes the four cluster phases on behalf of
 * {@link ClusterOrchestrator}:
 *
 *   PLANNING → EXECUTING → VALIDATING → FIXING
 *
 * Extracted into its own file so `orchestrator.ts` stays under 450 LOC.
 *
 * ## Key integration points
 * - Uses {@link AgentEvaluator} (niyanta) for zero-LLM heuristic pre-screening
 *   of the worker output before expensive LLM validators fire.
 * - Uses typed prompt strings from {@link prompts.ts}.
 *
 * @see orchestrator.ts for the public API
 * @see prompts.ts for system-prompt templates
 * @see types.ts for shared type definitions
 */

import type { AgentEvent, OrchestrationConfig } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { ChitraguptaBridge } from "@takumi/bridge";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { agentLoop } from "../loop.js";
import { getTemperatureForTask } from "../model-router.js";
import type { ToolRegistry } from "../tools/registry.js";
import { ensembleExecute, type EnsembleConfig } from "./ensemble.js";
import { FIXER_PROMPT, getValidatorPrompt, getWorkerPrompt, PLANNER_PROMPT } from "./prompts.js";
import { moaValidate, type MoAConfig, type MoAResult } from "./mixture-of-agents.js";
import { progressiveRefine } from "./progressive-refinement.js";
import {
	generateSelfCritique,
	storeCritique,
	retrievePastCritiques,
	augmentPromptWithReflexion,
	type SelfCritique,
} from "./reflexion.js";
import {
	type AgentInstance,
	AgentRole,
	AgentStatus,
	type ClusterEvent,
	ClusterPhase,
	type ClusterState,
	ValidationDecision,
	type ValidationResult,
	type WorkProduct,
} from "./types.js";
import { aggregateValidations } from "./weighted-voting.js";

const log = createLogger("cluster-phases");

/** Minimum heuristic score (0–10) to proceed to LLM validation. */
const HEURISTIC_PASS = 4.0;

/** Map ClusterPhase enum to temperature phase strings. */
const PHASE_TO_TEMPERATURE_STRING: Partial<Record<ClusterPhase, "PLANNING" | "EXECUTING" | "VALIDATING" | "FIXING">> = {
	[ClusterPhase.PLANNING]: "PLANNING",
	[ClusterPhase.EXECUTING]: "EXECUTING",
	[ClusterPhase.VALIDATING]: "VALIDATING",
	[ClusterPhase.FIXING]: "FIXING",
};

// ─── Phase Context ────────────────────────────────────────────────────────────

/**
 * Callbacks injected by {@link ClusterOrchestrator} so phase logic can
 * mutate state and emit events without importing the orchestrator directly.
 */
export interface PhaseContext {
	/** Access the live cluster state. */
	getState(): ClusterState;
	/** Transition to a new phase and broadcast the event. */
	setPhase(p: ClusterPhase): void;
	/** Update a single agent status and broadcast. */
	updateAgentStatus(id: string, s: AgentStatus, msg?: string): void;
	/** Broadcast a cluster event to all listeners. */
	emitEvent(e: ClusterEvent): void;
	/** Persist a checkpoint. */
	saveCheckpoint(): Promise<void>;
	/** Sends a message batch to the LLM and returns an event stream. */
	sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: unknown[],
		signal?: AbortSignal,
		options?: SendMessageOptions,
	): AsyncIterable<AgentEvent>;
	/**
	 * Working directory for cluster agents.
	 * Equals `process.cwd()` in "none" isolation; isolated path for worktree/docker.
	 */
	workDir: string;
	/** Optional Chitragupta memory context injected into system prompts. */
	chitraguptaMemory?: string;
	/** Optional Chitragupta bridge for Akasha memory and reflexion. */
	chitragupta?: ChitraguptaBridge;
	/** Optional model override lookup per agent role. */
	getModelForRole?: (role: AgentRole) => string | undefined;
	/** Tool registry for agents to use tools. */
	tools?: ToolRegistry;
	/**
	 * Optional streaming callback — invoked for each text token produced by an agent.
	 * Wire this to set `isStreaming = true` in the TUI so the status bar stays active.
	 *
	 * @param agentId - ID of the agent producing text.
	 * @param delta   - Incremental text chunk.
	 */
	onAgentText?: (agentId: string, delta: string) => void;
	/**
	 * Optional token-usage callback — invoked whenever an LLM call reports usage.
	 * Used by the orchestrator to accumulate real metrics for the bandit learner.
	 *
	 * @param inputTokens  - Input tokens consumed.
	 * @param outputTokens - Output tokens produced.
	 */
	onTokenUsage?: (inputTokens: number, outputTokens: number) => void;
	/** Optional orchestration config for advanced multi-agent strategies. */
	orchestrationConfig?: OrchestrationConfig;
}

// ─── Phase Runner ─────────────────────────────────────────────────────────────

/**
 * Executes the four cluster phases.
 * Instantiated once per {@link ClusterOrchestrator} instance.
 *
 * @example
 * ```ts
 * const runner = new ClusterPhaseRunner(ctx, evaluator);
 * yield* runner.runPlanningPhase();
 * ```
 */
export class ClusterPhaseRunner {
	private readonly ctx: PhaseContext;
	/** Niyanta heuristic evaluator — zero-LLM output pre-screening. */
	private readonly evaluator: AgentEvaluator;

	constructor(ctx: PhaseContext, evaluator: AgentEvaluator) {
		this.ctx = ctx;
		this.evaluator = evaluator;
	}

	// ── runAgent ────────────────────────────────────────────────────────────

	/**
	 * Run an LLM call for a single agent and stream back the full response.
	 * Updates agent message history so follow-up turns have context.
	 *
	 * @param agent       - The agent instance to run.
	 * @param systemPrompt - System prompt for the LLM.
	 * @param userMessage  - User turn to send.
	 * @param phase        - Current cluster phase (for temperature calculation).
	 * @param attemptNumber - Retry attempt number (1-indexed, default: 1).
	 * @returns The full text response from the LLM.
	 */
	async runAgent(
		agent: AgentInstance,
		systemPrompt: string,
		userMessage: string,
		phase: ClusterPhase,
		attemptNumber = 1,
	): Promise<string> {
		this.ctx.updateAgentStatus(agent.id, AgentStatus.THINKING);

		const enrichedSystem = this.ctx.chitraguptaMemory
			? `${systemPrompt}\n\n## Project Memory (from Chitragupta)\n${this.ctx.chitraguptaMemory}`.trim()
			: systemPrompt;
		const modelOverride = this.ctx.getModelForRole?.(agent.role);
		
		// Calculate adaptive temperature if enabled
		const adaptiveTempConfig = this.ctx.orchestrationConfig?.adaptiveTemperature;
		const shouldUseAdaptiveTemp = adaptiveTempConfig?.enabled !== false; // Default: enabled
		const complexity: "TRIVIAL" | "SIMPLE" | "STANDARD" | "CRITICAL" = "STANDARD"; // Default complexity
		const temperaturePhase = PHASE_TO_TEMPERATURE_STRING[phase] ?? "EXECUTING";
		const temperature = shouldUseAdaptiveTemp
			? getTemperatureForTask(complexity, temperaturePhase, attemptNumber)
			: undefined; // Let provider use its default
		
		const callOptions: SendMessageOptions = {
			...(modelOverride ? { model: modelOverride } : {}),
			...(temperature !== undefined ? { temperature } : {}),
		};
		let text = "";

		try {
			if (this.ctx.tools) {
				// Use agentLoop to handle tool calls automatically
				const loop = agentLoop(userMessage, agent.messages, {
					sendMessage: (msgs, sys, tools, signal, opts) =>
						this.ctx.sendMessage(msgs, sys, tools, signal, { ...opts, ...callOptions }),
					tools: this.ctx.tools,
					systemPrompt: enrichedSystem,
				});

				for await (const ev of loop) {
					if (ev.type === "text_delta") {
						text += ev.text;
						this.ctx.onAgentText?.(agent.id, ev.text);
					} else if (ev.type === "usage_update" && this.ctx.onTokenUsage) {
						this.ctx.onTokenUsage(ev.usage.inputTokens ?? 0, ev.usage.outputTokens ?? 0);
					} else if (ev.type === "error") {
						throw ev.error;
					}
				}
				// agentLoop doesn't mutate the original history array, so we need to append the new turns
				// Actually, agentLoop doesn't return the updated messages array.
				// We might need to reconstruct it or just append the final text.
				// For now, we'll just append the user message and the final text response.
				// This is a slight simplification if tools were used, but it keeps the context manageable.
				agent.messages.push(
					{ role: "user", content: [{ type: "text", text: userMessage }] },
					{ role: "assistant", content: [{ type: "text", text }] },
				);
			} else {
				// Fallback to raw sendMessage if no tools are provided
				const messages: MessagePayload[] = [
					...agent.messages,
					{ role: "user", content: [{ type: "text", text: userMessage }] },
				];
				for await (const ev of this.ctx.sendMessage(messages, enrichedSystem, undefined, undefined, callOptions)) {
					if (ev.type === "text_delta") {
						text += ev.text;
						this.ctx.onAgentText?.(agent.id, ev.text);
					} else if (ev.type === "usage_update" && this.ctx.onTokenUsage) {
						this.ctx.onTokenUsage(ev.usage.inputTokens ?? 0, ev.usage.outputTokens ?? 0);
					} else if (ev.type === "error") {
						throw ev.error;
					}
				}
				agent.messages.push(
					{ role: "user", content: [{ type: "text", text: userMessage }] },
					{ role: "assistant", content: [{ type: "text", text }] },
				);
			}

			this.ctx.updateAgentStatus(agent.id, AgentStatus.DONE);
			agent.completedAt = Date.now();
			return text;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			agent.error = msg;
			this.ctx.updateAgentStatus(agent.id, AgentStatus.ERROR, msg);
			throw err;
		}
	}

	// ── Phase 1: Planning ────────────────────────────────────────────────────

	/**
	 * Run the planning phase using the PLANNER_PROMPT from prompts.ts.
	 * Stores the plan string in cluster state for the worker to consume.
	 *
	 * @yields Nothing directly — side-effect is `state.plan` being set.
	 */
	async *runPlanningPhase(): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		this.ctx.setPhase(ClusterPhase.PLANNING);

		// Find the planner agent
		const planner = this.getAgentByRole(state, AgentRole.PLANNER);
		if (!planner) return;

		// Inform the planner which directory to operate in (worktree / docker / cwd)
		const userMsg = `Task: ${state.config.taskDescription}\n\nWorking directory: ${this.ctx.workDir}\n\nCreate a detailed implementation plan.`;

		try {
			// PLANNER_PROMPT imported from prompts.ts
			state.plan = await this.runAgent(planner, PLANNER_PROMPT, userMsg, ClusterPhase.PLANNING, 1);
			await this.ctx.saveCheckpoint();
			log.info("Planning phase complete");
			yield {
				type: "phase_change",
				clusterId: state.id,
				oldPhase: ClusterPhase.PLANNING,
				newPhase: ClusterPhase.EXECUTING,
				timestamp: Date.now(),
			};
		} catch (err) {
			log.error("Planning phase failed", err);
			throw err;
		}
	}

	// ── Phase 2: Execution ───────────────────────────────────────────────────

	/**
	 * Run the execution phase.
	 * If ensemble is enabled, spawns K workers in parallel and selects the best.
	 * Otherwise, runs standard single-worker execution.
	 *
	 * @yields `phase_change` event after execution completes.
	 */
	async *runExecutionPhase(): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		this.ctx.setPhase(ClusterPhase.EXECUTING);

		const config = this.ctx.orchestrationConfig;
		const ensembleConfig = config?.ensemble;
		const progressiveConfig = config?.progressiveRefinement;

		// Check ensemble first (mutually exclusive with progressive)
		if (ensembleConfig?.enabled) {
			log.info(`Using ensemble execution: K=${ensembleConfig.workerCount}`);
			yield* this.runEnsembleExecution(ensembleConfig);
		}
		// Check progressive refinement second
		else if (progressiveConfig?.enabled) {
			log.info(
				`Using progressive refinement: max ${progressiveConfig.maxIterations} iterations, target ${progressiveConfig.targetScore}`,
			);
			yield* this.runProgressiveExecution(progressiveConfig);
		}
		// Fall back to standard single-worker execution
		else {
			log.info("Using standard single-worker execution");
			yield* this.runStandardExecution();
		}

		await this.ctx.saveCheckpoint();
		log.info("Execution phase complete");
		yield {
			type: "phase_change",
			clusterId: state.id,
			oldPhase: ClusterPhase.EXECUTING,
			newPhase: ClusterPhase.VALIDATING,
			timestamp: Date.now(),
		};
	}

	/**
	 * Run standard single-worker execution.
	 * @private
	 */
	private async *runStandardExecution(): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		const worker = this.getAgentByRole(state, AgentRole.WORKER);
		if (!worker) throw new Error("No WORKER agent in cluster");

		// Build the user message: include the plan and working directory so the
		// worker knows exactly where to create / modify files.
		const userMsg = state.plan
			? `Plan:\n${state.plan}\n\nWorking directory: ${this.ctx.workDir}\n\nImplement this plan now.`
			: `Task: ${state.config.taskDescription}\n\nWorking directory: ${this.ctx.workDir}\n\nImplement this task.`;

		try {
			// getWorkerPrompt imported from prompts.ts
			const response = await this.runAgent(worker, getWorkerPrompt(!!state.plan), userMsg, ClusterPhase.EXECUTING, 1);

			// Store work product — diff/files are populated by tool-use in real flow
			state.workProduct = {
				filesModified: [],
				diff: "",
				summary: response,
				testResults: undefined,
				buildResults: undefined,
			};
		} catch (err) {
			log.error("Standard execution phase failed", err);
			throw err;
		}
	}

	/**
	 * Run ensemble execution: spawn K workers, select winner via consensus.
	 * @private
	 */
	private async *runEnsembleExecution(config: EnsembleConfig): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		const worker = this.getAgentByRole(state, AgentRole.WORKER);
		if (!worker) throw new Error("No WORKER agent in cluster");

		try {
			// Call ensemble function
			const result = await ensembleExecute(
				this.ctx,
				state.config.taskDescription,
				config,
				this.evaluator,
			);

			log.info(
				`Ensemble complete: winner=${result.winner.workerId}, consensus=${(result.consensus * 100).toFixed(0)}%`,
			);

			// Store winner as work product
			state.workProduct = {
				filesModified: [],
				diff: "",
				summary: result.winner.output,
				testResults: undefined,
				buildResults: undefined,
				heuristicScore: result.winner.heuristicScore,
				metadata: {
					ensembleCandidates: result.candidates.length,
					consensusScore: result.consensus,
					avgScore:
						result.candidates.reduce((sum, c) => sum + c.heuristicScore, 0) / result.candidates.length,
				},
			};

			// Track tokens from all K workers
			if (this.ctx.onTokenUsage) {
				this.ctx.onTokenUsage(result.totalTokens.input, result.totalTokens.output);
			}

			// Emit ensemble completion event
			yield {
				type: "ensemble_complete",
				clusterId: state.id,
				candidateCount: result.candidates.length,
				winnerId: result.winner.workerId,
				timestamp: Date.now(),
			};
		} catch (err) {
			log.error("Ensemble execution phase failed", err);
			throw err;
		}
	}

	/**
	 * Run progressive refinement execution: iterative improvement via critic feedback.
	 * @private
	 */
	private async *runProgressiveExecution(
		config: NonNullable<OrchestrationConfig["progressiveRefinement"]>,
	): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		const worker = this.getAgentByRole(state, AgentRole.WORKER);
		if (!worker) throw new Error("No WORKER agent in cluster");

		try {
			// First, generate initial draft using standard execution
			log.info("Generating initial draft before refinement...");
			const userMsg = state.plan
				? `Plan:\n${state.plan}\n\nWorking directory: ${this.ctx.workDir}\n\nImplement this plan now.`
				: `Task: ${state.config.taskDescription}\n\nWorking directory: ${this.ctx.workDir}\n\nImplement this task.`;

			const initialDraft = await this.runAgent(
				worker,
				getWorkerPrompt(!!state.plan),
				userMsg,
				ClusterPhase.EXECUTING,
				1,
			);

			// Now call progressive refinement to iteratively improve the draft
			log.info("Starting progressive refinement iterations...");
			const result = await progressiveRefine(
				this.ctx,
				this.evaluator,
				state.config.taskDescription,
				initialDraft,
				{
					maxIterations: config.maxIterations,
					minImprovement: config.minImprovement,
					useCriticModel: config.useCriticModel,
					targetScore: config.targetScore,
				},
			);

			log.info(
				`Progressive refinement complete: ${result.iterations.length} iterations, ` +
					`final score ${result.finalScore.toFixed(2)}/10, ` +
					`improvement ${(result.improvement * 100).toFixed(1)}%, ` +
					`stopped: ${result.stopReason}`,
			);

			// Store final refined output as work product
			const initialScore = result.iterations[0]?.heuristicScore ?? 0;
			state.workProduct = {
				filesModified: [],
				diff: "",
				summary: result.finalOutput,
				testResults: undefined,
				buildResults: undefined,
				heuristicScore: result.finalScore,
				metadata: {
					iterations: result.iterations.length,
					stopReason: result.stopReason,
					initialScore,
					improvementRate: result.improvement,
				},
			};

			// Track tokens from all iterations
			if (this.ctx.onTokenUsage) {
				this.ctx.onTokenUsage(result.totalTokenUsage.input, result.totalTokenUsage.output);
			}

			// Emit progressive completion event
			yield {
				type: "progressive_complete",
				clusterId: state.id,
				iterationCount: result.iterations.length,
				finalScore: result.finalScore,
				stopReason: result.stopReason,
				timestamp: Date.now(),
			};
		} catch (err) {
			log.error("Progressive refinement execution phase failed", err);
			throw err;
		}
	}

	// ── Phase 3: Validation (with heuristic pre-screen) ─────────────────────

	/**
	 * Run the validation phase.
	 *
	 * ### Flow
	 * 1. **Heuristic pre-screen** via {@link AgentEvaluator} (zero LLM calls).
	 *    If score < {@link HEURISTIC_PASS}, skip to REJECT immediately — saves
	 *    expensive validator LLM calls when the output is obviously bad.
	 * 2. **LLM validators** run in parallel (blind validation pattern).
	 * 3. Decision aggregated per `config.validationStrategy`.
	 *
	 * @yields `validation_complete` event with results + decision.
	 */
	async *runValidationPhase(): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		this.ctx.setPhase(ClusterPhase.VALIDATING);
		state.validationAttempt++;

		// No validators → auto-approve
		const validators = this.getAgentsByRolePattern(state, /^VALIDATOR_/);
		if (validators.length === 0 || !state.workProduct) {
			state.finalDecision = ValidationDecision.APPROVE;
			return;
		}

		log.info(`Validation attempt ${state.validationAttempt} — ${validators.length} validators`);

		// ── 1. Heuristic pre-screen (zero LLM) ────────────────────────────
		const heuristicReport = this.evaluator.evaluate(
			"worker",
			state.id,
			state.config.taskDescription,
			state.workProduct.summary,
		);
		log.debug(`Heuristic score: ${heuristicReport.overallScore.toFixed(2)}`);

		if (heuristicReport.overallScore < HEURISTIC_PASS) {
			log.warn(`Heuristic score ${heuristicReport.overallScore.toFixed(2)} < ${HEURISTIC_PASS} — fast-reject`);
			state.finalDecision = ValidationDecision.REJECT;
			state.validationResults = [
				{
					validatorId: "heuristic",
					validatorRole: AgentRole.VALIDATOR_REQUIREMENTS,
					decision: ValidationDecision.REJECT,
					findings: [
						{
							severity: "critical",
							category: "quality",
							description: `Heuristic pre-screen failed (score ${heuristicReport.overallScore.toFixed(2)}/10)`,
						},
					],
					reasoning: "Automatic heuristic rejection — output quality below threshold.",
					confidence: 0.9,
				},
			];
			yield {
				type: "validation_complete",
				clusterId: state.id,
				attempt: state.validationAttempt,
				results: state.validationResults,
				decision: ValidationDecision.REJECT,
				timestamp: Date.now(),
			};
			return;
		}

		// ── 2. Choose validation strategy: MoA or Standard ────────────────
		const moaConfig = this.ctx.orchestrationConfig?.moA;
		if (moaConfig?.enabled) {
			yield* this.runMoAValidation(state, moaConfig);
		} else {
			yield* this.runStandardValidation(state, validators);
		}

		await this.ctx.saveCheckpoint();
	}

	// ── Standard (Single-Round) Validation ───────────────────────────────────

	/**
	 * Standard single-round validation: validators run in parallel (blind).
	 * This is the original validation strategy before MoA was introduced.
	 *
	 * @param state - Cluster state with work product.
	 * @param validators - Validator agent instances.
	 * @yields validation_complete event with aggregated decision.
	 */
	private async *runStandardValidation(
		state: ClusterState,
		validators: AgentInstance[],
	): AsyncGenerator<ClusterEvent> {
		log.info(`Standard validation: ${validators.length} validators in parallel`);

		// Run all validators in parallel (blind validation)
		const results = await Promise.all(validators.map((v) => this.runValidator(v, state.workProduct!)));
		state.validationResults = results;
		const decision = this.aggregateValidationResults(state, results);
		state.finalDecision = decision;

		yield {
			type: "validation_complete",
			clusterId: state.id,
			attempt: state.validationAttempt,
			results,
			decision,
			timestamp: Date.now(),
		};

		log.info(
			`Validation ${decision}: ${results.filter((r) => r.decision === ValidationDecision.APPROVE).length}/${results.length} approved`,
		);
	}

	// ── MoA (Multi-Round) Validation ─────────────────────────────────────────

	/**
	 * Mixture-of-Agents multi-round validation with iterative refinement.
	 * Validators see each other's critiques across rounds and converge on consensus.
	 *
	 * Based on: "Mixture-of-Agents Enhances Large Language Model Capabilities"
	 * Wang et al., arXiv:2406.04692 (June 2024)
	 *
	 * @param state - Cluster state with work product.
	 * @param config - MoA configuration (rounds, validatorCount, allowCrossTalk, temperatures).
	 * @yields moa_validation_complete event with multi-round results and final consensus.
	 */
	private async *runMoAValidation(
		state: ClusterState,
		config: Partial<MoAConfig>,
	): AsyncGenerator<ClusterEvent> {
		const workProduct = state.workProduct;
		if (!workProduct) {
			throw new Error("No work product to validate");
		}

		log.info(
			`MoA validation: ${config.rounds ?? 2} rounds, ${config.validatorCount ?? 3} validators, cross-talk=${config.allowCrossTalk ?? true}`,
		);

		// Call MoA validation engine
		const result = await moaValidate(
			this.ctx,
			this.evaluator,
			workProduct.summary,
			state.config.taskDescription,
			config,
		);

		// Convert MoA validator states to ValidationResults for cluster state
		const finalRound = result.rounds[result.rounds.length - 1];
		state.validationResults = finalRound.validators.map((v) => ({
			validatorId: v.validatorId,
			validatorRole: AgentRole.VALIDATOR_REQUIREMENTS, // Generic role for MoA validators
			decision: v.decision,
			findings: [],
			reasoning: v.reasoning,
			confidence: v.confidence,
		}));

		state.finalDecision = result.finalDecision;

		// Update workProduct metadata with MoA info
		state.workProduct = {
			...workProduct,
			metadata: {
				...workProduct.metadata,
				moaRounds: result.rounds.length,
				moaConsensus: result.finalConsensus,
				moaAverageConfidence: result.averageConfidence,
			},
		};

		// Track token usage across all rounds
		if (this.ctx.onTokenUsage) {
			this.ctx.onTokenUsage(result.totalTokenUsage.input, result.totalTokenUsage.output);
		}

		// Emit MoA-specific event
		yield {
			type: "moa_validation_complete",
			clusterId: state.id,
			rounds: result.rounds.length,
			finalDecision: result.finalDecision,
			consensus: result.finalConsensus,
			averageConfidence: result.averageConfidence,
			timestamp: Date.now(),
		};

		// Also emit standard validation_complete for compatibility
		yield {
			type: "validation_complete",
			clusterId: state.id,
			attempt: state.validationAttempt,
			results: state.validationResults,
			decision: result.finalDecision,
			timestamp: Date.now(),
		};

		log.info(
			`MoA validation complete: ${result.finalDecision} (consensus=${result.finalConsensus.toFixed(2)}, avg_confidence=${result.averageConfidence.toFixed(2)})`,
		);
	}

	// ── Phase 4: Fixing ──────────────────────────────────────────────────────

	/**
	 * Ask the worker to fix the issues identified by validators.
	 * Uses {@link FIXER_PROMPT} from prompts.ts.
	 * Optionally uses Reflexion for self-critique and learning from past failures.
	 *
	 * @yields Nothing — side-effect is `state.workProduct.summary` updated.
	 */
	async *runFixingPhase(): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		this.ctx.setPhase(ClusterPhase.FIXING);

		const worker = this.getAgentByRole(state, AgentRole.WORKER);
		if (!worker) return;

		// Summarise all rejection findings for the worker
		const findingsSummary = state.validationResults
			.filter((r) => r.decision === ValidationDecision.REJECT)
			.map((r) => {
				const lines = r.findings.map((f) => `  [${f.severity}] ${f.description}`).join("\n");
				return `${r.validatorRole}:\n${lines}\n${r.reasoning}`;
			})
			.join("\n\n");

		const userMsg = `The validators rejected your work:\n\n${findingsSummary}\n\nFix all issues and re-run tests.`;

		// Optional: Use Reflexion for self-critique and learning
		let systemPrompt = FIXER_PROMPT;
		const reflexionConfig = this.ctx.orchestrationConfig?.reflexion;
		if (reflexionConfig?.enabled && this.ctx.chitragupta && state.workProduct) {
			try {
				log.info("Generating reflexion self-critique for failed attempt");
				
				// Generate self-critique via reflexion
				const critique = await generateSelfCritique(
					this.ctx,
					state.config.taskDescription,
					state.workProduct.summary ?? "",
					state.validationResults,
				);

				// Store critique in Akasha for future learning
				if (reflexionConfig.useAkasha) {
					await storeCritique(
						this.ctx.chitragupta,
						critique,
						"CODING", // Task type for better retrieval
					);
				}

				// Retrieve similar past critiques
				const pastCritiques = await retrievePastCritiques(
					this.ctx.chitragupta,
					state.config.taskDescription,
					reflexionConfig.maxHistorySize ?? 3,
				);

				// Augment prompt with reflexion learning
				const allCritiques = [critique, ...pastCritiques];
				systemPrompt = augmentPromptWithReflexion(FIXER_PROMPT, allCritiques);

				log.info(
					`Reflexion: Generated critique with ${critique.actionItems.length} action items, retrieved ${pastCritiques.length} past learnings`,
				);
			} catch (err) {
				log.error("Reflexion failed, continuing without self-critique", err);
				// Continue with original prompt if reflexion fails
			}
		}

		try {
			// Run worker with enhanced prompt (with or without reflexion)
			// Use validationAttempt as the attempt number for temperature decay
			const fixed = await this.runAgent(worker, systemPrompt, userMsg, ClusterPhase.FIXING, state.validationAttempt);
			state.workProduct = { ...state.workProduct!, summary: fixed };
			await this.ctx.saveCheckpoint();
			log.info("Fixing phase complete");
		} catch (err) {
			log.error("Fixing phase failed", err);
			throw err;
		}
	}

	// ── Validator Helpers ────────────────────────────────────────────────────

	/**
	 * Run a single validator agent using blind validation.
	 * The validator receives ONLY the task description + work product — never
	 * the worker's conversation history (prevents anchoring bias).
	 *
	 * @param validator   - The validator agent instance.
	 * @param workProduct - The output to validate.
	 * @returns A {@link ValidationResult} with decision, findings, and reasoning.
	 */
	async runValidator(validator: AgentInstance, workProduct: WorkProduct): Promise<ValidationResult> {
		// getValidatorPrompt imported from prompts.ts — role-specific focus
		const systemPrompt = getValidatorPrompt(validator.role);

		const testLine = workProduct.testResults
			? `Tests: ${workProduct.testResults.passed ? "PASSED" : "FAILED"}\n${workProduct.testResults.output}`
			: "";
		const buildLine = workProduct.buildResults
			? `Build: ${workProduct.buildResults.success ? "SUCCESS" : "FAILED"}\n${workProduct.buildResults.output}`
			: "";
		const userMsg = [
			`Task: ${validator.context.taskDescription}`,
			`\nWork Product:\n${workProduct.summary}`,
			`\nFiles Modified: ${workProduct.filesModified.join(", ") || "None"}`,
			testLine,
			buildLine,
			'\nRespond with JSON:\n{"decision":"APPROVE"|"REJECT"|"NEEDS_INFO","findings":[{"severity":"critical"|"major"|"minor"|"info","category":"...","description":"...","suggestion":"..."}],"reasoning":"...","confidence":0.0}',
		]
			.filter(Boolean)
			.join("\n");

		try {
			// Validators use attempt 1 (they don't retry, and phase ensures low temp)
			const raw = await this.runAgent(validator, systemPrompt, userMsg, ClusterPhase.VALIDATING, 1);
			const json = JSON.parse((raw.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
			return {
				validatorId: validator.id,
				validatorRole: validator.role,
				decision: (json.decision as ValidationDecision) ?? ValidationDecision.REJECT,
				findings: json.findings ?? [],
				reasoning: json.reasoning ?? "",
				confidence: json.confidence ?? 0.5,
			};
		} catch (err) {
			log.error(`Validator ${validator.role} failed`, err);
			return {
				validatorId: validator.id,
				validatorRole: validator.role,
				decision: ValidationDecision.REJECT,
				findings: [
					{
						severity: "critical",
						category: "validation_error",
						description: `Validator threw: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				reasoning: "Validator encountered an error — defaulting to REJECT.",
				confidence: 0.1,
			};
		}
	}

	/**
	 * Aggregate individual validator decisions into a single cluster decision.
	 *
	 * If orchestration.weightedVoting is configured, uses confidence-weighted voting.
	 * Otherwise falls back to simple validation strategy:
	 *
	 * | Strategy    | Rule                              |
	 * |-------------|-----------------------------------|
	 * | `none`      | Always APPROVE                    |
	 * | `single`    | At least 1 APPROVE                |
	 * | `majority`  | Strict majority APPROVE           |
	 * | `all_approve` | Zero REJECTs required           |
	 */
	aggregateValidationResults(state: ClusterState, results: ValidationResult[]): ValidationDecision {
		// Check if weighted voting is enabled
		if (this.ctx.orchestrationConfig?.weightedVoting) {
			log.info("Using weighted voting for validation aggregation");
			const weightedResult = aggregateValidations(results, this.evaluator);
			
			log.info(
				`Weighted voting result: ${weightedResult.decision} ` +
				`(score=${(weightedResult.weightedScore * 100).toFixed(1)}%) - ${weightedResult.explanation}`,
			);
			
			return weightedResult.decision;
		}
		
		// Fallback: simple validation strategy
		log.debug("Using simple validation strategy: %s", state.config.validationStrategy);
		const approvals = results.filter((r) => r.decision === ValidationDecision.APPROVE).length;
		const rejections = results.filter((r) => r.decision === ValidationDecision.REJECT).length;
		switch (state.config.validationStrategy) {
			case "none":
				return ValidationDecision.APPROVE;
			case "single":
				return approvals > 0 ? ValidationDecision.APPROVE : ValidationDecision.REJECT;
			case "majority":
				return approvals > results.length / 2 ? ValidationDecision.APPROVE : ValidationDecision.REJECT;
			case "all_approve":
				return rejections === 0 ? ValidationDecision.APPROVE : ValidationDecision.REJECT;
			default:
				return ValidationDecision.REJECT;
		}
	}

	// ── Private State Accessors ──────────────────────────────────────────────

	/** First agent with the given role, or null. */
	private getAgentByRole(state: ClusterState, role: AgentRole): AgentInstance | null {
		return Array.from(state.agents.values()).find((a) => a.role === role) ?? null;
	}

	/** All agents whose role matches the regex. */
	private getAgentsByRolePattern(state: ClusterState, pattern: RegExp): AgentInstance[] {
		return Array.from(state.agents.values()).filter((a) => pattern.test(a.role));
	}
}
