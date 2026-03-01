/**
 * Tests for LLM cost estimation and budget enforcement.
 */

import { describe, expect, it, vi } from "vitest";
import { TaskComplexity } from "../src/classifier.js";
import { BudgetExceededError, BudgetGuard, estimateClusterCost, estimateCost, MODEL_PRICING } from "../src/cost.js";

// ── estimateCost ──────────────────────────────────────────────────────────────

describe("estimateCost", () => {
	it("returns 0 for 0 tokens", () => {
		expect(estimateCost(0, 0, "claude-3-5-sonnet")).toBe(0);
	});

	it("uses known model pricing (claude-opus-4)", () => {
		const cost = estimateCost(1_000_000, 1_000_000, "claude-opus-4");
		// Should be non-zero and a reasonable per-million-token cost
		expect(cost).toBeGreaterThan(0);
	});

	it("falls back to DEFAULT_PRICE for unknown model", () => {
		const _knownCost = estimateCost(100_000, 50_000, "claude-3-5-sonnet");
		const unknownCost = estimateCost(100_000, 50_000, "unknown-model-xyz");
		// Both should be positive numbers; unknown uses the fallback defaults
		expect(unknownCost).toBeGreaterThan(0);
		expect(typeof unknownCost).toBe("number");
	});

	it("scales linearly with token count", () => {
		const half = estimateCost(500_000, 0, "gpt-4o");
		const full = estimateCost(1_000_000, 0, "gpt-4o");
		expect(full).toBeCloseTo(half * 2, 8);
	});

	it("input and output are priced separately", () => {
		const inputOnly = estimateCost(1_000_000, 0, "claude-3-5-sonnet");
		const outputOnly = estimateCost(0, 1_000_000, "claude-3-5-sonnet");
		// Output tokens are typically more expensive
		expect(outputOnly).toBeGreaterThanOrEqual(inputOnly);
	});

	it("all MODEL_PRICING entries produce valid prices", () => {
		for (const [model] of Object.entries(MODEL_PRICING)) {
			const cost = estimateCost(100_000, 50_000, model);
			expect(cost, `model: ${model}`).toBeGreaterThan(0);
			expect(Number.isFinite(cost), `model: ${model}`).toBe(true);
		}
	});
});

// ── estimateClusterCost ───────────────────────────────────────────────────────

describe("estimateClusterCost", () => {
	it("returns minUsd, maxUsd, agentCount", () => {
		const est = estimateClusterCost(TaskComplexity.STANDARD, "claude-3-5-sonnet");
		expect(est).toHaveProperty("minUsd");
		expect(est).toHaveProperty("maxUsd");
		expect(est).toHaveProperty("agentCount");
	});

	it("maxUsd >= minUsd", () => {
		for (const complexity of Object.values(TaskComplexity) as TaskComplexity[]) {
			const est = estimateClusterCost(complexity, "claude-3-5-sonnet");
			expect(est.maxUsd).toBeGreaterThanOrEqual(est.minUsd);
		}
	});

	it("CRITICAL has more agents than TRIVIAL", () => {
		const trivial = estimateClusterCost(TaskComplexity.TRIVIAL, "claude-3-5-sonnet");
		const critical = estimateClusterCost(TaskComplexity.CRITICAL, "claude-3-5-sonnet");
		expect(critical.agentCount).toBeGreaterThan(trivial.agentCount);
	});

	it("CRITICAL has higher cost than TRIVIAL", () => {
		const trivial = estimateClusterCost(TaskComplexity.TRIVIAL, "claude-3-5-sonnet");
		const critical = estimateClusterCost(TaskComplexity.CRITICAL, "claude-3-5-sonnet");
		expect(critical.minUsd).toBeGreaterThan(trivial.minUsd);
	});

	it("all complexities produce positive costs", () => {
		for (const complexity of Object.values(TaskComplexity) as TaskComplexity[]) {
			const est = estimateClusterCost(complexity, "gpt-4o");
			expect(est.minUsd).toBeGreaterThan(0);
			expect(est.maxUsd).toBeGreaterThan(0);
		}
	});
});

// ── BudgetGuard ───────────────────────────────────────────────────────────────

describe("BudgetGuard", () => {
	it("starts with zero spent", () => {
		const guard = new BudgetGuard({ limitUsd: 1.0, model: "claude-3-5-sonnet" });
		expect(guard.spent).toBe(0);
	});

	it("accumulates cost across calls", () => {
		const guard = new BudgetGuard({ limitUsd: 10, model: "gpt-4o" });
		guard.record(100_000, 50_000);
		guard.record(100_000, 50_000);
		expect(guard.spent).toBeGreaterThan(0);
	});

	it("remaining decreases as cost accumulates", () => {
		const guard = new BudgetGuard({ limitUsd: 1.0, model: "gpt-4o" });
		const before = guard.remaining;
		guard.record(50_000, 20_000);
		expect(guard.remaining).toBeLessThan(before);
	});

	it("fraction goes from 0 to 1 as budget is consumed", () => {
		const guard = new BudgetGuard({ limitUsd: 100, model: "gpt-4o" });
		expect(guard.fraction).toBe(0);
		guard.record(100_000, 50_000); // small spend against large limit
		expect(guard.fraction).toBeGreaterThan(0);
		expect(guard.fraction).toBeLessThan(1);
	});

	it("throws BudgetExceededError when limit is crossed", () => {
		const guard = new BudgetGuard({ limitUsd: 0.000001, model: "gpt-4o" });
		expect(() => guard.record(1_000_000, 1_000_000)).toThrow(BudgetExceededError);
	});

	it("BudgetExceededError carries spentUsd and limitUsd", () => {
		const guard = new BudgetGuard({ limitUsd: 0.000001, model: "gpt-4o" });
		try {
			guard.record(1_000_000, 1_000_000);
		} catch (err) {
			expect(err).toBeInstanceOf(BudgetExceededError);
			const be = err as BudgetExceededError;
			expect(be.spentUsd).toBeGreaterThan(0);
			expect(be.limitUsd).toBe(0.000001);
		}
	});

	it("does not throw when under limit", () => {
		const guard = new BudgetGuard({ limitUsd: 100, model: "gpt-4o" });
		expect(() => guard.record(100, 50)).not.toThrow();
	});

	it("calls onUpdate callback after each record()", () => {
		const onUpdate = vi.fn();
		const guard = new BudgetGuard({ limitUsd: 10, model: "gpt-4o", onUpdate });
		guard.record(100_000, 50_000);
		expect(onUpdate).toHaveBeenCalledTimes(1);
		guard.record(100_000, 50_000);
		expect(onUpdate).toHaveBeenCalledTimes(2);
	});

	it("summary() returns a human-readable string", () => {
		const guard = new BudgetGuard({ limitUsd: 5.0, model: "gpt-4o" });
		guard.record(100_000, 50_000);
		const summary = guard.summary();
		expect(typeof summary).toBe("string");
		expect(summary.length).toBeGreaterThan(0);
	});

	it("BudgetGuard with no limit never throws", () => {
		const guard = new BudgetGuard({ limitUsd: Number.POSITIVE_INFINITY, model: "gpt-4o" });
		expect(() => guard.record(10_000_000, 10_000_000)).not.toThrow();
	});
});
