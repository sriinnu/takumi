/**
 * Type definitions for ChitraguptaBridge.
 */

export interface MemoryResult {
	content: string;
	relevance: number;
	source?: string;
}

export interface UnifiedRecallResult {
	content: string;
	score: number;
	source: string;
	type: string;
}

export interface DaySearchResult {
	date: string;
	content: string;
	score: number;
}

export interface ChitraguptaSessionInfo {
	id: string;
	title: string;
	timestamp: number;
	turns: number;
}

/** Project info from sessionProjects() */
export interface ChitraguptaProjectInfo {
	project: string;
	sessionCount: number;
	lastActive: string;
}

export interface SessionDetail {
	id: string;
	title: string;
	turns: Array<{ role: string; content: string; timestamp: number }>;
}

export interface HandoverSummary {
	originalRequest: string;
	filesModified: string[];
	filesRead: string[];
	decisions: string[];
	errors: string[];
	recentContext: string;
}

export interface AkashaTrace {
	content: string;
	type: string;
	topics: string[];
	strength: number;
}

/**
 * Vasana tendency — a crystallized behavioral pattern extracted by Chitragupta
 * from repeated observations across sessions (BOCPD-detected stability).
 * NOTE: mirrors @chitragupta/tantra VasanaTendencyResult; delete local def when
 * chitragupta publishes the type as a standalone package export.
 */
export interface VasanaTendency {
	/** Tendency category/name (e.g. "prefers-functional-style"). */
	tendency: string;
	/** Positive, negative, or neutral valence. */
	valence: string;
	/** Normalized strength 0.0–1.0 (Thompson-sampled confidence). */
	strength: number;
	/** BOCPD stability estimate 0.0–1.0. */
	stability: number;
	/** Cross-session predictive accuracy 0.0–1.0. */
	predictiveAccuracy: number;
	/** Number of times this tendency was reinforced. */
	reinforcementCount: number;
	/** Human-readable description of the behavioral pattern. */
	description: string;
}

/**
 * Chitragupta aggregate health snapshot — Triguna-based system state.
 * NOTE: mirrors @chitragupta/tantra HealthStatusResult; delete local def when
 * chitragupta publishes the type as a standalone package export.
 */
export interface ChitraguptaHealth {
	/** Triguna state: Sattvic (clarity), Rajasic (energy), Tamasic (inertia). Each 0.0–1.0. */
	state: { sattva: number; rajas: number; tamas: number };
	/** Dominant Guna at current time ("sattva" | "rajas" | "tamas"). */
	dominant: string;
	/** Change direction per Guna ("rising" | "stable" | "falling"). */
	trend: { sattva: string; rajas: string; tamas: string };
	/** Active alerts or anomaly descriptions. */
	alerts: string[];
	/** Recent snapshots for trend rendering (newest-last). */
	history: Array<{
		timestamp: number;
		state: { sattva: number; rajas: number; tamas: number };
		dominant: string;
	}>;
}

/** Vidhi (learned procedure) metadata */
export interface VidhiInfo {
	id: string;
	name: string;
	pattern: string;
	action: string;
	confidence: number;
	usageCount: number;
	createdAt: string;
}

/** Vidhi match result */
export interface VidhiMatch {
	vidhi: VidhiInfo;
	score: number;
	context: string;
}

/** Consolidation run result */
export interface ConsolidationResult {
	sessionCount: number;
	vidhisExtracted: number;
	factsExtracted: number;
	daysSaved: number;
	elapsed: number;
}

/** Extracted fact */
export interface ExtractedFact {
	id: string;
	text: string;
	type: string;
	confidence: number;
	source: string;
	createdAt: string;
}

export interface ChitraguptaBridgeOptions {
	/** Path to the chitragupta-mcp binary. Default: "chitragupta-mcp". */
	command?: string;
	/** Arguments for the binary. Default: ["--transport", "stdio"]. */
	args?: string[];
	/** Project path passed as environment variable. */
	projectPath?: string;
	/** Startup timeout in ms. Default: 5000. */
	startupTimeoutMs?: number;
	/** Per-request timeout in ms. Default: 10000. */
	requestTimeoutMs?: number;
	/**
	 * Override the daemon Unix socket path.
	 * Default: platform-resolved path (mirrors @chitragupta/daemon).
	 * Set to "" to disable socket mode entirely.
	 */
	socketPath?: string;
}

/** Session creation options */
export interface SessionCreateOptions {
	project: string;
	title?: string;
	agent?: string;
	model?: string;
	provider?: string;
	branch?: string;
}

/** Session creation result */
export interface SessionCreateResult {
	id: string;
	created: boolean;
}

/** Session metadata updates */
export interface SessionMetaUpdates {
	title?: string;
	tags?: string[];
	model?: string;
	provider?: string;
	costUsd?: number;
	durationMs?: number;
	completed?: boolean;
	[key: string]: unknown;
}

/** Turn data structure */
export interface Turn {
	number: number;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp?: number;
	model?: string;
	tokens?: {
		prompt?: number;
		completion?: number;
		total?: number;
	};
	costUsd?: number;
	toolCalls?: Array<{
		id: string;
		name: string;
		input: Record<string, unknown>;
	}>;
	toolResults?: Array<{
		id: string;
		name: string;
		output: string;
	}>;
}

/** Turn add result */
export interface TurnAddResult {
	added: boolean;
}

/** Max turn number result */
export interface MaxTurnResult {
	maxTurn: number;
}

/** Memory scope information (Phase 18) */
export interface MemoryScope {
	type: "global" | "project";
	path?: string; // Present for project-scoped memories (hex hash)
}

/** Daemon status and health metrics (Phase 18) */
export interface DaemonStatus {
	counts: {
		turns: number;
		sessions: number;
		rules: number;
		vidhis: number;
		samskaras: number;
		vasanas: number;
		akashaTraces: number;
	};
	timestamp: number;
}

// ── Phase 20: Telemetry v2 Schema ────────────────────────────────────────────

export interface TelemetryProcess {
	pid: number;
	ppid: number | null;
	uptime: number; // seconds since process start
	heartbeatAt: number; // Unix timestamp ms
	startedAt: number;
}

export interface TelemetrySystem {
	host: string;
	user: string;
	platform: NodeJS.Platform;
	arch: string;
	nodeVersion: string;
}

export interface TelemetryWorkspace {
	cwd: string;
	git: {
		branch?: string;
		commit?: string;
		dirty?: boolean;
		remote?: string;
	};
}

export interface TelemetrySession {
	id: string;
	file: string;
	name: string;
}

export interface TelemetryModel {
	provider: string;
	id: string;
	name: string;
	thinkingLevel?: number;
}

export interface TelemetryState {
	activity: "working" | "waiting_input" | "idle" | "error";
	idle: boolean;
	idleSince?: number;
}

export interface TelemetryContext {
	tokens: number;
	contextWindow: number;
	remainingTokens: number;
	percent: number;
	pressure: "normal" | "approaching_limit" | "near_limit" | "at_limit";
	closeToLimit: boolean; // >= 85%
	nearLimit: boolean; // >= 95%
}

export interface TelemetryCognition {
	stance: "stable" | "watchful" | "strained" | "critical";
	workspaceMode: "monitor" | "execute" | "stabilize" | "consolidate" | "recover";
	dominantSignal: string | null;
	dominantSummary: string | null;
	directiveBacklog: number;
	signalCount: number;
}

export interface TelemetryRouting {
	tty: string;
	mux: "tmux" | "zellij" | null;
	muxSession: string | null;
	muxWindowId: string | null;
	terminalApp: string | null;
}

export interface TelemetryCapabilities {
	hasUI: boolean;
	hasTools: boolean;
	hasMemory: boolean;
}

export interface TelemetryExtensions {
	telemetry: string | null;
	bridge: string | null;
}

export interface TelemetryMessages {
	lastAssistantText?: string;
	lastAssistantHtml?: string;
	lastAssistantUpdatedAt?: number;
}

export interface AgentTelemetry {
	schemaVersion: 2;
	process: TelemetryProcess;
	system: TelemetrySystem;
	workspace: TelemetryWorkspace;
	session: TelemetrySession;
	model: TelemetryModel;
	state: TelemetryState;
	context: TelemetryContext;
	cognition?: TelemetryCognition;
	routing: TelemetryRouting;
	capabilities: TelemetryCapabilities;
	extensions: TelemetryExtensions;
	messages?: TelemetryMessages;
	lastEvent: string;
}

export interface TelemetrySnapshot {
	schemaVersion: 2;
	timestamp: number;
	aggregate: "working" | "waiting_input" | "idle" | "mixed";
	counts: {
		total: number;
		working: number;
		waiting_input: number;
		idle: number;
		error: number;
	};
	context: {
		total: number;
		normal: number;
		approachingLimit: number;
		nearLimit: number;
		atLimit: number;
	};
	sessions: Record<
		string,
		{
			sessionId: string;
			instances: number;
			statuses: string[];
		}
	>;
	instancesByPid: Record<number, AgentTelemetry>;
	instances: AgentTelemetry[];
}
