/**
 * Observation & Notification types — Phases 49-51.
 *
 * Types for bidirectional Chitragupta ↔ Takumi communication.
 *
 * Current bridge contract shape:
 * - Takumi → Chitragupta: session.create, turn.add, observe.batch, heal.report, preference.update, sabha.*
 * - Chitragupta → Takumi: predict.next, pattern.query, sabha.consult, sabha.updated, heal_reported, push notifications
 * - Shared service methods: bridge.info, capabilities, route.resolve, health.status
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

/** Structured executor run state — emitted for Takumi executor lifecycle milestones. */
export interface ExecutorRunEvent {
	type: "executor_run";
	runId: string;
	status: "started" | "completed" | "failed";
	sessionId: string;
	projectPath: string;
	mode: "single" | "multi" | "headless";
	description: string;
	artifacts?: string[];
	filesChanged?: string[];
	laneIds?: string[];
	validationStatus?: "not-run" | "passed" | "failed" | "mixed";
	timestamp: number;
}

/** Structured executor artifact emitted back to the hub for later recall/policy checks. */
export interface ExecutorArtifactEvent {
	type: "executor_artifact";
	artifactType: "plan" | "validation" | "summary" | "handoff" | "postmortem" | "exec-result";
	sessionId: string;
	projectPath: string;
	summary: string;
	path?: string;
	metadata?: Record<string, unknown>;
	timestamp: number;
}

/** Union of all observation event types. */
export type ObservationEvent =
	| ToolUsageEvent
	| ErrorResolutionEvent
	| EditPatternEvent
	| UserCorrectionEvent
	| PreferenceEvent
	| ExecutorRunEvent
	| ExecutorArtifactEvent;

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
	type: "error_spike" | "loop_detected" | "cost_trajectory" | string;
	severity: "info" | "warning" | "critical";
	details: Record<string, unknown>;
	suggestion: string;
}

/** Report that a healing action was recorded and scored. */
export interface HealReportedNotification {
	anomalyType: string;
	actionTaken: string;
	outcome: "success" | "partial" | "failed" | string;
	successRate?: number;
	sampleCount?: number;
	clientId?: string | null;
}

/** Evolution request — retained as a forward-compatible/legacy notification. */
export interface EvolveRequestNotification {
	type: "auto_configure" | "tool_preference" | "style_update" | string;
	payload: Record<string, unknown>;
}

/** Preference update — a learned preference from observations. */
export interface PreferenceUpdateNotification {
	key: string;
	value: string;
	confidence: number;
	source: string;
}

/** Sabha consultation notification — Chitragupta is asking Takumi for council input. */
export interface SabhaConsultNotification {
	sabhaId: string;
	question: string;
	convener: string;
	sabha?: Record<string, unknown>;
	targets?: string[];
	targetClientIds?: string[];
}

export interface SabhaParticipantSpec {
	id: string;
	role: string;
	expertise?: number;
	credibility?: number;
	clientId?: string;
	targetClientId?: string;
}

export interface NyayaSyllogismInput {
	pratijna: string;
	hetu: string;
	udaharana: string;
	upanaya: string;
	nigamana: string;
}

export interface SabhaChallengeInput {
	challengerId: string;
	targetStep: keyof NyayaSyllogismInput;
	challenge: string;
}

export interface SabhaResponseInput {
	recordIndex: number;
	response: string;
}

export interface SabhaVoteInput {
	participantId: string;
	position: "support" | "oppose" | "abstain";
	reasoning: string;
}

export interface SabhaVoteState extends SabhaVoteInput {
	weight?: number;
}

export interface SabhaChallengeState extends SabhaChallengeInput {
	resolved?: boolean;
	response?: string;
}

export interface SabhaRoundState {
	roundNumber: number;
	proposal: NyayaSyllogismInput;
	challenges: SabhaChallengeState[];
	votes: SabhaVoteState[];
	verdict?: string | null;
}

export interface SabhaCurrentRoundState {
	roundNumber: number;
	proposal: NyayaSyllogismInput;
	unresolvedChallenges: SabhaChallengeState[];
	allChallenges: SabhaChallengeState[];
	votes: SabhaVoteState[];
	voteSummary: {
		supportWeight: number;
		opposeWeight: number;
		abstainWeight: number;
		count: number;
	};
	verdict?: string | null;
}

export interface SabhaState {
	id: string;
	topic: string;
	status: string;
	convener: string;
	finalVerdict?: string | null;
	createdAt: number;
	concludedAt?: number | null;
	participants: SabhaParticipantSpec[];
	clientBindings?: Record<string, string>;
	participantCount: number;
	rounds?: SabhaRoundState[];
	roundCount: number;
	currentRound?: SabhaCurrentRoundState | null;
}

export interface SabhaAskParams {
	topic: string;
	convener?: string;
	askerId?: string;
	participants?: SabhaParticipantSpec[];
	targetClientIds?: string[];
}

export interface SabhaAskResult {
	sabha: SabhaState;
	question: string;
	targets: string[];
	targetClientIds: string[];
	notificationsSent: number;
}

export interface SabhaGatherParams {
	id: string;
}

export interface SabhaGatherResult {
	sabha: SabhaState;
	explanation: string;
}

export interface SabhaDeliberateParams {
	id?: string;
	topic?: string;
	convener?: string;
	participants?: SabhaParticipantSpec[];
	proposerId?: string;
	syllogism?: NyayaSyllogismInput;
	proposal?: NyayaSyllogismInput;
	challenges?: SabhaChallengeInput[];
	responses?: SabhaResponseInput[];
	votes?: SabhaVoteInput[];
	conclude?: boolean;
	targetClientIds?: string[];
}

export interface SabhaDeliberateResult {
	sabha: SabhaState;
	explanation: string | null;
	notificationsSent: number;
}

export interface SabhaRecordParams {
	id: string;
	sessionId: string;
	project: string;
	category?: string;
	confidence?: number;
}

export interface SabhaRecordResult {
	decision: Record<string, unknown>;
	sabha: SabhaState;
}

export interface SabhaEscalateParams {
	id: string;
	reason?: string;
	targetClientIds?: string[];
}

export interface SabhaEscalateResult {
	sabha: SabhaState;
	reason: string;
}

export interface SabhaUpdatedNotification {
	sabhaId: string;
	sabha: SabhaState;
	event: "deliberating" | "concluded" | "challenge" | "response" | "vote" | "escalated" | string;
	explanation?: string | null;
	challengerId?: string;
	targetStep?: keyof NyayaSyllogismInput;
	challenge?: string;
	recordIndex?: number;
	participantId?: string;
	position?: "support" | "oppose" | "abstain";
	reason?: string;
}

export interface SabhaRecordedNotification {
	sabhaId: string;
	decisionId: string;
	project: string;
	sessionId: string;
}

export interface SabhaEscalatedNotification {
	sabhaId: string;
	reason: string;
	clientId?: string | null;
}

/** Union of all notification types Chitragupta can push. */
export type ChitraguptaNotification =
	| { method: "pattern_detected"; params: PatternDetectedNotification }
	| { method: "prediction"; params: PredictionNotification }
	| { method: "anomaly_alert"; params: AnomalyAlertNotification }
	| { method: "heal_reported"; params: HealReportedNotification }
	| { method: "sabha.consult"; params: SabhaConsultNotification }
	| { method: "sabha.updated"; params: SabhaUpdatedNotification }
	| { method: "sabha.recorded"; params: SabhaRecordedNotification }
	| { method: "sabha.escalated"; params: SabhaEscalatedNotification }
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
	HEAL_REPORTED: "heal_reported",
	SABHA_CONSULT: "sabha.consult",
	SABHA_UPDATED: "sabha.updated",
	SABHA_RECORDED: "sabha.recorded",
	SABHA_ESCALATED: "sabha.escalated",
	EVOLVE_REQUEST: "evolve_request",
	PREFERENCE_UPDATE: "preference_update",
} as const;
