/**
 * yagna-nadi.ts — Health pulse monitor (नाड़ी / Nadi = "pulse / vital channel").
 *
 * Nadi watches the Yagna's vital signs in real time:
 *
 *   - **Deadlock detection**: If no subtask makes progress for N seconds while
 *     some are still "running", the DAG might be stuck. Nadi detects this and
 *     forces a recycle of stale lanes.
 *   - **Circuit breaker**: Tracks consecutive failures per subtask. After crossing
 *     a threshold, the subtask is "poisoned" — permanently failed to prevent
 *     infinite retry loops burning tokens.
 *   - **Stale lane recycling**: If a running subtask hasn't emitted progress in
 *     a configurable window, Nadi marks it for termination and retry.
 *   - **Budget tracking**: Monitors elapsed time against the global timeout and
 *     remaining retry budget across all subtasks.
 *
 * Nadi runs as a periodic tick (called from the Kriya loop), not as a background
 * timer. This keeps it synchronous with the event loop and avoids race conditions.
 */

import type { YagnaEventListener, YagnaSnapshot } from "./yagna-types.js";

/* ── Configuration ───────────────────────────────────────────── */

/** Nadi tuning knobs. */
export interface NadiConfig {
	/** Seconds without progress before a running subtask is considered stale. */
	staleLaneThresholdSec: number;
	/** Consecutive failures before a subtask is circuit-broken (poisoned). */
	circuitBreakerThreshold: number;
	/** Seconds of zero global progress before declaring deadlock. */
	deadlockThresholdSec: number;
}

/** Conservative defaults: 120s stale, 4 consecutive failures, 180s deadlock. */
export const DEFAULT_NADI_CONFIG: NadiConfig = {
	staleLaneThresholdSec: 120,
	circuitBreakerThreshold: 4,
	deadlockThresholdSec: 180,
};

/* ── Health report ───────────────────────────────────────────── */

/** Possible actions Nadi can recommend. */
export type NadiAction =
	| "healthy" // All clear, continue
	| "recycle-stale" // Kill and restart stale lanes
	| "poison-subtask" // Circuit-break a specific subtask
	| "deadlock-detected" // Nothing is making progress — force intervention
	| "budget-exhausted"; // Time or retry budget is spent

/** The health report returned by each Nadi tick. */
export interface NadiReport {
	/** Overall health status. */
	status: NadiAction;
	/** Subtask IDs that triggered the action (if any). */
	affectedSubtasks: string[];
	/** Human-readable summary for logging/TUI. */
	message: string;
	/** Time remaining before global timeout (ms), or Infinity if unlimited. */
	timeRemainingMs: number;
	/** Total retry budget remaining across all subtasks. */
	retriesRemaining: number;
}

/* ── Nadi pulse monitor ──────────────────────────────────────── */

/**
 * Persistent health monitor for a Yagna run.
 *
 * Tracks last-progress timestamps per subtask and global progress epoch.
 * Call `tick()` periodically from the Kriya scheduling loop.
 */
export class Nadi {
	private readonly config: NadiConfig;

	/** Epoch ms of the last observed progress event per subtask. */
	private readonly lastProgress = new Map<string, number>();

	/** Epoch ms of the last time ANY subtask made progress. */
	private lastGlobalProgress: number;

	/** Consecutive failure count per subtask (reset on success). */
	private readonly consecutiveFailures = new Map<string, number>();

	/** Set of subtask IDs that have been circuit-broken (poisoned). */
	private readonly poisoned = new Set<string>();

	constructor(config: Partial<NadiConfig> = {}) {
		this.config = { ...DEFAULT_NADI_CONFIG, ...config };
		this.lastGlobalProgress = Date.now();
	}

	/* ── Event intake ──────────────────────────────────────── */

	/**
	 * Notify Nadi that a subtask made progress (status changed, output received).
	 *
	 * Resets the stale timer for this subtask and the global deadlock timer.
	 */
	recordProgress(subtaskId: string): void {
		const now = Date.now();
		this.lastProgress.set(subtaskId, now);
		this.lastGlobalProgress = now;
	}

	/** Record a successful completion — resets the failure counter. */
	recordSuccess(subtaskId: string): void {
		this.consecutiveFailures.set(subtaskId, 0);
		this.recordProgress(subtaskId);
	}

	/** Record a failure — increments the consecutive failure counter. */
	recordFailure(subtaskId: string): void {
		const current = this.consecutiveFailures.get(subtaskId) ?? 0;
		this.consecutiveFailures.set(subtaskId, current + 1);
		this.recordProgress(subtaskId); // Failure is still "activity".
	}

	/** Check if a subtask has been circuit-broken. */
	isPoisoned(subtaskId: string): boolean {
		return this.poisoned.has(subtaskId);
	}

	/* ── Periodic health check ─────────────────────────────── */

	/**
	 * Run one health check tick. Returns a report with recommended action.
	 *
	 * Call this from the Kriya polling loop (every 2–5 seconds).
	 *
	 * @param snap - Current Yagna snapshot.
	 * @param emit - Event emitter for logging poisoned/stale events.
	 */
	tick(snap: YagnaSnapshot, emit: YagnaEventListener): NadiReport {
		const now = Date.now();

		// Budget check: global timeout.
		const timeRemainingMs =
			snap.config.timeoutMs > 0
				? Math.max(0, snap.config.timeoutMs - (now - snap.startedAt))
				: Number.POSITIVE_INFINITY;

		if (timeRemainingMs === 0) {
			return report("budget-exhausted", [], "Global timeout exceeded.", timeRemainingMs, 0);
		}

		// Compute remaining retries across all subtasks.
		const retriesRemaining = snap.subtasks.reduce((sum, st) => {
			if (st.status === "failed" || st.status === "done") return sum;
			return sum + Math.max(0, snap.config.maxRetries - st.attempts + 1);
		}, 0);

		// Circuit breaker check: any subtask with too many consecutive failures?
		const needsPoison: string[] = [];
		for (const st of snap.subtasks) {
			if (this.poisoned.has(st.id)) continue;
			const failures = this.consecutiveFailures.get(st.id) ?? 0;
			if (failures >= this.config.circuitBreakerThreshold) {
				needsPoison.push(st.id);
				this.poisoned.add(st.id);
				st.status = "failed";
				st.lastError = `Circuit breaker: ${failures} consecutive failures.`;
				emit({ kind: "subtask-status", subtaskId: st.id, status: "failed" });
			}
		}

		if (needsPoison.length > 0) {
			return report(
				"poison-subtask",
				needsPoison,
				`Circuit breaker tripped for: ${needsPoison.join(", ")}.`,
				timeRemainingMs,
				retriesRemaining,
			);
		}

		// Stale lane detection: running subtasks with no recent progress.
		const staleThresholdMs = this.config.staleLaneThresholdSec * 1000;
		const stale: string[] = [];
		for (const st of snap.subtasks) {
			if (st.status !== "running") continue;
			const lastProg = this.lastProgress.get(st.id) ?? snap.startedAt;
			if (now - lastProg > staleThresholdMs) {
				stale.push(st.id);
			}
		}

		if (stale.length > 0) {
			// Mark stale subtasks as pending to trigger re-execution.
			for (const id of stale) {
				const st = snap.subtasks.find((s) => s.id === id);
				if (st) {
					st.status = "pending";
					st.lastError = `Stale lane recycled after ${this.config.staleLaneThresholdSec}s of no progress.`;
					emit({ kind: "retry", subtaskId: id, attempt: st.attempts, reason: "stale-lane" });
				}
			}
			return report(
				"recycle-stale",
				stale,
				`Recycled ${stale.length} stale lane(s).`,
				timeRemainingMs,
				retriesRemaining,
			);
		}

		// Global deadlock detection: no progress anywhere for too long.
		const deadlockThresholdMs = this.config.deadlockThresholdSec * 1000;
		const running = snap.subtasks.filter((st) => st.status === "running");
		if (running.length > 0 && now - this.lastGlobalProgress > deadlockThresholdMs) {
			return report(
				"deadlock-detected",
				running.map((st) => st.id),
				`No progress for ${this.config.deadlockThresholdSec}s with ${running.length} running subtask(s).`,
				timeRemainingMs,
				retriesRemaining,
			);
		}

		// All clear.
		return report("healthy", [], "All systems nominal.", timeRemainingMs, retriesRemaining);
	}
}

/* ── Helper ──────────────────────────────────────────────────── */

/** Build a NadiReport tuple. */
function report(
	status: NadiAction,
	affectedSubtasks: string[],
	message: string,
	timeRemainingMs: number,
	retriesRemaining: number,
): NadiReport {
	return { status, affectedSubtasks, message, timeRemainingMs, retriesRemaining };
}
