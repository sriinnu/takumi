/**
 * yagna-loop.ts — Core state machine driving the Yagna (यज्ञ) ritual.
 *
 * The loop advances through phases: decompose → tarka → kriya → verify → merge.
 * Each phase is self-contained; failures retry or degrade gracefully.
 * The loop halts only at a terminal phase (complete | failed).
 *
 * One command, zero questions. The user provides a topic and the Yagna runs
 * autonomously — even if it takes hours.
 */

import type { AppCommandContext } from "../commands/app-command-context.js";
import { Nadi } from "./yagna-nadi.js";
import { decomposePhase } from "./yagna-phase-decompose.js";
import { kriyaPhase } from "./yagna-phase-kriya.js";
import { mergePhase } from "./yagna-phase-merge.js";
import { tarkaPhase } from "./yagna-phase-tarka.js";
import { verifyPhase } from "./yagna-phase-verify.js";
import { Smriti } from "./yagna-smriti.js";
import {
	DEFAULT_YAGNA_CONFIG,
	TERMINAL_PHASES,
	type YagnaConfig,
	type YagnaEventListener,
	type YagnaPhase,
	type YagnaSnapshot,
	type YagnaSubtask,
} from "./yagna-types.js";

/**
 * Create the initial empty snapshot for a new Yagna run.
 *
 * @param topic - The user's high-level objective.
 * @param overrides - Optional config tweaks (e.g. `--rounds=5`).
 * @returns A fresh snapshot in the "idle" phase.
 */
export function createYagnaSnapshot(topic: string, overrides: Partial<YagnaConfig> = {}): YagnaSnapshot {
	return {
		id: `yagna-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
		topic,
		phase: "idle",
		subtasks: [],
		config: { ...DEFAULT_YAGNA_CONFIG, ...overrides },
		startedAt: Date.now(),
		updatedAt: Date.now(),
		summary: "",
		error: null,
	};
}

/**
 * Run the full Yagna loop to completion.
 *
 * This is the single entry point for autonomous execution. Once started it
 * will not ask the user any questions — it decomposes, debates (Tarka),
 * executes (Kriya), verifies, and merges autonomously.
 *
 * Termination conditions:
 *   - All work completes and merges → phase = "complete"
 *   - Unrecoverable failure after retries → phase = "failed"
 *   - Global timeout exceeded → phase = "failed"
 *
 * @param ctx - The TUI app context (agent runner, state, config).
 * @param snap - A fresh snapshot created by `createYagnaSnapshot`.
 * @param emit - Callback that receives every lifecycle event for TUI/telemetry.
 * @returns The final snapshot with results and summary.
 */
export async function runYagnaLoop(
	ctx: AppCommandContext,
	snap: YagnaSnapshot,
	emit: YagnaEventListener,
): Promise<YagnaSnapshot> {
	// Instantiate self-healing subsystems for this run.
	const smriti = new Smriti();
	const nadi = new Nadi();

	/** Maximum verify→kriya retry cycles before giving up. */
	const MAX_VERIFY_CYCLES = 3;

	try {
		/* ── PHASE 1: DECOMPOSE — break topic into subtask DAG ── */
		transitionTo(snap, "decompose", emit);
		await decomposePhase(ctx, snap, emit);

		if (snap.subtasks.length === 0) {
			snap.error = "Decomposition produced zero subtasks.";
			transitionTo(snap, "failed", emit);
			emit({ kind: "yagna-failed", yagnaId: snap.id, error: snap.error });
			return snap;
		}

		/* ── PHASE 2: TARKA — consensus debate per subtask ────── */
		if (hasTimedOut(snap)) return failTimeout(snap, emit);
		if (snap.config.maxTarkaRounds > 0) {
			transitionTo(snap, "tarka", emit);
			await tarkaPhase(ctx, snap, emit);
		} else {
			for (const st of snap.subtasks) {
				st.agreedPlan = st.spec;
				st.status = "ready";
			}
		}

		/* ── PHASE 3+4: KRIYA ↔ VERIFY retry cycle ────────────── */
		// The loop retries: execute → verify → (reject → re-execute) up to MAX_VERIFY_CYCLES.
		// Smriti records failures; Nadi monitors health each cycle.
		for (let cycle = 0; cycle < MAX_VERIFY_CYCLES; cycle++) {
			if (hasTimedOut(snap)) return failTimeout(snap, emit);

			// KRIYA — execute all pending/ready subtasks.
			transitionTo(snap, "kriya", emit);
			await kriyaPhase(ctx, snap, emit, smriti, nadi);

			// Check Nadi health after the execution burst.
			const pulse = nadi.tick(snap, emit);
			emit({ kind: "nadi-pulse", status: pulse.status, message: pulse.message });

			if (pulse.status === "budget-exhausted") return failTimeout(snap, emit);

			// Detect systemic issues — shared infra problems block everyone.
			const systemicIssues = smriti.detectSystemicIssues();
			for (const issue of systemicIssues) {
				emit({ kind: "systemic-issue", signature: issue.errorSignature, affectedCount: issue.affectedSubtasks.length });
			}

			// Early exit on total failure.
			if (countFailed(snap.subtasks) === snap.subtasks.length) {
				snap.error = "All subtasks failed Kriya execution.";
				transitionTo(snap, "failed", emit);
				emit({ kind: "yagna-failed", yagnaId: snap.id, error: snap.error });
				return snap;
			}

			// VERIFY — adversarial review gate.
			if (hasTimedOut(snap)) return failTimeout(snap, emit);
			transitionTo(snap, "verify", emit);
			const anyPassed = await verifyPhase(ctx, snap, emit);

			if (!anyPassed && countFailed(snap.subtasks) === snap.subtasks.length) {
				snap.error = "Verification rejected all subtasks.";
				transitionTo(snap, "failed", emit);
				emit({ kind: "yagna-failed", yagnaId: snap.id, error: snap.error });
				return snap;
			}

			// Count how many subtasks were rejected back to "pending" by the verifier.
			const rejected = snap.subtasks.filter((st) => st.status === "pending").length;
			if (rejected === 0) break; // All done or failed — no more retries needed.
			emit({ kind: "verify-retry", cycle: cycle + 1, rejectedCount: rejected });
		}

		/* ── PHASE 5: MERGE — topological branch merge ────────── */
		if (hasTimedOut(snap)) return failTimeout(snap, emit);
		if (snap.config.autoMerge) {
			transitionTo(snap, "merge", emit);
			await mergePhase(ctx, snap, emit);
		}

		/* ── DONE ─────────────────────────────────────────────── */
		transitionTo(snap, "complete", emit);
		const elapsed = Date.now() - snap.startedAt;
		const doneCount = snap.subtasks.filter((st) => st.status === "done").length;
		const failedCount = countFailed(snap.subtasks);
		snap.summary = [
			`Yagna "${snap.topic}" completed in ${formatDuration(elapsed)}.`,
			`${doneCount}/${snap.subtasks.length} subtasks succeeded, ${failedCount} failed.`,
			smriti.size > 0 ? `Self-healing recorded ${smriti.size} diagnostic entries.` : "",
		]
			.filter(Boolean)
			.join(" ");
		emit({ kind: "yagna-complete", yagnaId: snap.id, elapsed });
		return snap;
	} catch (err) {
		snap.error = err instanceof Error ? err.message : String(err);
		if (!TERMINAL_PHASES.has(snap.phase)) {
			transitionTo(snap, "failed", emit);
		}
		emit({ kind: "yagna-failed", yagnaId: snap.id, error: snap.error });
		return snap;
	}
}

/* ── Internal helpers ────────────────────────────────────────── */

/**
 * Advance the Yagna to the next phase.
 * Pure bookkeeping — the actual work happens in the phase handler.
 */
function transitionTo(snap: YagnaSnapshot, next: YagnaPhase, emit: YagnaEventListener): void {
	snap.phase = next;
	snap.updatedAt = Date.now();
	emit({ kind: "phase-enter", phase: next, yagnaId: snap.id });
}

/** Check whether the global timeout has been exceeded. */
function hasTimedOut(snap: YagnaSnapshot): boolean {
	if (snap.config.timeoutMs <= 0) return false;
	return Date.now() - snap.startedAt > snap.config.timeoutMs;
}

/** Fail the Yagna due to timeout. */
function failTimeout(snap: YagnaSnapshot, emit: YagnaEventListener): YagnaSnapshot {
	snap.error = `Yagna timed out after ${formatDuration(Date.now() - snap.startedAt)}.`;
	transitionTo(snap, "failed", emit);
	emit({ kind: "yagna-failed", yagnaId: snap.id, error: snap.error });
	return snap;
}

/** Count subtasks in a terminal-failure state. */
function countFailed(subtasks: YagnaSubtask[]): number {
	return subtasks.filter((st) => st.status === "failed").length;
}

/** Format milliseconds into a human-readable duration string. */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}
