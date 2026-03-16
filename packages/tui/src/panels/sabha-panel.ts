/**
 * SabhaPanel — sidebar widget showing deliberation council state.
 *
 * Displays the latest Sabha ID, default participants, active Chitragupta
 * predictions, and pattern matches.  Only renders when there is at least
 * one prediction or the lastSabhaId is set.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import { DEFAULT_SABHA_PARTICIPANTS } from "../sabha-defaults.js";
import type { AppState } from "../state.js";

export interface SabhaPanelProps {
	state: AppState;
}

// ANSI 256-colour codes
const FG_LABEL = 6;
const FG_DIM = 8;
const FG_PREDICT = 220;
const FG_PATTERN = 153;
const FG_ROLE = 14;

/** Maximum prediction rows shown. */
const MAX_PREDICTIONS = 3;
/** Maximum pattern rows shown. */
const MAX_PATTERNS = 2;
/** Default participants shown in compact form. */
const MAX_PARTICIPANTS = 3;

/** Strip ANSI escape sequences from untrusted data. */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Safely format confidence as integer percentage. */
function formatConfidence(c: number): string {
	if (typeof c !== "number" || Number.isNaN(c)) return "?%";
	return `${Math.round(c * 100)}%`;
}

export class SabhaPanel extends Component {
	private readonly state: AppState;
	private _disposeEffect: (() => void) | null = null;

	constructor(props: SabhaPanelProps) {
		super();
		this.state = props.state;

		this._disposeEffect = effect(() => {
			// Subscribe to all relevant signals
			this.state.lastSabhaId.value;
			this.state.chitraguptaPredictions.value;
			this.state.chitraguptaPatternMatches.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this._disposeEffect?.();
		super.onUnmount();
	}

	/** Height this panel needs.  0 when no sabha data exists. */
	get height(): number {
		const sabhaId = this.state.lastSabhaId.value;
		const predictions = this.state.chitraguptaPredictions.value;
		const patterns = this.state.chitraguptaPatternMatches.value;

		const hasSabha = sabhaId !== "";
		const hasPredictions = predictions.length > 0;
		const hasPatterns = patterns.length > 0;

		if (!hasSabha && !hasPredictions && !hasPatterns) return 0;

		// header + sabha-id row + participants row
		let rows = 1;
		if (hasSabha) rows += 2;

		// predictions section
		if (hasPredictions) {
			rows += 1; // sub-header
			rows += Math.min(predictions.length, MAX_PREDICTIONS);
		}

		// patterns section
		if (hasPatterns) {
			rows += 1; // sub-header
			rows += Math.min(patterns.length, MAX_PATTERNS);
		}

		return rows;
	}

	render(screen: Screen, rect: Rect): void {
		const sabhaId = this.state.lastSabhaId.value;
		const predictions = this.state.chitraguptaPredictions.value;
		const patterns = this.state.chitraguptaPatternMatches.value;

		if (sabhaId === "" && predictions.length === 0 && patterns.length === 0) return;

		const { x, y, width } = rect;
		let cursorY = y;
		const maxY = y + rect.height;

		// ── Section header ────────────────────────────────────────────────
		if (cursorY >= maxY) return;
		screen.writeText(cursorY, x, "SABHA", { fg: FG_LABEL, bold: true });
		cursorY++;

		// ── Sabha ID ──────────────────────────────────────────────────────
		if (sabhaId && cursorY < maxY) {
			screen.writeText(cursorY, x, this.trunc(`ID: ${stripAnsi(sabhaId)}`, width), { fg: FG_DIM });
			cursorY++;
		}

		// ── Participants (compact) ────────────────────────────────────────
		if (sabhaId && cursorY < maxY) {
			const participants = DEFAULT_SABHA_PARTICIPANTS.slice(0, MAX_PARTICIPANTS);
			const participantStr = participants.map((p) => stripAnsi(p.id)).join(", ");
			screen.writeText(cursorY, x, this.trunc(`Council: ${participantStr}`, width), { fg: FG_ROLE });
			cursorY++;
		}

		// ── Predictions ───────────────────────────────────────────────────
		if (predictions.length > 0 && cursorY < maxY) {
			screen.writeText(cursorY, x, "Predictions:", { fg: FG_DIM, dim: true });
			cursorY++;

			const shown = predictions.slice(0, MAX_PREDICTIONS);
			for (const pred of shown) {
				if (cursorY >= maxY) break;
				const conf = formatConfidence(pred.confidence);
				const action = stripAnsi(pred.action ?? "");
				const maxActionWidth = Math.max(1, width - conf.length - 2);
				const truncAction = action.length > maxActionWidth ? `${action.slice(0, maxActionWidth - 1)}\u2026` : action;
				const line = `${truncAction} ${conf}`;
				screen.writeText(cursorY, x, this.trunc(line, width), { fg: FG_PREDICT });
				cursorY++;
			}
		}

		// ── Pattern Matches ───────────────────────────────────────────────
		if (patterns.length > 0 && cursorY < maxY) {
			screen.writeText(cursorY, x, "Patterns:", { fg: FG_DIM, dim: true });
			cursorY++;

			const shown = patterns.slice(0, MAX_PATTERNS);
			for (const pat of shown) {
				if (cursorY >= maxY) break;
				const conf = formatConfidence(pat.confidence);
				const typeStr = stripAnsi(pat.type ?? "");
				const maxTypeWidth = Math.max(1, width - conf.length - 2);
				const truncType = typeStr.length > maxTypeWidth ? `${typeStr.slice(0, maxTypeWidth - 1)}\u2026` : typeStr;
				const line = `${truncType} ${conf}`;
				screen.writeText(cursorY, x, this.trunc(line, width), { fg: FG_PATTERN });
				cursorY++;
			}
		}
	}

	private trunc(text: string, width: number): string {
		if (text.length <= width) return text;
		return `${text.slice(0, width - 1)}\u2026`;
	}
}
