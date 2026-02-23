/**
 * @file mixture-of-agents.ts
 * @module cluster/mixture-of-agents
 *
 * Mixture-of-Agents (MoA): Multi-Round Collaborative Validation
 *
 * **Paper:** "Mixture-of-Agents Enhances Large Language Model Capabilities"
 * Wang et al., arXiv:2406.04692 (June 2024)
 *
 * ## Key Insight
 * LLMs produce better outputs when they can see and critique each other's work iteratively:
 * 1. Round 1: Multiple agents generate initial solutions independently
 * 2. Round 2: Agents see Round 1 outputs, refine and improve
 * 3. Round 3: Agents see Round 2 outputs, converge on best solution
 * 4. Final: Aggregate the refined outputs via voting or reranking
 *
 * Result: AlpacaEval 2.0 score of 65.1%, surpassing GPT-4o (57.5%)
 *
 * ## Implementation Strategy
 * For Takumi's validation phase:
 * - **Round 1**: K validators review worker output independently (no cross-talk)
 * - **Round 2**: Each validator sees others' critiques, can refine their decision
 * - **Round 3**: Validators reach consensus or weighted vote
 * - **Aggregation**: Use weighted voting with confidence from refined critiques
 *
 * This prevents scenarios where one validator misses an issue that others caught,
 * or where a validator is overly harsh without seeing alternative perspectives.
 *
 * ## Integration with Takumi
 * - Extends existing blind validation pattern
 * - Compatible with weighted-voting.ts for final aggregation
 * - Each round uses lower temperature (0.2 → 0.1 → 0.05 for convergence)
 * - Tracks token usage across all rounds
 *
 * @see https://arxiv.org/abs/2406.04692
 */

import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload } from "../loop.js";
import type { PhaseContext } from "./phases.js";
import { ValidationDecision, type ValidationResult } from "./types.js";
import { type ValidatorVote, weightedMajority } from "./weighted-voting.js";

const log = createLogger("cluster-moa");

// ─── Type Definitions ────────────────────────────────────────────────────────

/** Configuration for MoA multi-round validation. */
export interface MoAConfig {
	/** Number of refinement rounds (default: 2, range: 1-3). */
	rounds: number;
	/** Number of validators per round (default: 3). */
	validatorCount: number;
	/** Whether validators can see each other's feedback (default: true). */
	allowCrossTalk: boolean;
	/** Temperature schedule for rounds (default: [0.2, 0.1, 0.05]). */
	temperatures: number[];
}

/** State of a validator across multiple rounds. */
export interface ValidatorState {
	/** Unique validator ID. */
	validatorId: string;
	/** Current decision (may change across rounds). */
	decision: ValidationDecision;
	/** Current reasoning (refined each round). */
	reasoning: string;
	/** Confidence in decision (0-1, increases with consensus). */
	confidence: number;
	/** History of decisions from past rounds. */
	history: Array<{ round: number; decision: ValidationDecision; reasoning: string }>;
}

/** Result of a single MoA round. */
export interface MoARoundResult {
	/** Round number (1-indexed). */
	round: number;
	/** Validator states after this round. */
	validators: ValidatorState[];
	/** Intermediate aggregated decision. */
	aggregatedDecision: ValidationDecision;
	/** Consensus score (0-1, higher = more agreement). */
	consensus: number;
	/** Token usage for this round. */
	tokenUsage: { input: number; output: number };
}

/** Final result of MoA validation. */
export interface MoAResult {
	/** All rounds executed. */
	rounds: MoARoundResult[];
	/** Final aggregated decision. */
	finalDecision: ValidationDecision;
	/** Final consensus score. */
	finalConsensus: number;
	/** Average confidence across validators. */
	averageConfidence: number;
	/** Total token usage across all rounds. */
	totalTokenUsage: { input: number; output: number };
}

// ─── MoA Validation Engine ───────────────────────────────────────────────────

/**
 * Executes multi-round MoA validation with iterative refinement.
 *
 * Process:
 * 1. Round 1: Validators review task output independently (blind validation)
 * 2. Round 2+: Validators see others' critiques, refine their own decisions
 * 3. After each round, calculate consensus and check for early convergence
 * 4. Final: Aggregate using weighted voting with refined confidence scores
 *
 * @param ctx - Phase context (for LLM calls)
 * @param evaluator - AgentEvaluator for heuristic scoring
 * @param taskOutput - The work product to validate
 * @param taskDescription - Original task description
 * @param config - MoA configuration
 * @returns Final validation result with all rounds and token usage
 *
 * @example
 * ```ts
 * const result = await moaValidate(ctx, evaluator, workerOutput, taskDesc, {
 *   rounds: 2,
 *   validatorCount: 3,
 *   allowCrossTalk: true,
 *   temperatures: [0.2, 0.1]
 * });
 * console.log(result.finalDecision); // APPROVE | REJECT | NEEDS_INFO
 * console.log(result.finalConsensus); // 0.87 (high agreement)
 * ```
 */
export async function moaValidate(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	taskOutput: string,
	taskDescription: string,
	config: Partial<MoAConfig> = {},
): Promise<MoAResult> {
	const cfg: MoAConfig = {
		rounds: config.rounds ?? 2,
		validatorCount: config.validatorCount ?? 3,
		allowCrossTalk: config.allowCrossTalk ?? true,
		temperatures: config.temperatures ?? [0.2, 0.1, 0.05],
	};

	log.info(`Starting MoA validation: ${cfg.rounds} rounds, ${cfg.validatorCount} validators`);

	const rounds: MoARoundResult[] = [];
	let validatorStates: ValidatorState[] = [];

	// Initialize validator states
	for (let i = 0; i < cfg.validatorCount; i++) {
		validatorStates.push({
			validatorId: `validator_${i + 1}`,
			decision: ValidationDecision.NEEDS_INFO,
			reasoning: "",
			confidence: 0.5,
			history: [],
		});
	}

	// Execute rounds
	for (let round = 1; round <= cfg.rounds; round++) {
		const temperature = cfg.temperatures[round - 1] ?? 0.2;
		log.info(`MoA Round ${round}/${cfg.rounds} (temp=${temperature})`);

		const roundResult = await executeRound(
			ctx,
			evaluator,
			taskOutput,
			taskDescription,
			validatorStates,
			round,
			temperature,
			cfg.allowCrossTalk,
		);

		rounds.push(roundResult);
		validatorStates = roundResult.validators;

		// Early convergence: if consensus > 0.9, stop early
		if (roundResult.consensus > 0.9 && round < cfg.rounds) {
			log.info(`Early convergence at round ${round} (consensus=${roundResult.consensus.toFixed(2)})`);
			break;
		}
	}

	// Aggregate final decision
	const finalRound = rounds[rounds.length - 1];
	const totalTokens = rounds.reduce(
		(acc, r) => ({
			input: acc.input + r.tokenUsage.input,
			output: acc.output + r.tokenUsage.output,
		}),
		{ input: 0, output: 0 },
	);

	const avgConfidence = validatorStates.reduce((sum, v) => sum + v.confidence, 0) / validatorStates.length;

	return {
		rounds,
		finalDecision: finalRound.aggregatedDecision,
		finalConsensus: finalRound.consensus,
		averageConfidence: avgConfidence,
		totalTokenUsage: totalTokens,
	};
}

/**
 * Executes a single MoA round: validators review + refine.
 */
async function executeRound(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	taskOutput: string,
	taskDescription: string,
	validatorStates: ValidatorState[],
	round: number,
	temperature: number,
	allowCrossTalk: boolean,
): Promise<MoARoundResult> {
	const updatedStates: ValidatorState[] = [];
	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	// Parallel validation (all validators run concurrently)
	await Promise.all(
		validatorStates.map(async (state) => {
			const prompt = buildValidatorPrompt(taskDescription, taskOutput, state, validatorStates, round, allowCrossTalk);

			const messages: MessagePayload[] = [{ role: "user", content: prompt }];

			let response = "";
			try {
				for await (const event of ctx.sendMessage(messages, VALIDATOR_SYSTEM_PROMPT, [], undefined, {
					model: ctx.getModelForRole?.("VALIDATOR" as any),
					// @ts-expect-error - temperature property
					temperature,
				})) {
					if (event.type === "text_delta") {
						response += event.text;
					}
					if (event.type === "usage_update") {
						totalInputTokens += event.usage.inputTokens;
						totalOutputTokens += event.usage.outputTokens;
					}
				}
			} catch (err) {
				log.error(`Validator ${state.validatorId} failed in round ${round}: ${err}`);
				response = "ERROR: Unable to complete validation";
			}

			// Parse decision and reasoning
			const decision = parseDecision(response);
			const reasoning = extractReasoning(response);
			const heuristicReport = evaluator.evaluate(state.validatorId, "moa", "validation task", response);

			// Update state
			state.history.push({ round, decision: state.decision, reasoning: state.reasoning });
			state.decision = decision;
			state.reasoning = reasoning;
			state.confidence = heuristicReport.overallScore / 10; // Convert 0-10 to 0-1

			updatedStates.push(state);
		}),
	);

	// Aggregate decisions using weighted voting
	const votes: ValidatorVote[] = updatedStates.map((state) => ({
		validatorId: state.validatorId,
		decision: state.decision,
		confidence: state.confidence,
		reasoning: state.reasoning,
		heuristicScore: state.confidence * 10,
	}));

	const votingResult = weightedMajority(votes);
	const consensus = calculateConsensus(updatedStates);

	return {
		round,
		validators: updatedStates,
		aggregatedDecision: votingResult.decision,
		consensus,
		tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
	};
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Builds the validation prompt for a single validator in a specific round.
 */
function buildValidatorPrompt(
	taskDescription: string,
	taskOutput: string,
	currentValidator: ValidatorState,
	allValidators: ValidatorState[],
	round: number,
	allowCrossTalk: boolean,
): string {
	let prompt = `**Task:**
${taskDescription}

**Output to Validate:**
${taskOutput.slice(0, 2000)}${taskOutput.length > 2000 ? "\n...(truncated)" : ""}

`;

	// Round 1: No cross-talk (blind validation)
	if (round === 1) {
		prompt += `**Instructions:**
Review the output carefully. Provide your decision: APPROVE, REJECT, or NEEDS_INFO.
Explain your reasoning clearly.`;
	} else if (allowCrossTalk) {
		// Round 2+: Show other validators' feedback
		const otherValidators = allValidators.filter((v) => v.validatorId !== currentValidator.validatorId);
		prompt += `**Other Validators' Feedback (Round ${round - 1}):**
${otherValidators.map((v) => `- ${v.validatorId}: ${v.decision} - ${v.reasoning.slice(0, 150)}...`).join("\n")}

**Your Previous Decision (Round ${round - 1}):**
${currentValidator.decision}: ${currentValidator.reasoning.slice(0, 150)}...

**Instructions:**
Review your previous decision and the feedback from other validators.
Refine your analysis. You may change your decision if you now see issues or strengths you missed.
Provide your updated decision: APPROVE, REJECT, or NEEDS_INFO.`;
	}

	return prompt;
}

const VALIDATOR_SYSTEM_PROMPT = `You are a meticulous code validator in a multi-agent system.

Your role:
1. Review the task output for correctness, completeness, and quality
2. Consider feedback from other validators (if provided)
3. Provide a clear decision: APPROVE, REJECT, or NEEDS_INFO
4. Explain your reasoning concisely but thoroughly

Decision criteria:
- APPROVE: Output fully satisfies the task, no issues
- NEEDS_INFO: Output is on the right track but needs fixes
- REJECT: Output is fundamentally incorrect or off-task

Output format:
Decision: <APPROVE|REJECT|NEEDS_INFO>
Reasoning: <explanation>`;

/**
 * Parses a ValidationDecision from LLM response text.
 */
function parseDecision(response: string): ValidationDecision {
	const upper = response.toUpperCase();
	if (upper.includes("DECISION: APPROVE") || upper.includes("DECISION:APPROVE")) {
		return ValidationDecision.APPROVE;
	}
	if (upper.includes("DECISION: REJECT") || upper.includes("DECISION:REJECT")) {
		return ValidationDecision.REJECT;
	}
	return ValidationDecision.NEEDS_INFO;
}

/**
 * Extracts reasoning text from LLM response (looks for "Reasoning:" line).
 */
function extractReasoning(response: string): string {
	const match = response.match(/Reasoning:\s*(.+)/is);
	return match ? match[1].trim().slice(0, 500) : response.slice(0, 500);
}

/**
 * Calculates consensus score: how much validators agree (0-1).
 * 1.0 = unanimous, 0.0 = complete disagreement.
 */
function calculateConsensus(validators: ValidatorState[]): number {
	const decisions = validators.map((v) => v.decision);
	const counts: Record<ValidationDecision, number> = {
		[ValidationDecision.APPROVE]: 0,
		[ValidationDecision.REJECT]: 0,
		[ValidationDecision.NEEDS_INFO]: 0,
	};

	for (const d of decisions) {
		counts[d]++;
	}

	const maxCount = Math.max(...Object.values(counts));
	return maxCount / validators.length;
}
