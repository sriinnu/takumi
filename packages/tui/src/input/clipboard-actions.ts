/**
 * Terminal clipboard layer.
 *
 * Terminals expose two clipboard paths — I try both, in order:
 *
 * 1. **In-band (OSC 52)** — an escape sequence written to stdout.
 *    Non-blocking, no child process, works over SSH. Preferred path.
 *
 * 2. **Out-of-band (shell exec)** — spawning pbcopy/pbpaste on macOS,
 *    xclip on Linux. This is synchronous IPC and fundamentally dangerous
 *    in a single-threaded event loop: if the tool hangs (modal dialog,
 *    broken pipe, D-Bus timeout), the entire TUI freezes. I guard this
 *    with a hard timeout and a byte ceiling on the read buffer.
 *
 * There's a third inbound path — **bracketed paste** — where the terminal
 * wraps CMD+V content in escape delimiters (\x1b[200~ ... \x1b[201~).
 * I strip those delimiters and return the clean text.
 */

import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { IS_LINUX, IS_MACOS } from "@takumi/core";
import { copyToClipboard, supportsOsc52 } from "@takumi/render";

// ── Bracketed paste delimiters ──────────────────────────────────────

/**
 * Bracketed paste delimiters per DEC private mode 2004.
 * Exported for the input handler's cross-chunk paste accumulator.
 */
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

// ── Shell clipboard provider ────────────────────────────────────────

/** Platform-specific binaries and arguments for shell clipboard access. */
interface ShellClipboardProvider {
	readonly read: { binary: string; args: string[] };
	readonly write: { binary: string; args: string[] };
}

/**
 * Resolved once at module load. `null` on platforms where I don't have
 * a known clipboard tool (Windows, headless containers, etc.).
 */
const SHELL_PROVIDER: ShellClipboardProvider | null = IS_MACOS
	? { read: { binary: "pbpaste", args: [] }, write: { binary: "pbcopy", args: [] } }
	: IS_LINUX
		? {
				read: { binary: "xclip", args: ["-selection", "clipboard", "-o"] },
				write: { binary: "xclip", args: ["-selection", "clipboard"] },
			}
		: null;

/**
 * Execution contract for shell clipboard commands.
 *
 * - **timeout 3 s**: generous for local IPC — if the tool hasn't responded
 *   by then, something is genuinely wrong (modal dialog, broken pipe).
 * - **maxBuffer 1 MB**: byte-level ceiling at the I/O boundary so I never
 *   allocate unbounded memory from a child process pipe. The input handler
 *   applies a tighter character-level cap downstream.
 */
const SHELL_EXEC_OPTS: ExecFileSyncOptions = {
	encoding: "utf-8",
	timeout: 3_000,
	maxBuffer: 1024 * 1024,
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Strip bracketed paste delimiters from raw terminal input.
 * Returns the cleaned text when paste markers were found, `null` otherwise.
 */
export function extractBracketedPaste(raw: string): string | null {
	if (!raw.includes(PASTE_START)) return null;
	return raw.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "");
}

/**
 * Write text to the system clipboard.
 * Tries OSC 52 first (non-blocking), falls back to shell exec.
 */
export function copyToSystemClipboard(text: string, write: (data: string) => void): boolean {
	if (supportsOsc52()) {
		write(copyToClipboard(text));
		return true;
	}
	if (!SHELL_PROVIDER) return false;
	try {
		execFileSync(SHELL_PROVIDER.write.binary, SHELL_PROVIDER.write.args, {
			...SHELL_EXEC_OPTS,
			input: text,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Read text from the system clipboard via shell fallback.
 * Returns `null` when no shell provider exists or the command fails/times out.
 */
export function readFromSystemClipboard(): string | null {
	if (!SHELL_PROVIDER) return null;
	try {
		return execFileSync(SHELL_PROVIDER.read.binary, SHELL_PROVIDER.read.args, SHELL_EXEC_OPTS) as string;
	} catch {
		return null;
	}
}
