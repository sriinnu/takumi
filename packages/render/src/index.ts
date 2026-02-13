// ANSI escape helpers
export {
	cursorTo,
	cursorMove,
	cursorShow,
	cursorHide,
	clearScreen,
	clearLine,
	clearToEndOfLine,
	clearToEndOfScreen,
	fg,
	bg,
	fgRgb,
	bgRgb,
	bold,
	dim,
	italic,
	underline,
	strikethrough,
	inverse,
	reset,
	visibleLength,
} from "./ansi.js";

// Signals
export {
	signal,
	computed,
	effect,
	batch,
	untrack,
} from "./signals.js";
export type { Signal, ReadonlySignal } from "./signals.js";

// Screen
export { Screen } from "./screen.js";
export type { ScreenPatch } from "./screen.js";

// Component system
export { Component } from "./component.js";
export type { YogaNode, ComponentStyle } from "./component.js";

// Yoga layout
export {
	initYoga,
	getYoga,
	createNode,
	applyStyle,
	computeLayout,
} from "./yoga.js";

// Text utilities
export {
	measureText,
	segmentGraphemes,
	isFullwidth,
	wrapText,
	truncate,
} from "./text.js";

// Color utilities
export {
	COLORS,
	namedFg,
	namedBg,
	color256,
	color256Fg,
	color256Bg,
	rgb,
	truecolorFg,
	truecolorBg,
	hex,
	hexToRgb,
} from "./color.js";
export type { ColorName } from "./color.js";

// Theming
export {
	defaultTheme,
	getTheme,
	setTheme,
	registerTheme,
	listThemes,
} from "./theme.js";
export type { Theme } from "./theme.js";

// Theme variants
export {
	catppuccinMocha,
	catppuccinLatte,
	dracula,
	tokyoNight,
	oneDark,
	gruvboxDark,
	builtinThemes,
} from "./theme-variants.js";

// Render scheduler
export { RenderScheduler } from "./reconciler.js";
export type { RenderSchedulerOptions } from "./reconciler.js";

// Components
export { Box } from "./components/box.js";
export type { BoxProps } from "./components/box.js";

export { TextComponent } from "./components/text.js";
export type { TextProps } from "./components/text.js";

export { Input } from "./components/input.js";
export type { InputProps } from "./components/input.js";

export { Spinner, SPINNER_STYLES } from "./components/spinner.js";
export type { SpinnerProps, SpinnerStyle } from "./components/spinner.js";

export { Scroll } from "./components/scroll.js";
export type { ScrollProps } from "./components/scroll.js";

export { Border } from "./components/border.js";
export type { BorderProps, BorderStyle } from "./components/border.js";

export { Markdown } from "./components/markdown.js";
export type { MarkdownProps } from "./components/markdown.js";

export { Syntax, tokenizeLine, LANGUAGE_MAP } from "./components/syntax.js";
export type { SyntaxProps, TokenType, Token, LanguageRules } from "./components/syntax.js";

export { Diff } from "./components/diff.js";
export type { DiffProps, DiffLine, DiffLineType } from "./components/diff.js";

// Standalone markdown renderer
export { renderMarkdown } from "./markdown.js";

// Clipboard (OSC 52)
export {
	copyToClipboard,
	requestClipboard,
	parseClipboardResponse,
	clearClipboard,
} from "./clipboard.js";

export { List } from "./components/list.js";
export type { ListProps, ListItem } from "./components/list.js";
