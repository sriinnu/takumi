/**
 * Tests for cluster strategy modules:
 * - Weighted voting
 * - Temperature scaling
 * - Ensemble execution
 * - Tree-of-Thoughts planning
 */

import type { AgentEvent } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { type EnsembleConfig, ensembleExecute } from "../src/cluster/ensemble.js";
import { type ToTConfig, totPlan } from "../src/cluster/tot-planner.js";
import { ValidationDecision, type ValidationResult } from "../src/cluster/types.js";
import {
	aggregateValidations,
	calculateConfidence,
	type ValidatorVote,
	weightedMajority,
} from "../src/cluster/weighted-voting.js";
import { getTemperatureForTask } from "../src/model-router.js";

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockEvaluator(score = 7.0) {
	return {
		evaluate: vi.fn(() => ({
			overallScore: score,
			dimensions: {},
			feedback: "mock feedback",
		})),
	} as never;
}

function mockPhaseCtx(responseText = "mock output"): never {
	return {
		getState: () => ({ id: "test-cluster" }),
		setPhase: vi.fn(),
		updateAgentStatus: vi.fn(),
		emitEvent: vi.fn(),
		saveCheckpoint: vi.fn(async () => {}),
		sendMessage: vi.fn(async function* (): AsyncGenerator<AgentEvent> {
			yield { type: "text_delta", text: responseText };
			yield {
				type: "usage_update",
				usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
			};
			yield { type: "done", stopReason: "end_turn" };
		}),
		workDir: "/tmp/test",
		tools: { getDefinitions: () => [] },
		getModelForRole: () => undefined,
		onTokenUsage: vi.fn(),
		onAgentText: vi.fn(),
	} as never;
}

// ── Weighted Voting ──────────────────────────────────────────────────────────

describe("Weighted Voting", () => {
	describe("weightedMajority", () => {
		it("approves when weighted score > 0.5", () => {
			const votes: ValidatorVote[] = [
				{
					validatorId: "v1",
					decision: ValidationDecision.APPROVE,
					confidence: 0.9,
					reasoning: "looks good",
					heuristicScore: 8,
				},
				{
					validatorId: "v2",
					decision: ValidationDecision.REJECT,
					confidence: 0.3,
					reasoning: "minor issues",
					heuristicScore: 3,
				},
				{
					validatorId: "v3",
					decision: ValidationDecision.APPROVE,
					confidence: 0.7,
					reasoning: "solid",
					heuristicScore: 7,
				},
			];
			const result = weightedMajority(votes);
			expect(result.decision).toBe(ValidationDecision.APPROVE);
			expect(result.weightedScore).toBeGreaterThan(0.5);
		});

		it("rejects when weighted score ≤ 0.3", () => {
			const votes: ValidatorVote[] = [
				{
					validatorId: "v1",
					decision: ValidationDecision.REJECT,
					confidence: 0.9,
					reasoning: "critical bug",
					heuristicScore: 2,
				},
				{
					validatorId: "v2",
					decision: ValidationDecision.REJECT,
					confidence: 0.8,
					reasoning: "fails tests",
					heuristicScore: 2,
				},
				{
					validatorId: "v3",
					decision: ValidationDecision.APPROVE,
					confidence: 0.2,
					reasoning: "maybe ok",
					heuristicScore: 4,
				},
			];
			const result = weightedMajority(votes);
			expect(result.decision).toBe(ValidationDecision.REJECT);
			expect(result.weightedScore).toBeLessThanOrEqual(0.3);
		});

		it("handles single validator", () => {
			const votes: ValidatorVote[] = [
				{
					validatorId: "v1",
					decision: ValidationDecision.APPROVE,
					confidence: 0.8,
					reasoning: "ok",
					heuristicScore: 8,
				},
			];
			const result = weightedMajority(votes);
			expect(result.decision).toBe(ValidationDecision.APPROVE);
			expect(result.weightedScore).toBe(1.0);
		});

		it("throws on empty votes", () => {
			expect(() => weightedMajority([])).toThrow("Cannot compute weighted majority with zero votes");
		});

		it("high-confidence reject outweighs low-confidence approves", () => {
			const votes: ValidatorVote[] = [
				{
					validatorId: "v1",
					decision: ValidationDecision.APPROVE,
					confidence: 0.1,
					reasoning: "maybe",
					heuristicScore: 1,
				},
				{
					validatorId: "v2",
					decision: ValidationDecision.APPROVE,
					confidence: 0.1,
					reasoning: "unsure",
					heuristicScore: 1,
				},
				{
					validatorId: "v3",
					decision: ValidationDecision.REJECT,
					confidence: 1.0,
					reasoning: "critical flaw",
					heuristicScore: 9,
				},
			];
			const result = weightedMajority(votes);
			expect(result.decision).toBe(ValidationDecision.REJECT);
		});

		it("NEEDS_INFO counts as partial negative", () => {
			const votes: ValidatorVote[] = [
				{
					validatorId: "v1",
					decision: ValidationDecision.APPROVE,
					confidence: 0.6,
					reasoning: "ok",
					heuristicScore: 6,
				},
				{
					validatorId: "v2",
					decision: ValidationDecision.NEEDS_INFO,
					confidence: 0.8,
					reasoning: "need more",
					heuristicScore: 5,
				},
			];
			const result = weightedMajority(votes);
			// Weighted: (0.6*1 - 0.8*0.5) / (0.6+0.8) = 0.2 / 1.4 = ~0.14, normalized ~0.57
			expect(result.weightedScore).toBeGreaterThan(0.4);
		});

		it("builds explanation with vote breakdown", () => {
			const votes: ValidatorVote[] = [
				{
					validatorId: "v1",
					decision: ValidationDecision.APPROVE,
					confidence: 0.9,
					reasoning: "great",
					heuristicScore: 9,
				},
				{
					validatorId: "v2",
					decision: ValidationDecision.REJECT,
					confidence: 0.4,
					reasoning: "meh",
					heuristicScore: 4,
				},
			];
			const result = weightedMajority(votes);
			expect(result.explanation).toContain("Approve: 1");
			expect(result.explanation).toContain("Reject: 1");
		});
	});

	describe("calculateConfidence", () => {
		it("maps heuristic score 10 to high confidence", () => {
			const conf = calculateConfidence(10, "Detailed analysis of the code with multiple findings.", mockEvaluator());
			// score 10 → base 1.0, but short output (<100 chars) penalty → 0.7
			expect(conf).toBeGreaterThanOrEqual(0.6);
		});

		it("maps heuristic score 0 to zero confidence", () => {
			const conf = calculateConfidence(0, "Detailed analysis text here is enough.", mockEvaluator());
			expect(conf).toBe(0);
		});

		it("penalizes short output", () => {
			const short = calculateConfidence(8, "ok", mockEvaluator());
			const long = calculateConfidence(
				8,
				"This is a detailed analysis covering multiple aspects of the code quality, correctness, and maintainability.",
				mockEvaluator(),
			);
			expect(short).toBeLessThan(long);
		});

		it("boosts detailed structured output", () => {
			const structured = `This analysis covers several areas:\n1. Code quality is high\n2. Tests pass\n3. No security issues\n4. Performance is acceptable\n5. Documentation exists\n${"A".repeat(500)}`;
			const plain = `This analysis covers several areas but there is not much structure to it and it just rambles on without any numbered points or bullets. ${"B".repeat(400)}`;
			const a = calculateConfidence(7, structured, mockEvaluator());
			const b = calculateConfidence(7, plain, mockEvaluator());
			expect(a).toBeGreaterThanOrEqual(b);
		});

		it("clamps to [0, 1]", () => {
			const conf = calculateConfidence(15, `${"A".repeat(600)}\n1. bullet`, mockEvaluator());
			expect(conf).toBeLessThanOrEqual(1.0);
			expect(conf).toBeGreaterThanOrEqual(0);
		});
	});

	describe("aggregateValidations", () => {
		it("converts ValidationResults to weighted decision", () => {
			const results: ValidationResult[] = [
				{
					validatorId: "v1",
					validatorRole: "VALIDATOR_REQUIREMENTS" as never,
					decision: ValidationDecision.APPROVE,
					findings: [],
					reasoning: "All requirements met with good implementation quality and thorough testing coverage.",
					confidence: 0.9,
				},
				{
					validatorId: "v2",
					validatorRole: "VALIDATOR_CODE" as never,
					decision: ValidationDecision.APPROVE,
					findings: [],
					reasoning: "Code quality is high with proper error handling, types, and clean structure throughout.",
					confidence: 0.8,
				},
			];
			const result = aggregateValidations(results, mockEvaluator(8));
			expect(result.decision).toBe(ValidationDecision.APPROVE);
		});
	});
});

// ── Dynamic Temperature Scaling ──────────────────────────────────────────────

describe("Dynamic Temperature Scaling", () => {
	describe("getTemperatureForTask", () => {
		it("returns low temp for TRIVIAL tasks", () => {
			expect(getTemperatureForTask("TRIVIAL", "EXECUTING")).toBe(0.3);
		});

		it("returns medium temp for SIMPLE tasks", () => {
			expect(getTemperatureForTask("SIMPLE", "EXECUTING")).toBe(0.5);
		});

		it("returns moderate temp for STANDARD tasks", () => {
			expect(getTemperatureForTask("STANDARD", "EXECUTING")).toBe(0.7);
		});

		it("returns high temp for CRITICAL first attempt", () => {
			expect(getTemperatureForTask("CRITICAL", "EXECUTING", 1)).toBe(0.9);
		});

		it("always returns 0.2 for VALIDATING phase regardless of complexity", () => {
			expect(getTemperatureForTask("TRIVIAL", "VALIDATING")).toBe(0.2);
			expect(getTemperatureForTask("CRITICAL", "VALIDATING")).toBe(0.2);
			expect(getTemperatureForTask("STANDARD", "VALIDATING")).toBe(0.2);
		});

		it("adds +0.1 for PLANNING phase", () => {
			expect(getTemperatureForTask("STANDARD", "PLANNING")).toBeCloseTo(0.8);
		});

		it("subtracts 0.2 for FIXING phase", () => {
			expect(getTemperatureForTask("STANDARD", "FIXING")).toBeCloseTo(0.5);
		});

		it("decays on retries", () => {
			const first = getTemperatureForTask("CRITICAL", "EXECUTING", 1);
			const second = getTemperatureForTask("CRITICAL", "EXECUTING", 2);
			const third = getTemperatureForTask("CRITICAL", "EXECUTING", 3);
			expect(second).toBeLessThan(first);
			expect(third).toBeLessThan(second);
		});

		it("never goes below 0.3 on retries for workers", () => {
			const extreme = getTemperatureForTask("SIMPLE", "EXECUTING", 10);
			expect(extreme).toBeGreaterThanOrEqual(0.3);
		});

		it("clamps to [0.0, 1.0]", () => {
			const temp = getTemperatureForTask("CRITICAL", "PLANNING", 1);
			expect(temp).toBeLessThanOrEqual(1.0);
			expect(temp).toBeGreaterThanOrEqual(0.0);
		});
	});
});

// ── Ensemble Execution ───────────────────────────────────────────────────────

describe("Ensemble Execution", () => {
	it("runs multiple workers and selects winner", async () => {
		const config: EnsembleConfig = { workerCount: 3, temperature: 0.9, parallel: true };
		const ctx = mockPhaseCtx("solution output");
		const evaluator = mockEvaluator(7.5);

		const result = await ensembleExecute(ctx, "implement feature", config, evaluator);

		expect(result.candidates).toHaveLength(3);
		expect(result.winner).toBeDefined();
		expect(result.winner.output).toBe("solution output");
		expect(result.consensus).toBeGreaterThan(0);
		expect(result.totalTokens.input).toBeGreaterThan(0);
	});

	it("works in sequential mode", async () => {
		const config: EnsembleConfig = { workerCount: 2, temperature: 0.8, parallel: false };
		const ctx = mockPhaseCtx("seq output");
		const evaluator = mockEvaluator(6.0);

		const result = await ensembleExecute(ctx, "fix bug", config, evaluator);

		expect(result.candidates).toHaveLength(2);
		expect(result.winner.output).toBe("seq output");
	});

	it("handles worker failure gracefully", async () => {
		async function* throwingGenerator(): AsyncGenerator<AgentEvent> {
			yield { type: "message_start" } as AgentEvent;
			throw new Error("LLM timeout");
		}
		const failCtx = {
			...Object.fromEntries(Object.entries(mockPhaseCtx() as object)),
			sendMessage: vi.fn(throwingGenerator),
			tools: { getDefinitions: () => [] },
			getModelForRole: () => undefined,
		} as never;
		const config: EnsembleConfig = { workerCount: 2, temperature: 0.9, parallel: true };
		const evaluator = mockEvaluator(1.0);

		const result = await ensembleExecute(failCtx, "task", config, evaluator);
		expect(result.candidates).toHaveLength(2);
		// Workers should return failure marker
		expect(result.winner.output).toContain("[Worker failed");
	});

	it("calculates consensus based on score proximity", async () => {
		const ctx = mockPhaseCtx("output");
		// All candidates will have same score since evaluator is deterministic mock
		const evaluator = mockEvaluator(8.0);
		const config: EnsembleConfig = { workerCount: 3, temperature: 0.9, parallel: true };

		const result = await ensembleExecute(ctx, "task", config, evaluator);
		// All same score → consensus should be 1.0 (all within 1 point)
		expect(result.consensus).toBe(1.0);
	});
});

// ── Tree-of-Thoughts Planning ────────────────────────────────────────────────

describe("Tree-of-Thoughts Planning", () => {
	it("generates and scores plan branches", async () => {
		const response =
			"1. Approach A: start with database schema changes\n2. Approach B: start with API endpoints\n3. Approach C: start with frontend components";
		const ctx = mockPhaseCtx(response);
		const evaluator = mockEvaluator(7.0);

		const result = await totPlan(ctx, evaluator, "build user auth system", {
			branchFactor: 3,
			maxDepth: 1,
			pruneThreshold: 3.0,
			targetScore: 9.0,
		});

		expect(result.nodes.length).toBeGreaterThan(0);
		expect(result.bestPlan).toBeTruthy();
		expect(result.bestScore).toBeGreaterThanOrEqual(0);
		expect(result.branchesExplored).toBeGreaterThan(0);
	});

	it("prunes low-scoring branches", async () => {
		const response = "1. Good approach\n2. Another approach\n3. Third approach";
		const ctx = mockPhaseCtx(response);
		// Score of 3.0 is below default prune threshold of 4.0
		const evaluator = mockEvaluator(3.0);

		const result = await totPlan(ctx, evaluator, "task", {
			branchFactor: 3,
			maxDepth: 2,
			pruneThreshold: 4.0,
			targetScore: 9.0,
		});

		expect(result.branchesPruned).toBeGreaterThan(0);
	});

	it("returns early when target score is reached", async () => {
		const response = "1. Perfect approach\n2. Also good\n3. Another";
		const ctx = mockPhaseCtx(response);
		const evaluator = mockEvaluator(9.5);

		const result = await totPlan(ctx, evaluator, "task", {
			branchFactor: 3,
			maxDepth: 3,
			pruneThreshold: 3.0,
			targetScore: 9.0,
		});

		expect(result.targetReached).toBe(true);
		expect(result.bestScore).toBeGreaterThanOrEqual(9.0);
	});

	it("handles DFS search strategy", async () => {
		const response = "1. DFS approach one\n2. DFS approach two";
		const ctx = mockPhaseCtx(response);
		const evaluator = mockEvaluator(6.0);

		const result = await totPlan(ctx, evaluator, "task", {
			branchFactor: 2,
			maxDepth: 2,
			pruneThreshold: 3.0,
			targetScore: 9.0,
			searchStrategy: "dfs",
		});

		expect(result.nodes.length).toBeGreaterThan(0);
		expect(result.bestPlan).toBeTruthy();
	});

	it("tracks token usage across all branches", async () => {
		const response = "1. Plan A\n2. Plan B\n3. Plan C";
		const ctx = mockPhaseCtx(response);
		const evaluator = mockEvaluator(7.0);

		const result = await totPlan(ctx, evaluator, "task", {
			branchFactor: 3,
			maxDepth: 1,
		});

		expect(result.totalTokenUsage.input).toBeGreaterThan(0);
		expect(result.totalTokenUsage.output).toBeGreaterThan(0);
	});

	it("builds correct best path from leaf to root", async () => {
		const response = "1. Step\n2. Alternative\n3. Third option";
		const ctx = mockPhaseCtx(response);
		const evaluator = mockEvaluator(7.0);

		const result = await totPlan(ctx, evaluator, "task", {
			branchFactor: 3,
			maxDepth: 1,
			pruneThreshold: 3.0,
		});

		expect(result.bestPath.length).toBeGreaterThanOrEqual(1);
		// Each path ID should be in the nodes list
		for (const id of result.bestPath) {
			expect(result.nodes.find((n) => n.id === id)).toBeDefined();
		}
	});

	it("uses default config when partial config provided", async () => {
		const response = "1. Branch one\n2. Branch two\n3. Branch three";
		const ctx = mockPhaseCtx(response);
		const evaluator = mockEvaluator(5.0);

		// Only override one field — rest should use defaults
		const result = await totPlan(ctx, evaluator, "task", { branchFactor: 2 });

		expect(result.nodes.length).toBeGreaterThan(0);
	});
});
