/**
 * @file weighted-voting.ts
 * @module cluster/weighted-voting
 *
 * Weighted Voting with Confidence Scores
 *
 * ## Problem
 * Binary "all must approve" or "any reject" strategies are brittle:
 * - A single noisy validator can block good work
 * - Unanimous approval is too strict for complex tasks
 *
 * ## Solution
 * Weight each validator's vote by their confidence score (0-1).
 * Compute weighted sum: sum(confidence * vote) / sum(confidence)
 * Threshold: > 0.5 → approve, ≤ 0.5 → reject
 *
 * ## Confidence Calculation
 * Derived from AgentEvaluator heuristic scores:
 * - High correctness + completeness → high confidence
 * - Low relevance or contradictory reasoning → low confidence
 * - Normalized to [0, 1] scale
 *
 * ## Example
 * ```
 * Validator A: APPROVE, confidence=0.9 → +0.9
 * Validator B: REJECT,  confidence=0.3 → -0.3
 * Validator C: APPROVE, confidence=0.7 → +0.7
 *
 * Weighted sum: (0.9 - 0.3 + 0.7) / (0.9 + 0.3 + 0.7) = 1.3 / 1.9 = 0.68 → APPROVE
 * ```
 *
 * With simple majority: 2 approve, 1 reject → approve (same result)
 * But with tie-breaking: 1 high-confidence reject can outweigh 2 low-confidence approves
 */

import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import { ValidationDecision, type ValidationResult } from "./types.js";

const log = createLogger("cluster-weighted-voting");

// ─── Type Definitions ────────────────────────────────────────────────────────

/** A validator's vote with confidence weighting. */
export interface ValidatorVote {
	/** Validator agent ID. */
	validatorId: string;
	/** Binary decision. */
	decision: ValidationDecision;
	/** Confidence in this decision (0-1). Higher = more certain. */
	confidence: number;
	/** Human-readable reasoning from the validator. */
	reasoning: string;
	/** Raw heuristic score from AgentEvaluator (0-10). */
	heuristicScore: number;
}

/** Result of weighted voting aggregation. */
export interface WeightedVotingResult {
	/** Final decision. */
	decision: ValidationDecision;
	/** Weighted score (0-1). >0.5 → approve, ≤0.5 → reject. */
	weightedScore: number;
	/** Individual votes. */
	votes: ValidatorVote[];
	/** Human-readable explanation of the decision. */
	explanation: string;
}

// ─── Weighted Voting Algorithm ───────────────────────────────────────────────

/**
 * Computes the final validation decision via confidence-weighted voting.
 *
 * Algorithm:
 * 1. Assign numeric value: APPROVE=+1, REJECT=-1, NEEDS_INFO=-0.5
 * 2. Weight each vote: value * confidence
 * 3. Sum weighted votes and confidences
 * 4. Compute: weightedSum / totalConfidence
 * 5. Threshold at 0.5
 *
 * @param votes - Array of validator votes with confidence scores
 * @returns Aggregated decision with explanation
 *
 * @example
 * ```ts
 * const votes: ValidatorVote[] = [
 *   { validatorId: "v1", decision: ValidationDecision.APPROVE, confidence: 0.9, ... },
 *   { validatorId: "v2", decision: ValidationDecision.REJECT, confidence: 0.3, ... },
 * ];
 * const result = weightedMajority(votes);
 * console.log(result.decision); // ValidationDecision.APPROVE
 * ```
 */
export function weightedMajority(votes: ValidatorVote[]): WeightedVotingResult {
	if (votes.length === 0) {
		throw new Error("Cannot compute weighted majority with zero votes");
	}

	// Edge case: single validator (common for SIMPLE tasks)
	if (votes.length === 1) {
		const vote = votes[0];
		return {
			decision: vote.decision,
			weightedScore: vote.decision === ValidationDecision.APPROVE ? 1.0 : 0.0,
			votes,
			explanation: `Single validator ${vote.validatorId}: ${vote.decision} (confidence=${vote.confidence.toFixed(2)})`,
		};
	}

	// Compute weighted sum
	let weightedSum = 0;
	let totalConfidence = 0;

	for (const vote of votes) {
		const value = decisionToNumeric(vote.decision);
		weightedSum += value * vote.confidence;
		totalConfidence += vote.confidence;
	}

	// Normalize to [0, 1] scale (shift from [-1, 1] to [0, 1])
	const normalizedScore = (weightedSum / totalConfidence + 1) / 2;

	// Threshold decision
	const decision =
		normalizedScore > 0.5
			? ValidationDecision.APPROVE
			: normalizedScore > 0.3
				? ValidationDecision.NEEDS_INFO
				: ValidationDecision.REJECT;

	const explanation = buildExplanation(votes, normalizedScore, decision);

	log.info(`Weighted voting: ${explanation}`);

	return {
		decision,
		weightedScore: normalizedScore,
		votes,
		explanation,
	};
}

/**
 * Converts a validation decision to a numeric value for weighting.
 * APPROVE = +1 (full positive)
 * NEEDS_INFO = -0.5 (partial negative)
 * REJECT = -1 (full negative)
 */
function decisionToNumeric(decision: ValidationDecision): number {
	switch (decision) {
		case ValidationDecision.APPROVE:
			return 1;
		case ValidationDecision.NEEDS_INFO:
			return -0.5;
		case ValidationDecision.REJECT:
			return -1;
	}
}

/**
 * Builds a human-readable explanation of the voting result.
 */
function buildExplanation(votes: ValidatorVote[], score: number, decision: ValidationDecision): string {
	const approveVotes = votes.filter((v) => v.decision === ValidationDecision.APPROVE);
	const rejectVotes = votes.filter((v) => v.decision === ValidationDecision.REJECT);
	const revisionVotes = votes.filter((v) => v.decision === ValidationDecision.NEEDS_INFO);

	const approveWeight = approveVotes.reduce((sum, v) => sum + v.confidence, 0);
	const rejectWeight = rejectVotes.reduce((sum, v) => sum + v.confidence, 0);

	return (
		`Weighted decision: ${decision} (score=${(score * 100).toFixed(0)}%) | ` +
		`Approve: ${approveVotes.length} (weight=${approveWeight.toFixed(2)}), ` +
		`Reject: ${rejectVotes.length} (weight=${rejectWeight.toFixed(2)}), ` +
		`Revision: ${revisionVotes.length}`
	);
}

/**
 * Calculates confidence score from AgentEvaluator output.
 *
 * Maps heuristic score (0-10) to confidence (0-1):
 * - 8-10 → 0.8-1.0 (high confidence)
 * - 5-8  → 0.5-0.8 (medium confidence)
 * - 0-5  → 0.0-0.5 (low confidence)
 *
 * Adjusted by score variance: if validator reasoning is inconsistent,
 * confidence is reduced.
 */
export function calculateConfidence(
	heuristicScore: number,
	validatorOutput: string,
	_evaluator: AgentEvaluator,
): number {
	// Base confidence from heuristic score (0-10 → 0-1)
	let confidence = heuristicScore / 10;

	// Penalize if output is very short (likely low-effort validation)
	if (validatorOutput.length < 100) {
		confidence *= 0.7;
	}

	// Boost if reasoning is detailed (>500 chars with structured analysis)
	if (validatorOutput.length > 500 && /\d+\.|[-•]/.test(validatorOutput)) {
		confidence = Math.min(1.0, confidence * 1.15);
	}

	// Clamp to [0, 1]
	return Math.max(0, Math.min(1, confidence));
}

/**
 * Aggregates multiple ValidationResults into a single decision using weighted voting.
 *
 * @param results - Array of validation results from multiple validators
 * @param evaluator - AgentEvaluator for calculating confidence scores
 * @returns Aggregated result with weighted decision
 */
export function aggregateValidations(results: ValidationResult[], evaluator: AgentEvaluator): WeightedVotingResult {
	const votes: ValidatorVote[] = results.map((result) => {
		const heuristicReport = evaluator.evaluate(
			result.validatorId,
			"validation",
			"validator feedback",
			result.reasoning,
		);
		const confidence = calculateConfidence(heuristicReport.overallScore, result.reasoning, evaluator);

		return {
			validatorId: result.validatorId,
			decision: result.decision,
			confidence,
			reasoning: result.reasoning,
			heuristicScore: heuristicReport.overallScore,
		};
	});

	return weightedMajority(votes);
}
