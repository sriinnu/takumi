/**
 * Diff parser and ANSI renderer — parse unified diff format and render
 * as colored ANSI strings for terminal display.
 *
 * Provides:
 * - parseDiff() — parse unified diff text into structured DiffFile[]
 * - renderDiff() — render a DiffFile as ANSI-colored string
 * - renderInlineDiff() — word-level diff highlighting for single-line changes
 * - isDiffContent() — detect if text looks like unified diff output
 */

import type { Theme } from "./theme.js";
import { hexToRgb } from "./color.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DiffLine {
	type: "add" | "remove" | "context" | "header";
	content: string;
	oldLineNo?: number;
	newLineNo?: number;
}

export interface DiffHunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	header: string;
	lines: DiffLine[];
}

export interface DiffFile {
	oldPath: string;
	newPath: string;
	hunks: DiffHunk[];
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)?$/;
const FILE_OLD_RE = /^--- (?:a\/)?(.+)$/;
const FILE_NEW_RE = /^\+\+\+ (?:b\/)?(.+)$/;

/**
 * Parse a unified diff string into structured DiffFile[].
 * Handles multi-file diffs with multiple hunks per file.
 */
export function parseDiff(diffText: string): DiffFile[] {
	if (!diffText || diffText.trim() === "") return [];

	const rawLines = diffText.split("\n");
	const files: DiffFile[] = [];
	let currentFile: DiffFile | null = null;
	let currentHunk: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;
	let i = 0;

	while (i < rawLines.length) {
		const line = rawLines[i];

		// File header: --- a/path
		const oldMatch = line.match(FILE_OLD_RE);
		if (oldMatch && i + 1 < rawLines.length) {
			const nextLine = rawLines[i + 1];
			const newMatch = nextLine.match(FILE_NEW_RE);
			if (newMatch) {
				// Finalize previous hunk/file
				if (currentHunk && currentFile) {
					currentFile.hunks.push(currentHunk);
				}
				if (currentFile) {
					files.push(currentFile);
				}

				currentFile = {
					oldPath: oldMatch[1],
					newPath: newMatch[1],
					hunks: [],
				};
				currentHunk = null;
				i += 2;
				continue;
			}
		}

		// Skip "diff --git" lines and other preamble
		if (line.startsWith("diff ") || line.startsWith("index ") ||
			line.startsWith("new file") || line.startsWith("deleted file") ||
			line.startsWith("similarity") || line.startsWith("rename") ||
			line.startsWith("old mode") || line.startsWith("new mode")) {
			i++;
			continue;
		}

		// Hunk header: @@ -a,b +c,d @@
		const hunkMatch = line.match(HUNK_HEADER_RE);
		if (hunkMatch) {
			// Finalize previous hunk
			if (currentHunk && currentFile) {
				currentFile.hunks.push(currentHunk);
			}

			// If no file context yet, create a synthetic one
			if (!currentFile) {
				currentFile = { oldPath: "unknown", newPath: "unknown", hunks: [] };
			}

			const hunkOldStart = parseInt(hunkMatch[1], 10);
			const hunkOldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
			const hunkNewStart = parseInt(hunkMatch[3], 10);
			const hunkNewCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

			currentHunk = {
				oldStart: hunkOldStart,
				oldCount: hunkOldCount,
				newStart: hunkNewStart,
				newCount: hunkNewCount,
				header: line,
				lines: [],
			};

			oldLine = hunkOldStart;
			newLine = hunkNewStart;
			i++;
			continue;
		}

		// Diff content lines (only process if we're inside a hunk)
		if (currentHunk) {
			if (line.startsWith("+")) {
				currentHunk.lines.push({
					type: "add",
					content: line.slice(1),
					newLineNo: newLine,
				});
				newLine++;
			} else if (line.startsWith("-")) {
				currentHunk.lines.push({
					type: "remove",
					content: line.slice(1),
					oldLineNo: oldLine,
				});
				oldLine++;
			} else if (line.startsWith(" ") || line === "") {
				// Context line — may start with space or be empty (end of diff)
				const content = line.startsWith(" ") ? line.slice(1) : line;
				// Only add non-empty context or actual space-prefixed lines
				if (line.startsWith(" ") || (line === "" && i < rawLines.length - 1)) {
					currentHunk.lines.push({
						type: "context",
						content,
						oldLineNo: oldLine,
						newLineNo: newLine,
					});
					oldLine++;
					newLine++;
				}
			} else if (line.startsWith("\\")) {
				// "\ No newline at end of file" — skip
			} else {
				// Unrecognized line inside a hunk — treat as context
				currentHunk.lines.push({
					type: "context",
					content: line,
					oldLineNo: oldLine,
					newLineNo: newLine,
				});
				oldLine++;
				newLine++;
			}
		}

		i++;
	}

	// Finalize last hunk and file
	if (currentHunk && currentFile) {
		currentFile.hunks.push(currentHunk);
	}
	if (currentFile) {
		files.push(currentFile);
	}

	return files;
}

// ── ANSI helpers ─────────────────────────────────────────────────────────────

function hexToAnsi(hexColor: string): string {
	const [r, g, b] = hexToRgb(hexColor);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function hexToBgAnsi(hexColor: string): string {
	const [r, g, b] = hexToRgb(hexColor);
	// Use subtle background: darken significantly
	const dr = Math.round(r * 0.2);
	const dg = Math.round(g * 0.2);
	const db = Math.round(b * 0.2);
	return `\x1b[48;2;${dr};${dg};${db}m`;
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Render a DiffFile as an ANSI-colored string for terminal display.
 *
 * Output format:
 * ```
 * -- src/app.ts ----------------------------------------
 * @@ -10,5 +10,7 @@
 *   10 |   const app = new TakumiApp();
 *   11 |   app.start();
 *    - |-  app.run();
 *   12 |+  await app.run();
 *   13 |+  app.cleanup();
 *   14 |   return app;
 * ```
 */
export function renderDiff(diff: DiffFile, theme: Theme, width: number): string {
	const lines: string[] = [];

	// File header
	const filePath = diff.newPath !== "/dev/null" ? diff.newPath : diff.oldPath;
	const headerSep = "\u2500".repeat(Math.max(1, width - filePath.length - 5));
	lines.push(
		`${DIM}\u2500\u2500 ${RESET}${BOLD}${filePath}${RESET} ${DIM}${headerSep}${RESET}`,
	);

	for (const hunk of diff.hunks) {
		// Hunk header in cyan/dim
		const hunkColor = hexToAnsi(theme.diffHunkHeader);
		lines.push(`${hunkColor}${DIM}${hunk.header}${RESET}`);

		// Calculate gutter width based on max line numbers in hunk
		const maxOldLine = hunk.oldStart + hunk.oldCount;
		const maxNewLine = hunk.newStart + hunk.newCount;
		const maxLineNum = Math.max(maxOldLine, maxNewLine);
		const gutterWidth = String(maxLineNum).length;

		for (const diffLine of hunk.lines) {
			const formatted = formatDiffLine(diffLine, theme, gutterWidth);
			lines.push(formatted);
		}
	}

	return lines.join("\n");
}

/**
 * Format a single diff line with line numbers and colors.
 */
function formatDiffLine(
	line: DiffLine,
	theme: Theme,
	gutterWidth: number,
): string {
	switch (line.type) {
		case "add": {
			const lineNo = line.newLineNo !== undefined
				? String(line.newLineNo).padStart(gutterWidth)
				: " ".repeat(gutterWidth);
			const oldGutter = " ".repeat(gutterWidth);
			const fgColor = hexToAnsi(theme.diffAdd);
			const bgColor = hexToBgAnsi(theme.diffAdd);
			return `${DIM}${oldGutter} ${lineNo} ${RESET}${fgColor}${bgColor}\u2502+${line.content}${RESET}`;
		}
		case "remove": {
			const lineNo = line.oldLineNo !== undefined
				? String(line.oldLineNo).padStart(gutterWidth)
				: " ".repeat(gutterWidth);
			const newGutter = " ".repeat(gutterWidth);
			const fgColor = hexToAnsi(theme.diffRemove);
			const bgColor = hexToBgAnsi(theme.diffRemove);
			return `${DIM}${lineNo} ${newGutter} ${RESET}${fgColor}${bgColor}\u2502-${line.content}${RESET}`;
		}
		case "context": {
			const oldNo = line.oldLineNo !== undefined
				? String(line.oldLineNo).padStart(gutterWidth)
				: " ".repeat(gutterWidth);
			const newNo = line.newLineNo !== undefined
				? String(line.newLineNo).padStart(gutterWidth)
				: " ".repeat(gutterWidth);
			return `${DIM}${oldNo} ${newNo} \u2502${RESET} ${line.content}`;
		}
		case "header": {
			return `${DIM}${line.content}${RESET}`;
		}
	}
}

/**
 * Render multi-file diff (array of DiffFile) as a single ANSI string.
 */
export function renderMultiFileDiff(
	files: DiffFile[],
	theme: Theme,
	width: number,
): string {
	return files.map((f) => renderDiff(f, theme, width)).join("\n\n");
}

// ── Inline word diff ─────────────────────────────────────────────────────────

/**
 * Compute a word-level inline diff between two strings.
 * Returns an ANSI-colored string showing changed words highlighted.
 */
export function renderInlineDiff(
	oldText: string,
	newText: string,
	theme: Theme,
): string {
	const oldWords = tokenizeWords(oldText);
	const newWords = tokenizeWords(newText);

	// Compute LCS (Longest Common Subsequence) for word-level diff
	const lcs = computeLCS(oldWords, newWords);

	const parts: string[] = [];
	let oldIdx = 0;
	let newIdx = 0;

	for (const [oi, ni] of lcs) {
		// Removed words (in old but not in LCS subsequence before this match)
		while (oldIdx < oi) {
			const removeColor = hexToAnsi(theme.diffRemove);
			const removeBg = hexToBgAnsi(theme.diffRemove);
			parts.push(`${removeColor}${removeBg}${oldWords[oldIdx]}${RESET}`);
			oldIdx++;
		}
		// Added words (in new but not in LCS subsequence before this match)
		while (newIdx < ni) {
			const addColor = hexToAnsi(theme.diffAdd);
			const addBg = hexToBgAnsi(theme.diffAdd);
			parts.push(`${addColor}${addBg}${newWords[newIdx]}${RESET}`);
			newIdx++;
		}
		// Common word
		parts.push(newWords[ni]);
		oldIdx = oi + 1;
		newIdx = ni + 1;
	}

	// Remaining removed words
	while (oldIdx < oldWords.length) {
		const removeColor = hexToAnsi(theme.diffRemove);
		const removeBg = hexToBgAnsi(theme.diffRemove);
		parts.push(`${removeColor}${removeBg}${oldWords[oldIdx]}${RESET}`);
		oldIdx++;
	}
	// Remaining added words
	while (newIdx < newWords.length) {
		const addColor = hexToAnsi(theme.diffAdd);
		const addBg = hexToBgAnsi(theme.diffAdd);
		parts.push(`${addColor}${addBg}${newWords[newIdx]}${RESET}`);
		newIdx++;
	}

	return parts.join("");
}

/**
 * Tokenize text into words, preserving whitespace as separate tokens.
 */
function tokenizeWords(text: string): string[] {
	const tokens: string[] = [];
	let pos = 0;

	while (pos < text.length) {
		if (/\s/.test(text[pos])) {
			// Whitespace token
			let end = pos;
			while (end < text.length && /\s/.test(text[end])) end++;
			tokens.push(text.slice(pos, end));
			pos = end;
		} else {
			// Word token
			let end = pos;
			while (end < text.length && !/\s/.test(text[end])) end++;
			tokens.push(text.slice(pos, end));
			pos = end;
		}
	}

	return tokens;
}

/**
 * Compute the Longest Common Subsequence between two word arrays.
 * Returns array of [oldIndex, newIndex] pairs for matching words.
 */
function computeLCS(a: string[], b: string[]): [number, number][] {
	const m = a.length;
	const n = b.length;

	// Build DP table
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array(n + 1).fill(0),
	);

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find the LCS pairs
	const result: [number, number][] = [];
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			result.unshift([i - 1, j - 1]);
			i--;
			j--;
		} else if (dp[i - 1][j] > dp[i][j - 1]) {
			i--;
		} else {
			j--;
		}
	}

	return result;
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect if text content looks like unified diff output.
 * Checks for common diff markers.
 */
export function isDiffContent(text: string): boolean {
	if (!text) return false;
	const firstLines = text.slice(0, 500);
	// Must have hunk headers (use multiline flag to match anywhere in text)
	if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(firstLines)) return true;
	// Or have --- and +++ file headers
	if (/^--- /m.test(firstLines) && /^\+\+\+ /m.test(firstLines)) return true;
	// Or start with diff --git
	if (/^diff --git/m.test(firstLines)) return true;
	return false;
}
