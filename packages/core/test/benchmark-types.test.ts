import {
	type BenchmarkBaseline,
	type BenchmarkResult,
	computeMetrics,
	DEFAULT_GATE_THRESHOLDS,
	evaluateGate,
} from "@takumi/core";
import { describe, expect, it } from "vitest";

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
	return {
		taskId: "t1",
		category: "plan",
		passed: true,
		failedAssertions: [],
		toolsUsed: ["shell"],
		durationMs: 3000,
		costUsd: 0.02,
		retries: 0,
		humanIntervention: false,
		...overrides,
	};
}

describe("computeMetrics", () => {
	it("computes correct aggregate metrics", () => {
		const results = [
			makeResult({ passed: true, durationMs: 2000, costUsd: 0.01 }),
			makeResult({ passed: true, durationMs: 4000, costUsd: 0.03 }),
			makeResult({ passed: false, durationMs: 6000, costUsd: 0.05 }),
		];

		const m = computeMetrics(results);
		expect(m.totalTasks).toBe(3);
		expect(m.passedTasks).toBe(2);
		expect(m.successRate).toBeCloseTo(2 / 3);
		expect(m.avgDurationMs).toBeCloseTo(4000);
		expect(m.avgCostPerTask).toBeCloseTo(0.03);
	});

	it("handles empty results", () => {
		const m = computeMetrics([]);
		expect(m.totalTasks).toBe(0);
		expect(m.successRate).toBe(0);
		expect(m.avgDurationMs).toBe(0);
		expect(m.avgCostPerTask).toBe(0);
	});
});

describe("evaluateGate", () => {
	it("passes when all results succeed and within thresholds", () => {
		const results = [
			makeResult({ passed: true, costUsd: 0.01, durationMs: 2000 }),
			makeResult({ passed: true, costUsd: 0.02, durationMs: 3000 }),
		];

		const report = evaluateGate(results);
		expect(report.verdict).toBe("pass");
		expect(report.violations).toHaveLength(0);
	});

	it("fails when success rate below threshold", () => {
		const results = [makeResult({ passed: false }), makeResult({ passed: false }), makeResult({ passed: true })];

		const report = evaluateGate(results, { ...DEFAULT_GATE_THRESHOLDS, minSuccessRate: 0.8 });
		expect(report.verdict).toBe("fail");
		expect(report.violations.some((v) => v.check === "min_success_rate")).toBe(true);
	});

	it("fails when average cost exceeds threshold", () => {
		const results = [makeResult({ passed: true, costUsd: 2.0 }), makeResult({ passed: true, costUsd: 3.0 })];

		const report = evaluateGate(results, { ...DEFAULT_GATE_THRESHOLDS, maxAvgCostUsd: 1.0 });
		expect(report.verdict).toBe("fail");
		expect(report.violations.some((v) => v.check === "max_avg_cost")).toBe(true);
	});

	it("detects regression against baseline", () => {
		const results = [
			makeResult({ passed: false, costUsd: 0.01, durationMs: 2000 }),
			makeResult({ passed: true, costUsd: 0.02, durationMs: 2000 }),
		];
		const baseline: BenchmarkBaseline = {
			recordedAt: new Date().toISOString(),
			model: "claude-sonnet",
			passRates: { plan: 1.0, "bug-fix": 1.0, refactor: 1.0, review: 1.0, validation: 1.0 },
			metrics: computeMetrics([
				makeResult({ passed: true, costUsd: 0.005, durationMs: 1000 }),
				makeResult({ passed: true, costUsd: 0.005, durationMs: 1000 }),
			]),
		};

		// baseline has 100% success, results have 50% — regression > 0.05
		const report = evaluateGate(results, DEFAULT_GATE_THRESHOLDS, baseline);
		expect(report.verdict).toBe("fail");
		expect(report.violations.some((v) => v.check === "regression_delta")).toBe(true);
	});

	it("fails on empty results due to 0 success rate", () => {
		const report = evaluateGate([]);
		expect(report.verdict).toBe("fail");
		expect(report.violations.some((v) => v.check === "min_success_rate")).toBe(true);
	});
});
