import type { AppCommandContext } from "./app-command-context.js";
import { executeNativeTool, hasNativeTool, parseJsonToolOutput } from "./app-command-macros.js";

interface NativeSideAgentStartResult {
	id: string;
	status: string;
	worktree: string;
	branch: string;
	tmuxWindow: string;
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

	ctx.addInfoMessage(`${commandName} spawned side lane ${started.id} on ${started.branch} (${started.worktree}).`);

	const queryResult = await executeNativeTool(ctx, commandName, "takumi_agent_query", {
		id: started.id,
		query,
		format: "json",
	});
	return parseJsonToolOutput<NativeSideAgentQueryResult>(queryResult);
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
