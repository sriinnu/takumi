/**
 * Operator observability types — P-Track 5.
 *
 * Defines session/fleet summary structures, threshold alerts,
 * and degraded-run replay metadata used by operator dashboards.
 */

// ── Alert system ──────────────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertKind =
	| "context_pressure"
	| "cost_spike"
	| "repeated_failure"
	| "degraded_routing"
	| "approval_pressure"
	| "stale_agent";

export interface OperatorAlert {
	id: string;
	kind: AlertKind;
	severity: AlertSeverity;
	message: string;
	/** The PID or session ID that triggered the alert. */
	source: string;
	/** Unix timestamp (ms). */
	createdAt: number;
	/** Whether the operator has acknowledged this alert. */
	acknowledged: boolean;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

export interface AlertThresholds {
	/** Context usage % that triggers a warning.  Default: 85 */
	contextWarningPercent: number;
	/** Context usage % that triggers critical.   Default: 95 */
	contextCriticalPercent: number;
	/** Cost per minute (USD) that triggers a warning.  Default: 0.10 */
	costSpikeWarningPerMin: number;
	/** Number of consecutive tool failures that triggers an alert. Default: 3 */
	repeatFailureCount: number;
	/** Pending approvals count that triggers pressure alert. Default: 5 */
	approvalPressureCount: number;
	/** Seconds without heartbeat before stale alert.  Default: 30 */
	staleAgentSec: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
	contextWarningPercent: 85,
	contextCriticalPercent: 95,
	costSpikeWarningPerMin: 0.1,
	repeatFailureCount: 3,
	approvalPressureCount: 5,
	staleAgentSec: 30,
};

// ── Session summary ───────────────────────────────────────────────────────────

export interface SessionSummary {
	sessionId: string;
	/** Current activity state. */
	activity: "working" | "waiting_input" | "idle" | "error";
	/** Model in use. */
	model: string;
	/** Provider in use. */
	provider: string;
	/** Running total cost (USD). */
	costUsd: number;
	/** Context window usage (0–100). */
	contextPercent: number;
	/** Context pressure level. */
	pressure: "normal" | "approaching_limit" | "near_limit" | "at_limit";
	/** Total turns completed. */
	turnCount: number;
	/** Count of tool failures in this session. */
	toolFailures: number;
	/** Whether routing is degraded. */
	degraded: boolean;
	/** Fallback chain used (if degraded). */
	fallbackChain?: string[];
	/** Last heartbeat timestamp (ms). */
	lastHeartbeatAt: number;
}

// ── Fleet summary ─────────────────────────────────────────────────────────────

export interface FleetSummary {
	/** Total active agents. */
	totalAgents: number;
	/** Agents currently working. */
	workingAgents: number;
	/** Agents idle. */
	idleAgents: number;
	/** Agents in error state. */
	errorAgents: number;
	/** Aggregate cost across all sessions (USD). */
	totalCostUsd: number;
	/** Active alerts by severity. */
	alertCounts: Record<AlertSeverity, number>;
	/** Per-session summaries. */
	sessions: SessionSummary[];
	/** Active (unacknowledged) alerts. */
	activeAlerts: OperatorAlert[];
	/** Timestamp of this snapshot. */
	snapshotAt: number;
}

// ── Degraded-run replay metadata ──────────────────────────────────────────────

export interface DegradedRunEntry {
	/** Session ID of the degraded run. */
	sessionId: string;
	/** Run ID (exec protocol run ID, if headless). */
	runId?: string;
	/** Why it was degraded. */
	reason: string;
	/** Routing fallback chain attempted. */
	fallbackChain: string[];
	/** Was the run ultimately successful despite degradation? */
	succeeded: boolean;
	/** Duration (ms). */
	durationMs: number;
	/** Timestamp (ms). */
	occurredAt: number;
}

// ── Factory helpers ───────────────────────────────────────────────────────────

let alertCounter = 0;

export function createAlertId(now = Date.now()): string {
	alertCounter += 1;
	return `alert-${now.toString(36)}-${alertCounter.toString(36).padStart(3, "0")}`;
}

/** Reset counter — tests only. */
export function resetAlertCounter(): void {
	alertCounter = 0;
}

export function createAlert(input: {
	kind: AlertKind;
	severity: AlertSeverity;
	message: string;
	source: string;
}): OperatorAlert {
	return {
		id: createAlertId(),
		kind: input.kind,
		severity: input.severity,
		message: input.message,
		source: input.source,
		createdAt: Date.now(),
		acknowledged: false,
	};
}
