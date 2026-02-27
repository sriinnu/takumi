/**
 * Terminal capability detection.
 *
 * Detects the running terminal emulator and its capabilities
 * (truecolor, OSC 52 clipboard, image protocol, unicode version, etc.).
 *
 * Supported terminals:
 *   Ghostty, kitty, iTerm2, WezTerm, Alacritty, foot, Windows Terminal,
 *   xterm, GNOME Terminal / VTE, tmux, screen, and generic fallbacks.
 */

// ── Terminal identity ─────────────────────────────────────────────────────────

export type TerminalName =
	| "ghostty"
	| "kitty"
	| "iterm2"
	| "wezterm"
	| "alacritty"
	| "foot"
	| "windows-terminal"
	| "xterm"
	| "vte"
	| "tmux"
	| "screen"
	| "apple-terminal"
	| "unknown";

export interface TerminalCapabilities {
	/** Detected terminal emulator name. */
	name: TerminalName;
	/** Whether the terminal supports 24-bit RGB color. */
	truecolor: boolean;
	/** Whether OSC 52 clipboard sequences are supported. */
	osc52: boolean;
	/** Whether the terminal supports the kitty image protocol. */
	kittyImages: boolean;
	/** Whether the terminal supports the iTerm2 inline image protocol. */
	iterm2Images: boolean;
	/** Whether the terminal supports Sixel graphics. */
	sixel: boolean;
	/** Whether the terminal supports hyperlinks (OSC 8). */
	hyperlinks: boolean;
	/** Whether bracketed paste mode is supported. */
	bracketedPaste: boolean;
	/** Whether the terminal supports the kitty keyboard protocol. */
	kittyKeyboard: boolean;
	/** Whether focus events (CSI I / CSI O) are supported. */
	focusEvents: boolean;
	/** Whether unicode grapheme cluster segmentation is reliable. */
	unicodeWidthReliable: boolean;
	/** Whether the terminal supports synchronized output (BSU/ESU). */
	synchronizedOutput: boolean;
	/** Raw TERM_PROGRAM value (if set). */
	termProgram: string | undefined;
	/** Raw TERM value. */
	term: string | undefined;
	/** Raw COLORTERM value. */
	colorTerm: string | undefined;
}

// ── Detection ─────────────────────────────────────────────────────────────────

/** Environment-variable bag — defaults to process.env but injectable for tests. */
export type EnvSource = Record<string, string | undefined>;

/**
 * Identify the terminal emulator from environment variables.
 *
 * Detection priority:
 *  1. TERM_PROGRAM (set by most modern emulators)
 *  2. Terminal-specific env vars (GHOSTTY_RESOURCES_DIR, KITTY_PID, etc.)
 *  3. TERM value as fallback
 */
export function detectTerminal(env: EnvSource = process.env): TerminalName {
	const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
	const term = env.TERM?.toLowerCase() ?? "";

	// ── TERM_PROGRAM-based detection ─────────────────────────────────
	if (termProgram === "ghostty") return "ghostty";
	if (termProgram === "wezterm") return "wezterm";
	if (termProgram.includes("iterm")) return "iterm2";
	if (termProgram === "apple_terminal") return "apple-terminal";
	if (termProgram === "tmux") return "tmux";

	// ── Terminal-specific env vars ───────────────────────────────────
	if (env.GHOSTTY_RESOURCES_DIR) return "ghostty";
	if (env.KITTY_PID || env.KITTY_WINDOW_ID) return "kitty";
	if (env.WEZTERM_PANE) return "wezterm";
	if (env.ITERM_SESSION_ID) return "iterm2";
	if (env.WT_SESSION) return "windows-terminal";
	if (env.ALACRITTY_WINDOW_ID || env.ALACRITTY_LOG) return "alacritty";
	if (env.FOOT_TERM) return "foot";
	if (env.TMUX) return "tmux";
	if (env.STY) return "screen";

	// ── TERM-based fallback ──────────────────────────────────────────
	if (term.startsWith("xterm")) return "xterm";
	if (term === "linux") return "unknown";

	// VTE-based terminals (GNOME Terminal, Tilix, etc.)
	if (env.VTE_VERSION) return "vte";

	return "unknown";
}

/**
 * Detect full terminal capabilities.
 *
 * This is a synchronous, heuristic-based probe. It reads only
 * environment variables — no ANSI query/response round-trips.
 */
export function detectCapabilities(env: EnvSource = process.env): TerminalCapabilities {
	const name = detectTerminal(env);
	const colorTerm = env.COLORTERM?.toLowerCase();
	const hasTruecolorEnv = colorTerm === "truecolor" || colorTerm === "24bit";

	// Start with conservative defaults
	const caps: TerminalCapabilities = {
		name,
		truecolor: hasTruecolorEnv,
		osc52: false,
		kittyImages: false,
		iterm2Images: false,
		sixel: false,
		hyperlinks: false,
		bracketedPaste: true, // most modern terminals support this
		kittyKeyboard: false,
		focusEvents: false,
		unicodeWidthReliable: false,
		synchronizedOutput: false,
		termProgram: env.TERM_PROGRAM,
		term: env.TERM,
		colorTerm: env.COLORTERM,
	};

	// Apply per-terminal overrides
	TERMINAL_PROFILES[name]?.(caps);

	return caps;
}

// ── Per-terminal capability profiles ──────────────────────────────────────────

type ProfileApplier = (caps: TerminalCapabilities) => void;

const TERMINAL_PROFILES: Record<TerminalName, ProfileApplier | undefined> = {
	ghostty: (c) => {
		c.truecolor = true;
		c.osc52 = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.kittyKeyboard = true;
		c.focusEvents = true;
		c.unicodeWidthReliable = true;
		c.synchronizedOutput = true;
	},

	kitty: (c) => {
		c.truecolor = true;
		c.osc52 = true;
		c.kittyImages = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.kittyKeyboard = true;
		c.focusEvents = true;
		c.unicodeWidthReliable = true;
		c.synchronizedOutput = true;
	},

	iterm2: (c) => {
		c.truecolor = true;
		c.osc52 = true;
		c.iterm2Images = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.focusEvents = true;
		c.unicodeWidthReliable = true;
	},

	wezterm: (c) => {
		c.truecolor = true;
		c.osc52 = true;
		c.kittyImages = true;
		c.iterm2Images = true;
		c.sixel = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.kittyKeyboard = true;
		c.focusEvents = true;
		c.unicodeWidthReliable = true;
		c.synchronizedOutput = true;
	},

	alacritty: (c) => {
		c.truecolor = true;
		c.osc52 = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.focusEvents = true;
		c.unicodeWidthReliable = true;
	},

	foot: (c) => {
		c.truecolor = true;
		c.osc52 = true;
		c.sixel = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.kittyKeyboard = true;
		c.focusEvents = true;
		c.unicodeWidthReliable = true;
		c.synchronizedOutput = true;
	},

	"windows-terminal": (c) => {
		c.truecolor = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
		c.focusEvents = true;
	},

	xterm: (c) => {
		// xterm supports truecolor if COLORTERM says so, already set above
		c.osc52 = true;
		c.bracketedPaste = true;
	},

	vte: (c) => {
		c.truecolor = true;
		c.hyperlinks = true;
		c.bracketedPaste = true;
	},

	tmux: (c) => {
		// tmux passes through most capabilities of the outer terminal
		c.truecolor = true;
		c.osc52 = true; // if tmux has set-clipboard on
		c.bracketedPaste = true;
		c.focusEvents = true;
	},

	screen: (c) => {
		c.bracketedPaste = true;
	},

	"apple-terminal": (c) => {
		// Apple Terminal.app is surprisingly limited
		c.bracketedPaste = true;
		// No truecolor, no OSC 52, no hyperlinks
	},

	unknown: undefined,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return true if the terminal supports truecolor (24-bit RGB).
 * Convenience shorthand for `detectCapabilities(env).truecolor`.
 */
export function supportsTruecolor(env: EnvSource = process.env): boolean {
	return detectCapabilities(env).truecolor;
}

/**
 * Return true if the terminal supports OSC 52 clipboard operations.
 */
export function supportsOsc52(env: EnvSource = process.env): boolean {
	return detectCapabilities(env).osc52;
}

/**
 * Create the ANSI sequence to enable synchronized output (mode 2026).
 * Only useful if `caps.synchronizedOutput` is true.
 */
export function beginSyncUpdate(): string {
	return "\x1b[?2026h";
}

/**
 * End synchronized output.
 */
export function endSyncUpdate(): string {
	return "\x1b[?2026l";
}

/**
 * Return a concise summary string for the detected terminal and its capabilities.
 * Useful for status bars and diagnostic output.
 */
export function terminalSummary(caps: TerminalCapabilities): string {
	const flags: string[] = [];
	if (caps.truecolor) flags.push("rgb");
	if (caps.osc52) flags.push("clip");
	if (caps.kittyImages) flags.push("kitty-img");
	if (caps.iterm2Images) flags.push("iterm-img");
	if (caps.sixel) flags.push("sixel");
	if (caps.hyperlinks) flags.push("link");
	if (caps.kittyKeyboard) flags.push("kkbd");
	if (caps.synchronizedOutput) flags.push("sync");

	return `${caps.name}${flags.length ? ` [${flags.join(",")}]` : ""}`;
}
