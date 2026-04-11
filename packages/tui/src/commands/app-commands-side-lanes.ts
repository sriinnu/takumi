/**
 * Side-lane commands — operator controls for tracked workflow lanes.
 *
 * I keep these commands separate from the workflow macros so the lane registry
 * stays actionable after spawn: list, refresh, focus, send, and stop.
 */

import { execFileSync } from "node:child_process";
import { formatSideLaneDigest, type SideLaneSnapshot } from "../side-lane-store.js";
import { refreshTrackedNativeSideAgentLane } from "../workflow/workflow-side-agent-lanes.js";
import type { AppCommandContext } from "./app-command-context.js";
import { executeNativeTool, hasNativeTool, parseJsonToolOutput } from "./app-command-macros.js";

interface NativeSideAgentStopResult {
	id: string;
	state: string;
	reason?: string;
	alreadyStopped?: boolean;
}

function resolveTrackedLane(ctx: AppCommandContext, commandName: string, selector?: string): SideLaneSnapshot | null {
	const lane = ctx.state.sideLanes.find(selector);
	if (lane) {
		return lane;
	}
	const suffix = selector ? ` matching "${selector}"` : "";
	ctx.addInfoMessage(`${commandName}: no tracked side lane${suffix}.`);
	return null;
}

function renderLaneList(lanes: SideLaneSnapshot[]): string {
	return [
		"Tracked side lanes:",
		...lanes.map((lane, index) => {
			const detail = lane.error || lane.responseSummary || lane.recentOutput || lane.title;
			const suffix = detail ? ` — ${detail.replace(/\s+/g, " ").trim()}` : "";
			return `${index + 1}. ${lane.id} ${formatSideLaneDigest(lane)}${suffix}`;
		}),
	].join("\n");
}

function renderLaneDetail(lane: SideLaneSnapshot): string {
	const lines = [
		lane.id,
		`Digest: ${formatSideLaneDigest(lane)}`,
		`Command: ${lane.commandName}`,
		`State: ${lane.state}`,
		`Title: ${lane.title}`,
		`Updated: ${new Date(lane.updatedAt).toISOString()}`,
	];
	if (lane.tmuxWindow) {
		lines.push(`tmux: ${lane.tmuxWindow}`);
	}
	if (lane.branch) {
		lines.push(`Branch: ${lane.branch}`);
	}
	if (lane.worktree) {
		lines.push(`Worktree: ${lane.worktree}`);
	}
	if (lane.model) {
		lines.push(`Model: ${lane.model}`);
	}
	if (lane.lastQuery) {
		lines.push(`Last query: ${lane.lastQuery}`);
	}
	if (lane.responseType) {
		lines.push(`Response type: ${lane.responseType}`);
	}
	if (lane.responseSummary) {
		lines.push(`Summary: ${lane.responseSummary}`);
	}
	if (lane.error) {
		lines.push(`Error: ${lane.error}`);
	}
	if (lane.recentOutput) {
		lines.push("Recent output:");
		lines.push(lane.recentOutput.trimEnd());
	}
	return lines.join("\n");
}

function splitLanePromptArgs(args: string): { selector: string; prompt: string } | null {
	const trimmed = args.trim();
	if (!trimmed) {
		return null;
	}
	const [selector, ...rest] = trimmed.split(/\s+/);
	const prompt = rest.join(" ").trim();
	return selector && prompt ? { selector, prompt } : null;
}

function listLaneSelectors(ctx: AppCommandContext): string[] {
	const lanes = ctx.state.sideLanes.list(12);
	return ["latest", ...new Set(lanes.flatMap((lane) => [lane.id, lane.tmuxWindow, lane.commandName].filter(Boolean)))];
}

function getLaneSelectorCompletions(ctx: AppCommandContext, partial: string, includeAll = false): string[] {
	const trimmed = partial.trim().toLowerCase();
	const selectors = listLaneSelectors(ctx);
	const prefixed = includeAll ? ["all", ...selectors] : selectors;
	if (!trimmed) {
		return prefixed;
	}
	return prefixed.filter((value) => value.toLowerCase().includes(trimmed)).slice(0, 12);
}

function getLaneSendCompletions(ctx: AppCommandContext, partial: string): string[] {
	const trimmed = partial.trimStart();
	if (!trimmed || !trimmed.includes(" ")) {
		const selector = trimmed.toLowerCase();
		return listLaneSelectors(ctx)
			.filter((value) => value.toLowerCase().includes(selector))
			.slice(0, 12)
			.map((value) => `${value} `);
	}
	return [];
}

export function registerSideLaneCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/lane-list",
		"List tracked side lanes",
		async () => {
			const lanes = ctx.state.sideLanes.list(8);
			if (lanes.length === 0) {
				ctx.addInfoMessage("/lane-list: no tracked side lanes.");
				return;
			}
			ctx.addInfoMessage(renderLaneList(lanes));
		},
		["/lanes"],
	);

	ctx.commands.register(
		"/lane-refresh",
		"Refresh tracked side-lane state from native tools",
		async (args) => {
			if (!hasNativeTool(ctx, "takumi_agent_check")) {
				ctx.addInfoMessage("/lane-refresh: takumi_agent_check is unavailable.");
				return;
			}

			if (args.trim() === "all") {
				const lanes = ctx.state.sideLanes.list();
				if (lanes.length === 0) {
					ctx.addInfoMessage("/lane-refresh: no tracked side lanes.");
					return;
				}
				// I refresh sequentially so tool usage stays predictable in the main operator lane.
				let refreshed = 0;
				for (const lane of lanes) {
					const preview = await refreshTrackedNativeSideAgentLane(ctx, "/lane-refresh", lane.id);
					if (preview) {
						refreshed += 1;
					}
				}
				ctx.addInfoMessage(`/lane-refresh: refreshed ${refreshed} side lane${refreshed === 1 ? "" : "s"}.`);
				return;
			}

			const lane = resolveTrackedLane(ctx, "/lane-refresh", args.trim() || undefined);
			if (!lane) {
				return;
			}
			const preview = await refreshTrackedNativeSideAgentLane(ctx, "/lane-refresh", lane.id);
			if (!preview) {
				ctx.addInfoMessage(`/lane-refresh: could not refresh ${lane.id}.`);
				return;
			}
			ctx.addInfoMessage(`/lane-refresh: ${lane.id} is ${preview.state} in ${lane.tmuxWindow || lane.id}.`);
		},
		{ aliases: ["/lane-check"], getArgumentCompletions: (partial) => getLaneSelectorCompletions(ctx, partial, true) },
	);

	ctx.commands.register(
		"/lane-show",
		"Show tracked side-lane details",
		async (args) => {
			const lane = resolveTrackedLane(ctx, "/lane-show", args.trim() || undefined);
			if (!lane) {
				return;
			}
			ctx.addInfoMessage(renderLaneDetail(lane));
		},
		{ aliases: ["/lane-inspect"], getArgumentCompletions: (partial) => getLaneSelectorCompletions(ctx, partial) },
	);

	ctx.commands.register(
		"/lane-focus",
		"Focus a tracked side lane in tmux",
		async (args) => {
			const lane = resolveTrackedLane(ctx, "/lane-focus", args.trim() || undefined);
			if (!lane) {
				return;
			}
			if (!lane.tmuxWindow) {
				ctx.addInfoMessage(`/lane-focus: ${lane.id} has no tmux window recorded.`);
				return;
			}
			if (!process.env.TMUX) {
				ctx.addInfoMessage(
					`/lane-focus: not inside tmux. Focus manually with: tmux select-window -t ${lane.tmuxWindow}`,
				);
				return;
			}
			try {
				// I intentionally use tmux directly here because focus is a terminal concern, not an LLM-tool concern.
				execFileSync("tmux", ["select-window", "-t", lane.tmuxWindow], { stdio: "ignore" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.addInfoMessage(`/lane-focus: tmux select-window failed for ${lane.tmuxWindow} — ${message}`);
			}
		},
		{ aliases: ["/lane-open"], getArgumentCompletions: (partial) => getLaneSelectorCompletions(ctx, partial) },
	);

	ctx.commands.register(
		"/lane-send",
		"Send a prompt to a tracked side lane",
		async (args) => {
			const parsed = splitLanePromptArgs(args);
			if (!parsed) {
				ctx.addInfoMessage("Usage: /lane-send <lane-id|tmux-window|command> <prompt>");
				return;
			}
			if (!hasNativeTool(ctx, "takumi_agent_send")) {
				ctx.addInfoMessage("/lane-send: takumi_agent_send is unavailable.");
				return;
			}
			const lane = resolveTrackedLane(ctx, "/lane-send", parsed.selector);
			if (!lane) {
				return;
			}
			const result = await executeNativeTool(ctx, "/lane-send", "takumi_agent_send", {
				id: lane.id,
				prompt: parsed.prompt,
			});
			if (!result || result.isError) {
				return;
			}
			await refreshTrackedNativeSideAgentLane(ctx, "/lane-send", lane.id);
			ctx.addInfoMessage(`/lane-send: sent prompt to ${lane.id}.`);
		},
		{ getArgumentCompletions: (partial) => getLaneSendCompletions(ctx, partial) },
	);

	ctx.commands.register(
		"/lane-stop",
		"Stop a tracked side lane and release its resources",
		async (args) => {
			if (!hasNativeTool(ctx, "takumi_agent_stop")) {
				ctx.addInfoMessage("/lane-stop: takumi_agent_stop is unavailable.");
				return;
			}
			const lane = resolveTrackedLane(ctx, "/lane-stop", args.trim() || undefined);
			if (!lane) {
				return;
			}
			const result = await executeNativeTool(ctx, "/lane-stop", "takumi_agent_stop", { id: lane.id });
			const stopped = parseJsonToolOutput<NativeSideAgentStopResult>(result);
			if (!stopped) {
				return;
			}
			ctx.state.sideLanes.upsert({
				id: lane.id,
				state: stopped.state,
				error: stopped.reason ?? lane.error ?? "Stopped by operator",
			});
			ctx.addInfoMessage(
				stopped.alreadyStopped
					? `/lane-stop: ${lane.id} was already ${stopped.state}.`
					: `/lane-stop: stopped ${lane.id} and released its lane.`,
			);
		},
		{ getArgumentCompletions: (partial) => getLaneSelectorCompletions(ctx, partial) },
	);
}
