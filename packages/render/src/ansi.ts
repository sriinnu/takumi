/**
 * Low-level ANSI escape sequence helpers.
 * These produce raw strings — no I/O, no side effects.
 */

// ── Cursor movement ───────────────────────────────────────────────────────────

/** Move cursor to absolute position (1-based). */
export function cursorTo(row: number, col: number): string {
	return `\x1b[${row};${col}H`;
}

/** Move cursor relative to current position. */
export function cursorMove(rows: number, cols: number): string {
	let out = "";
	if (rows > 0) out += `\x1b[${rows}B`;
	else if (rows < 0) out += `\x1b[${-rows}A`;
	if (cols > 0) out += `\x1b[${cols}C`;
	else if (cols < 0) out += `\x1b[${-cols}D`;
	return out;
}

/** Show the terminal cursor. */
export function cursorShow(): string {
	return "\x1b[?25h";
}

/** Hide the terminal cursor. */
export function cursorHide(): string {
	return "\x1b[?25l";
}

// ── Screen operations ─────────────────────────────────────────────────────────

/** Clear the entire screen. */
export function clearScreen(): string {
	return "\x1b[2J";
}

/** Clear the current line. */
export function clearLine(): string {
	return "\x1b[2K";
}

/** Clear from cursor to end of line. */
export function clearToEndOfLine(): string {
	return "\x1b[K";
}

/** Clear from cursor to end of screen. */
export function clearToEndOfScreen(): string {
	return "\x1b[J";
}

// ── Colors ────────────────────────────────────────────────────────────────────

/** Set foreground color (0-255 palette). */
export function fg(color: number): string {
	if (color < 0 || color > 255) return "";
	return `\x1b[38;5;${color}m`;
}

/** Set background color (0-255 palette). */
export function bg(color: number): string {
	if (color < 0 || color > 255) return "";
	return `\x1b[48;5;${color}m`;
}

/** Set foreground to RGB truecolor. */
export function fgRgb(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}

/** Set background to RGB truecolor. */
export function bgRgb(r: number, g: number, b: number): string {
	return `\x1b[48;2;${r};${g};${b}m`;
}

// ── Text styles ───────────────────────────────────────────────────────────────

export function bold(text: string): string {
	return `\x1b[1m${text}\x1b[22m`;
}

export function dim(text: string): string {
	return `\x1b[2m${text}\x1b[22m`;
}

export function italic(text: string): string {
	return `\x1b[3m${text}\x1b[23m`;
}

export function underline(text: string): string {
	return `\x1b[4m${text}\x1b[24m`;
}

export function strikethrough(text: string): string {
	return `\x1b[9m${text}\x1b[29m`;
}

export function inverse(text: string): string {
	return `\x1b[7m${text}\x1b[27m`;
}

/** Full reset of all styles and colors. */
export function reset(): string {
	return "\x1b[0m";
}

// ── Visible length ────────────────────────────────────────────────────────────

/**
 * ANSI escape pattern: matches all CSI sequences, OSC sequences,
 * and simple escape sequences. Used to strip escapes for measuring
 * visible text width.
 */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][AB012]/g;

/**
 * Return the visible character width of a string, stripping all
 * ANSI escape sequences first.
 */
export function visibleLength(text: string): number {
	const stripped = text.replace(ANSI_RE, "");
	let len = 0;
	for (const ch of stripped) {
		const code = ch.codePointAt(0)!;
		// CJK Unified Ideographs and other fullwidth ranges
		if (isFullwidthCodePoint(code)) {
			len += 2;
		} else {
			len += 1;
		}
	}
	return len;
}

/** Check if a Unicode code point is fullwidth. */
function isFullwidthCodePoint(code: number): boolean {
	return (
		// CJK Unified Ideographs
		(code >= 0x4e00 && code <= 0x9fff) ||
		// CJK Unified Ideographs Extension A
		(code >= 0x3400 && code <= 0x4dbf) ||
		// CJK Compatibility Ideographs
		(code >= 0xf900 && code <= 0xfaff) ||
		// Fullwidth Forms
		(code >= 0xff01 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		// CJK Radicals Supplement
		(code >= 0x2e80 && code <= 0x2eff) ||
		// Kangxi Radicals
		(code >= 0x2f00 && code <= 0x2fdf) ||
		// CJK Symbols and Punctuation
		(code >= 0x3000 && code <= 0x303f) ||
		// Hiragana
		(code >= 0x3040 && code <= 0x309f) ||
		// Katakana
		(code >= 0x30a0 && code <= 0x30ff) ||
		// Hangul Syllables
		(code >= 0xac00 && code <= 0xd7af) ||
		// CJK Unified Ideographs Extension B
		(code >= 0x20000 && code <= 0x2a6df) ||
		// CJK Unified Ideographs Extension C
		(code >= 0x2a700 && code <= 0x2b73f) ||
		// Enclosed CJK
		(code >= 0x3200 && code <= 0x32ff) ||
		// CJK Compatibility
		(code >= 0x3300 && code <= 0x33ff)
	);
}
