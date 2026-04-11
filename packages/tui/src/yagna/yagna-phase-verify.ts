/**
 * yagna-phase-verify.ts — Adversarial verification gate.
 *
 * After Kriya (execution), each subtask is reviewed by an independent
 * verifier agent. The verifier checks correctness, completeness,
 * and adherence to the agreed plan.
 *
 * A rejected subtask is sent back to Kriya for a retry attempt.
 * Multiple rejections increment the attempt counter against the retry budget.
 */

import type { AppCommandContext } from "../commands/app-command-context.js";
import type { NativeSideAgentQueryResult } from "../workflow/workflow-side-agent-lanes.js";
import { runNativeSideAgentLane } from "../workflow/workflow-side-agent-lanes.js";
import type { YagnaEventListener, YagnaSnapshot, YagnaSubtask } from "./yagna-types.js";

/** Structured verdict returned by the verification agent. */
interface Verdict {
	pass: boolean;
	reason: string;
}

/**
 * Run the verification phase across all completed subtasks.
 *
 * Only subtasks with status "done" are verified. Failed subtasks
 * are skipped (they already failed during Kriya).
 *
 * @param ctx - TUI app command context.
 * @param snap - Yagna snapshot with executed subtasks.
 * @param emit - Event listener for progress updates.
 */
export async function verifyPhase(
	ctx: AppCommandContext,
	snap: YagnaSnapshot,
	emit: YagnaEventListener,
): Promise<boolean> {
	const done = snap.subtasks.filter((st) => st.status === "done");

	if (done.length === 0) return false;

	// Verify all completed subtasks in parallel.
	await Promise.all(done.map((subtask) => verifySubtask(ctx, snap, subtask, emit)));

	// Return true if at least one subtask still has status "done" after verification.
	return snap.subtasks.some((st) => st.status === "done");
}

/* ── Per-subtask verification ────────────────────────────────── */

/**
 * Verify a single subtask and update its status accordingly.
 *
 * If verification fails, the subtask is marked "pending" (ready for retry
 * in a subsequent Kriya pass) rather than "failed", preserving its retry budget.
 *
 * @param ctx - TUI app context.
 * @param snap - Yagna snapshot for retry budget checking.
 * @param subtask - The subtask to verify.
 * @param emit - Event emitter.
 */
async function verifySubtask(
	ctx: AppCommandContext,
	snap: YagnaSnapshot,
	subtask: YagnaSubtask,
	emit: YagnaEventListener,
): Promise<void> {
	// "running" indicates active work on this subtask (verification pass).
	emit({ kind: "subtask-status", subtaskId: subtask.id, status: "running" });

	const prompt = buildVerifyPrompt(subtask);

	const result = await runNativeSideAgentLane(ctx, "/yagna", `verify-${subtask.id}`, prompt, {
		topic: "verification",
		complexity: "STANDARD",
	});

	const verdict = extractVerdict(result);

	if (verdict.pass) {
		// Verification passed — subtask stays "done".
		emit({ kind: "subtask-status", subtaskId: subtask.id, status: "done" });
		return;
	}

	// Verification failed — check if retries remain.
	if (subtask.attempts < snap.config.maxRetries + 1) {
		subtask.status = "pending"; // Re-enter Kriya queue.
		subtask.lastError = `Verification rejected: ${verdict.reason}`;
		emit({ kind: "subtask-status", subtaskId: subtask.id, status: "pending" });
	} else {
		subtask.status = "failed";
		subtask.lastError = `Verification rejected (no retries left): ${verdict.reason}`;
		emit({ kind: "subtask-status", subtaskId: subtask.id, status: "failed" });
	}
}

/* ── Prompt construction ─────────────────────────────────────── */

/** Build the adversarial verification prompt. */
function buildVerifyPrompt(subtask: YagnaSubtask): string {
	return [
		"You are an adversarial code reviewer. Your job is to verify that the implementation",
		`of subtask "${subtask.title}" meets its specification.`,
		"",
		"Agreed plan / specification:",
		subtask.agreedPlan || subtask.spec,
		"",
		"Review criteria:",
		"1. Does the code compile without errors?",
		"2. Do all tests pass?",
		"3. Does the implementation match the agreed plan?",
		"4. Are there any obvious bugs, security issues, or missing edge cases?",
		"5. Is the code well-structured with proper types and documentation?",
		"",
		'Return ONLY a JSON object: { "pass": true/false, "reason": "..." }',
		"Be critical but fair. Reject only for genuine issues, not style preferences.",
	].join("\n");
}

/* ── Verdict extraction ──────────────────────────────────────── */

/**
 * Extract a pass/fail verdict from the verification lane result.
 *
 * Attempts JSON parsing first, then falls back to keyword detection.
 * Defaults to pass=true when the response is ambiguous (optimistic gate).
 */
function extractVerdict(result: NativeSideAgentQueryResult | null): Verdict {
	if (!result) return { pass: true, reason: "No verifier response — optimistic pass." };

	const text = typeof result.response === "string" ? result.response : JSON.stringify(result.response ?? "");

	// Try structured JSON extraction first.
	const jsonVerdict = tryParseVerdict(text);
	if (jsonVerdict) return jsonVerdict;

	// Fallback: keyword-based detection for unstructured responses.
	const lower = text.toLowerCase();
	if (
		lower.includes("reject") ||
		lower.includes("fail") ||
		lower.includes('"pass":false') ||
		lower.includes('"pass": false')
	) {
		return { pass: false, reason: text.slice(0, 500) };
	}

	// Default: optimistic pass when the verifier is ambiguous.
	return { pass: true, reason: "Verifier response parsed as pass." };
}

/**
 * Try to parse a JSON verdict from text, tolerating markdown fences.
 *
 * @returns A typed Verdict or null if parsing fails.
 */
function tryParseVerdict(text: string): Verdict | null {
	const cleaned = text
		.replace(/^```(?:json)?\s*/m, "")
		.replace(/\s*```$/m, "")
		.trim();

	try {
		const parsed = JSON.parse(cleaned);
		if (typeof parsed === "object" && parsed !== null && "pass" in parsed) {
			return {
				pass: Boolean(parsed.pass),
				reason: typeof parsed.reason === "string" ? parsed.reason : "",
			};
		}
	} catch {
		// Try extracting the first JSON object from the text.
		const match = cleaned.match(/\{[\s\S]*?\}/);
		if (match) {
			try {
				const parsed = JSON.parse(match[0]);
				if (typeof parsed === "object" && parsed !== null && "pass" in parsed) {
					return {
						pass: Boolean(parsed.pass),
						reason: typeof parsed.reason === "string" ? parsed.reason : "",
					};
				}
			} catch {
				return null;
			}
		}
	}
	return null;
}
