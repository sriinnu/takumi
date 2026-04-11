import type { TurnCost } from "@takumi/agent";
import type { AppState } from "./state.js";

interface ModelAggregate {
	model: string;
	turns: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd: number;
}

export function buildBudgetReport(state: AppState, budgetUsd?: number): string {
	const snapshot = state.costSnapshot.value;
	const spent = snapshot?.totalUsd ?? state.totalCost.value;
	const lines = ["Budget"];

	lines.push(`  Spent       ${formatUsd(spent)}`);
	if (budgetUsd == null || !Number.isFinite(budgetUsd)) {
		lines.push("  Limit       unlimited");
		if ((snapshot?.ratePerMinute ?? 0) > 0) {
			lines.push(`  Burn        ${formatUsd(snapshot?.ratePerMinute ?? 0)}/min`);
		}
		return lines.join("\n");
	}

	const remaining = budgetUsd - spent;
	const usedPct = budgetUsd > 0 ? (spent / budgetUsd) * 100 : 0;
	lines.push(`  Limit       ${formatUsd(budgetUsd)}`);
	lines.push(`  Remaining   ${remaining >= 0 ? formatUsd(remaining) : `${formatUsd(Math.abs(remaining))} over`}`);
	lines.push(`  Used        ${usedPct.toFixed(1)}%`);
	if ((snapshot?.ratePerMinute ?? 0) > 0) {
		lines.push(`  Burn        ${formatUsd(snapshot?.ratePerMinute ?? 0)}/min`);
		lines.push(`  Projected   ${formatUsd(snapshot?.projectedUsd ?? spent)} (10m horizon)`);
	}
	if (state.costAlertLevel.value !== "none") {
		lines.push(`  Alert       ${titleCase(state.costAlertLevel.value)}`);
	} else if (state.hasCostSpike.value) {
		lines.push("  Alert       Burn spike");
	}

	return lines.join("\n");
}

export function buildCostReport(state: AppState, budgetUsd?: number): string {
	const snapshot = state.costSnapshot.value;
	const totalUsd = snapshot?.totalUsd ?? state.totalCost.value;
	const totalInputTokens = snapshot?.totalInputTokens ?? state.totalInputTokens.value;
	const totalOutputTokens = snapshot?.totalOutputTokens ?? state.totalOutputTokens.value;
	const trackedTurns = snapshot?.turns ?? [];
	const totalTokens = totalInputTokens + totalOutputTokens;
	const lines = ["Cost report"];

	lines.push(`  Total         ${formatUsd(totalUsd)}`);
	lines.push(
		`  Tokens        ${totalTokens.toLocaleString()} total (${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out)`,
	);
	lines.push(`  Budget        ${formatBudgetLine(totalUsd, budgetUsd)}`);
	if ((snapshot?.ratePerMinute ?? 0) > 0) {
		lines.push(`  Burn rate     ${formatUsd(snapshot?.ratePerMinute ?? 0)}/min`);
		lines.push(`  Projected     ${formatUsd(snapshot?.projectedUsd ?? totalUsd)} (10m horizon)`);
	}
	if ((snapshot?.avgCostPerTurn ?? 0) > 0) {
		lines.push(`  Avg / turn    ${formatUsd(snapshot?.avgCostPerTurn ?? 0)}`);
	}
	if (state.costAlertLevel.value !== "none") {
		lines.push(`  Alert         ${titleCase(state.costAlertLevel.value)}`);
	} else if (state.hasCostSpike.value) {
		lines.push("  Alert         Burn spike");
	}

	if (trackedTurns.length === 0) {
		if (totalTokens > 0) {
			lines.push("");
			lines.push("Detailed model and turn breakdown becomes available as this runtime observes priced turns.");
		}
		return lines.join("\n");
	}

	const byModel = aggregateByModel(trackedTurns);
	lines.push("");
	lines.push("By model (tracked this runtime)");
	for (const entry of byModel) {
		const cacheBits: string[] = [];
		if (entry.cacheReadTokens > 0) cacheBits.push(`${entry.cacheReadTokens.toLocaleString()} cache read`);
		if (entry.cacheWriteTokens > 0) cacheBits.push(`${entry.cacheWriteTokens.toLocaleString()} cache write`);
		const cacheText = cacheBits.length > 0 ? ` | ${cacheBits.join(" / ")}` : "";
		lines.push(
			`  ${entry.model} — ${formatUsd(entry.costUsd)} | ${entry.turns} turn${entry.turns === 1 ? "" : "s"} | ${entry.inputTokens.toLocaleString()} in / ${entry.outputTokens.toLocaleString()} out${cacheText}`,
		);
	}

	lines.push("");
	lines.push("Recent priced turns");
	for (const turn of trackedTurns.slice(-3)) {
		const cacheBits: string[] = [];
		if (turn.cacheReadTokens > 0) cacheBits.push(`${turn.cacheReadTokens.toLocaleString()} cache read`);
		if (turn.cacheWriteTokens > 0) cacheBits.push(`${turn.cacheWriteTokens.toLocaleString()} cache write`);
		const cacheText = cacheBits.length > 0 ? ` | ${cacheBits.join(" / ")}` : "";
		lines.push(
			`  #${turn.turn} ${turn.model} — ${formatUsd(turn.costUsd)} | ${turn.inputTokens.toLocaleString()} in / ${turn.outputTokens.toLocaleString()} out${cacheText}`,
		);
	}

	return lines.join("\n");
}

function aggregateByModel(turns: TurnCost[]): ModelAggregate[] {
	const byModel = new Map<string, ModelAggregate>();
	for (const turn of turns) {
		const existing = byModel.get(turn.model) ?? {
			model: turn.model,
			turns: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUsd: 0,
		};
		existing.turns += 1;
		existing.inputTokens += turn.inputTokens;
		existing.outputTokens += turn.outputTokens;
		existing.cacheReadTokens += turn.cacheReadTokens;
		existing.cacheWriteTokens += turn.cacheWriteTokens;
		existing.costUsd += turn.costUsd;
		byModel.set(turn.model, existing);
	}

	return [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function formatBudgetLine(spentUsd: number, budgetUsd?: number): string {
	if (budgetUsd == null || !Number.isFinite(budgetUsd)) return "unlimited";
	const usedPct = budgetUsd > 0 ? (spentUsd / budgetUsd) * 100 : 0;
	return `${formatUsd(budgetUsd)} (${usedPct.toFixed(1)}% used)`;
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
