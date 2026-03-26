import { describe, expect, it, vi } from "vitest";
import { AppState } from "../src/state.js";

const mockEnsureCanonicalSessionBinding = vi.fn(async () => "canon-1");
const mockGetBoundSessionId = vi.fn(() => "canon-1");
const mockObserveExecutorEvents = vi.fn(async () => {});

vi.mock("../src/chitragupta-executor-runtime.js", () => ({
	ensureCanonicalSessionBinding: mockEnsureCanonicalSessionBinding,
	getBoundSessionId: mockGetBoundSessionId,
	observeExecutorEvents: mockObserveExecutorEvents,
}));

const { reportAutocycleIterationToChitragupta } = await import("../src/autocycle-chitragupta.js");

describe("autocycle-chitragupta", () => {
	it("reports iteration events and triggers consolidation when connected", async () => {
		const state = new AppState();
		state.canonicalSessionId.value = "canon-1";
		const consolidationRun = vi.fn(async () => ({ ok: true }));
		state.chitraguptaBridge.value = {
			isConnected: true,
			consolidationRun,
		} as any;

		await reportAutocycleIterationToChitragupta({
			state,
			objective: "improve latency",
			targetFile: "src/main.ts",
			evalCommand: "pnpm test",
			manifestFilePath: ".takumi/autocycle/run.experiment.md",
			result: {
				iteration: 2,
				success: true,
				status: "keep",
				metric: 0.88,
				stdout: "ok",
				durationMs: 42,
			},
			summary: {
				runId: "run-42",
				ledgerFilePath: ".takumi/autocycle/run-42.jsonl",
				completedEvaluations: 2,
				counts: { keep: 2, discard: 0, timeout: 0, crash: 0, "metric-missing": 0, aborted: 0 },
				keepRate: 1,
				totalDurationMs: 84,
				averageDurationMs: 42,
				baselineMetric: 0.95,
				bestMetric: 0.88,
				latestMetric: 0.88,
				optimizeDirection: "minimize",
			},
		});

		expect(mockEnsureCanonicalSessionBinding).toHaveBeenCalledWith(state);
		expect(mockObserveExecutorEvents).toHaveBeenCalledWith(
			state,
			expect.arrayContaining([
				expect.objectContaining({
					type: "executor_artifact",
					artifactType: "exec-result",
					sessionId: "canon-1",
					summary: expect.stringContaining("Autocycle iteration 2"),
					metadata: expect.objectContaining({
						runId: "run-42",
						iteration: 2,
						autocycle: true,
						manifestFilePath: ".takumi/autocycle/run.experiment.md",
					}),
				}),
				expect.objectContaining({
					type: "executor_run",
					runId: "run-42:iteration:2",
					status: "completed",
					validationStatus: "passed",
				}),
			]),
		);
		expect(consolidationRun).toHaveBeenCalledWith("takumi", 1);
		expect(state.consolidationInProgress.value).toBe(false);
	});

	it("skips consolidation when bridge is disconnected but still reports events", async () => {
		const state = new AppState();
		state.canonicalSessionId.value = "canon-1";
		const consolidationRun = vi.fn(async () => ({ ok: true }));
		state.chitraguptaBridge.value = {
			isConnected: false,
			consolidationRun,
		} as any;

		await reportAutocycleIterationToChitragupta({
			state,
			objective: "improve latency",
			targetFile: "src/main.ts",
			evalCommand: "pnpm test",
			manifestFilePath: ".takumi/autocycle/run.experiment.md",
			result: {
				iteration: 1,
				success: false,
				status: "discard",
				metric: 1.1,
				stdout: "ok",
				durationMs: 24,
			},
			summary: {
				runId: "run-99",
				ledgerFilePath: ".takumi/autocycle/run-99.jsonl",
				completedEvaluations: 1,
				counts: { keep: 0, discard: 1, timeout: 0, crash: 0, "metric-missing": 0, aborted: 0 },
				keepRate: 0,
				totalDurationMs: 24,
				averageDurationMs: 24,
				baselineMetric: 1.0,
				bestMetric: 1.0,
				latestMetric: 1.1,
				optimizeDirection: "minimize",
			},
		});

		expect(mockObserveExecutorEvents).toHaveBeenCalled();
		expect(consolidationRun).not.toHaveBeenCalled();
	});

	it("swallows consolidation failures and clears in-progress state", async () => {
		const state = new AppState();
		state.canonicalSessionId.value = "canon-1";
		const consolidationRun = vi.fn(async () => {
			throw new Error("consolidation unavailable");
		});
		state.chitraguptaBridge.value = {
			isConnected: true,
			consolidationRun,
		} as any;

		await expect(
			reportAutocycleIterationToChitragupta({
				state,
				objective: "improve latency",
				targetFile: "src/main.ts",
				evalCommand: "pnpm test",
				manifestFilePath: ".takumi/autocycle/run.experiment.md",
				result: {
					iteration: 3,
					success: true,
					status: "keep",
					metric: 0.7,
					stdout: "ok",
					durationMs: 30,
				},
				summary: {
					runId: "run-7",
					ledgerFilePath: ".takumi/autocycle/run-7.jsonl",
					completedEvaluations: 3,
					counts: { keep: 2, discard: 1, timeout: 0, crash: 0, "metric-missing": 0, aborted: 0 },
					keepRate: 2 / 3,
					totalDurationMs: 90,
					averageDurationMs: 30,
					baselineMetric: 0.9,
					bestMetric: 0.7,
					latestMetric: 0.7,
					optimizeDirection: "minimize",
				},
			}),
		).resolves.toBeUndefined();

		expect(state.consolidationInProgress.value).toBe(false);
	});
});
