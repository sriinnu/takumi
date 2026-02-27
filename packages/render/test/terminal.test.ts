/**
 * Tests for terminal capability detection.
 */

import { describe, expect, it } from "vitest";
import {
	beginSyncUpdate,
	detectCapabilities,
	detectTerminal,
	endSyncUpdate,
	supportsOsc52,
	supportsTruecolor,
	terminalSummary,
} from "../src/terminal.js";

// ── detectTerminal ────────────────────────────────────────────────────────────

describe("detectTerminal", () => {
	it("detects Ghostty via TERM_PROGRAM", () => {
		expect(detectTerminal({ TERM_PROGRAM: "ghostty" })).toBe("ghostty");
	});

	it("detects Ghostty via GHOSTTY_RESOURCES_DIR", () => {
		expect(detectTerminal({ GHOSTTY_RESOURCES_DIR: "/usr/share/ghostty" })).toBe("ghostty");
	});

	it("detects kitty via KITTY_PID", () => {
		expect(detectTerminal({ KITTY_PID: "12345" })).toBe("kitty");
	});

	it("detects kitty via KITTY_WINDOW_ID", () => {
		expect(detectTerminal({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
	});

	it("detects iTerm2 via TERM_PROGRAM", () => {
		expect(detectTerminal({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm2");
	});

	it("detects iTerm2 via ITERM_SESSION_ID", () => {
		expect(detectTerminal({ ITERM_SESSION_ID: "w0t0p0:ABC123" })).toBe("iterm2");
	});

	it("detects WezTerm via TERM_PROGRAM", () => {
		expect(detectTerminal({ TERM_PROGRAM: "WezTerm" })).toBe("wezterm");
	});

	it("detects WezTerm via WEZTERM_PANE", () => {
		expect(detectTerminal({ WEZTERM_PANE: "0" })).toBe("wezterm");
	});

	it("detects Alacritty via ALACRITTY_WINDOW_ID", () => {
		expect(detectTerminal({ ALACRITTY_WINDOW_ID: "1234" })).toBe("alacritty");
	});

	it("detects Alacritty via ALACRITTY_LOG", () => {
		expect(detectTerminal({ ALACRITTY_LOG: "/tmp/alacritty.log" })).toBe("alacritty");
	});

	it("detects Windows Terminal via WT_SESSION", () => {
		expect(detectTerminal({ WT_SESSION: "abc-123" })).toBe("windows-terminal");
	});

	it("detects foot via FOOT_TERM", () => {
		expect(detectTerminal({ FOOT_TERM: "foot" })).toBe("foot");
	});

	it("detects tmux via TERM_PROGRAM", () => {
		expect(detectTerminal({ TERM_PROGRAM: "tmux" })).toBe("tmux");
	});

	it("detects tmux via TMUX env var", () => {
		expect(detectTerminal({ TMUX: "/tmp/tmux-1000/default,1234,0" })).toBe("tmux");
	});

	it("detects screen via STY", () => {
		expect(detectTerminal({ STY: "1234.session" })).toBe("screen");
	});

	it("detects Apple Terminal via TERM_PROGRAM", () => {
		expect(detectTerminal({ TERM_PROGRAM: "Apple_Terminal" })).toBe("apple-terminal");
	});

	it("detects VTE-based terminals", () => {
		expect(detectTerminal({ VTE_VERSION: "7200" })).toBe("vte");
	});

	it("falls back to xterm for xterm-256color", () => {
		expect(detectTerminal({ TERM: "xterm-256color" })).toBe("xterm");
	});

	it("returns unknown for empty env", () => {
		expect(detectTerminal({})).toBe("unknown");
	});

	it("is case-insensitive for TERM_PROGRAM", () => {
		expect(detectTerminal({ TERM_PROGRAM: "Ghostty" })).toBe("ghostty");
	});

	it("TERM_PROGRAM takes priority over env vars", () => {
		// If WezTerm sets TERM_PROGRAM=WezTerm but KITTY_PID is also set,
		// TERM_PROGRAM should win
		expect(detectTerminal({ TERM_PROGRAM: "WezTerm", KITTY_PID: "123" })).toBe("wezterm");
	});
});

// ── detectCapabilities ────────────────────────────────────────────────────────

describe("detectCapabilities", () => {
	it("returns full capabilities for Ghostty", () => {
		const caps = detectCapabilities({ TERM_PROGRAM: "ghostty" });
		expect(caps.name).toBe("ghostty");
		expect(caps.truecolor).toBe(true);
		expect(caps.osc52).toBe(true);
		expect(caps.hyperlinks).toBe(true);
		expect(caps.kittyKeyboard).toBe(true);
		expect(caps.synchronizedOutput).toBe(true);
		expect(caps.focusEvents).toBe(true);
		expect(caps.unicodeWidthReliable).toBe(true);
	});

	it("returns full capabilities for kitty", () => {
		const caps = detectCapabilities({ KITTY_PID: "123" });
		expect(caps.name).toBe("kitty");
		expect(caps.truecolor).toBe(true);
		expect(caps.kittyImages).toBe(true);
		expect(caps.kittyKeyboard).toBe(true);
	});

	it("returns iTerm2 image support for iTerm2", () => {
		const caps = detectCapabilities({ ITERM_SESSION_ID: "sess" });
		expect(caps.name).toBe("iterm2");
		expect(caps.iterm2Images).toBe(true);
		expect(caps.truecolor).toBe(true);
	});

	it("returns sixel support for WezTerm", () => {
		const caps = detectCapabilities({ WEZTERM_PANE: "0" });
		expect(caps.name).toBe("wezterm");
		expect(caps.sixel).toBe(true);
		expect(caps.kittyImages).toBe(true);
		expect(caps.iterm2Images).toBe(true);
	});

	it("returns sixel support for foot", () => {
		const caps = detectCapabilities({ FOOT_TERM: "foot" });
		expect(caps.name).toBe("foot");
		expect(caps.sixel).toBe(true);
	});

	it("detects truecolor via COLORTERM", () => {
		const caps = detectCapabilities({ COLORTERM: "truecolor", TERM: "xterm-256color" });
		expect(caps.truecolor).toBe(true);
	});

	it("detects truecolor via 24bit COLORTERM", () => {
		const caps = detectCapabilities({ COLORTERM: "24bit", TERM: "xterm" });
		expect(caps.truecolor).toBe(true);
	});

	it("Apple Terminal has limited capabilities", () => {
		const caps = detectCapabilities({ TERM_PROGRAM: "Apple_Terminal" });
		expect(caps.name).toBe("apple-terminal");
		expect(caps.truecolor).toBe(false);
		expect(caps.osc52).toBe(false);
		expect(caps.hyperlinks).toBe(false);
		expect(caps.bracketedPaste).toBe(true); // basic support
	});

	it("unknown terminal has conservative defaults", () => {
		const caps = detectCapabilities({});
		expect(caps.name).toBe("unknown");
		expect(caps.truecolor).toBe(false);
		expect(caps.osc52).toBe(false);
		expect(caps.kittyImages).toBe(false);
		expect(caps.iterm2Images).toBe(false);
		expect(caps.sixel).toBe(false);
	});

	it("preserves raw env values in caps", () => {
		const caps = detectCapabilities({
			TERM_PROGRAM: "ghostty",
			TERM: "xterm-ghostty",
			COLORTERM: "truecolor",
		});
		expect(caps.termProgram).toBe("ghostty");
		expect(caps.term).toBe("xterm-ghostty");
		expect(caps.colorTerm).toBe("truecolor");
	});

	it("Alacritty supports OSC 52 but not images", () => {
		const caps = detectCapabilities({ ALACRITTY_WINDOW_ID: "1" });
		expect(caps.osc52).toBe(true);
		expect(caps.kittyImages).toBe(false);
		expect(caps.iterm2Images).toBe(false);
		expect(caps.sixel).toBe(false);
	});

	it("tmux supports OSC 52 passthrough", () => {
		const caps = detectCapabilities({ TMUX: "/tmp/tmux" });
		expect(caps.osc52).toBe(true);
		expect(caps.truecolor).toBe(true);
	});

	it("Windows Terminal supports hyperlinks", () => {
		const caps = detectCapabilities({ WT_SESSION: "wt-id" });
		expect(caps.hyperlinks).toBe(true);
		expect(caps.truecolor).toBe(true);
	});
});

// ── Convenience helpers ───────────────────────────────────────────────────────

describe("supportsTruecolor", () => {
	it("returns true for Ghostty", () => {
		expect(supportsTruecolor({ TERM_PROGRAM: "ghostty" })).toBe(true);
	});

	it("returns false for Apple Terminal", () => {
		expect(supportsTruecolor({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
	});
});

describe("supportsOsc52", () => {
	it("returns true for kitty", () => {
		expect(supportsOsc52({ KITTY_PID: "1" })).toBe(true);
	});

	it("returns false for unknown", () => {
		expect(supportsOsc52({})).toBe(false);
	});
});

// ── Synchronized output ───────────────────────────────────────────────────────

describe("synchronizedOutput", () => {
	it("beginSyncUpdate returns mode 2026h", () => {
		expect(beginSyncUpdate()).toBe("\x1b[?2026h");
	});

	it("endSyncUpdate returns mode 2026l", () => {
		expect(endSyncUpdate()).toBe("\x1b[?2026l");
	});
});

// ── terminalSummary ───────────────────────────────────────────────────────────

describe("terminalSummary", () => {
	it("produces a compact summary with flags", () => {
		const caps = detectCapabilities({ TERM_PROGRAM: "ghostty" });
		const summary = terminalSummary(caps);
		expect(summary).toContain("ghostty");
		expect(summary).toContain("rgb");
		expect(summary).toContain("clip");
		expect(summary).toContain("sync");
	});

	it("produces a clean summary for minimal caps", () => {
		const caps = detectCapabilities({});
		const summary = terminalSummary(caps);
		expect(summary).toBe("unknown");
	});

	it("shows kitty image flag for kitty", () => {
		const caps = detectCapabilities({ KITTY_PID: "1" });
		const summary = terminalSummary(caps);
		expect(summary).toContain("kitty-img");
	});

	it("shows sixel flag for WezTerm", () => {
		const caps = detectCapabilities({ WEZTERM_PANE: "0" });
		const summary = terminalSummary(caps);
		expect(summary).toContain("sixel");
	});
});
