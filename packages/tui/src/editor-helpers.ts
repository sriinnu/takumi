import type { EditorPosition } from "./editor.js";

const OPEN_BRACKETS = new Set(["(", "[", "{", "<"]);

const BRACKET_PAIRS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"<": ">",
	")": "(",
	"]": "[",
	"}": "{",
	">": "<",
};

export function isWordChar(ch: string): boolean {
	return /[\w]/.test(ch);
}

export function getBracketTarget(ch: string): { pair: string; forward: boolean } | null {
	const pair = BRACKET_PAIRS[ch];
	if (!pair) return null;
	return { pair, forward: OPEN_BRACKETS.has(ch) };
}

export function scanForBracket(
	lines: string[],
	startRow: number,
	startCol: number,
	openChar: string,
	closeChar: string,
	forward: boolean,
): EditorPosition | null {
	let depth = 0;
	if (forward) {
		for (let row = startRow; row < lines.length; row++) {
			const line = lines[row];
			const startC = row === startRow ? startCol : 0;
			for (let col = startC; col < line.length; col++) {
				const ch = line[col];
				if (ch === openChar) depth++;
				else if (ch === closeChar && --depth === 0) return { row, col };
			}
		}
		return null;
	}

	for (let row = startRow; row >= 0; row--) {
		const line = lines[row];
		const startC = row === startRow ? startCol : line.length - 1;
		for (let col = startC; col >= 0; col--) {
			const ch = line[col];
			if (ch === openChar) depth++;
			else if (ch === closeChar && --depth === 0) return { row, col };
		}
	}
	return null;
}
