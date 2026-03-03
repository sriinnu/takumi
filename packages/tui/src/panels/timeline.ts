/**
 * TimelinePanel — session replay timeline showing turns with navigation.
 * Only renders when AppState.replayMode is true.
 */

import type { Message, Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface TimelinePanelProps {
	state: AppState;
}

/** Map a message role to a display icon. */
function roleIcon(role: string): string {
	switch (role) {
		case "user":
			return "\u{1F9D1}";
		case "assistant":
			return "\u{1F916}";
		default:
			return "\u{1F527}";
	}
}

/** Extract a plain-text preview from the first content block. */
function contentPreview(msg: Message, maxLen: number): string {
	if (!msg.content || msg.content.length === 0) return "(empty)";
	const block = msg.content[0];
	let raw = "";
	switch (block.type) {
		case "text":
			raw = block.text;
			break;
		case "thinking":
			raw = `[thinking] ${block.thinking}`;
			break;
		case "tool_use":
			raw = `[tool] ${block.name}`;
			break;
		case "tool_result":
			raw = `[result] ${block.content}`;
			break;
		case "image":
			raw = "[image]";
			break;
		default:
			raw = "(unknown)";
	}
	// Replace newlines with spaces for single-line preview
	raw = raw.replace(/\n/g, " ");
	if (raw.length > maxLen) return `${raw.slice(0, maxLen)}...`;
	return raw;
}

export class TimelinePanel extends Component {
	private state: AppState;
	private scrollOffset = 0;
	private disposeEffect: (() => void) | null = null;

	constructor(props: TimelinePanelProps) {
		super();
		this.state = props.state;

		this.disposeEffect = effect(() => {
			const _mode = this.state.replayMode.value;
			const _idx = this.state.replayIndex.value;
			const _turns = this.state.replayTurns.value;
			const _sid = this.state.replaySessionId.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	// ── Navigation ────────────────────────────────────────────────────────────

	/** Advance to the next turn (clamped at end). */
	next(): void {
		const turns = this.state.replayTurns.value;
		const current = this.state.replayIndex.value;
		if (current < turns.length - 1) {
			this.state.replayIndex.value = current + 1;
		}
	}

	/** Go to the previous turn (clamped at 0). */
	prev(): void {
		const current = this.state.replayIndex.value;
		if (current > 0) {
			this.state.replayIndex.value = current - 1;
		}
	}

	/** Return the message at the current replay index, or undefined. */
	getCurrentTurn(): Message | undefined {
		const turns = this.state.replayTurns.value;
		const idx = this.state.replayIndex.value;
		return turns[idx];
	}

	/** Current scroll offset (exposed for testing). */
	getScrollOffset(): number {
		return this.scrollOffset;
	}

	// ── Render ────────────────────────────────────────────────────────────────

	render(screen: Screen, rect: Rect): void {
		if (!this.state.replayMode.value) return;

		const turns = this.state.replayTurns.value;
		const currentIdx = this.state.replayIndex.value;
		const sessionId = this.state.replaySessionId.value;
		const total = turns.length;

		// ── Header (row 0) ────────────────────────────────────────────────────
		const header = `Replay: ${sessionId} \u2014 Turn ${currentIdx + 1} of ${total}`;
		this.fillRow(screen, rect.y, rect.x, rect.width, 15, 236);
		screen.writeText(rect.y, rect.x + 1, header, { fg: 15, bg: 236, bold: true });

		// ── Turn list ─────────────────────────────────────────────────────────
		// Available rows for list: between header and footer
		const listHeight = rect.height - 2; // 1 header + 1 footer
		if (listHeight <= 0) return;

		// Ensure current turn is visible
		this.ensureVisible(currentIdx, listHeight);

		for (let i = 0; i < listHeight; i++) {
			const turnIdx = this.scrollOffset + i;
			const row = rect.y + 1 + i;

			if (turnIdx >= total) {
				// Empty row past the end
				this.fillRow(screen, row, rect.x, rect.width, 7, -1);
				continue;
			}

			const msg = turns[turnIdx];
			const isCurrent = turnIdx === currentIdx;
			const icon = roleIcon(msg.role);
			const maxPreview = Math.max(0, rect.width - 10);
			const preview = contentPreview(msg, Math.min(60, maxPreview));
			const line = `${String(turnIdx + 1).padStart(3)} ${icon} ${preview}`;

			const fgColor = isCurrent ? 0 : 7;
			const bgColor = isCurrent ? 15 : -1;

			this.fillRow(screen, row, rect.x, rect.width, fgColor, bgColor);
			screen.writeText(row, rect.x, line, { fg: fgColor, bg: bgColor });
		}

		// ── Footer (last row) ─────────────────────────────────────────────────
		const footerRow = rect.y + rect.height - 1;
		const footer = "\u2190 prev \u2502 \u2192 next \u2502 f fork \u2502 Esc exit";
		this.fillRow(screen, footerRow, rect.x, rect.width, 8, 236);
		screen.writeText(footerRow, rect.x + 1, footer, { fg: 8, bg: 236 });
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	/** Adjust scrollOffset so `idx` is visible within `viewportHeight` rows. */
	private ensureVisible(idx: number, viewportHeight: number): void {
		if (idx < this.scrollOffset) {
			this.scrollOffset = idx;
		} else if (idx >= this.scrollOffset + viewportHeight) {
			this.scrollOffset = idx - viewportHeight + 1;
		}
	}

	/** Fill an entire row with a background color. */
	private fillRow(screen: Screen, row: number, startCol: number, width: number, fg: number, bg: number): void {
		for (let col = startCol; col < startCol + width; col++) {
			screen.set(row, col, {
				char: " ",
				fg,
				bg,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}
	}
}
