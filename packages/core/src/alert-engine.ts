/**
 * Alert engine — evaluates telemetry snapshots against thresholds
 * and produces OperatorAlerts for the observability dashboard.
 */

import type {
	AlertSeverity,
	AlertThresholds,
	DegradedRunEntry,
	FleetSummary,
	OperatorAlert,
	SessionSummary,
} from "./observability-types.js";
import { createAlert, DEFAULT_ALERT_THRESHOLDS } from "./observability-types.js";

// ── Engine ────────────────────────────────────────────────────────────────────

export class AlertEngine {
	private alerts: OperatorAlert[] = [];
	private degradedRuns: DegradedRunEntry[] = [];
	private readonly thresholds: AlertThresholds;
	private readonly maxAlerts: number;

	constructor(options?: { thresholds?: Partial<AlertThresholds>; maxAlerts?: number }) {
		this.thresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...options?.thresholds };
		this.maxAlerts = options?.maxAlerts ?? 500;
	}

	/** Evaluate a session summary and fire alerts if thresholds are breached. */
	evaluateSession(session: SessionSummary): OperatorAlert[] {
		const fired: OperatorAlert[] = [];

		// Context pressure
		if (session.contextPercent >= this.thresholds.contextCriticalPercent) {
			fired.push(
				createAlert({
					kind: "context_pressure",
					severity: "critical",
					message: `Context at ${session.contextPercent}% for session ${session.sessionId}`,
					source: session.sessionId,
				}),
			);
		} else if (session.contextPercent >= this.thresholds.contextWarningPercent) {
			fired.push(
				createAlert({
					kind: "context_pressure",
					severity: "warning",
					message: `Context approaching limit (${session.contextPercent}%) for session ${session.sessionId}`,
					source: session.sessionId,
				}),
			);
		}

		// Repeated failures
		if (session.toolFailures >= this.thresholds.repeatFailureCount) {
			fired.push(
				createAlert({
					kind: "repeated_failure",
					severity: "warning",
					message: `${session.toolFailures} tool failures in session ${session.sessionId}`,
					source: session.sessionId,
				}),
			);
		}

		// Degraded routing
		if (session.degraded) {
			fired.push(
				createAlert({
					kind: "degraded_routing",
					severity: "warning",
					message: `Degraded routing in session ${session.sessionId}: ${session.fallbackChain?.join(" → ") ?? "unknown"}`,
					source: session.sessionId,
				}),
			);
		}

		for (const alert of fired) this.addAlert(alert);
		return fired;
	}

	/** Check for stale agents (no heartbeat in threshold window). */
	evaluateStaleness(sessions: SessionSummary[], now = Date.now()): OperatorAlert[] {
		const fired: OperatorAlert[] = [];
		const staleMs = this.thresholds.staleAgentSec * 1000;

		for (const session of sessions) {
			if (now - session.lastHeartbeatAt > staleMs && session.activity !== "idle") {
				const alert = createAlert({
					kind: "stale_agent",
					severity: "warning",
					message: `Agent for session ${session.sessionId} has not sent a heartbeat in ${this.thresholds.staleAgentSec}s`,
					source: session.sessionId,
				});
				fired.push(alert);
				this.addAlert(alert);
			}
		}
		return fired;
	}

	/** Record a degraded run for replay/debug. */
	recordDegradedRun(entry: DegradedRunEntry): void {
		this.degradedRuns.push(entry);
		if (this.degradedRuns.length > this.maxAlerts) {
			this.degradedRuns = this.degradedRuns.slice(-this.maxAlerts);
		}
	}

	/** Acknowledge an alert. */
	acknowledge(alertId: string): boolean {
		const alert = this.alerts.find((a) => a.id === alertId);
		if (!alert) return false;
		alert.acknowledged = true;
		return true;
	}

	/** Build a fleet summary from session summaries. */
	buildFleetSummary(sessions: SessionSummary[]): FleetSummary {
		const alertCounts: Record<AlertSeverity, number> = { info: 0, warning: 0, critical: 0 };
		for (const a of this.activeAlerts()) {
			alertCounts[a.severity]++;
		}
		return {
			totalAgents: sessions.length,
			workingAgents: sessions.filter((s) => s.activity === "working").length,
			idleAgents: sessions.filter((s) => s.activity === "idle" || s.activity === "waiting_input").length,
			errorAgents: sessions.filter((s) => s.activity === "error").length,
			totalCostUsd: sessions.reduce((sum, s) => sum + s.costUsd, 0),
			alertCounts,
			sessions,
			activeAlerts: this.activeAlerts(),
			snapshotAt: Date.now(),
		};
	}

	/** Active (unacknowledged) alerts. */
	activeAlerts(): OperatorAlert[] {
		return this.alerts.filter((a) => !a.acknowledged);
	}

	/** All alerts (including acknowledged). */
	allAlerts(): OperatorAlert[] {
		return [...this.alerts];
	}

	/** Get degraded run history. */
	getDegradedRuns(limit = 50): DegradedRunEntry[] {
		return this.degradedRuns.slice(-limit);
	}

	// ── Private ─────────────────────────────────────────────────────────────

	private addAlert(alert: OperatorAlert): void {
		this.alerts.push(alert);
		if (this.alerts.length > this.maxAlerts) {
			this.alerts = this.alerts.slice(-this.maxAlerts);
		}
	}
}
