/**
 * yagna-phase-kriya.ts — Execution phase (क्रिया / Kriya).
 *
 * Schedules subtasks for parallel execution respecting the dependency DAG.
 * Each subtask runs in an isolated side-agent lane (worktree + tmux session).
 *
 * Self-healing integration:
 *   - **Chikitsa**: After each failure, diagnoses the root cause and selects
 *     a recovery strategy (retry-with-fix, redesign, split, poison).
 *   - **Smriti**: Records every failure→diagnosis→outcome for cross-subtask
 *     learning and systemic issue detection.
 *   - **Nadi**: Checked each scheduling tick for deadlock, stale lanes, and
 *     circuit-breaker trips.
 *
 * DAG scheduling uses a ready-set approach: a subtask becomes eligible once
 * all its dependencies are complete. This maximises parallelism without
 * violating ordering constraints.
 */

import type { AppCommandContext } from "../commands/app-command-context.js";
import { runNativeSideAgentLane } from "../workflow/workflow-side-agent-lanes.js";
import { diagnose } from "./yagna-chikitsa.js";
import type { Nadi } from "./yagna-nadi.js";
import type { Smriti } from "./yagna-smriti.js";
import type { YagnaEventListener, YagnaSnapshot, YagnaSubtask } from "./yagna-types.js";

/**
 * Run the Kriya (execution) phase: execute subtasks respecting DAG dependencies.
 *
 * Uses a polling loop that checks every 2 seconds for newly runnable subtasks.
 * Each scheduling tick also runs a Nadi health check for deadlock/stale detection.
 * Failed subtasks are diagnosed by Chikitsa and recorded in Smriti.
 *
 * @param ctx - TUI app command context with side-agent tools.
 * @param snap - Yagna snapshot with agreed plans from Tarka phase.
 * @param emit - Event emitter for progress updates.
 * @param smriti - Run memory for recording failure→diagnosis→outcome chains.
 * @param nadi - Health pulse monitor for deadlock/circuit-breaker detection.
 */
export async function kriyaPhase(
	ctx: AppCommandContext,
	snap: YagnaSnapshot,
	emit: YagnaEventListener,
	smriti?: Smriti,
	nadi?: Nadi,
): Promise<void> {
	const maxRetries = snap.config.maxRetries;

	// Build a lookup set of all subtask IDs for O(1) dependency checks.
	const allIds = new Set(snap.subtasks.map((st) => st.id));

	// Track which subtasks are currently executing to avoid double-launch.
	const running = new Set<string>();

	/* ── DAG scheduling loop ─────────────────────────────── */
	while (true) {
		const ready = findReadySubtasks(snap.subtasks, allIds, running);
		const allDone = snap.subtasks.every((st) => st.status === "done" || st.status === "failed");

		// Exit conditions: nothing left to run.
		if (allDone) break;
		if (ready.length === 0 && running.size === 0) break; // Deadlock or all terminal.

		// Launch all ready subtasks in parallel.
		for (const subtask of ready) {
			running.add(subtask.id);
			subtask.status = "running";
			emit({ kind: "subtask-status", subtaskId: subtask.id, status: "running" });

			// Fire-and-forget; completions detected by the polling loop below.
			executeSubtask(ctx, snap, subtask, maxRetries, emit, smriti, nadi).finally(() => {
				running.delete(subtask.id);
			});
		}

		// Run Nadi health check each tick (deadlock, stale lane, circuit breaker).
		if (nadi) {
			const pulse = nadi.tick(snap, emit);
			if (pulse.status === "deadlock-detected" || pulse.status === "budget-exhausted") break;
		}

		// Yield to allow lanes to make progress before checking again.
		await sleep(2000);
	}
}

/* ── Ready-set computation ───────────────────────────────────── */

/**
 * Find subtasks whose dependencies are all satisfied and are not yet running.
 *
 * A subtask is "ready" when:
 * 1. Its status is "pending" or "ready" (eligible for execution).
 * 2. All its dependency IDs have status "done".
 * 3. Dependencies that reference unknown IDs are silently ignored.
 */
function findReadySubtasks(subtasks: YagnaSubtask[], _allIds: Set<string>, running: Set<string>): YagnaSubtask[] {
	// Build a status lookup for O(1) dependency resolution.
	const statusMap = new Map<string, YagnaSubtask["status"]>();
	for (const st of subtasks) {
		statusMap.set(st.id, st.status);
	}

	return subtasks.filter((st) => {
		// Accept both "pending" and "ready" as eligible for launch.
		if (st.status !== "pending" && st.status !== "ready") return false;
		if (running.has(st.id)) return false;

		// All known dependencies must be "done".
		return st.dependencies.every((depId) => {
			const depStatus = statusMap.get(depId);
			return depStatus === "done" || depStatus === undefined; // Unknown deps → skip.
		});
	});
}

/* ── Subtask execution with retry ────────────────────────────── */

/**
 * Execute a single subtask in a side-agent lane with Chikitsa-powered retries.
 *
 * After each failure, Chikitsa diagnoses the root cause and selects a recovery
 * strategy. Smriti records the diagnosis for cross-subtask learning. Nadi
 * tracks progress for deadlock detection.
 *
 * Recovery action handling:
 *   - retry / retry-with-diagnosis → re-run with enriched diagnostic prompt.
 *   - redesign → mark subtask as "pending" and bail (loop will re-enter Tarka).
 *   - poison → immediately fail the subtask (circuit breaker).
 *   - unblock-dependency → skip this attempt (dependency will be fixed first).
 *   - split → currently treated as redesign (DAG mutation deferred).
 */
async function executeSubtask(
	ctx: AppCommandContext,
	_snap: YagnaSnapshot,
	subtask: YagnaSubtask,
	maxRetries: number,
	emit: YagnaEventListener,
	smriti?: Smriti,
	nadi?: Nadi,
): Promise<void> {
	/** Collected agent responses for sycophancy detection across attempts. */
	const priorResponses: string[] = [];

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		subtask.attempts = attempt + 1;
		nadi?.recordProgress(subtask.id);

		// Build the prompt — plain on first attempt, Chikitsa-enriched on retries.
		let prompt = buildExecutionPrompt(subtask, attempt);

		// On retries, enrich with Smriti hints and Chikitsa prompt addendum.
		if (attempt > 0 && subtask.lastError && smriti) {
			const hints = smriti.generateHints(subtask.id);
			if (hints) prompt += `\n\n${hints}`;
		}

		try {
			const result = await runNativeSideAgentLane(ctx, "/yagna", `kriya-${subtask.id}-a${attempt}`, prompt, {
				topic: "execution",
				complexity: "STANDARD",
			});

			if (result) {
				subtask.status = "done";
				subtask.laneId = `kriya-${subtask.id}`;
				emit({ kind: "subtask-status", subtaskId: subtask.id, status: "done" });
				nadi?.recordSuccess(subtask.id);
				smriti?.markOutcome(subtask.id, "recovered");
				return;
			}

			subtask.lastError = "Lane returned no result";
		} catch (err) {
			subtask.lastError = err instanceof Error ? err.message : String(err);
		}

		// Track response text for sycophancy detection.
		const responseText = subtask.lastError ?? "";
		priorResponses.push(responseText);

		// ── Chikitsa diagnosis: classify failure and select recovery strategy.
		const report = diagnose(subtask, responseText, priorResponses.slice(0, -1));
		emit({ kind: "diagnosis", subtaskId: subtask.id, failureClass: report.failureClass, action: report.action });

		// Record in Smriti for cross-subtask learning.
		smriti?.record(subtask.id, subtask.attempts, report, subtask.lastError ?? "");
		nadi?.recordFailure(subtask.id);

		// Check if Nadi has circuit-broken this subtask.
		if (nadi?.isPoisoned(subtask.id)) {
			subtask.status = "failed";
			subtask.lastError = "Circuit breaker tripped by Nadi.";
			emit({ kind: "subtask-status", subtaskId: subtask.id, status: "failed" });
			return;
		}

		// Act on the recovery strategy.
		if (report.action === "poison") {
			subtask.status = "failed";
			emit({ kind: "subtask-status", subtaskId: subtask.id, status: "failed" });
			return;
		}
		if (report.action === "redesign" || report.action === "split") {
			// Send back to pending — the verify→kriya retry loop will handle re-planning.
			subtask.status = "pending";
			emit({ kind: "retry", subtaskId: subtask.id, attempt: subtask.attempts, reason: report.action });
			return;
		}
		if (report.action === "unblock-dependency") {
			subtask.status = "pending";
			emit({ kind: "retry", subtaskId: subtask.id, attempt: subtask.attempts, reason: "awaiting-dependency" });
			return;
		}

		// retry / retry-with-diagnosis — append the diagnostic addendum for next loop iteration.
		if (report.promptAddendum) {
			// The addendum will be included via buildExecutionPrompt on the next iteration
			// since lastError is already set.
			subtask.lastError = `${subtask.lastError}\n\n[Chikitsa] ${report.promptAddendum}`;
		}
		emit({ kind: "retry", subtaskId: subtask.id, attempt: subtask.attempts, reason: report.failureClass });
		smriti?.markOutcome(subtask.id, "failed-again");
	}

	// All retries exhausted — mark as failed.
	subtask.status = "failed";
	emit({ kind: "subtask-status", subtaskId: subtask.id, status: "failed" });
}

/* ── Prompt construction ─────────────────────────────────────── */

/**
 * Build the execution prompt for a subtask attempt.
 *
 * Attempt 0 gets the clean plan. Subsequent attempts include the error
 * context for self-healing.
 */
function buildExecutionPrompt(subtask: YagnaSubtask, attempt: number): string {
	const base = [
		`Implement subtask "${subtask.title}".`,
		"",
		"Agreed plan:",
		subtask.agreedPlan || subtask.spec,
		"",
		"Rules:",
		"- Write production-quality TypeScript.",
		"- Include JSDoc comments on public exports.",
		"- Run tests if a test file exists.",
		"- If tests fail, fix the code until they pass.",
		"- Commit your changes with a conventional commit message.",
	];

	// Append self-healing context on retries.
	if (attempt > 0 && subtask.lastError) {
		base.push(
			"",
			`⚠ Previous attempt (${attempt}) failed:`,
			subtask.lastError,
			"",
			"Fix the error and try again. Do not repeat the same mistake.",
		);
	}

	return base.join("\n");
}

/* ── Utility ─────────────────────────────────────────────────── */

/** Promise-based sleep for polling intervals. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
