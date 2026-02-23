/**
 * Text measurement and manipulation utilities for terminal rendering.
 * Handles Unicode grapheme clusters, fullwidth characters, word wrapping.
 */

import { visibleLength } from "./ansi.js";

/**
 * Measure the visible width of text, handling ANSI escapes and
 * fullwidth (CJK) characters. Alias for visibleLength.
 */
export function measureText(text: string): number {
	return visibleLength(text);
}

/**
 * Segment a string into grapheme clusters using Intl.Segmenter.
 * Falls back to Array.from for environments without Segmenter.
 */
export function segmentGraphemes(text: string): string[] {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
		return [...segmenter.segment(text)].map((s) => s.segment);
	}
	// Fallback: Array.from handles most surrogate pairs
	return Array.from(text);
}

/**
 * Check if a character is a fullwidth (CJK) character that
 * takes 2 columns in a terminal.
 */
export function isFullwidth(char: string): boolean {
	const code = char.codePointAt(0);
	if (code === undefined) return false;
	return (
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xff01 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x3000 && code <= 0x303f) ||
		(code >= 0x3040 && code <= 0x309f) ||
		(code >= 0x30a0 && code <= 0x30ff) ||
		(code >= 0xac00 && code <= 0xd7af) ||
		(code >= 0x20000 && code <= 0x2a6df)
	);
}

/**
 * Wrap text to fit within the given column width.
 * Respects word boundaries when possible. Returns an array of lines.
 */
export function wrapText(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [];
	const inputLines = text.split("\n");
	const result: string[] = [];

	for (const line of inputLines) {
		if (measureText(line) <= maxWidth) {
			result.push(line);
			continue;
		}

		// Word-wrap this line
		const words = line.split(/(\s+)/);
		let currentLine = "";
		let currentWidth = 0;

		for (const word of words) {
			const wordWidth = measureText(word);

			if (currentWidth + wordWidth <= maxWidth) {
				currentLine += word;
				currentWidth += wordWidth;
			} else if (wordWidth > maxWidth) {
				// Word itself is wider than maxWidth — break it character by character
				if (currentLine) {
					result.push(currentLine.trimEnd());
					currentLine = "";
					currentWidth = 0;
				}
				const graphemes = segmentGraphemes(word);
				for (const g of graphemes) {
					const gw = measureText(g);
					if (currentWidth + gw > maxWidth && currentLine) {
						result.push(currentLine);
						currentLine = "";
						currentWidth = 0;
					}
					currentLine += g;
					currentWidth += gw;
				}
			} else {
				// Start a new line
				if (currentLine) {
					result.push(currentLine.trimEnd());
				}
				// Skip leading whitespace on new line
				if (/^\s+$/.test(word)) {
					currentLine = "";
					currentWidth = 0;
				} else {
					currentLine = word;
					currentWidth = wordWidth;
				}
			}
		}

		if (currentLine) {
			result.push(currentLine);
		}
	}

	return result;
}

/**
 * Truncate text to fit within maxWidth columns, adding an ellipsis
 * if the text was truncated.
 */
export function truncate(text: string, maxWidth: number, ellipsis = "\u2026"): string {
	if (maxWidth <= 0) return "";
	if (measureText(text) <= maxWidth) return text;

	const ellipsisWidth = measureText(ellipsis);
	if (maxWidth <= ellipsisWidth) return ellipsis.slice(0, maxWidth);

	const targetWidth = maxWidth - ellipsisWidth;
	const graphemes = segmentGraphemes(text);
	let result = "";
	let width = 0;

	for (const g of graphemes) {
		const gw = measureText(g);
		if (width + gw > targetWidth) break;
		result += g;
		width += gw;
	}

	return result + ellipsis;
}
