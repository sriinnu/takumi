import os from "node:os";
import path from "node:path";

// ── Key codes ─────────────────────────────────────────────────────────────────

export const KEY_CODES = {
	// Control keys
	CTRL_A: "\x01",
	CTRL_B: "\x02",
	CTRL_C: "\x03",
	CTRL_D: "\x04",
	CTRL_E: "\x05",
	CTRL_F: "\x06",
	CTRL_K: "\x0b",
	CTRL_L: "\x0c",
	CTRL_N: "\x0e",
	CTRL_P: "\x10",
	CTRL_R: "\x12",
	CTRL_U: "\x15",
	CTRL_W: "\x17",
	CTRL_Z: "\x1a",

	// Navigation
	ENTER: "\r",
	TAB: "\t",
	ESCAPE: "\x1b",
	BACKSPACE: "\x7f",
	DELETE: "\x1b[3~",

	// Arrow keys
	UP: "\x1b[A",
	DOWN: "\x1b[B",
	RIGHT: "\x1b[C",
	LEFT: "\x1b[D",

	// Modifiers + arrows
	SHIFT_UP: "\x1b[1;2A",
	SHIFT_DOWN: "\x1b[1;2B",
	SHIFT_RIGHT: "\x1b[1;2C",
	SHIFT_LEFT: "\x1b[1;2D",
	ALT_UP: "\x1b[1;3A",
	ALT_DOWN: "\x1b[1;3B",
	ALT_RIGHT: "\x1b[1;3C",
	ALT_LEFT: "\x1b[1;3D",
	CTRL_UP: "\x1b[1;5A",
	CTRL_DOWN: "\x1b[1;5B",
	CTRL_RIGHT: "\x1b[1;5C",
	CTRL_LEFT: "\x1b[1;5D",

	// Special
	HOME: "\x1b[H",
	END: "\x1b[F",
	PAGE_UP: "\x1b[5~",
	PAGE_DOWN: "\x1b[6~",
	INSERT: "\x1b[2~",

	// Function keys
	F1: "\x1bOP",
	F2: "\x1bOQ",
	F3: "\x1bOR",
	F4: "\x1bOS",
	F5: "\x1b[15~",
	F6: "\x1b[17~",
	F7: "\x1b[18~",
	F8: "\x1b[19~",
	F9: "\x1b[20~",
	F10: "\x1b[21~",
	F11: "\x1b[23~",
	F12: "\x1b[24~",
} as const;

// ── ANSI escape sequences ─────────────────────────────────────────────────────

export const ANSI = {
	// Cursor
	CURSOR_HOME: "\x1b[H",
	CURSOR_SAVE: "\x1b7",
	CURSOR_RESTORE: "\x1b8",
	CURSOR_SHOW: "\x1b[?25h",
	CURSOR_HIDE: "\x1b[?25l",
	CURSOR_BLINK_ON: "\x1b[?12h",
	CURSOR_BLINK_OFF: "\x1b[?12l",

	// Screen
	CLEAR_SCREEN: "\x1b[2J",
	CLEAR_LINE: "\x1b[2K",
	CLEAR_TO_END: "\x1b[J",
	CLEAR_TO_LINE_END: "\x1b[K",
	CLEAR_TO_LINE_START: "\x1b[1K",

	// Scrolling
	SCROLL_UP: "\x1b[S",
	SCROLL_DOWN: "\x1b[T",

	// Modes
	ALT_SCREEN_ON: "\x1b[?1049h",
	ALT_SCREEN_OFF: "\x1b[?1049l",
	MOUSE_ON: "\x1b[?1000h\x1b[?1006h",
	MOUSE_OFF: "\x1b[?1000l\x1b[?1006l",
	BRACKETED_PASTE_ON: "\x1b[?2004h",
	BRACKETED_PASTE_OFF: "\x1b[?2004l",

	// Style reset
	RESET: "\x1b[0m",
	BOLD: "\x1b[1m",
	DIM: "\x1b[2m",
	ITALIC: "\x1b[3m",
	UNDERLINE: "\x1b[4m",
	BLINK: "\x1b[5m",
	INVERSE: "\x1b[7m",
	HIDDEN: "\x1b[8m",
	STRIKETHROUGH: "\x1b[9m",

	// Reset individual
	RESET_BOLD: "\x1b[22m",
	RESET_DIM: "\x1b[22m",
	RESET_ITALIC: "\x1b[23m",
	RESET_UNDERLINE: "\x1b[24m",
	RESET_BLINK: "\x1b[25m",
	RESET_INVERSE: "\x1b[27m",
	RESET_HIDDEN: "\x1b[28m",
	RESET_STRIKETHROUGH: "\x1b[29m",
	RESET_FG: "\x1b[39m",
	RESET_BG: "\x1b[49m",
} as const;

// ── Limits ────────────────────────────────────────────────────────────────────

export const LIMITS = {
	/** Maximum terminal columns we support rendering to */
	MAX_COLS: 500,

	/** Maximum terminal rows we support rendering to */
	MAX_ROWS: 200,

	/** Maximum file size (bytes) for the read tool */
	MAX_FILE_SIZE: 10 * 1024 * 1024,

	/** Maximum line count for the read tool */
	MAX_FILE_LINES: 20_000,

	/** Maximum output size from bash tool (bytes) */
	MAX_BASH_OUTPUT: 100_000,

	/** Default bash command timeout (ms) */
	BASH_TIMEOUT: 120_000,

	/** Maximum conversation turns before auto-compact */
	MAX_TURNS: 100,

	/** Maximum message content length before truncation */
	MAX_MESSAGE_LENGTH: 500_000,

	/** Input history depth */
	INPUT_HISTORY_SIZE: 500,

	/** Maximum concurrent tool executions */
	MAX_PARALLEL_TOOLS: 8,

	/** SSE reconnect interval (ms) */
	SSE_RECONNECT_INTERVAL: 1000,

	/** SSE maximum reconnect attempts */
	SSE_MAX_RECONNECTS: 10,

	/** Minimum terminal width required */
	MIN_TERMINAL_WIDTH: 40,

	/** Minimum terminal height required */
	MIN_TERMINAL_HEIGHT: 10,
} as const;

// ── Telemetry (Phase 20) ──────────────────────────────────────────────────────

/** Telemetry directory for per-instance heartbeat files */
export const TELEMETRY_DIR =
	process.env.TAKUMI_TELEMETRY_DIR || path.join(os.homedir(), ".takumi", "telemetry", "instances");

/** Heartbeat emission interval (ms) */
export const TELEMETRY_HEARTBEAT_MS = 1500;

/** Context pressure threshold: "approaching_limit" (85%) */
export const TELEMETRY_CLOSE_PERCENT = 85;

/** Context pressure threshold: "near_limit" (95%) */
export const TELEMETRY_NEAR_PERCENT = 95;

/** Staleness threshold for telemetry snapshot (ms) */
export const TELEMETRY_STALE_MS = 10000;
