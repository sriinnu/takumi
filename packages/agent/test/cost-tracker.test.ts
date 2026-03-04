/**
 * Tests for CostTracker (Phase 38)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CostSnapshot, CostTracker } from "../src/cost-tracker.js";

describe("CostTracker", () => {
	let tracker: CostTracker;

	beforeEach(() => {
		tracker = new CostTracker({ model: "claude-sonnet-4-20250514" });
	});

	describe("construction", () => {
		it("starts with zero accumulated cost", () => {
			expect(tracker.total).toBe(0);
			expect(tracker.turnCount).toBe(0);
		});

		it("accepts partial config", () => {
			const t = new CostTracker({
				model: "gpt-4o",
				budgetUsd: 1.0,
				rateWindow: 3,
			});
			expect(t.total).toBe(0);
		});
	});

	describe("record()", () => {
		it("accumulates cost across turns", () => {
			tracker.record(1000, 500);
			tracker.record(2000, 1000);
			expect(tracker.turnCount).toBe(2);
			expect(tracker.total).toBeGreaterThan(0);
		});

		it("returns a snapshot after each record", () => {
			const snap = tracker.record(500, 200);
			expect(snap.totalUsd).toBeGreaterThan(0);
			expect(snap.turns).toHaveLength(1);
			expect(snap.turns[0].turn).toBe(1);
			expect(snap.turns[0].inputTokens).toBe(500);
			expect(snap.turns[0].outputTokens).toBe(200);
		});

		it("fires onSnapshot callback", () => {
			const cb = vi.fn<[CostSnapshot], void>();
			const t = new CostTracker({
				model: "claude-sonnet-4-20250514",
				onSnapshot: cb,
			});
			t.record(100, 50);
			expect(cb).toHaveBeenCalledOnce();
			expect(cb.mock.calls[0][0].totalUsd).toBeGreaterThan(0);
		});

		it("accepts model override per turn", () => {
			const snap = tracker.record(1000, 1000, "gpt-4o");
			expect(snap.turns[0].model).toBe("gpt-4o");
		});
	});

	describe("snapshot()", () => {
		it("returns zero-state snapshot when no turns recorded", () => {
			const snap = tracker.snapshot();
			expect(snap.totalUsd).toBe(0);
			expect(snap.turns).toHaveLength(0);
			expect(snap.ratePerMinute).toBe(0);
			expect(snap.alertLevel).toBe("none");
			expect(snap.avgCostPerTurn).toBe(0);
		});

		it("calculates budget fraction when budget is set", () => {
			const t = new CostTracker({
				model: "claude-sonnet-4-20250514",
				budgetUsd: 0.01,
			});
			t.record(10000, 5000);
			const snap = t.snapshot();
			expect(snap.budgetFraction).toBeGreaterThan(0);
		});

		it("budget fraction is 0 for unlimited budget", () => {
			tracker.record(1000, 1000);
			const snap = tracker.snapshot();
			expect(snap.budgetFraction).toBe(0);
		});
	});

	describe("alert levels", () => {
		it("returns 'none' when under info threshold", () => {
			const t = new CostTracker({
				model: "claude-sonnet-4-20250514",
				budgetUsd: 100,
				alertThresholds: [0.5, 0.75, 0.9],
			});
			t.record(10, 10);
			expect(t.snapshot().alertLevel).toBe("none");
		});

		it("returns 'critical' when over critical threshold", () => {
			const t = new CostTracker({
				model: "claude-sonnet-4-20250514",
				budgetUsd: 0.0001,
				alertThresholds: [0.1, 0.5, 0.8],
			});
			// Record enough tokens to exceed 80% of a tiny budget
			t.record(10000, 10000);
			expect(t.snapshot().alertLevel).toBe("critical");
		});
	});

	describe("rate projection", () => {
		it("rate is zero with fewer than 2 turns", () => {
			tracker.record(1000, 500);
			expect(tracker.snapshot().ratePerMinute).toBe(0);
		});
	});

	describe("summary()", () => {
		it("returns a human-readable string", () => {
			tracker.record(1000, 500);
			const s = tracker.summary();
			expect(s).toContain("$");
			expect(s).toContain("1 turns");
			expect(s).toContain("/min");
		});
	});

	describe("static pricing()", () => {
		it("returns known model pricing", () => {
			const p = CostTracker.pricing("claude-sonnet-4-20250514");
			expect(p.inputPerM).toBeGreaterThan(0);
			expect(p.outputPerM).toBeGreaterThan(0);
		});

		it("returns fallback for unknown models", () => {
			const p = CostTracker.pricing("some-unknown-model");
			expect(p.inputPerM).toBe(5.0);
			expect(p.outputPerM).toBe(15.0);
		});
	});
});
