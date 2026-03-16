/**
 * Handoff Types — P-Track 3: Structured Handoff/Reattach
 *
 * Defines the portable payload exchanged when work transfers between
 * sessions, branches, or side agents. The payload is self-contained:
 * a receiver can resume work without external context lookups.
 */

// ── Handoff target ────────────────────────────────────────────────────────────

/** Where the handoff is directed. */
export type HandoffTargetKind = "session" | "branch" | "side-agent" | "new-session";

export interface HandoffTarget {
	kind: HandoffTargetKind;
	/** Existing session/branch/agent ID (null for "new-session"). */
	id: string | null;
	/** Human label for the target. */
	label?: string;
}

// ── Route binding snapshot ────────────────────────────────────────────────────

/** Captures the Chitragupta-resolved route so the receiver can reuse or re-resolve. */
export interface HandoffRouteBinding {
	/** The route class used (e.g. "coding.deep-reasoning"). */
	routeClass: string;
	/** Selected provider family (e.g. "anthropic"). */
	providerFamily: string;
	/** Selected model ID (e.g. "claude-sonnet-4-6"). */
	modelId: string;
	/** Fallback chain of capability IDs. */
	fallbackChain: string[];
	/** Whether the route was degraded at handoff time. */
	degraded: boolean;
}

// ── Work state snapshot ───────────────────────────────────────────────────────

export interface HandoffFileChange {
	path: string;
	status: "added" | "modified" | "deleted";
}

export interface HandoffWorkState {
	/** Current objective / task description. */
	objective: string;
	/** Key decisions made so far. */
	decisions: string[];
	/** Files modified during this work unit. */
	filesChanged: HandoffFileChange[];
	/** Files read for context. */
	filesRead: string[];
	/** Known blockers or open questions. */
	blockers: string[];
	/** Validation status at handoff time. */
	validationStatus: "passed" | "failed" | "not-run" | "partial";
	/** Suggested next action for the receiver. */
	nextAction: string;
}

// ── Artifact reference ────────────────────────────────────────────────────────

export interface HandoffArtifactRef {
	artifactId: string;
	kind: string;
	summary: string;
}

// ── Core payload ──────────────────────────────────────────────────────────────

export interface HandoffPayload {
	/** Schema version for forward-compat. */
	version: 1;
	/** Unique handoff ID. */
	handoffId: string;
	/** ISO-8601 creation timestamp. */
	createdAt: string;
	/** Who initiated the handoff. */
	source: {
		sessionId: string;
		/** Branch name (git), if applicable. */
		branch?: string;
		/** Side agent ID, if the source is a side agent. */
		sideAgentId?: string;
		/** Model that was active. */
		model: string;
		/** Provider family. */
		provider: string;
	};
	/** Intended receiver. */
	target: HandoffTarget;
	/** Snapshot of the work being handed off. */
	workState: HandoffWorkState;
	/** Chitragupta route binding at handoff time (if available). */
	routeBinding?: HandoffRouteBinding;
	/** References to persisted artifacts. */
	artifacts: HandoffArtifactRef[];
	/** Chitragupta daemon session ID for cross-session continuity. */
	daemonSessionId?: string;
	/** Checkpoint turn number — the receiver can slice messages here. */
	checkpointTurn?: number;
	/** Optional free-form notes from the source. */
	notes?: string;
}

// ── Reattach result ───────────────────────────────────────────────────────────

export interface ReattachResult {
	/** Whether reattach succeeded. */
	success: boolean;
	/** The session ID that was activated. */
	sessionId: string;
	/** Number of messages restored. */
	messageCount: number;
	/** Model resolved for the receiver. */
	model: string;
	/** Warning messages (e.g., tool drift, stale route). */
	warnings: string[];
}

// ── ID generation ─────────────────────────────────────────────────────────────

let handoffCounter = 0;
const handoffSuffix = Math.random().toString(36).slice(2, 6);

export function createHandoffId(now = Date.now()): string {
	handoffCounter += 1;
	return `hoff-${now.toString(36)}-${handoffSuffix}-${handoffCounter.toString(36).padStart(3, "0")}`;
}

/** Reset counter (for deterministic tests). */
export function resetHandoffCounter(): void {
	handoffCounter = 0;
}
