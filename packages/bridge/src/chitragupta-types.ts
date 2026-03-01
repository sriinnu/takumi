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
