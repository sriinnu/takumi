/**
 * Color utilities for terminal rendering.
 * Supports named colors, 256-color palette, and 24-bit truecolor.
 */

// ── Named colors (xterm 256-color indices) ────────────────────────────────────

export const COLORS = {
	// Standard 16 colors
	black: 0,
	red: 1,
	green: 2,
	yellow: 3,
	blue: 4,
	magenta: 5,
	cyan: 6,
	white: 7,
	brightBlack: 8,
	brightRed: 9,
	brightGreen: 10,
	brightYellow: 11,
	brightBlue: 12,
	brightMagenta: 13,
	brightCyan: 14,
	brightWhite: 15,

	// Grays
	gray: 8,
	grey: 8,
	darkGray: 240,
	darkGrey: 240,
	lightGray: 248,
	lightGrey: 248,

	// Extended palette aliases
	orange: 208,
	pink: 213,
	purple: 129,
	teal: 30,
	gold: 220,
	olive: 142,
	navy: 17,
	maroon: 52,
	lime: 118,
	coral: 209,
	salmon: 173,
	indigo: 55,
	violet: 177,
	aqua: 51,
} as const;

export type ColorName = keyof typeof COLORS;

/** Get an ANSI foreground SGR for a named color. */
export function namedFg(name: ColorName): string {
	return `\x1b[38;5;${COLORS[name]}m`;
}

/** Get an ANSI background SGR for a named color. */
export function namedBg(name: ColorName): string {
	return `\x1b[48;5;${COLORS[name]}m`;
}

// ── 256-color palette ─────────────────────────────────────────────────────────

/** Foreground from 256-color palette (0-255). */
export function color256Fg(index: number): string {
	return `\x1b[38;5;${clamp256(index)}m`;
}

/** Background from 256-color palette (0-255). */
export function color256Bg(index: number): string {
	return `\x1b[48;5;${clamp256(index)}m`;
}

/**
 * Shorthand: color256(index) returns both fg and bg setter functions.
 */
export function color256(index: number): { fg: string; bg: string } {
	const i = clamp256(index);
	return {
		fg: `\x1b[38;5;${i}m`,
		bg: `\x1b[48;5;${i}m`,
	};
}

// ── 24-bit truecolor ──────────────────────────────────────────────────────────

/** Truecolor foreground. */
export function truecolorFg(r: number, g: number, b: number): string {
	return `\x1b[38;2;${clamp8(r)};${clamp8(g)};${clamp8(b)}m`;
}

/** Truecolor background. */
export function truecolorBg(r: number, g: number, b: number): string {
	return `\x1b[48;2;${clamp8(r)};${clamp8(g)};${clamp8(b)}m`;
}

/**
 * Shorthand: rgb(r, g, b) returns both fg and bg strings.
 */
export function rgb(r: number, g: number, b: number): { fg: string; bg: string } {
	return {
		fg: truecolorFg(r, g, b),
		bg: truecolorBg(r, g, b),
	};
}

// ── Hex parsing ───────────────────────────────────────────────────────────────

/** Parse a hex color (#RGB or #RRGGBB) to [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
	const cleaned = hex.replace(/^#/, "");
	if (cleaned.length === 3) {
		const r = Number.parseInt(cleaned[0] + cleaned[0], 16);
		const g = Number.parseInt(cleaned[1] + cleaned[1], 16);
		const b = Number.parseInt(cleaned[2] + cleaned[2], 16);
		return [r, g, b];
	}
	if (cleaned.length === 6) {
		const r = Number.parseInt(cleaned.slice(0, 2), 16);
		const g = Number.parseInt(cleaned.slice(2, 4), 16);
		const b = Number.parseInt(cleaned.slice(4, 6), 16);
		return [r, g, b];
	}
	return [0, 0, 0];
}

/** Convert hex string to fg/bg ANSI escapes. */
export function hex(color: string): { fg: string; bg: string } {
	const [r, g, b] = hexToRgb(color);
	return rgb(r, g, b);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp256(n: number): number {
	return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp8(n: number): number {
	return Math.max(0, Math.min(255, Math.round(n)));
}
