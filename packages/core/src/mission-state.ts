/**
 * Mission state model — the first-class unit of work in Takumi.
 *
 * A mission replaces the transcript-only continuity model with explicit
 * lifecycle phases, authority tracking, and transition lineage. This module
 * defines the types and a lightweight runtime state machine. Extension
 * surfaces will eventually emit `mission_state_changed` events on transitions.
 *
 * @see docs/mission-runtime-spec.md
 */

import { createLogger } from "./logger.js";

const log = createLogger("mission-state");

// ── Enums ─────────────────────────────────────────────────────────────────────

/** Lifecycle phase of a mission. */
export type MissionPhase =
	| "planning" /** Mission accepted, decomposition in progress. */
	| "active" /** Lanes executing work. */
	| "blocked" /** Waiting on external input, access, or dependency. */
	| "degraded" /** Continuing locally without canonical authority. */
	| "validating" /** Verifying acceptance criteria. */
	| "completed" /** Acceptance criteria met. */
	| "halted"; /** Stopped by operator, budget, or safety policy. */

/** Runtime authority mode — who owns canonical truth right now. */
export type MissionAuthority =
	| "engine" /** Chitragupta is reachable and authoritative. */
	| "local-only" /** Degraded local continuation. */
	| "rebound"; /** Chitragupta returned; recovery/reconciliation active. */

/** Reason a mission reached a terminal state. */
export type MissionStopReason =
	| "criteria_met"
	| "blocked_external"
	| "budget_exhausted"
	| "safety_halt"
	| "operator_halt";

// ── Core Types ────────────────────────────────────────────────────────────────

/** Budget and safety constraints for a mission. */
export interface MissionConstraints {
	/** Maximum token budget across all lanes. */
	maxTokens?: number;
	/** Maximum wall-clock duration in milliseconds. */
	maxDurationMs?: number;
	/** Whether degraded local fallback is allowed when Chitragupta is unavailable. */
	allowDegradedLocal?: boolean;
	/** Cost posture hint for routing decisions. */
	costPosture?: "free" | "low" | "medium" | "high";
}

/** A recorded transition in the mission's lineage. */
export interface MissionTransition {
	/** Previous phase. */
	from: MissionPhase;
	/** New phase. */
	to: MissionPhase;
	/** Reason for the transition. */
	reason: string;
	/** Authority at time of transition. */
	authority: MissionAuthority;
	/** Epoch timestamp. */
	at: number;
}

/** Full mission state — the primary runtime unit of work. */
export interface MissionState {
	/** Unique mission identifier. */
	id: string;
	/** Human-readable objective. */
	objective: string;
	/** Current lifecycle phase. */
	phase: MissionPhase;
	/** Current runtime authority mode. */
	authority: MissionAuthority;
	/** Acceptance criteria (free-form strings for now). */
	acceptanceCriteria: string[];
	/** Budget/safety constraints. */
	constraints: MissionConstraints;
	/** Ordered transition history — append-only lineage. */
	transitions: MissionTransition[];
	/** IDs of promoted artifacts. */
	promotedArtifactIds: string[];
	/** Stop reason when phase is `completed` or `halted`. */
	stopReason?: MissionStopReason;
	/** Epoch timestamp — when the mission was created. */
	createdAt: number;
	/** Epoch timestamp — last transition. */
	updatedAt: number;
}

// ── Transition Rules ──────────────────────────────────────────────────────────

/**
 * Allowed phase transitions. Each key lists the phases reachable from it.
 * Unlisted transitions are rejected by the runtime.
 */
const ALLOWED_TRANSITIONS: Record<MissionPhase, MissionPhase[]> = {
	planning: ["active", "blocked", "halted"],
	active: ["blocked", "degraded", "validating", "halted"],
	blocked: ["active", "degraded", "halted"],
	degraded: ["active", "blocked", "validating", "halted"],
	validating: ["active", "completed", "halted"],
	completed: [],
	halted: [],
};

/** Check whether a phase transition is structurally allowed. */
export function isTransitionAllowed(from: MissionPhase, to: MissionPhase): boolean {
	return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create a fresh mission in the `planning` phase. */
export function createMission(
	id: string,
	objective: string,
	opts?: { acceptanceCriteria?: string[]; constraints?: MissionConstraints; authority?: MissionAuthority },
): MissionState {
	const now = Date.now();
	return {
		id,
		objective,
		phase: "planning",
		authority: opts?.authority ?? "engine",
		acceptanceCriteria: opts?.acceptanceCriteria ?? [],
		constraints: opts?.constraints ?? {},
		transitions: [],
		promotedArtifactIds: [],
		createdAt: now,
		updatedAt: now,
	};
}

// ── Transition Engine ─────────────────────────────────────────────────────────

export interface TransitionResult {
	ok: boolean;
	mission: MissionState;
	error?: string;
}

/**
 * Attempt a phase transition, returning a *new* MissionState on success.
 * The original state is never mutated.
 */
export function transitionMission(
	mission: MissionState,
	to: MissionPhase,
	reason: string,
	opts?: { stopReason?: MissionStopReason; authority?: MissionAuthority },
): TransitionResult {
	if (!isTransitionAllowed(mission.phase, to)) {
		const msg = `Transition ${mission.phase} → ${to} not allowed for mission ${mission.id}`;
		log.warn(msg);
		return { ok: false, mission, error: msg };
	}

	const now = Date.now();
	const authority = opts?.authority ?? mission.authority;
	const transition: MissionTransition = {
		from: mission.phase,
		to,
		reason,
		authority,
		at: now,
	};

	const next: MissionState = {
		...mission,
		phase: to,
		authority,
		transitions: [...mission.transitions, transition],
		updatedAt: now,
		stopReason: opts?.stopReason ?? mission.stopReason,
	};

	log.debug(`Mission ${mission.id}: ${mission.phase} → ${to} (${reason})`);
	return { ok: true, mission: next };
}

/** Promote an artifact into the mission's durable ledger. Returns a new state. */
export function promoteArtifact(mission: MissionState, artifactId: string): MissionState {
	if (mission.promotedArtifactIds.includes(artifactId)) return mission;
	return {
		...mission,
		promotedArtifactIds: [...mission.promotedArtifactIds, artifactId],
		updatedAt: Date.now(),
	};
}

/** Convenience check for terminal phases. */
export function isMissionTerminal(mission: MissionState): boolean {
	return mission.phase === "completed" || mission.phase === "halted";
}

/** Convenience: is this mission running in degraded authority. */
export function isMissionDegraded(mission: MissionState): boolean {
	return mission.authority === "local-only" || mission.phase === "degraded";
}
