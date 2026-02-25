/**
 * themes.ts — Built-in Takumi colour themes.
 *
 * Each theme maps to a ThemeConfig with named colour tokens.
 * The token values are ANSI-256 colour indices used by Kagami's Screen.writeText.
 *
 * Usage:
 *   import { resolveTheme } from "./themes.js";
 *   const theme = resolveTheme(config.theme);
 */

import type { ThemeConfig } from "@takumi/core";

// ── Palette library ──────────────────────────────────────────────────────────

/** ANSI-256 colour indices for well-known 24-bit colours. */
const P = {
	// Neutrals
	white: 15,
	black: 16,
	grey: 244,
	dimGrey: 238,
	// Takumi default (electric violet family)
	violet: 141,
	lavender: 183,
	deepViolet: 55,
	cyan: 51,
	// Catppuccin Mocha
	ctp_rosewater: 224,
	ctp_lavender: 183,
	ctp_blue: 111,
	ctp_green: 114,
	ctp_yellow: 221,
	ctp_red: 210,
	ctp_surface: 236,
	// Dracula
	drac_purple: 141,
	drac_pink: 212,
	drac_cyan: 117,
	drac_green: 84,
	drac_yellow: 228,
	drac_red: 203,
	// Nord
	nord_frost1: 110,
	nord_frost2: 109,
	nord_snow: 189,
	nord_green: 108,
	nord_yellow: 222,
	nord_red: 167,
	// Google
	google_blue: 33,
	google_green: 34,
	google_yellow: 220,
	google_red: 196,
};

// ── Theme definitions ─────────────────────────────────────────────────────────

export const BUILT_IN_THEMES: Record<string, ThemeConfig> = {
	default: {
		name: "default",
		colors: {
			primary: "#a78bfa", // violet-400
			secondary: "#60a5fa", // blue-400
			background: "#000000",
			foreground: "#ffffff",
			success: "#4ade80",
			warning: "#facc15",
			error: "#f87171",
			muted: "#6b7280",
		},
		// ANSI-256 tokens used by Kagami renderer
		ansi: {
			primary: P.violet,
			secondary: P.cyan,
			bg: 16,
			bgBar: 236,
			bgBrand: P.deepViolet,
			fg: P.white,
			success: 2,
			warning: 3,
			error: 1,
			muted: P.grey,
			separator: 99,
		},
	},

	"catppuccin-mocha": {
		name: "catppuccin-mocha",
		colors: {
			primary: "#cba6f7",
			secondary: "#89b4fa",
			background: "#1e1e2e",
			foreground: "#cdd6f4",
			success: "#a6e3a1",
			warning: "#f9e2af",
			error: "#f38ba8",
			muted: "#6c7086",
		},
		ansi: {
			primary: P.ctp_lavender,
			secondary: P.ctp_blue,
			bg: 235,
			bgBar: 237,
			bgBrand: 55,
			fg: P.white,
			success: P.ctp_green,
			warning: P.ctp_yellow,
			error: P.ctp_red,
			muted: P.dimGrey,
			separator: P.ctp_lavender,
		},
	},

	dracula: {
		name: "dracula",
		colors: {
			primary: "#bd93f9",
			secondary: "#8be9fd",
			background: "#282a36",
			foreground: "#f8f8f2",
			success: "#50fa7b",
			warning: "#f1fa8c",
			error: "#ff5555",
			muted: "#6272a4",
		},
		ansi: {
			primary: P.drac_purple,
			secondary: P.drac_cyan,
			bg: 235,
			bgBar: 237,
			bgBrand: 54,
			fg: P.white,
			success: P.drac_green,
			warning: P.drac_yellow,
			error: P.drac_red,
			muted: P.dimGrey,
			separator: P.drac_purple,
		},
	},

	nord: {
		name: "nord",
		colors: {
			primary: "#88c0d0",
			secondary: "#81a1c1",
			background: "#2e3440",
			foreground: "#eceff4",
			success: "#a3be8c",
			warning: "#ebcb8b",
			error: "#bf616a",
			muted: "#4c566a",
		},
		ansi: {
			primary: P.nord_frost1,
			secondary: P.nord_frost2,
			bg: 236,
			bgBar: 237,
			bgBrand: 24,
			fg: P.nord_snow,
			success: P.nord_green,
			warning: P.nord_yellow,
			error: P.nord_red,
			muted: P.dimGrey,
			separator: P.nord_frost2,
		},
	},

	google: {
		name: "google",
		colors: {
			primary: "#4285f4",
			secondary: "#34a853",
			background: "#202124",
			foreground: "#e8eaed",
			success: "#34a853",
			warning: "#fbbc04",
			error: "#ea4335",
			muted: "#9aa0a6",
		},
		ansi: {
			primary: P.google_blue,
			secondary: P.google_green,
			bg: 234,
			bgBar: 236,
			bgBrand: 19,
			fg: P.white,
			success: P.google_green,
			warning: P.google_yellow,
			error: P.google_red,
			muted: P.grey,
			separator: P.google_blue,
		},
	},
};

/** Resolved ANSI tokens passed to Kagami. */
export interface ResolvedTheme extends ThemeConfig {
	ansi: {
		primary: number;
		secondary: number;
		bg: number;
		bgBar: number;
		bgBrand: number;
		fg: number;
		success: number;
		warning: number;
		error: number;
		muted: number;
		separator: number;
	};
}

/** Resolve a theme name or inline ThemeConfig → ResolvedTheme. */
export function resolveTheme(theme: string | ThemeConfig | undefined): ResolvedTheme {
	if (!theme) return BUILT_IN_THEMES.default as ResolvedTheme;
	if (typeof theme === "string") {
		return (BUILT_IN_THEMES[theme] ?? BUILT_IN_THEMES.default) as ResolvedTheme;
	}
	// Inline theme: merge with default for missing ANSI tokens
	const base = BUILT_IN_THEMES.default as ResolvedTheme;
	const themeAnsi = (theme as ResolvedTheme).ansi ?? {};
	const mergedAnsi = { ...base.ansi, ...themeAnsi };
	return { ...base, ...theme, ansi: mergedAnsi } as ResolvedTheme;
}

export const THEME_NAMES = Object.keys(BUILT_IN_THEMES);
