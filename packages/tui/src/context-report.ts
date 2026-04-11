import type { TakumiConfig } from "@takumi/core";
import { formatChitraguptaSyncLine } from "./operator-authority.js";
import { formatSideLaneDigest } from "./side-lane-store.js";
import type { AppState } from "./state.js";

type ContextReportConfig = Pick<TakumiConfig, "maxCostUsd" | "workingDirectory">;

export function buildContextReport(state: AppState, config: ContextReportConfig): string {
	const lines = ["Context report", ""];
	const workingDirectory = config.workingDirectory || process.cwd();
	const totalTokens = state.totalTokens.value;
	const snapshot = state.costSnapshot.value;
	const sideLanes = state.sideLanes.list(3);
	const trackedLaneCount = state.sideLanes.entries.value.length;

	lines.push("Session");
	lines.push(`  Working dir  ${workingDirectory}`);
	lines.push(`  Session      ${state.sessionId.value || "(none)"}`);
	lines.push(`  Canonical    ${state.canonicalSessionId.value || "(unbound)"}`);
	lines.push(`  Hub          ${state.chitraguptaConnected.value ? "connected" : "standalone"}`);
	lines.push(`  Sync         ${formatChitraguptaSyncLine(state)}`);
	lines.push(`  Model        ${state.model.value}`);
	lines.push(`  Provider     ${state.provider.value}`);

	lines.push("");
	lines.push("Conversation");
	lines.push(`  Messages     ${state.messageCount.value}`);
	lines.push(`  Turns        ${state.turnCount.value}`);
	lines.push(
		`  Tokens       ${totalTokens.toLocaleString()} total (${state.totalInputTokens.value.toLocaleString()} in / ${state.totalOutputTokens.value.toLocaleString()} out)`,
	);

	lines.push("");
	lines.push("Context window");
	if (hasMeasuredContext(state)) {
		lines.push(
			`  Usage        ${state.contextTokens.value.toLocaleString()} / ${state.contextWindow.value.toLocaleString()} (${state.contextPercent.value.toFixed(1)}%)`,
		);
	} else {
		lines.push("  Usage        not measured yet in this runtime");
	}
	lines.push(`  Pressure     ${formatPressureLabel(state.contextPressure.value)}`);
	lines.push(`  Advice       ${buildContextAdvice(state)}`);
	if (state.consolidationInProgress.value) {
		lines.push("  Consolidate  running");
	}

	lines.push("");
	lines.push("Cost");
	lines.push(`  Spent        ${formatUsd(snapshot?.totalUsd ?? state.totalCost.value)}`);
	lines.push(`  Budget       ${formatBudgetLine(state, config.maxCostUsd)}`);
	if ((snapshot?.ratePerMinute ?? 0) > 0) {
		lines.push(`  Burn         ${formatUsd(snapshot?.ratePerMinute ?? 0)}/min`);
		lines.push(`  Projected    ${formatUsd(snapshot?.projectedUsd ?? state.totalCost.value)} (10m horizon)`);
	}
	if ((snapshot?.avgCostPerTurn ?? 0) > 0) {
		lines.push(`  Avg / turn   ${formatUsd(snapshot?.avgCostPerTurn ?? 0)}`);
	}
	if (state.costAlertLevel.value !== "none") {
		lines.push(`  Alert        ${titleCase(state.costAlertLevel.value)}`);
	} else if (state.hasCostSpike.value) {
		lines.push("  Alert        Burn spike");
	}

	lines.push("");
	lines.push("Runtime");
	lines.push(`  Status       ${state.statusText.value}`);
	lines.push(`  Side lanes   ${formatSideLaneSummary(sideLanes, trackedLaneCount)}`);

	return lines.join("\n");
}

function hasMeasuredContext(state: AppState): boolean {
	return state.contextTokens.value > 0 || state.contextPercent.value > 0;
}

function buildContextAdvice(state: AppState): string {
	if (state.consolidationInProgress.value) {
		return "Auto-consolidation is running; avoid stacking more large turns until it settles.";
	}

	if (!hasMeasuredContext(state)) {
		return "Live context telemetry appears after usage updates; send a turn to populate it.";
	}

	switch (state.contextPressure.value) {
		case "at_limit":
			return "Context is at the limit; compact before continuing.";
		case "near_limit":
			return "Context is very tight; compact or hand off now.";
		case "approaching_limit":
			return "Wrap the current subtask soon and consider /context-prune if the next turn will be large.";
		default:
			return "Context is healthy; no compaction needed right now.";
	}
}

function formatPressureLabel(value: string): string {
	if (!value) return "Unknown";
	return titleCase(value.replaceAll("_", " "));
}

function formatBudgetLine(state: AppState, budgetUsd?: number): string {
	const spent = state.costSnapshot.value?.totalUsd ?? state.totalCost.value;
	if (budgetUsd == null || !Number.isFinite(budgetUsd)) {
		return "unlimited";
	}

	const usedPct = budgetUsd > 0 ? (spent / budgetUsd) * 100 : 0;
	const remaining = budgetUsd - spent;
	return `${formatUsd(budgetUsd)} (${usedPct.toFixed(1)}% used, ${remaining >= 0 ? `${formatUsd(remaining)} remaining` : `${formatUsd(Math.abs(remaining))} over`})`;
}

function formatSideLaneSummary(digests: ReturnType<AppState["sideLanes"]["list"]>, totalCount: number): string {
	if (totalCount === 0) return "(none)";
	const preview = digests.map(formatSideLaneDigest).join(", ");
	return `${totalCount} tracked${preview ? ` (${preview})` : ""}`;
}

function formatUsd(value: number): string {
	const abs = Math.abs(value);
	if (abs < 0.01) return `$${value.toFixed(4)}`;
	if (abs < 1) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(2)}`;
}

function titleCase(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
