/**
 * yagna-smriti.ts — Run memory engine (स्मृति / Smriti = "memory / remembrance").
 *
 * Smriti records the failure → diagnosis → recovery → outcome chain for every
 * subtask attempt within a Yagna run. This creates an intra-run knowledge base
 * that subsequent attempts can draw from.
 *
 * Key capabilities:
 *   - **Pattern registry**: Tracks which error patterns recur and which fixes worked.
 *   - **Poison detection**: If the same error signature appears ≥3 times across
 *     different subtasks, Smriti flags it as a systemic issue (e.g., broken shared type).
 *   - **Hint generation**: Produces contextual hints for Kriya prompts based on what
 *     worked for similar errors earlier in the same Yagna run.
 *   - **Outcome ledger**: Records attempt outcomes for post-mortem analysis.
 *
 * Smriti is scoped to a single Yagna run (in-memory). Cross-run persistence is
 * intentionally deferred — the run-local feedback loop is the high-value target.
 */

import type { DiagnosticReport, FailureClass } from "./yagna-chikitsa.js";

/* ── Public types ────────────────────────────────────────────── */

/** A single entry in the memory ledger. */
export interface SmritiEntry {
	/** Subtask that experienced the event. */
	subtaskId: string;
	/** Which attempt number (1-indexed). */
	attempt: number;
	/** Epoch ms when recorded. */
	timestamp: number;
	/** The Chikitsa diagnosis for this attempt. */
	diagnosis: DiagnosticReport;
	/** Whether the subsequent retry (if any) succeeded. */
	outcome: "pending" | "recovered" | "failed-again";
	/** First 200 chars of the error, used as a deduplication key. */
	errorSignature: string;
}

/** A systemic issue detected across multiple subtasks. */
export interface SystemicIssue {
	/** The error signature pattern. */
	errorSignature: string;
	/** Failure class from Chikitsa. */
	failureClass: FailureClass;
	/** How many distinct subtasks hit this same issue. */
	affectedSubtasks: string[];
	/** How many total occurrences across all subtasks. */
	totalOccurrences: number;
}

/* ── Smriti class ────────────────────────────────────────────── */

/**
 * In-memory knowledge base for a single Yagna run.
 *
 * Instantiated once per Yagna, passed through the loop and phases.
 * Thread-safe for concurrent reads (Kriya launches parallel subtasks).
 */
export class Smriti {
	/** Ordered ledger of all recorded entries. */
	private readonly ledger: SmritiEntry[] = [];

	/** Index: errorSignature → array of ledger indices. O(1) lookup for pattern matching. */
	private readonly signatureIndex = new Map<string, number[]>();

	/** Index: subtaskId → array of ledger indices. */
	private readonly subtaskIndex = new Map<string, number[]>();

	/**
	 * Record a failure diagnosis for a subtask attempt.
	 *
	 * @param subtaskId - Which subtask failed.
	 * @param attempt - Attempt number (1-indexed).
	 * @param diagnosis - The Chikitsa report.
	 * @param errorText - Raw error text for signature extraction.
	 */
	record(subtaskId: string, attempt: number, diagnosis: DiagnosticReport, errorText: string): void {
		const signature = extractSignature(errorText);
		const entry: SmritiEntry = {
			subtaskId,
			attempt,
			timestamp: Date.now(),
			diagnosis,
			outcome: "pending",
			errorSignature: signature,
		};

		const idx = this.ledger.length;
		this.ledger.push(entry);

		// Update signature index for cross-subtask pattern detection.
		if (!this.signatureIndex.has(signature)) {
			this.signatureIndex.set(signature, []);
		}
		this.signatureIndex.get(signature)!.push(idx);

		// Update subtask index for per-subtask history queries.
		if (!this.subtaskIndex.has(subtaskId)) {
			this.subtaskIndex.set(subtaskId, []);
		}
		this.subtaskIndex.get(subtaskId)!.push(idx);
	}

	/**
	 * Mark the most recent entry for a subtask as recovered or failed-again.
	 *
	 * Called when a retry attempt completes (success or failure).
	 */
	markOutcome(subtaskId: string, outcome: "recovered" | "failed-again"): void {
		const indices = this.subtaskIndex.get(subtaskId);
		if (!indices || indices.length === 0) return;
		// Update the most recent entry for this subtask.
		const lastIdx = indices[indices.length - 1];
		this.ledger[lastIdx].outcome = outcome;
	}

	/**
	 * Detect systemic issues — error patterns that recur across ≥2 distinct subtasks.
	 *
	 * These often indicate shared infrastructure problems (broken type file, missing
	 * dependency, misconfigured build) that no single subtask can fix on its own.
	 *
	 * @param minSubtasks - Minimum distinct subtasks to qualify as systemic (default: 2).
	 */
	detectSystemicIssues(minSubtasks = 2): SystemicIssue[] {
		const issues: SystemicIssue[] = [];

		for (const [signature, indices] of this.signatureIndex) {
			// Collect unique subtask IDs that hit this signature.
			const affectedSet = new Set<string>();
			for (const idx of indices) {
				affectedSet.add(this.ledger[idx].subtaskId);
			}

			if (affectedSet.size >= minSubtasks) {
				// Pick the failure class from the most recent occurrence.
				const lastIdx = indices[indices.length - 1];
				issues.push({
					errorSignature: signature,
					failureClass: this.ledger[lastIdx].diagnosis.failureClass,
					affectedSubtasks: [...affectedSet],
					totalOccurrences: indices.length,
				});
			}
		}

		return issues;
	}

	/**
	 * Generate contextual hints for a subtask's next attempt.
	 *
	 * Draws from:
	 *   1. This subtask's own failure history (what was tried, what failed).
	 *   2. Other subtasks that hit the same error signature (what worked for them).
	 *   3. Systemic issues (if detected — suggests fixing shared infrastructure first).
	 *
	 * @param subtaskId - The subtask about to retry.
	 * @returns A prompt addendum string with accumulated wisdom, or empty if no hints.
	 */
	generateHints(subtaskId: string): string {
		const hints: string[] = [];

		// 1. Own history — what approaches were already tried and failed.
		const ownIndices = this.subtaskIndex.get(subtaskId) ?? [];
		if (ownIndices.length > 0) {
			const failedApproaches = ownIndices
				.map((idx) => this.ledger[idx])
				.filter((e) => e.outcome !== "recovered")
				.map((e) => `  - Attempt ${e.attempt}: ${e.diagnosis.failureClass} → ${e.diagnosis.action}`);

			if (failedApproaches.length > 0) {
				hints.push("Previously failed approaches for this subtask:");
				hints.push(...failedApproaches);
				hints.push("Do NOT repeat these approaches.");
			}
		}

		// 2. Cross-subtask recovery hints — if another subtask fixed the same error.
		const latestEntry = ownIndices.length > 0 ? this.ledger[ownIndices[ownIndices.length - 1]] : null;
		if (latestEntry) {
			const sameSignatureIndices = this.signatureIndex.get(latestEntry.errorSignature) ?? [];
			const recoveredSiblings = sameSignatureIndices
				.map((idx) => this.ledger[idx])
				.filter((e) => e.subtaskId !== subtaskId && e.outcome === "recovered");

			if (recoveredSiblings.length > 0) {
				const sibling = recoveredSiblings[0];
				hints.push(
					`\nAnother subtask (${sibling.subtaskId}) recovered from the same error ` +
						`using strategy: ${sibling.diagnosis.action}.`,
				);
			}
		}

		// 3. Systemic issue warning.
		const systemicIssues = this.detectSystemicIssues();
		for (const issue of systemicIssues) {
			if (latestEntry && issue.errorSignature === latestEntry.errorSignature) {
				hints.push(
					`\n⚠ SYSTEMIC ISSUE: This error affects ${issue.affectedSubtasks.length} subtasks. ` +
						"It may be a shared infrastructure problem (type definition, config, dependency). " +
						"Consider fixing the root cause rather than patching each subtask individually.",
				);
			}
		}

		return hints.join("\n");
	}

	/** Return the full ledger (read-only) for post-mortem analysis. */
	entries(): readonly SmritiEntry[] {
		return this.ledger;
	}

	/** Count total recorded entries. */
	get size(): number {
		return this.ledger.length;
	}
}

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * Extract a deduplication signature from error text.
 *
 * Takes the first 200 characters, strips dynamic content (line numbers,
 * timestamps, file paths), and normalises whitespace. This makes
 * semantically identical errors collapse to the same key.
 */
function extractSignature(errorText: string): string {
	return errorText
		.slice(0, 200)
		.replace(/\d+/g, "N") // Normalise numbers (line nums, timestamps)
		.replace(/\/[\w\-/.]+/g, "PATH") // Normalise file paths
		.replace(/\s+/g, " ") // Collapse whitespace
		.trim()
		.toLowerCase();
}
