/**
 * Built-in theme variants for the TUI.
 *
 * Each theme defines the full color palette mapping the Theme interface
 * to colors from the corresponding popular terminal/editor theme.
 *
 * ANSI-256 approximate codes are noted in comments for terminals that
 * lack true-color support. The canonical values are hex.
 */

import type { Theme } from "./theme.js";

// ---------------------------------------------------------------------------
// Catppuccin Mocha (Dark) — default theme
// https://github.com/catppuccin/catppuccin
// ---------------------------------------------------------------------------
export const catppuccinMocha: Theme = {
	name: "catppuccin-mocha",

	// Primary palette
	primary: "#cba6f7", // mauve  (ANSI ~141)
	secondary: "#94e2d5", // teal   (ANSI ~115)
	accent: "#f5c2e7", // pink   (ANSI ~218)
	background: "#1e1e2e", // base   (ANSI ~234)
	foreground: "#cdd6f4", // text   (ANSI ~189)
	muted: "#6c7086", // overlay0 (ANSI ~243)
	error: "#f38ba8", // red    (ANSI ~211)
	warning: "#fab387", // peach  (ANSI ~216)
	success: "#a6e3a1", // green  (ANSI ~150)
	info: "#89b4fa", // blue   (ANSI ~111)

	// Component-specific
	border: "#45475a", // surface1 (ANSI ~238)
	borderFocused: "#cba6f7", // mauve
	inputBackground: "#313244", // surface0 (ANSI ~236)
	inputForeground: "#cdd6f4", // text
	inputPlaceholder: "#585b70", // surface2 (ANSI ~240)
	selectionBackground: "#cba6f7", // mauve
	selectionForeground: "#1e1e2e", // base

	// Message colors
	userMessage: "#cdd6f4", // text
	assistantMessage: "#b4befe", // lavender
	systemMessage: "#6c7086", // overlay0
	thinkingText: "#9399b2", // overlay2

	// Syntax highlighting
	syntaxKeyword: "#cba6f7", // mauve
	syntaxString: "#a6e3a1", // green
	syntaxNumber: "#fab387", // peach
	syntaxComment: "#6c7086", // overlay0
	syntaxFunction: "#89b4fa", // blue
	syntaxType: "#f9e2af", // yellow
	syntaxOperator: "#89dceb", // sky
	syntaxPunctuation: "#9399b2", // overlay2

	// Diff colors
	diffAdd: "#a6e3a1", // green
	diffRemove: "#f38ba8", // red
	diffContext: "#9399b2", // overlay2
	diffHunkHeader: "#cba6f7", // mauve

	// Status bar
	statusBarBg: "#313244", // surface0
	statusBarFg: "#9399b2", // overlay2
	statusBarAccent: "#cba6f7", // mauve
};

// ---------------------------------------------------------------------------
// Catppuccin Latte (Light)
// https://github.com/catppuccin/catppuccin
// ---------------------------------------------------------------------------
export const catppuccinLatte: Theme = {
	name: "catppuccin-latte",

	// Primary palette  (ANSI-256 approx in comments)
	primary: "#8839ef", // mauve     (~136)
	secondary: "#179299", // teal      (~32)
	accent: "#ea76cb", // pink
	background: "#eff1f5", // base      (~231)
	foreground: "#4c4f69", // text      (~236)
	muted: "#9ca0b0", // overlay0  (~247)
	error: "#d20f39", // red       (~160)
	warning: "#fe640b", // peach     (~172)
	success: "#40a02b", // green     (~34)
	info: "#1e66f5", // blue

	// Component-specific
	border: "#bcc0cc", // surface1  (~249)
	borderFocused: "#8839ef", // mauve
	inputBackground: "#ccd0da", // surface0
	inputForeground: "#4c4f69", // text
	inputPlaceholder: "#acb0be", // surface2
	selectionBackground: "#8839ef", // mauve
	selectionForeground: "#eff1f5", // base

	// Message colors
	userMessage: "#4c4f69", // text
	assistantMessage: "#7287fd", // lavender
	systemMessage: "#9ca0b0", // overlay0
	thinkingText: "#7c7f93", // overlay2

	// Syntax highlighting
	syntaxKeyword: "#8839ef", // mauve
	syntaxString: "#40a02b", // green
	syntaxNumber: "#fe640b", // peach
	syntaxComment: "#9ca0b0", // overlay0
	syntaxFunction: "#1e66f5", // blue
	syntaxType: "#df8e1d", // yellow
	syntaxOperator: "#04a5e5", // sky
	syntaxPunctuation: "#7c7f93", // overlay2

	// Diff colors
	diffAdd: "#40a02b", // green
	diffRemove: "#d20f39", // red
	diffContext: "#7c7f93", // overlay2
	diffHunkHeader: "#8839ef", // mauve

	// Status bar
	statusBarBg: "#ccd0da", // surface0
	statusBarFg: "#7c7f93", // overlay2
	statusBarAccent: "#8839ef", // mauve
};

// ---------------------------------------------------------------------------
// Dracula
// https://draculatheme.com/contribute
// ---------------------------------------------------------------------------
export const dracula: Theme = {
	name: "dracula",

	// Primary palette
	primary: "#bd93f9", // purple    (ANSI ~141)
	secondary: "#8be9fd", // cyan      (~117)
	accent: "#ff79c6", // pink
	background: "#282a36", // background (~235)
	foreground: "#f8f8f2", // foreground (~231)
	muted: "#6272a4", // comment   (~103)
	error: "#ff5555", // red       (~203)
	warning: "#f1fa8c", // yellow    (~228)
	success: "#50fa7b", // green     (~84)
	info: "#8be9fd", // cyan

	// Component-specific
	border: "#44475a", // current line (~60)
	borderFocused: "#bd93f9", // purple
	inputBackground: "#44475a", // current line
	inputForeground: "#f8f8f2", // foreground
	inputPlaceholder: "#6272a4", // comment
	selectionBackground: "#bd93f9", // purple
	selectionForeground: "#282a36", // background

	// Message colors
	userMessage: "#f8f8f2", // foreground
	assistantMessage: "#bd93f9", // purple
	systemMessage: "#6272a4", // comment
	thinkingText: "#6272a4", // comment

	// Syntax highlighting
	syntaxKeyword: "#ff79c6", // pink
	syntaxString: "#f1fa8c", // yellow
	syntaxNumber: "#bd93f9", // purple
	syntaxComment: "#6272a4", // comment
	syntaxFunction: "#50fa7b", // green
	syntaxType: "#8be9fd", // cyan
	syntaxOperator: "#ff79c6", // pink
	syntaxPunctuation: "#f8f8f2", // foreground

	// Diff colors
	diffAdd: "#50fa7b", // green
	diffRemove: "#ff5555", // red
	diffContext: "#6272a4", // comment
	diffHunkHeader: "#bd93f9", // purple

	// Status bar
	statusBarBg: "#44475a", // current line
	statusBarFg: "#f8f8f2", // foreground
	statusBarAccent: "#bd93f9", // purple
};

// ---------------------------------------------------------------------------
// Tokyo Night
// https://github.com/enkia/tokyo-night-vscode-theme
// ---------------------------------------------------------------------------
export const tokyoNight: Theme = {
	name: "tokyo-night",

	// Primary palette
	primary: "#7aa2f7", // blue      (ANSI ~111)
	secondary: "#2ac3de", // cyan      (~79)
	accent: "#bb9af7", // magenta
	background: "#1a1b26", // background (~234)
	foreground: "#c0caf5", // foreground (~189)
	muted: "#565f89", // comment   (~102)
	error: "#f7768e", // red       (~204)
	warning: "#e0af68", // yellow    (~215)
	success: "#9ece6a", // green     (~114)
	info: "#7dcfff", // info blue

	// Component-specific
	border: "#3b4261", // dark3     (~60)
	borderFocused: "#7aa2f7", // blue
	inputBackground: "#24283b", // dark1
	inputForeground: "#c0caf5", // foreground
	inputPlaceholder: "#565f89", // comment
	selectionBackground: "#7aa2f7", // blue
	selectionForeground: "#1a1b26", // background

	// Message colors
	userMessage: "#c0caf5", // foreground
	assistantMessage: "#bb9af7", // magenta
	systemMessage: "#565f89", // comment
	thinkingText: "#565f89", // comment

	// Syntax highlighting
	syntaxKeyword: "#bb9af7", // magenta
	syntaxString: "#9ece6a", // green
	syntaxNumber: "#ff9e64", // orange
	syntaxComment: "#565f89", // comment
	syntaxFunction: "#7aa2f7", // blue
	syntaxType: "#2ac3de", // cyan
	syntaxOperator: "#89ddff", // op blue
	syntaxPunctuation: "#c0caf5", // foreground

	// Diff colors
	diffAdd: "#9ece6a", // green
	diffRemove: "#f7768e", // red
	diffContext: "#565f89", // comment
	diffHunkHeader: "#7aa2f7", // blue

	// Status bar
	statusBarBg: "#24283b", // dark1
	statusBarFg: "#565f89", // comment
	statusBarAccent: "#7aa2f7", // blue
};

// ---------------------------------------------------------------------------
// One Dark
// https://github.com/Binaryify/OneDark-Pro
// ---------------------------------------------------------------------------
export const oneDark: Theme = {
	name: "one-dark",

	// Primary palette
	primary: "#61afef", // blue      (ANSI ~75)
	secondary: "#56b6c2", // cyan      (~44)
	accent: "#c678dd", // magenta
	background: "#282c34", // background (~235)
	foreground: "#abb2bf", // foreground (~188)
	muted: "#5c6370", // comment   (~59)
	error: "#e06c75", // red       (~204)
	warning: "#e5c07b", // dark yellow (~215)
	success: "#98c379", // green     (~114)
	info: "#61afef", // blue

	// Component-specific
	border: "#4b5263", // gutter    (~239)
	borderFocused: "#61afef", // blue
	inputBackground: "#21252b", // bg dark
	inputForeground: "#abb2bf", // foreground
	inputPlaceholder: "#5c6370", // comment
	selectionBackground: "#61afef", // blue
	selectionForeground: "#282c34", // background

	// Message colors
	userMessage: "#abb2bf", // foreground
	assistantMessage: "#c678dd", // magenta
	systemMessage: "#5c6370", // comment
	thinkingText: "#5c6370", // comment

	// Syntax highlighting
	syntaxKeyword: "#c678dd", // magenta
	syntaxString: "#98c379", // green
	syntaxNumber: "#d19a66", // dark yellow/orange
	syntaxComment: "#5c6370", // comment
	syntaxFunction: "#61afef", // blue
	syntaxType: "#e5c07b", // light yellow
	syntaxOperator: "#56b6c2", // cyan
	syntaxPunctuation: "#abb2bf", // foreground

	// Diff colors
	diffAdd: "#98c379", // green
	diffRemove: "#e06c75", // red
	diffContext: "#5c6370", // comment
	diffHunkHeader: "#61afef", // blue

	// Status bar
	statusBarBg: "#21252b", // bg dark
	statusBarFg: "#5c6370", // comment
	statusBarAccent: "#61afef", // blue
};

// ---------------------------------------------------------------------------
// Gruvbox Dark
// https://github.com/morhetz/gruvbox
// ---------------------------------------------------------------------------
export const gruvboxDark: Theme = {
	name: "gruvbox-dark",

	// Primary palette
	primary: "#d65d0e", // orange    (ANSI ~172)
	secondary: "#689d6a", // aqua      (~142)
	accent: "#d3869b", // purple
	background: "#1d2021", // bg0_hard  (~235)
	foreground: "#ebdbb2", // fg        (~223)
	muted: "#928374", // gray      (~102)
	error: "#cc241d", // red       (~167)
	warning: "#fabd2f", // yellow    (~214)
	success: "#98971a", // green     (~142)
	info: "#458588", // blue

	// Component-specific
	border: "#3c3836", // bg1       (~239)
	borderFocused: "#d65d0e", // orange
	inputBackground: "#3c3836", // bg1
	inputForeground: "#ebdbb2", // fg
	inputPlaceholder: "#928374", // gray
	selectionBackground: "#d65d0e", // orange
	selectionForeground: "#1d2021", // bg0_hard

	// Message colors
	userMessage: "#ebdbb2", // fg
	assistantMessage: "#d3869b", // purple
	systemMessage: "#928374", // gray
	thinkingText: "#928374", // gray

	// Syntax highlighting
	syntaxKeyword: "#fb4934", // bright red
	syntaxString: "#b8bb26", // bright green
	syntaxNumber: "#d3869b", // purple
	syntaxComment: "#928374", // gray
	syntaxFunction: "#fabd2f", // bright yellow
	syntaxType: "#83a598", // bright blue
	syntaxOperator: "#fe8019", // bright orange
	syntaxPunctuation: "#a89984", // fg4

	// Diff colors
	diffAdd: "#b8bb26", // bright green
	diffRemove: "#fb4934", // bright red
	diffContext: "#928374", // gray
	diffHunkHeader: "#d65d0e", // orange

	// Status bar
	statusBarBg: "#3c3836", // bg1
	statusBarFg: "#928374", // gray
	statusBarAccent: "#d65d0e", // orange
};

/** All built-in theme variants (excluding the default which is registered separately). */
export const builtinThemes: Theme[] = [catppuccinMocha, catppuccinLatte, dracula, tokyoNight, oneDark, gruvboxDark];
