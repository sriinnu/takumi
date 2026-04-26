/**
 * Inline permission card — replaces the modal overlay path.
 *
 * Renders as transcript content so the chat keeps drawing even if the card
 * itself has a bug. No z-order, no dimming, no parallel state machine.
 */

import type { LineSegment, RenderedLine } from "./message-list-types.js";

const CARD_BORDER_FG = 214; // amber — draws the eye without screaming
const CARD_LABEL_FG = 3;
const CARD_HINT_FG = 222;
const CARD_DIM_FG = 8;

/**
 * Build the inline lines that render an open permission prompt.
 *
 * Width budget: bounded between 40 and 80 cells. The borders (`│ … │`) take
 * 4 cells of overhead, leaving the rest for label-aligned key/value pairs and
 * the action hint at the bottom.
 */
export function buildPermissionCardLines(
	tool: string,
	args: Record<string, unknown>,
	contentWidth: number,
): RenderedLine[] {
	const cardWidth = Math.min(Math.max(40, contentWidth), 80);
	const innerWidth = cardWidth - 2;
	const lines: RenderedLine[] = [];

	const titleText = ` permission · ${tool} `;
	const titleTextLen = Math.min(titleText.length, innerWidth - 2);
	const trimmedTitle = titleText.slice(0, titleTextLen);
	const topFill = Math.max(0, innerWidth - 1 - trimmedTitle.length);
	lines.push(borderLine(`┌─${trimmedTitle}${"─".repeat(topFill)}┐`, true));

	const keys = Object.keys(args);
	if (keys.length === 0) {
		lines.push(contentRow("(no arguments)", innerWidth, CARD_DIM_FG, true));
	} else {
		const labelWidth = Math.min(12, Math.max(...keys.map((k) => k.length)) + 1);
		for (const key of keys) {
			const label = `${key}:`.padEnd(labelWidth);
			const available = Math.max(8, innerWidth - 2 - labelWidth - 1);
			const valueRaw = formatPermissionArgValue(args[key]);
			const value = valueRaw.length > available ? `${valueRaw.slice(0, available - 1)}…` : valueRaw;
			lines.push(labelledContentRow(label, value, innerWidth, labelWidth));
		}
	}

	lines.push(contentRow("", innerWidth, -1, false));
	// `[A] always` is intentionally absent until allowlist persistence exists
	// — until then `A` is just a Shift-fumble alias for `a`, and labelling it
	// "always" would be a lie about what the agent actually remembers.
	lines.push(hintRow("[a] allow   [d] deny", innerWidth));
	lines.push(borderLine(`└${"─".repeat(cardWidth - 2)}┘`, false));
	return lines;
}

function borderLine(text: string, bold: boolean): RenderedLine {
	return { text, fg: CARD_BORDER_FG, bold, dim: false };
}

function contentRow(content: string, innerWidth: number, contentFg: number, dim: boolean): RenderedLine {
	const padded = ` ${content}`.padEnd(innerWidth);
	const truncated = padded.length > innerWidth ? padded.slice(0, innerWidth) : padded;
	return {
		text: `│${truncated}│`,
		fg: CARD_BORDER_FG,
		bold: false,
		dim: false,
		segments: [
			borderSeg("│"),
			{ text: truncated, fg: contentFg, bg: -1, bold: false, dim, italic: false, underline: false },
			borderSeg("│"),
		],
	};
}

function labelledContentRow(label: string, value: string, innerWidth: number, labelWidth: number): RenderedLine {
	const valueWidth = Math.max(0, innerWidth - 2 - labelWidth);
	const valuePadded = value.length >= valueWidth ? value.slice(0, valueWidth) : value.padEnd(valueWidth);
	const text = `│ ${label} ${valuePadded}│`;
	return {
		text,
		fg: CARD_BORDER_FG,
		bold: false,
		dim: false,
		segments: [
			borderSeg("│ "),
			{ text: label, fg: CARD_LABEL_FG, bg: -1, bold: false, dim: false, italic: false, underline: false },
			plainSeg(" "),
			plainSeg(valuePadded),
			borderSeg("│"),
		],
	};
}

function hintRow(hint: string, innerWidth: number): RenderedLine {
	const available = Math.max(0, innerWidth - 2);
	const hintTrimmed = hint.length > available ? hint.slice(0, available) : hint;
	const padding = " ".repeat(Math.max(0, available - hintTrimmed.length));
	return {
		text: `│ ${hintTrimmed}${padding} │`,
		fg: CARD_BORDER_FG,
		bold: false,
		dim: false,
		segments: [
			borderSeg("│ "),
			{ text: hintTrimmed, fg: CARD_HINT_FG, bg: -1, bold: true, dim: false, italic: false, underline: false },
			plainSeg(padding),
			borderSeg(" │"),
		],
	};
}

function borderSeg(text: string): LineSegment {
	return { text, fg: CARD_BORDER_FG, bg: -1, bold: false, dim: false, italic: false, underline: false };
}

function plainSeg(text: string): LineSegment {
	return { text, fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false };
}

function formatPermissionArgValue(value: unknown): string {
	if (value === null || value === undefined) return "(none)";
	if (typeof value === "string") return value.replace(/\r?\n/g, " ").trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value).replace(/\r?\n/g, " ");
	} catch {
		return "(unserializable)";
	}
}
