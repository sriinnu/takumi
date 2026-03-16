/**
 * Eval / regression gate types — P-Track 2.
 *
 * Defines the benchmark corpus schema, metric baselines, and gate
 * verdicts used to block regressions before release.
 */

// ── Task definition ───────────────────────────────────────────────────────────

export type BenchmarkCategory = "plan" | "bug-fix" | "refactor" | "review" | "validation";

export interface BenchmarkTask {
	/** Unique task ID (slug). */
	id: string;
	/** Human-readable name. */
	name: string;
	/** Category for grouping in reports. */
	category: BenchmarkCategory;
	/** The prompt sent to the agent. */
	prompt: string;
	/** Shell commands to set up the workspace before the agent runs. */
	setup?: string[];
	/** Constraints & assertions to evaluate the result. */
	assertions: BenchmarkAssertion[];
	/** Maximum cost in USD allowed for this task. */
	maxCostUsd?: number;
	/** Maximum wall-clock seconds allowed. */
	maxDurationSec?: number;
}

export type BenchmarkAssertion =
	| { type: "file_exists"; path: string }
	| { type: "file_contains"; path: string; pattern: string }
	| { type: "file_not_contains"; path: string; pattern: string }
	| { type: "tool_used"; name: string }
	| { type: "tool_not_used"; name: string }
	| { type: "exit_code"; code: number }
	| { type: "command_succeeds"; command: string };

// ── Result ────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
	taskId: string;
	category: BenchmarkCategory;
	passed: boolean;
	failedAssertions: string[];
	toolsUsed: string[];
	durationMs: number;
	costUsd: number;
	retries: number;
	humanIntervention: boolean;
	error?: string;
}

// ── Baseline / snapshot ───────────────────────────────────────────────────────

export interface BenchmarkBaseline {
	/** ISO 8601 timestamp when the baseline was recorded. */
	recordedAt: string;
	/** Model used during the baseline run. */
	model: string;
	/** Git commit SHA. */
	commitSha?: string;
	/** Per-category pass rates (0–1). */
	passRates: Record<BenchmarkCategory, number>;
	/** Aggregate metrics. */
	metrics: BenchmarkMetrics;
}

export interface BenchmarkMetrics {
	totalTasks: number;
	passedTasks: number;
	successRate: number;
	totalCostUsd: number;
	avgCostPerTask: number;
	totalDurationMs: number;
	avgDurationMs: number;
	totalRetries: number;
	humanInterventions: number;
}

// ── Gate ───────────────────────────────────────────────────────────────────────

export type GateVerdict = "pass" | "fail" | "warn";

export interface GateThresholds {
	/** Minimum overall success rate (0–1).  Default: 0.8 */
	minSuccessRate: number;
	/** Maximum overall cost per task (USD).   Default: 0.50 */
	maxAvgCostUsd: number;
	/** Maximum average duration (ms).         Default: 60_000 */
	maxAvgDurationMs: number;
	/** Maximum regression in success rate vs baseline (0–1).  Default: 0.05 */
	maxRegressionDelta: number;
}

export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
	minSuccessRate: 0.8,
	maxAvgCostUsd: 0.5,
	maxAvgDurationMs: 60_000,
	maxRegressionDelta: 0.05,
};

export interface GateReport {
	verdict: GateVerdict;
	/** Machine-readable reasons for each failing check. */
	violations: GateViolation[];
	metrics: BenchmarkMetrics;
	baseline?: BenchmarkBaseline;
	thresholds: GateThresholds;
	/** ISO 8601 timestamp. */
	evaluatedAt: string;
}

export interface GateViolation {
	check: string;
	expected: string;
	actual: string;
}

// ── Gate evaluation ───────────────────────────────────────────────────────────

export function evaluateGate(
	results: BenchmarkResult[],
	thresholds: GateThresholds = DEFAULT_GATE_THRESHOLDS,
	baseline?: BenchmarkBaseline,
): GateReport {
	const metrics = computeMetrics(results);
	const violations: GateViolation[] = [];

	if (metrics.successRate < thresholds.minSuccessRate) {
		violations.push({
			check: "min_success_rate",
			expected: `>= ${thresholds.minSuccessRate}`,
			actual: metrics.successRate.toFixed(3),
		});
	}
	if (metrics.avgCostPerTask > thresholds.maxAvgCostUsd) {
		violations.push({
			check: "max_avg_cost",
			expected: `<= $${thresholds.maxAvgCostUsd}`,
			actual: `$${metrics.avgCostPerTask.toFixed(4)}`,
		});
	}
	if (metrics.avgDurationMs > thresholds.maxAvgDurationMs) {
		violations.push({
			check: "max_avg_duration",
			expected: `<= ${thresholds.maxAvgDurationMs}ms`,
			actual: `${metrics.avgDurationMs.toFixed(0)}ms`,
		});
	}
	if (baseline) {
		const delta = baseline.metrics.successRate - metrics.successRate;
		if (delta > thresholds.maxRegressionDelta) {
			violations.push({
				check: "regression_delta",
				expected: `<= ${thresholds.maxRegressionDelta}`,
				actual: delta.toFixed(3),
			});
		}
	}

	return {
		verdict: violations.length === 0 ? "pass" : "fail",
		violations,
		metrics,
		baseline,
		thresholds,
		evaluatedAt: new Date().toISOString(),
	};
}

export function computeMetrics(results: BenchmarkResult[]): BenchmarkMetrics {
	const total = results.length || 1;
	const passed = results.filter((r) => r.passed).length;
	const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
	const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
	const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
	const interventions = results.filter((r) => r.humanIntervention).length;
	return {
		totalTasks: results.length,
		passedTasks: passed,
		successRate: passed / total,
		totalCostUsd: totalCost,
		avgCostPerTask: totalCost / total,
		totalDurationMs: totalDuration,
		avgDurationMs: totalDuration / total,
		totalRetries: totalRetries,
		humanInterventions: interventions,
	};
}
