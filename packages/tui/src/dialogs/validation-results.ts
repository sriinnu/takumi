/**
 * ValidationResultsDialog — surfaces multi-agent validation results after a REJECT.
 *
 * Pure logic/state class (no rendering) following the same pattern as CommandPalette.
 * Opened by CodingAgent when the validation phase produces at least one REJECT decision.
 *
 * Keybinds (while open):
 *   r  — dispatch "retry" cluster command
 *   f  — dispatch "validate" cluster command (re-run validation to check fixes)
 *   v  — open file preview for the focused finding's file reference (if present)
 *   ↑/↓ — navigate between findings
 *   Esc / q — close dialog
 */

import type { ValidationFinding, ValidationResult } from "@takumi/agent";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";

// ── Public types ─────────────────────────────────────────────────────────────

export interface FormattedFinding {
	severity: "critical" | "major" | "minor" | "info";
	category: string;
	description: string;
	/** Optional file path extracted from the finding's location. */
	file?: string;
	line?: number;
	suggestion?: string;
}

export interface FormattedValidation {
	validatorId: string;
	decision: "APPROVE" | "REJECT" | "NEEDS_INFO";
	confidence: number;
	findings: FormattedFinding[];
}

// ── ValidationResultsDialog ───────────────────────────────────────────────────

export class ValidationResultsDialog {
	private readonly _isOpen: Signal<boolean> = signal(false);
	private readonly _results: Signal<ValidationResult[]> = signal<ValidationResult[]>([]);
	private readonly _selectedIndex: Signal<number> = signal(0);

	/** Invoked when user presses "r" (retry fixing phase). */
	onRetry?: () => void;
	/** Invoked when user presses "f" (re-run validation after manual fixes). */
	onRevalidate?: () => void;
	/** Invoked with a file path when user presses "v" on a finding that has one. */
	onViewFile?: (file: string) => void;

	// ── State accessors ───────────────────────────────────────────────────────

	get isOpen(): boolean {
		return this._isOpen.value;
	}

	get selectedIndex(): number {
		return this._selectedIndex.value;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/**
	 * Open the dialog and populate it with the given validation results.
	 * Resets the selection index to the first REJECT entry, if any.
	 */
	open(results: ValidationResult[]): void {
		this._results.value = results;
		// Start selection on the first REJECT validator
		const firstRejectIdx = results.findIndex((r) => r.decision === "REJECT");
		this._selectedIndex.value = firstRejectIdx >= 0 ? firstRejectIdx : 0;
		this._isOpen.value = true;
	}

	/** Close the dialog and clear results. */
	close(): void {
		this._isOpen.value = false;
		this._results.value = [];
		this._selectedIndex.value = 0;
	}

	// ── Input handling ────────────────────────────────────────────────────────

	/**
	 * Process a key event. Returns true if the event was consumed.
	 * Should be called from the root input handler when the dialog is open.
	 */
	handleKey(event: KeyEvent): boolean {
		if (!this._isOpen.value) return false;

		// Esc or "q" — close
		if (event.raw === KEY_CODES.ESCAPE || event.key === "q") {
			this.close();
			return true;
		}

		// Up arrow — navigate up
		if (event.raw === KEY_CODES.UP) {
			const items = this.getFormattedResults();
			if (items.length > 0) {
				this._selectedIndex.value = Math.max(0, this._selectedIndex.value - 1);
			}
			return true;
		}

		// Down arrow — navigate down
		if (event.raw === KEY_CODES.DOWN) {
			const items = this.getFormattedResults();
			if (items.length > 0) {
				this._selectedIndex.value = Math.min(items.length - 1, this._selectedIndex.value + 1);
			}
			return true;
		}

		// "r" — retry fixes
		if (event.key === "r") {
			this.close();
			this.onRetry?.();
			return true;
		}

		// "f" — re-run validation
		if (event.key === "f") {
			this.close();
			this.onRevalidate?.();
			return true;
		}

		// "v" — view file for selected finding
		if (event.key === "v") {
			const items = this.getFormattedResults();
			const selected = items[this._selectedIndex.value];
			if (selected) {
				// Surface the first finding that has a file reference
				const withFile = selected.findings.find((f) => f.file);
				if (withFile?.file) {
					this.close();
					this.onViewFile?.(withFile.file);
					return true;
				}
			}
			return true;
		}

		// Consume all other keys while open
		return true;
	}

	// ── Data helpers ──────────────────────────────────────────────────────────

	/**
	 * Returns the validation results formatted for display.
	 * REJECT entries come first, then NEEDS_INFO, then APPROVE.
	 */
	getFormattedResults(): FormattedValidation[] {
		const raw = this._results.value;
		return [...raw]
			.sort((a, b) => {
				const order = { REJECT: 0, NEEDS_INFO: 1, APPROVE: 2 };
				return (order[a.decision] ?? 2) - (order[b.decision] ?? 2);
			})
			.map((r) => ({
				validatorId: r.validatorId,
				decision: r.decision,
				confidence: r.confidence,
				findings: r.findings.map((f) => this._formatFinding(f)),
			}));
	}

	/** Returns true if any validator issued a REJECT. */
	get hasRejections(): boolean {
		return this._results.value.some((r) => r.decision === "REJECT");
	}

	/** Count of REJECTs and total validators. */
	get summary(): { rejections: number; total: number } {
		const results = this._results.value;
		return {
			rejections: results.filter((r) => r.decision === "REJECT").length,
			total: results.length,
		};
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private _formatFinding(f: ValidationFinding): FormattedFinding {
		return {
			severity: f.severity,
			category: f.category,
			description: f.description,
			file: f.location?.file,
			line: f.location?.line,
			suggestion: f.suggestion,
		};
	}
}
