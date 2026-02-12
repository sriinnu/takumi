/**
 * Theming system for the TUI.
 * Each theme defines colors and styles for all UI components.
 */

export interface Theme {
	name: string;

	// Primary palette
	primary: string;
	secondary: string;
	accent: string;
	background: string;
	foreground: string;
	muted: string;
	error: string;
	warning: string;
	success: string;
	info: string;

	// Component-specific
	border: string;
	borderFocused: string;
	inputBackground: string;
	inputForeground: string;
	inputPlaceholder: string;
	selectionBackground: string;
	selectionForeground: string;

	// Message colors
	userMessage: string;
	assistantMessage: string;
	systemMessage: string;
	thinkingText: string;

	// Syntax highlighting
	syntaxKeyword: string;
	syntaxString: string;
	syntaxNumber: string;
	syntaxComment: string;
	syntaxFunction: string;
	syntaxType: string;
	syntaxOperator: string;
	syntaxPunctuation: string;

	// Diff colors
	diffAdd: string;
	diffRemove: string;
	diffContext: string;
	diffHunkHeader: string;

	// Status bar
	statusBarBg: string;
	statusBarFg: string;
	statusBarAccent: string;
}

export const defaultTheme: Theme = {
	name: "default",

	primary: "#7c3aed",
	secondary: "#6366f1",
	accent: "#f59e0b",
	background: "#0f172a",
	foreground: "#e2e8f0",
	muted: "#64748b",
	error: "#ef4444",
	warning: "#f59e0b",
	success: "#22c55e",
	info: "#3b82f6",

	border: "#334155",
	borderFocused: "#7c3aed",
	inputBackground: "#1e293b",
	inputForeground: "#e2e8f0",
	inputPlaceholder: "#475569",
	selectionBackground: "#7c3aed",
	selectionForeground: "#ffffff",

	userMessage: "#e2e8f0",
	assistantMessage: "#a5b4fc",
	systemMessage: "#64748b",
	thinkingText: "#94a3b8",

	syntaxKeyword: "#c084fc",
	syntaxString: "#86efac",
	syntaxNumber: "#fbbf24",
	syntaxComment: "#64748b",
	syntaxFunction: "#60a5fa",
	syntaxType: "#fbbf24",
	syntaxOperator: "#94a3b8",
	syntaxPunctuation: "#94a3b8",

	diffAdd: "#22c55e",
	diffRemove: "#ef4444",
	diffContext: "#94a3b8",
	diffHunkHeader: "#7c3aed",

	statusBarBg: "#1e293b",
	statusBarFg: "#94a3b8",
	statusBarAccent: "#7c3aed",
};

let currentTheme: Theme = { ...defaultTheme };
const themes = new Map<string, Theme>([["default", defaultTheme]]);

/** Get the active theme. */
export function getTheme(): Theme {
	return currentTheme;
}

/** Set the active theme by name or object. */
export function setTheme(nameOrTheme: string | Theme): void {
	if (typeof nameOrTheme === "string") {
		const theme = themes.get(nameOrTheme);
		if (!theme) throw new Error(`Unknown theme: ${nameOrTheme}`);
		currentTheme = { ...theme };
	} else {
		currentTheme = { ...nameOrTheme };
	}
}

/** Register a custom theme. */
export function registerTheme(theme: Theme): void {
	themes.set(theme.name, theme);
}

/** List all registered theme names. */
export function listThemes(): string[] {
	return [...themes.keys()];
}
