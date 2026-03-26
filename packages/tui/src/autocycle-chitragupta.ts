import type { AutocycleRunSummary, CycleResult } from "@takumi/agent";
import type { ObservationEvent } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import {
	ensureCanonicalSessionBinding,
	getBoundSessionId,
	observeExecutorEvents,
} from "./chitragupta-executor-runtime.js";
import type { AppState } from "./state.js";

const log = createLogger("autocycle-chitragupta");

export interface ReportAutocycleIterationInput {
	state: AppState;
	objective: string;
	targetFile: string;
	evalCommand: string;
	manifestFilePath: string;
	result: CycleResult;
	summary: AutocycleRunSummary;
}

export async function reportAutocycleIterationToChitragupta(input: ReportAutocycleIterationInput): Promise<void> {
	await ensureCanonicalSessionBinding(input.state);
	const sessionId = getBoundSessionId(input.state);
	const events = buildAutocycleObservationEvents(input, sessionId);

	await observeExecutorEvents(input.state, events);
	await triggerAutocycleConsolidation(input.state, input.summary.runId);
}

function buildAutocycleObservationEvents(input: ReportAutocycleIterationInput, sessionId: string): ObservationEvent[] {
	const timestamp = Date.now();
	const projectPath = process.cwd();
	const iterationRunId = `${input.summary.runId}:iteration:${input.result.iteration}`;
	const description = `Autocycle iteration ${input.result.iteration}: ${input.objective}`;
	const artifactSummary = buildAutocycleArtifactSummary(input);

	return [
		{
			type: "executor_artifact",
			artifactType: "exec-result",
			sessionId,
			projectPath,
			summary: artifactSummary,
			path: input.summary.ledgerFilePath,
			metadata: {
				runId: input.summary.runId,
				iteration: input.result.iteration,
				objective: input.objective,
				targetFile: input.targetFile,
				evalCommand: input.evalCommand,
				status: input.result.status,
				success: input.result.success,
				metric: input.result.metric,
				bestMetric: input.summary.bestMetric,
				baselineMetric: input.summary.baselineMetric,
				latestMetric: input.summary.latestMetric,
				keepRate: input.summary.keepRate,
				manifestFilePath: input.manifestFilePath,
				autocycle: true,
			},
			timestamp,
		},
		{
			type: "executor_run",
			runId: iterationRunId,
			status: input.result.success ? "completed" : "failed",
			sessionId,
			projectPath,
			mode: "single",
			description,
			artifacts: ["exec-result"],
			filesChanged: [input.targetFile],
			validationStatus: input.result.success ? "passed" : "failed",
			timestamp,
		},
	];
}

function buildAutocycleArtifactSummary(input: ReportAutocycleIterationInput): string {
	const metricText = input.result.metric == null ? "metric=n/a" : `metric=${input.result.metric}`;
	const bestText = input.summary.bestMetric == null ? "best=n/a" : `best=${input.summary.bestMetric}`;
	return [
		`Autocycle iteration ${input.result.iteration}`,
		`status=${input.result.status}`,
		metricText,
		bestText,
		`duration=${input.result.durationMs}ms`,
		`target=${input.targetFile}`,
	].join(" | ");
}

async function triggerAutocycleConsolidation(state: AppState, runId: string): Promise<void> {
	const bridge = state.chitraguptaBridge.value;
	if (!bridge?.isConnected || state.consolidationInProgress.value) {
		return;
	}

	const project = process.cwd().split("/").pop() ?? "unknown";
	state.consolidationInProgress.value = true;
	try {
		await bridge.consolidationRun(project, 1);
	} catch (error) {
		log.debug(`Autocycle consolidation failed for ${runId}: ${(error as Error).message}`);
	} finally {
		state.consolidationInProgress.value = false;
	}
}
