/**
 * yagna-chikitsa.ts — Failure diagnostic engine (चिकित्सा / Chikitsa = "healing/medicine").
 *
 * When a subtask fails, Chikitsa doesn't just retry blindly — it diagnoses:
 *
 *   1. **Classify** the failure: compile error, test failure, timeout, dependency issue,
 *      design flaw, or sycophantic non-fix (agent said "fixed" but changed nothing).
 *   2. **Select a recovery strategy**: retry-as-is, retry-with-targeted-fix, split the
 *      subtask, escalate to re-design, or mark as poison (circuit breaker).
 *   3. **Enrich the retry prompt** with diagnostic context so the next attempt targets
 *      the actual root cause instead of blindly repeating.
 *
 * Sycophancy detection (from duh-main consensus protocol):
 *   If the agent's "fix" response has >90% Jaccard overlap with the previous attempt
 *   AND the same error recurs, Chikitsa flags it as a non-fix and forces a strategy
 *   escalation (different framing, different approach).
 *
 * This module is stateless per call — run memory lives in yagna-smriti.ts.
 */

import type { YagnaSubtask } from "./yagna-types.js";

/* ── Public types ────────────────────────────────────────────── */

/** Classification of why a subtask failed. */
export type FailureClass =
	| "compile-error" // TypeScript / build errors
	| "test-failure" // Tests ran but assertions failed
	| "timeout" // Lane exceeded time budget
	| "dependency-missing" // Upstream subtask not done or import not found
	| "design-flaw" // Fundamental approach is wrong (detected by verifier)
	| "sycophantic-fix" // Agent claimed fix but nothing meaningfully changed
	| "unknown"; // Unclassifiable

/** What the system should do next. */
export type RecoveryAction =
	| "retry" // Same prompt, fresh attempt (transient issue)
	| "retry-with-diagnosis" // Retry with enriched diagnostic prompt
	| "split" // Break this subtask into smaller pieces
	| "redesign" // Send back to Tarka for a new plan
	| "poison" // Circuit breaker: mark permanently failed, skip
	| "unblock-dependency"; // A dependency is failing; fix it first

/** Full diagnostic report produced by Chikitsa. */
export interface DiagnosticReport {
	/** What class of failure this is. */
	failureClass: FailureClass;
	/** Selected recovery strategy. */
	action: RecoveryAction;
	/** Human-readable explanation of the diagnosis. */
	reasoning: string;
	/** Enriched prompt addendum for the next retry attempt (if applicable). */
	promptAddendum: string;
	/** Confidence in the classification (0–1). */
	confidence: number;
}

/* ── Pattern catalogue ───────────────────────────────────────── */

/**
 * Known error patterns mapped to failure classes.
 *
 * Each pattern is tested against the error text (case-insensitive).
 * Order matters — first match wins.
 */
const ERROR_PATTERNS: ReadonlyArray<{ pattern: RegExp; cls: FailureClass }> = [
	{ pattern: /TS\d{4,5}:|error TS|Cannot find module|cannot find name/i, cls: "compile-error" },
	{ pattern: /FAIL|AssertionError|expect\(|test failed|vitest.*fail/i, cls: "test-failure" },
	{ pattern: /timed?\s*out|ETIMEDOUT|deadline exceeded|timeout/i, cls: "timeout" },
	{ pattern: /Cannot find module|import.*not found|dependency.*missing/i, cls: "dependency-missing" },
	{ pattern: /verification rejected|design.*flaw|fundamental.*wrong/i, cls: "design-flaw" },
];

/* ── Core API ────────────────────────────────────────────────── */

/**
 * Diagnose a subtask failure and recommend a recovery strategy.
 *
 * This is the main entry point. Kriya calls this after each failed attempt
 * to determine what to do next.
 *
 * @param subtask - The failed subtask with error context in `lastError`.
 * @param previousResponse - The agent's response text from the failed attempt (for sycophancy detection).
 * @param priorResponses - Array of responses from all prior attempts.
 * @returns A diagnostic report with classification, action, and enriched prompt.
 */
export function diagnose(subtask: YagnaSubtask, previousResponse: string, priorResponses: string[]): DiagnosticReport {
	const errorText = subtask.lastError ?? "";

	// Step 1: Check for sycophantic non-fix (agent says "done" but nothing changed).
	if (priorResponses.length > 0 && previousResponse) {
		const lastPrior = priorResponses[priorResponses.length - 1];
		const overlap = jaccardSimilarity(lastPrior, previousResponse);

		// If >90% overlap AND we're seeing the same error class repeatedly,
		// the agent is likely just agreeing without actually fixing.
		if (overlap > 0.9) {
			return {
				failureClass: "sycophantic-fix",
				action: selectEscalation(subtask),
				reasoning: `Agent response has ${(overlap * 100).toFixed(0)}% overlap with previous attempt — likely a non-fix. Escalating strategy.`,
				promptAddendum: buildSycophancyPrompt(subtask),
				confidence: 0.85,
			};
		}
	}

	// Step 2: Classify the error via pattern matching.
	const failureClass = classifyError(errorText);

	// Step 3: Determine recovery action based on class + attempt history.
	const action = selectAction(failureClass, subtask);

	// Step 4: Build a targeted diagnostic prompt addendum.
	const promptAddendum = buildDiagnosticPrompt(failureClass, errorText, subtask);

	return {
		failureClass,
		action,
		reasoning: `Classified as ${failureClass} (attempt ${subtask.attempts}). Action: ${action}.`,
		promptAddendum,
		confidence: failureClass === "unknown" ? 0.3 : 0.75,
	};
}

/* ── Classification ──────────────────────────────────────────── */

/** Match error text against known patterns. */
function classifyError(errorText: string): FailureClass {
	for (const { pattern, cls } of ERROR_PATTERNS) {
		if (pattern.test(errorText)) return cls;
	}
	return "unknown";
}

/* ── Recovery strategy selection ─────────────────────────────── */

/**
 * Select recovery action based on failure class and attempt history.
 *
 * Strategy ladder:
 *   Attempt 1: retry-with-diagnosis (address the specific error)
 *   Attempt 2: retry-with-diagnosis (different framing)
 *   Attempt 3+: escalate to redesign or poison
 *
 * Timeout and dependency failures have special handling.
 */
function selectAction(cls: FailureClass, subtask: YagnaSubtask): RecoveryAction {
	const attempts = subtask.attempts;

	// Special cases that don't follow the normal ladder.
	if (cls === "timeout") return attempts >= 2 ? "poison" : "retry";
	if (cls === "dependency-missing") return "unblock-dependency";
	if (cls === "design-flaw") return attempts >= 2 ? "redesign" : "retry-with-diagnosis";

	// Normal escalation ladder.
	if (attempts <= 1) return "retry-with-diagnosis";
	if (attempts === 2) return "retry-with-diagnosis";
	if (attempts === 3) return "redesign";
	return "poison"; // Circuit breaker — stop wasting tokens.
}

/** When sycophancy is detected, escalate more aggressively. */
function selectEscalation(subtask: YagnaSubtask): RecoveryAction {
	// If we've already tried redesign, poison it.
	if (subtask.attempts >= 3) return "poison";
	// Skip straight to redesign — the current approach isn't working.
	return "redesign";
}

/* ── Diagnostic prompt builders ──────────────────────────────── */

/**
 * Build a targeted fix prompt based on the failure classification.
 *
 * Each class gets a different framing to maximise the chance of a real fix.
 */
function buildDiagnosticPrompt(cls: FailureClass, errorText: string, subtask: YagnaSubtask): string {
	const base = `⚠ Attempt ${subtask.attempts} failed. Diagnosis: ${cls}.`;

	switch (cls) {
		case "compile-error":
			return [
				base,
				"The code has TypeScript compilation errors.",
				"REQUIRED: Fix ALL type errors before doing anything else.",
				`Error output:\n${truncate(errorText, 800)}`,
				"Do NOT just add 'as any' — fix the actual type issues.",
			].join("\n");

		case "test-failure":
			return [
				base,
				"Tests are failing. Read the test output carefully.",
				"Fix the implementation to match what the tests expect.",
				`Test output:\n${truncate(errorText, 800)}`,
				"If the test expectations are wrong, explain why, but prefer fixing the code.",
			].join("\n");

		case "dependency-missing":
			return [
				base,
				"A required dependency or upstream module is missing.",
				"Check imports, ensure all referenced modules exist, and verify build order.",
				`Error:\n${truncate(errorText, 500)}`,
			].join("\n");

		case "design-flaw":
			return [
				base,
				"The verifier flagged a fundamental design issue.",
				"Step back and reconsider the approach. Don't patch — rethink.",
				`Verifier feedback:\n${truncate(errorText, 800)}`,
			].join("\n");

		default:
			return [
				base,
				"Review the error and fix the root cause. Do not repeat the same approach.",
				`Error:\n${truncate(errorText, 600)}`,
			].join("\n");
	}
}

/** Build a prompt specifically addressing sycophantic non-fixes. */
function buildSycophancyPrompt(subtask: YagnaSubtask): string {
	return [
		"⚠ CRITICAL: Your previous 'fix' did not actually change anything meaningful.",
		`The same error persists after ${subtask.attempts} attempts.`,
		"",
		"You MUST take a fundamentally different approach:",
		"1. Re-read the error message from scratch. Do not assume you know the fix.",
		"2. Delete the problematic code and rewrite it, don't just tweak.",
		"3. If the current design cannot work, say so explicitly and propose an alternative.",
		"4. Show a DIFF of what you actually changed — prove the fix is real.",
		"",
		`Original error: ${truncate(subtask.lastError ?? "", 500)}`,
	].join("\n");
}

/* ── Utilities ───────────────────────────────────────────────── */

/** Truncate text to a max length, appending a marker. */
function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return `${text.slice(0, maxLen)}... [truncated]`;
}

/**
 * Jaccard word-level similarity for sycophancy detection.
 *
 * Same algorithm as yagna-phase-tarka.ts convergence metric.
 * Reused here for a different purpose: detecting non-changes.
 */
function jaccardSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
	const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
	if (wordsA.size === 0 && wordsB.size === 0) return 1;
	let intersection = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++;
	}
	const union = wordsA.size + wordsB.size - intersection;
	return union === 0 ? 1 : intersection / union;
}
