/**
 * yagna-types.ts — Type definitions for Yagna (यज्ञ), the autonomous multi-agent ritual.
 *
 * A Yagna takes a topic, decomposes it into a subtask DAG, runs Tarka (तर्क)
 * debate rounds for consensus, dispatches Kriya (क्रिया) execution lanes, verifies
 * results, and merges — all without human intervention.
 *
 * Naming lineage:
 *   Yagna (यज्ञ) — sacred collective ritual where multiple priests collaborate toward one goal.
 *   Tarka (तर्क) — logical argumentation / dialectic reasoning.
 *   Kriya (क्रिया) — action / execution / doing.
 *
 * Inspired by:
 *   - duh-main:  PROPOSE → CHALLENGE → REVISE → COMMIT consensus engine
 *   - pi-agent-teams:  leader/worker task queues with heartbeat leases
 *   - oh-my-openagent:  intent-routed specialist delegation with parallel workers
 */

/** Phase transitions for the Yagna state machine. */
export type YagnaPhase =
	| "idle"
	| "decompose" // Break topic into subtask DAG
	| "tarka" // Consensus debate per subtask
	| "kriya" // Parallel execution via side lanes
	| "verify" // Adversarial review gate
	| "merge" // Topological-sort branch merge
	| "complete"
	| "failed";

/** Terminal phases where the Yagna no longer advances. */
export const TERMINAL_PHASES: ReadonlySet<YagnaPhase> = new Set(["complete", "failed"]);

/** Role identities for Tarka-phase participants. */
export type TarkaRole = "proposer" | "challenger-flaw" | "challenger-alt" | "challenger-risk" | "reviser";

/**
 * One round in the Tarka consensus loop for a single subtask.
 *
 * Each round follows PROPOSE → CHALLENGE (×3) → REVISE. Convergence is
 * detected via Jaccard word-overlap between consecutive rounds' challenges.
 */
export interface TarkaRound {
	/** Which round (1-indexed). */
	round: number;
	/** The proposal text from the proposer or previous revision. */
	proposal: string;
	/** Challenge outputs keyed by framing (flaw, alternative, risk). */
	challenges: Record<string, string>;
	/** Revised proposal after incorporating challenges. */
	revision: string;
	/** Jaccard word-overlap similarity vs. previous round's challenges. */
	convergenceScore: number;
}

/**
 * A single subtask in the decomposed work DAG.
 *
 * Flows: pending → debating → ready → running → done|failed.
 * Failed subtasks retry up to `YagnaConfig.maxRetries` with a self-healing
 * prompt that injects the previous error context.
 */
export interface YagnaSubtask {
	/** Unique identifier within the Yagna. */
	id: string;
	/** Human-readable title. */
	title: string;
	/** Detailed specification for the Kriya (execution) phase. */
	spec: string;
	/** IDs of subtasks that must complete before this one starts. */
	dependencies: string[];
	/** Current lifecycle status. */
	status: "pending" | "debating" | "ready" | "running" | "done" | "failed" | "retrying";
	/** Tarka debate rounds (populated during the debate phase). */
	tarkaRounds: TarkaRound[];
	/** Final agreed plan after Tarka converges. */
	agreedPlan: string;
	/** Side-agent lane ID during Kriya execution. */
	laneId: string | null;
	/** Git branch name in the worktree. */
	branch: string;
	/** Execution attempt count (for self-healing retries). */
	attempts: number;
	/** Error from the most recent failure, if any. */
	lastError: string | null;
}

/** Yagna-level configuration knobs. */
export interface YagnaConfig {
	/** Maximum Tarka rounds before forcing convergence. */
	maxTarkaRounds: number;
	/** Jaccard similarity threshold to declare Tarka convergence. */
	convergenceThreshold: number;
	/** Maximum Kriya retries per subtask before marking failed. */
	maxRetries: number;
	/** Maximum total Yagna duration in ms (0 = unlimited). */
	timeoutMs: number;
	/** Whether to auto-merge completed branches. */
	autoMerge: boolean;
}

/** Sane defaults — 3 debate rounds, 70% convergence, 2 retries. */
export const DEFAULT_YAGNA_CONFIG: YagnaConfig = {
	maxTarkaRounds: 3,
	convergenceThreshold: 0.7,
	maxRetries: 2,
	timeoutMs: 0,
	autoMerge: true,
};

/**
 * Full snapshot of a Yagna run.
 *
 * Persisted for TUI rendering and session recovery.
 */
export interface YagnaSnapshot {
	/** Unique Yagna run identifier. */
	id: string;
	/** Original topic provided by the user. */
	topic: string;
	/** Current phase in the state machine. */
	phase: YagnaPhase;
	/** All decomposed subtasks. */
	subtasks: YagnaSubtask[];
	/** Configuration for this run. */
	config: YagnaConfig;
	/** Epoch ms when the Yagna began. */
	startedAt: number;
	/** Epoch ms of the most recent phase transition. */
	updatedAt: number;
	/** Final summary produced at completion. */
	summary: string;
	/** Terminal error if the Yagna failed. */
	error: string | null;
}

/** Events emitted by the Yagna loop for TUI panels and telemetry. */
export type YagnaEvent =
	| { kind: "phase-enter"; phase: YagnaPhase; yagnaId: string }
	| { kind: "subtask-status"; subtaskId: string; status: YagnaSubtask["status"] }
	| { kind: "tarka-round"; subtaskId: string; round: number; convergenceScore: number }
	| { kind: "lane-spawned"; subtaskId: string; laneId: string }
	| { kind: "lane-done"; subtaskId: string; laneId: string; success: boolean }
	| { kind: "retry"; subtaskId: string; attempt: number; reason: string }
	| { kind: "converged"; subtaskId: string; rounds: number }
	| { kind: "merged"; subtaskId: string; branch: string }
	| { kind: "yagna-complete"; yagnaId: string; elapsed: number }
	| { kind: "yagna-failed"; yagnaId: string; error: string }
	// Self-healing events (Chikitsa / Smriti / Nadi).
	| { kind: "diagnosis"; subtaskId: string; failureClass: string; action: string }
	| { kind: "systemic-issue"; signature: string; affectedCount: number }
	| { kind: "nadi-pulse"; status: string; message: string }
	| { kind: "verify-retry"; cycle: number; rejectedCount: number };

/** Callback signature for Yagna event listeners. */
export type YagnaEventListener = (event: YagnaEvent) => void;
