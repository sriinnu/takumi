/**
 * Shared operator observability builders.
 *
 * I keep the desktop bridge and slash-command surfaces on the same runtime
 * truth so alerts, fleet summaries, and degraded-state drill-down stop
 * drifting into separate operator realities.
 */

import type { AgentStateSnapshot, RoutingDecision } from "@takumi/bridge";
import type { FleetSummary, ObservabilitySessionSummary, OperatorAlert } from "@takumi/core";
import { summarizeDegradedExecutionContext } from "./degraded-execution-context.js";
import { buildCostAlert } from "./http-bridge/http-bridge-cost-alert.js";
import type { AppState } from "./state.js";

export type RoutingSummary = NonNullable<AgentStateSnapshot["routing"]>;
export type ApprovalSummary = NonNullable<AgentStateSnapshot["approval"]>;
export type SyncSummary = NonNullable<AgentStateSnapshot["sync"]>;
export type AnomalySummary = NonNullable<AgentStateSnapshot["anomaly"]>;

function isAlertAcknowledged(state: AppState, alertId: string): boolean {
	return state.acknowledgedAlerts.value.has(alertId);
}

/** Summarize the latest routing decision for operator surfaces. */
export function summarizeRouting(state: AppState): RoutingSummary | null {
	const decisions = state.routingDecisions.value;
	const latest = decisions.at(-1);
	if (!latest) return null;
	return {
		capability: latest.request?.capability ?? null,
		authority: latest.selected ? "engine" : "takumi-fallback",
		enforcement: latest.selected ? "same-provider" : "capability-only",
		laneCount: decisions.length,
		degraded: latest.degraded === true,
		fallbackChain: latest.fallbackChain ?? [],
		reason: latest.reason ?? null,
		selectedId: latest.selected?.id ?? null,
	};
}

/** Summarize approval pressure for operator-facing views. */
export function summarizeApproval(state: AppState): ApprovalSummary | null {
	const pending = state.pendingPermission.value;
	if (!pending) return { pendingCount: 0, tool: null, argsSummary: null };
	const argsSummary = JSON.stringify(pending.args).slice(0, 240);
	return {
		pendingCount: 1,
		tool: pending.tool,
		argsSummary,
	};
}

/** Summarize replay / sync health for operator alerting. */
export function summarizeChitraguptaSync(state: AppState): SyncSummary {
	const sessionTurns = state.messages.value.filter((message) => message.sessionTurn === true);
	const lastSyncedMessageId = state.chitraguptaSync.value.lastSyncedMessageId;
	const lastSyncedIndex = lastSyncedMessageId
		? sessionTurns.findIndex((message) => message.id === lastSyncedMessageId)
		: -1;
	const pendingLocalTurns = lastSyncedIndex >= 0 ? sessionTurns.slice(lastSyncedIndex + 1).length : sessionTurns.length;

	return {
		canonicalSessionId: state.canonicalSessionId.value || null,
		status: state.chitraguptaSync.value.status ?? "idle",
		pendingLocalTurns,
		lastSyncError: state.chitraguptaSync.value.lastError ?? null,
		lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId ?? null,
		lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp ?? null,
		lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId ?? null,
		lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp ?? null,
		lastFailedMessageId: state.chitraguptaSync.value.lastFailedMessageId ?? null,
		lastFailedMessageTimestamp: state.chitraguptaSync.value.lastFailedMessageTimestamp ?? null,
		lastSyncedAt: state.chitraguptaSync.value.lastSyncedAt ?? null,
	};
}

/** Summarize daemon anomalies for operator alerting. */
export function summarizeAnomaly(state: AppState): AnomalySummary | null {
	const anomaly = state.chitraguptaAnomaly.value;
	if (!anomaly) return null;
	return {
		severity: anomaly.severity,
		details: anomaly.details,
		suggestion: anomaly.suggestion,
	};
}

/** Describe the currently selected route target in operator-friendly terms. */
export function describeRoutingDecisionTarget(decision: RoutingDecision): string {
	const label = decision.selected?.label?.trim();
	if (label) return label;

	const metadata = decision.selected?.metadata as Record<string, unknown> | undefined;
	const model =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: undefined;
	if (decision.selected?.providerFamily && model) {
		return `${decision.selected.providerFamily}/${model}`;
	}
	if (model) return model;
	return decision.selected?.id ?? "local fallback";
}

/** Build the live session summary used by operator fleet views. */
export function buildSessionSummary(state: AppState): ObservabilitySessionSummary {
	const contextPercent = Number.isFinite(state.contextPercent.value) ? state.contextPercent.value : 0;
	const routing = summarizeRouting(state);
	const degraded = summarizeDegradedExecutionContext(state);
	return {
		sessionId: state.sessionId.value || "unknown",
		activity: state.isStreaming.value ? "working" : state.pendingPermission.value ? "waiting_input" : "idle",
		model: state.model.value,
		provider: state.provider.value,
		costUsd: state.totalCost.value,
		contextPercent,
		pressure:
			contextPercent >= 95
				? "at_limit"
				: contextPercent >= 85
					? "near_limit"
					: contextPercent >= 70
						? "approaching_limit"
						: "normal",
		turnCount: state.turnCount.value,
		toolFailures: summarizeAnomaly(state) ? 1 : 0,
		degraded: degraded?.active ?? routing?.degraded ?? false,
		fallbackChain: degraded?.route?.fallbackChain.length ? degraded.route.fallbackChain : routing?.fallbackChain,
		lastHeartbeatAt: Date.now(),
	};
}

/** Build the full set of current operator alerts, including acknowledged ones. */
export function buildOperatorAlerts(state: AppState): OperatorAlert[] {
	const alerts: OperatorAlert[] = [];
	const now = Date.now();
	const approval = summarizeApproval(state);
	const anomaly = summarizeAnomaly(state);
	const routing = summarizeRouting(state);
	const sync = summarizeChitraguptaSync(state);
	const degraded = summarizeDegradedExecutionContext(state);
	const contextPercent = Number.isFinite(state.contextPercent.value) ? state.contextPercent.value : 0;

	if (approval && approval.pendingCount > 0) {
		alerts.push({
			id: "approval-pending",
			kind: "approval_pressure",
			severity: "warning",
			message: `Approval pending for ${approval.tool ?? "tool"}`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "approval-pending"),
		});
	}

	if (contextPercent >= 95) {
		alerts.push({
			id: "context-critical",
			kind: "context_pressure",
			severity: "critical",
			message: `Context at ${Math.round(contextPercent)}%`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "context-critical"),
		});
	} else if (contextPercent >= 85) {
		alerts.push({
			id: "context-warning",
			kind: "context_pressure",
			severity: "warning",
			message: `Context approaching limit (${Math.round(contextPercent)}%)`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "context-warning"),
		});
	}

	if (degraded?.route?.degraded ?? routing?.degraded) {
		alerts.push({
			id: "routing-degraded",
			kind: "degraded_routing",
			severity: "warning",
			message: degraded?.route?.reason ? `Degraded routing: ${degraded.route.reason}` : "Degraded routing active",
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "routing-degraded"),
		});
	}

	if (degraded?.sync?.failed ?? sync.status === "failed") {
		const stalledOn = degraded?.sync?.lastFailedMessageId
			? `stalled on ${degraded.sync.lastFailedMessageId}`
			: sync.lastFailedMessageId
				? `stalled on ${sync.lastFailedMessageId}`
				: "failed";
		const pendingTurns = degraded?.sync?.pendingLocalTurns ?? sync.pendingLocalTurns;
		const pendingDetail = pendingTurns && pendingTurns > 0 ? ` (${pendingTurns} pending)` : "";
		const errorDetail = degraded?.sync?.reason
			? `: ${degraded.sync.reason}`
			: sync.lastSyncError
				? `: ${sync.lastSyncError}`
				: "";
		alerts.push({
			id: "sync-failed",
			kind: "sync_failure",
			severity: "warning",
			message: `Chitragupta replay ${stalledOn}${pendingDetail}${errorDetail}`,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "sync-failed"),
		});
	}

	const costAlert = buildCostAlert(state, now, (alertId) => isAlertAcknowledged(state, alertId));
	if (costAlert) {
		alerts.push(costAlert);
	}

	if (anomaly) {
		alerts.push({
			id: "daemon-anomaly",
			kind: "repeated_failure",
			severity: anomaly.severity === "critical" ? "critical" : "warning",
			message: anomaly.details,
			source: state.sessionId.value || "unknown",
			createdAt: now,
			acknowledged: isAlertAcknowledged(state, "daemon-anomaly"),
		});
	}

	return alerts;
}

/** Build only active, unacknowledged alerts. */
export function buildActiveOperatorAlerts(state: AppState): OperatorAlert[] {
	return buildOperatorAlerts(state).filter((alert) => !alert.acknowledged);
}

/** Build the fleet snapshot used by both the bridge and slash commands. */
export function buildFleetSummary(state: AppState): FleetSummary {
	const sessions = [buildSessionSummary(state)];
	const activeAlerts = buildActiveOperatorAlerts(state);
	const alertCounts = {
		info: activeAlerts.filter((alert) => alert.severity === "info").length,
		warning: activeAlerts.filter((alert) => alert.severity === "warning").length,
		critical: activeAlerts.filter((alert) => alert.severity === "critical").length,
	};
	return {
		totalAgents: 1,
		workingAgents: sessions.filter((session) => session.activity === "working").length,
		idleAgents: sessions.filter((session) => session.activity === "idle" || session.activity === "waiting_input")
			.length,
		errorAgents: sessions.filter((session) => session.activity === "error").length,
		totalCostUsd: sessions.reduce((sum, session) => sum + session.costUsd, 0),
		alertCounts,
		sessions,
		activeAlerts,
		snapshotAt: Date.now(),
	};
}

/** Acknowledge a currently-known operator alert in app state. */
export function acknowledgeOperatorAlert(state: AppState, alertId: string): boolean {
	const known = buildOperatorAlerts(state).some((alert) => alert.id === alertId);
	if (!known) return false;
	const next = new Set(state.acknowledgedAlerts.value);
	next.add(alertId);
	state.acknowledgedAlerts.value = next;
	return true;
}

/** Return recent degraded routing decisions, newest first. */
export function buildRecentDegradedRoutingDecisions(state: AppState, limit = 10): RoutingDecision[] {
	return state.routingDecisions.value
		.filter((decision) => decision.degraded === true)
		.slice(-limit)
		.reverse();
}
