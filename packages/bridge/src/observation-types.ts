/**
 * Observation & Notification types — Phases 49-51.
 *
 * Types for bidirectional Chitragupta ↔ Takumi communication.
 *
 * Current bridge contract shape:
 * - Takumi → Chitragupta: session.open, session.turn, observe.batch, heal.report, preference.update
 * - Chitragupta → Takumi: predict.next, memory.recall, pattern.query, sabha.ask, push notifications
 * - Shared service methods: health.status, capabilities, subscribe
 */

// ── Observation Events (Phase 49: Takumi → Chitragupta) ──────────────────────

/** Tool usage observation — emitted after every tool call. */
export interface ToolUsageEvent {
	type: "tool_usage";
	tool: string;
	argsHash: string;
	durationMs: number;
	success: boolean;
	sessionId: string;
	timestamp: number;
}

/** Error→resolution pair — emitted when a tool succeeds after a prior failure. */
export interface ErrorResolutionEvent {
	type: "error_resolution";
	tool: string;
	errorMsg: string;
	resolution: string;
	sessionId: string;
	timestamp: number;
}

/** Edit pattern — emitted when the agent modifies files. */
export interface EditPatternEvent {
	type: "edit_pattern";
	files: string[];
	editType: "create" | "edit" | "delete" | "rename";
	coEdited: string[];
	sessionId: string;
	timestamp: number;
}

/** User correction — emitted when the user overrides or undoes agent output. */
export interface UserCorrectionEvent {
	type: "user_correction";
	originalHash: string;
	correctedHash: string;
	context: string;
	sessionId: string;
	timestamp: number;
}

/** Command/preference observation — tracks frequently used commands and settings. */
export interface PreferenceEvent {
	type: "preference";
	key: string;
	value: string;
	frequency: number;
	sessionId: string;
	timestamp: number;
}

/** Union of all observation event types. */
export type ObservationEvent =
	| ToolUsageEvent
	| ErrorResolutionEvent
	| EditPatternEvent
	| UserCorrectionEvent
	| PreferenceEvent;

/** observe.batch() result */
export interface ObserveBatchResult {
	accepted: number;
}

// ── Push Notifications (Phase 50: Chitragupta → Takumi) ──────────────────────

/** Detected pattern notification. */
export interface PatternDetectedNotification {
	type: string;
	pattern: unknown;
	confidence: number;
	occurrences: number;
	suggestion?: string;
}

/** Anomaly alert — error spikes, cost trajectory, infinite loops. */
export interface AnomalyAlertNotification {
	type: "error_spike" | "loop_detected" | "cost_trajectory";
	severity: "info" | "warning" | "critical";
	details: Record<string, unknown>;
	suggestion: string;
}

/** Evolution request — Chitragupta suggests auto-configuration changes. */
export interface EvolveRequestNotification {
	type: "auto_configure" | "tool_preference" | "style_update";
	payload: Record<string, unknown>;
}

/** Preference update — a learned preference from observations. */
export interface PreferenceUpdateNotification {
	key: string;
	value: string;
	confidence: number;
	source: string;
}

/** Union of all notification types Chitragupta can push. */
export type ChitraguptaNotification =
	| { method: "pattern_detected"; params: PatternDetectedNotification }
	| { method: "prediction"; params: PredictionNotification }
	| { method: "anomaly_alert"; params: AnomalyAlertNotification }
	| { method: "evolve_request"; params: EvolveRequestNotification }
	| { method: "preference_update"; params: PreferenceUpdateNotification };

// ── Query Types (Phase 51: Takumi → Chitragupta) ─────────────────────────────

/** predict.next() params */
export interface PredictNextParams {
	currentTool?: string;
	currentFile?: string;
	sessionId: string;
}

/** A single prediction result. */
export interface PredictionResult {
	type: "next_action" | "likely_files" | "failure_warning";
	action?: string;
	files?: string[];
	risk?: number;
	confidence: number;
	reasoning?: string;
	pastFailures?: number;
	suggestion?: string;
}

/** predict.next() result */
export interface PredictNextResult {
	predictions: PredictionResult[];
}

/** Prediction notification — proactive envelope carrying one or more predictions. */
export interface PredictionNotification {
	type: "next_action" | "likely_files" | "failure_warning";
	predictions: PredictionResult[];
}

/** pattern.query() params */
export interface PatternQueryParams {
	type?: string;
	minConfidence?: number;
	limit?: number;
}

/** A detected pattern record. */
export interface DetectedPattern {
	id: number;
	type: string;
	pattern: unknown;
	confidence: number;
	occurrences: number;
	firstSeen: number;
	lastSeen: number;
}

/** pattern.query() result */
export interface PatternQueryResult {
	patterns: DetectedPattern[];
}

/** health.status() result — extends existing ChitraguptaHealth. */
export interface HealthStatusResult {
	errorRate: number;
	anomalies: AnomalyAlertNotification[];
	costTrajectory: {
		currentCost: number;
		dailyAvg: number;
		projectedCost: number;
	};
}

/** heal.report() params */
export interface HealReportParams {
	anomalyType: string;
	actionTaken: string;
	outcome: "success" | "partial" | "failed";
	sessionId: string;
}

/** heal.report() result */
export interface HealReportResult {
	recorded: boolean;
}

// ── Notification Method Names (for onNotification subscriptions) ─────────────

export const NOTIFICATION_METHODS = {
	PATTERN_DETECTED: "pattern_detected",
	PREDICTION: "prediction",
	ANOMALY_ALERT: "anomaly_alert",
	EVOLVE_REQUEST: "evolve_request",
	PREFERENCE_UPDATE: "preference_update",
} as const;
