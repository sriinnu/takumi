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

import type { AgentEvent } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { agentLoop } from "../loop.js";
import type { ToolRegistry } from "../tools/registry.js";
import { FIXER_PROMPT, getValidatorPrompt, getWorkerPrompt, PLANNER_PROMPT } from "./prompts.js";
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

const log = createLogger("cluster-phases");

/** Minimum heuristic score (0–10) to proceed to LLM validation. */
const HEURISTIC_PASS = 4.0;

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
	 * @returns The full text response from the LLM.
	 */
	async runAgent(agent: AgentInstance, systemPrompt: string, userMessage: string): Promise<string> {
		this.ctx.updateAgentStatus(agent.id, AgentStatus.THINKING);

		const enrichedSystem = this.ctx.chitraguptaMemory
			? `${systemPrompt}\n\n## Project Memory (from Chitragupta)\n${this.ctx.chitraguptaMemory}`.trim()
			: systemPrompt;
		const modelOverride = this.ctx.getModelForRole?.(agent.role);
		const callOptions = modelOverride ? { model: modelOverride } : undefined;
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
			state.plan = await this.runAgent(planner, PLANNER_PROMPT, userMsg);
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
	 * Worker receives the planner's output (if any) via `getWorkerPrompt()`.
	 *
	 * @yields Nothing directly — side-effect is `state.workProduct` being set.
	 */
	async *runExecutionPhase(): AsyncGenerator<ClusterEvent> {
		const state = this.ctx.getState();
		this.ctx.setPhase(ClusterPhase.EXECUTING);

		const worker = this.getAgentByRole(state, AgentRole.WORKER);
		if (!worker) throw new Error("No WORKER agent in cluster");

		// Build the user message: include the plan and working directory so the
		// worker knows exactly where to create / modify files.
		const userMsg = state.plan
			? `Plan:\n${state.plan}\n\nWorking directory: ${this.ctx.workDir}\n\nImplement this plan now.`
			: `Task: ${state.config.taskDescription}\n\nWorking directory: ${this.ctx.workDir}\n\nImplement this task.`;

		try {
			// getWorkerPrompt imported from prompts.ts
			const response = await this.runAgent(worker, getWorkerPrompt(!!state.plan), userMsg);

			// Store work product — diff/files are populated by tool-use in real flow
			state.workProduct = {
				filesModified: [],
				diff: "",
				summary: response,
				testResults: undefined,
				buildResults: undefined,
			};
			await this.ctx.saveCheckpoint();
			log.info("Execution phase complete");
			yield {
				type: "phase_change",
				clusterId: state.id,
				oldPhase: ClusterPhase.EXECUTING,
				newPhase: ClusterPhase.VALIDATING,
				timestamp: Date.now(),
			};
		} catch (err) {
			log.error("Execution phase failed", err);
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

		// ── 2. LLM validators in parallel (blind validation) ────────────────
		const results = await Promise.all(validators.map((v) => this.runValidator(v, state.workProduct!)));
		state.validationResults = results;
		const decision = this.aggregateValidationResults(state, results);
		state.finalDecision = decision;
		await this.ctx.saveCheckpoint();

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

	// ── Phase 4: Fixing ──────────────────────────────────────────────────────

	/**
	 * Ask the worker to fix the issues identified by validators.
	 * Uses {@link FIXER_PROMPT} from prompts.ts.
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

		try {
			// FIXER_PROMPT imported from prompts.ts
			const fixed = await this.runAgent(worker, FIXER_PROMPT, userMsg);
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
			const raw = await this.runAgent(validator, systemPrompt, userMsg);
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
	 * Aggregate individual validator decisions into a single cluster decision
	 * using the strategy defined in `config.validationStrategy`.
	 *
	 * | Strategy    | Rule                              |
	 * |-------------|-----------------------------------|
	 * | `none`      | Always APPROVE                    |
	 * | `single`    | At least 1 APPROVE                |
	 * | `majority`  | Strict majority APPROVE           |
	 * | `all_approve` | Zero REJECTs required           |
	 */
	aggregateValidationResults(state: ClusterState, results: ValidationResult[]): ValidationDecision {
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
