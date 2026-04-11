import { DEFAULT_ALERT_THRESHOLDS, type OperatorAlert } from "@takumi/core";
import type { AppState } from "../state.js";

export function buildCostAlert(
	state: AppState,
	createdAt: number,
	isAcknowledged: (alertId: string) => boolean,
): OperatorAlert | null {
	const costRatePerMinute = state.costRatePerMinute.value;
	const costProjectedUsd = state.costProjectedUsd.value;
	const costBudgetFraction = state.costBudgetFraction.value;
	const costAlertLevel = state.costAlertLevel.value;
	if (
		costRatePerMinute < DEFAULT_ALERT_THRESHOLDS.costSpikeWarningPerMin &&
		costAlertLevel !== "warning" &&
		costAlertLevel !== "critical"
	) {
		return null;
	}

	const severity: OperatorAlert["severity"] = costAlertLevel === "critical" ? "critical" : "warning";
	const messageParts = [
		costRatePerMinute > 0 ? `Cost burn ${formatUsd(costRatePerMinute)}/min` : "Cost budget alert",
		`spent ${formatUsd(state.totalCost.value)}`,
	];
	if (costRatePerMinute > 0) {
		messageParts.push(`projected ${formatUsd(costProjectedUsd)}`);
	}
	if (costBudgetFraction > 0) {
		messageParts.push(`${Math.round(costBudgetFraction * 100)}% budget`);
	}

	const alertId = `cost-spike-${severity}`;
	return {
		id: alertId,
		kind: "cost_spike",
		severity,
		message: messageParts.join(" | "),
		source: state.sessionId.value || "unknown",
		createdAt,
		acknowledged: isAcknowledged(alertId),
	};
}

function formatUsd(value: number): string {
	if (value < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}
