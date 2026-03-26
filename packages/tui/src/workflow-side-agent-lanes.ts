import type { AppCommandContext } from "./app-command-context.js";
import { executeNativeTool, hasNativeTool, parseJsonToolOutput } from "./app-command-macros.js";

interface NativeSideAgentStartResult {
	id: string;
	status: string;
	worktree: string;
	branch: string;
	tmuxWindow: string;
}

export interface NativeSideAgentCheckResult {
	id: string;
	state: string;
	description: string;
	model: string;
	branch: string;
	error?: string | null;
	recentOutput: string;
}

export interface NativeSideAgentQueryResult {
	id: string;
	query: string;
	format: string;
	responseType: "structured" | "raw";
	response: unknown;
	warning?: string;
}

export interface NativeSideAgentLaneOptions {
	model?: string;
	preferredModel?: string;
	topic?: string;
	complexity?: string;
}

export interface NativeSideAgentLaneSpec extends NativeSideAgentLaneOptions {
	label: string;
	task: string;
	query: string;
}

export async function runNativeSideAgentLane(
	ctx: AppCommandContext,
	commandName: string,
	task: string,
	query: string,
	options: NativeSideAgentLaneOptions = {},
): Promise<NativeSideAgentQueryResult | null> {
	if (!hasNativeTool(ctx, "takumi_agent_start") || !hasNativeTool(ctx, "takumi_agent_query")) {
		return null;
	}

	const startInput: {
		description: string;
		initialPrompt: string;
		model?: string;
		preferredModel?: string;
		topic?: string;
		complexity?: string;
	} = {
		description: task,
		initialPrompt: [
			`Native workflow lane for ${commandName}.`,
			"Stay scoped to the requested task and keep your work independent from the main lane.",
			"Prefer structured reasoning and be explicit about assumptions.",
		].join("\n"),
	};
	const preferredModel =
		options.preferredModel ||
		ctx.state.sideAgentPreferredModel.value ||
		ctx.config.orchestration?.modelRouting?.sideAgent ||
		ctx.config.sideAgent?.defaultModel;
	if (options.model) {
		startInput.model = options.model;
	}
	if (preferredModel) {
		startInput.preferredModel = preferredModel;
	}
	if (options.topic) {
		startInput.topic = options.topic;
	}
	if (options.complexity) {
		startInput.complexity = options.complexity;
	}

	const startResult = await executeNativeTool(ctx, commandName, "takumi_agent_start", startInput);
	const started = parseJsonToolOutput<NativeSideAgentStartResult>(startResult);
	if (!started?.id) {
		return null;
	}

	const preview = await readNativeSideAgentPreview(ctx, commandName, started.id);
	recordSpawnedLane(ctx, commandName, task, started, preview);
	ctx.addInfoMessage(formatNativeSideAgentSpawnMessage(commandName, started, preview));

	const queryResult = await executeNativeTool(ctx, commandName, "takumi_agent_query", {
		id: started.id,
		query,
		format: "json",
	});
	const report = parseJsonToolOutput<NativeSideAgentQueryResult>(queryResult);
	const refreshedPreview = await readNativeSideAgentPreview(ctx, commandName, started.id);
	recordQueriedLane(
		ctx,
		started,
		task,
		query,
		report,
		refreshedPreview,
		queryResult?.isError ? queryResult.output : null,
	);
	return report;
}

export async function runNativeSideAgentQuestionLanes(
	ctx: AppCommandContext,
	commandName: string,
	lanes: NativeSideAgentLaneSpec[],
): Promise<Array<NativeSideAgentLaneSpec & { report: NativeSideAgentQueryResult }> | null> {
	if (!hasNativeTool(ctx, "takumi_agent_start") || !hasNativeTool(ctx, "takumi_agent_query")) {
		return null;
	}

	const reports = await Promise.all(
		lanes.map(async (lane) => {
			const report = await runNativeSideAgentLane(ctx, commandName, lane.task, lane.query, {
				topic: lane.topic,
				complexity: lane.complexity,
			});
			return report ? { ...lane, report } : null;
		}),
	);

	const completed = reports.filter((lane): lane is NativeSideAgentLaneSpec & { report: NativeSideAgentQueryResult } =>
		Boolean(lane),
	);
	return completed.length === lanes.length ? completed : null;
}

export async function refreshTrackedNativeSideAgentLane(
	ctx: AppCommandContext,
	commandName: string,
	laneId: string,
): Promise<NativeSideAgentCheckResult | null> {
	const preview = await readNativeSideAgentPreview(ctx, commandName, laneId);
	if (!preview) {
		return null;
	}
	const existing = ctx.state.sideLanes.find(laneId);
	ctx.state.sideLanes.upsert({
		id: laneId,
		commandName: existing?.commandName ?? commandName,
		title: preview.description?.trim() || existing?.title || laneId,
		state: normalizeLaneState(preview.state),
		branch: preview.branch || existing?.branch || "",
		worktree: existing?.worktree ?? "",
		tmuxWindow: existing?.tmuxWindow ?? "",
		model: preview.model || undefined,
		recentOutput: summarizeRecentOutput(preview.recentOutput ?? ""),
		error: preview.error ?? null,
	});
	return preview;
}

async function readNativeSideAgentPreview(
	ctx: AppCommandContext,
	commandName: string,
	laneId: string,
): Promise<NativeSideAgentCheckResult | null> {
	if (!hasNativeTool(ctx, "takumi_agent_check")) {
		return null;
	}
	const checkResult = await executeNativeTool(ctx, commandName, "takumi_agent_check", { id: laneId });
	return parseJsonToolOutput<NativeSideAgentCheckResult>(checkResult);
}

function recordSpawnedLane(
	ctx: AppCommandContext,
	commandName: string,
	task: string,
	started: NativeSideAgentStartResult,
	preview: NativeSideAgentCheckResult | null,
): void {
	ctx.state.sideLanes.upsert({
		id: started.id,
		commandName,
		title: preview?.description?.trim() || task,
		state: normalizeLaneState(preview?.state || started.status),
		tmuxWindow: started.tmuxWindow,
		branch: preview?.branch || started.branch,
		worktree: started.worktree,
		model: preview?.model ?? "",
		recentOutput: summarizeRecentOutput(preview?.recentOutput ?? ""),
		error: preview?.error ?? null,
	});
}

function recordQueriedLane(
	ctx: AppCommandContext,
	started: NativeSideAgentStartResult,
	task: string,
	query: string,
	report: NativeSideAgentQueryResult | null,
	preview: NativeSideAgentCheckResult | null,
	queryError: string | null,
): void {
	ctx.state.sideLanes.upsert({
		id: started.id,
		title: preview?.description?.trim() || task,
		state: preview?.state ? normalizeLaneState(preview.state) : undefined,
		branch: preview?.branch || started.branch,
		worktree: started.worktree,
		model: preview?.model || undefined,
		recentOutput: preview ? summarizeRecentOutput(preview.recentOutput ?? "") : undefined,
		lastQuery: query,
		responseType: report?.responseType ?? "",
		responseSummary: report ? summarizeLaneResponse(report.response) : "",
		error: preview?.error ?? normalizeLaneError(queryError),
	});
}

function normalizeLaneState(state: string | undefined): string {
	const trimmed = state?.trim().toLowerCase();
	return trimmed || "starting";
}

function normalizeLaneError(error: string | null): string | null {
	if (!error) {
		return null;
	}
	const trimmed = error.trim();
	return trimmed ? trimmed.slice(0, 240) : null;
}

function summarizeLaneResponse(response: unknown): string {
	if (typeof response === "string") {
		return summarizeResponseText(response);
	}
	if (response && typeof response === "object") {
		for (const key of ["summary", "verdict", "primaryQuestion", "recommendation", "action"]) {
			const value = (response as Record<string, unknown>)[key];
			if (typeof value === "string" && value.trim()) {
				return summarizeResponseText(value);
			}
		}
		try {
			return summarizeResponseText(JSON.stringify(response));
		} catch {
			return "(structured response)";
		}
	}
	if (response === null || response === undefined) {
		return "";
	}
	return summarizeResponseText(String(response));
}

function summarizeResponseText(text: string): string {
	const singleLine = text.replace(/\s+/g, " ").trim();
	if (!singleLine) {
		return "";
	}
	return singleLine.length > 120 ? `${singleLine.slice(0, 119)}…` : singleLine;
}

function formatNativeSideAgentSpawnMessage(
	commandName: string,
	started: NativeSideAgentStartResult,
	preview: NativeSideAgentCheckResult | null,
): string {
	const lines = [
		`${commandName} spawned side lane ${started.id}.`,
		`tmux window: ${started.tmuxWindow}`,
		`branch: ${started.branch}`,
		`worktree: ${started.worktree}`,
		`focus hint: tmux select-window -t ${started.tmuxWindow}`,
	];
	const outputPreview = summarizeRecentOutput(preview?.recentOutput ?? "");
	if (outputPreview) {
		lines.push("", "recent output:", outputPreview);
	}
	if (preview?.error) {
		lines.push("", `lane error: ${preview.error}`);
	}
	return lines.join("\n");
}

function summarizeRecentOutput(output: string): string {
	const trimmed = output.trim();
	if (!trimmed || trimmed === "<no output available>") {
		return "";
	}
	const lines = trimmed
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		return "";
	}
	return lines.slice(-8).join("\n");
}
