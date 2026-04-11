import type { AlertLevel as CostAlertLevel } from "@takumi/agent";

interface BuildCostTelemetryTextInput {
	tokens: number;
	formattedCost: string;
	formattedCostRate: string;
	alertLevel: CostAlertLevel;
	hasCostSpike: boolean;
	budgetFraction: number;
}

/** Format spend rate in a compact operator-facing form. */
export function formatUsdPerMinute(rate: number): string {
	if (!(rate > 0)) return "";
	if (rate < 0.01) return `$${rate.toFixed(4)}/m`;
	if (rate < 1) return `$${rate.toFixed(3)}/m`;
	return `$${rate.toFixed(2)}/m`;
}

/** Build the status-bar spend summary from the current cost snapshot. */
export function buildCostTelemetryText(input: BuildCostTelemetryTextInput): string {
	if (input.tokens <= 0) return "";

	const parts = [`${input.tokens.toLocaleString()}t`, input.formattedCost];
	if (input.formattedCostRate) {
		const alertGlyph =
			input.alertLevel === "critical" ? "‼" : input.alertLevel === "warning" || input.hasCostSpike ? "▲" : "↑";
		parts.push(`${alertGlyph}${input.formattedCostRate}`);
	}

	if (input.budgetFraction >= 0.25 || input.alertLevel !== "none") {
		parts.push(`${Math.round(input.budgetFraction * 100)}% budget`);
	}

	return ` ${parts.join(" | ")} `;
}
