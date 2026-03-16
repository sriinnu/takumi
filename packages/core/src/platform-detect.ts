/**
 * Cross-platform terminal and OS detection.
 *
 * Centralises all `process.platform` branching so the rest of the codebase
 * can call typed helpers instead of scattering raw platform checks everywhere.
 *
 * @module
 */

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

// ── OS identification ─────────────────────────────────────────────────────────

export type PlatformId = "macos" | "linux" | "windows" | "unknown";

export function currentPlatform(): PlatformId {
	switch (process.platform) {
		case "darwin":
			return "macos";
		case "linux":
			return "linux";
		case "win32":
			return "windows";
		default:
			return "unknown";
	}
}

export const IS_MACOS = process.platform === "darwin";
export const IS_LINUX = process.platform === "linux";
export const IS_WINDOWS = process.platform === "win32";

// ── WSL detection ─────────────────────────────────────────────────────────────

let wslCached: boolean | null = null;

/** Returns true when running inside Windows Subsystem for Linux. */
export function isWSL(): boolean {
	if (wslCached !== null) return wslCached;
	if (!IS_LINUX) {
		wslCached = false;
		return false;
	}
	try {
		const release = os.release().toLowerCase();
		wslCached = release.includes("microsoft") || release.includes("wsl");
	} catch {
		wslCached = false;
	}
	return wslCached;
}

// ── Terminal emulator detection ───────────────────────────────────────────────

export type TerminalId =
	| "ghostty"
	| "kitty"
	| "alacritty"
	| "iterm2"
	| "wezterm"
	| "windows-terminal"
	| "terminal-app"
	| "tmux"
	| "screen"
	| "vscode"
	| "powershell"
	| "cmd"
	| "unknown";

/** Best-effort detection of the user's terminal emulator from env vars. */
export function detectTerminal(): TerminalId {
	const env = process.env;

	// Multiplexer detection first (user may be inside tmux inside another term)
	if (env.TMUX) return "tmux";
	if (env.STY) return "screen";

	// VS Code integrated terminal
	if (env.TERM_PROGRAM === "vscode") return "vscode";

	// Known terminal emulators
	if (env.GHOSTTY_RESOURCES_DIR || env.TERM_PROGRAM === "ghostty") return "ghostty";
	if (env.KITTY_PID || env.TERM_PROGRAM === "kitty") return "kitty";
	if (env.ALACRITTY_LOG || env.TERM_PROGRAM === "alacritty") return "alacritty";
	if (env.TERM_PROGRAM === "iTerm.app") return "iterm2";
	if (env.WEZTERM_EXECUTABLE || env.TERM_PROGRAM === "WezTerm") return "wezterm";

	// Windows Terminal
	if (env.WT_SESSION) return "windows-terminal";

	// macOS Terminal.app fallback
	if (env.TERM_PROGRAM === "Apple_Terminal") return "terminal-app";

	// Windows shells (when not inside Windows Terminal)
	if (IS_WINDOWS) {
		if (env.PSModulePath) return "powershell";
		if (env.PROMPT) return "cmd";
	}

	return "unknown";
}

// ── Shell detection ───────────────────────────────────────────────────────────

export type ShellId = "zsh" | "bash" | "fish" | "powershell" | "pwsh" | "cmd" | "nushell" | "unknown";

/** Detect the user's current shell. */
export function detectShell(): ShellId {
	const shell = process.env.SHELL ?? process.env.ComSpec ?? "";
	const base = path
		.basename(shell)
		.toLowerCase()
		.replace(/\.exe$/, "");

	const known: Record<string, ShellId> = {
		zsh: "zsh",
		bash: "bash",
		fish: "fish",
		pwsh: "pwsh",
		powershell: "powershell",
		cmd: "cmd",
		nu: "nushell",
		nushell: "nushell",
	};

	return known[base] ?? "unknown";
}

// ── Capability probes (async) ─────────────────────────────────────────────────

function execProbe(cmd: string, args: string[]): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const child = execFile(cmd, args, { timeout: 2000 }, (err) => {
			resolve(!err);
		});
		child.on("error", () => resolve(false));
	});
}

/** Check if tmux is installed and reachable. */
export async function hasTmux(): Promise<boolean> {
	return execProbe("tmux", ["-V"]);
}

/** Check if git is installed and reachable. */
export async function hasGit(): Promise<boolean> {
	return execProbe("git", ["--version"]);
}

/** Check if Docker is available. */
export async function hasDocker(): Promise<boolean> {
	return execProbe("docker", ["--version"]);
}

// ── Config path resolution ────────────────────────────────────────────────────

/**
 * Resolve the Takumi config/data directory per platform.
 *
 * macOS:   ~/Library/Application Support/takumi
 * Linux:   $XDG_CONFIG_HOME/takumi or ~/.config/takumi
 * Windows: %APPDATA%/takumi
 */
export function resolveConfigDir(): string {
	if (process.env.TAKUMI_CONFIG_DIR) return process.env.TAKUMI_CONFIG_DIR;

	const home = os.homedir();

	if (IS_MACOS) return path.join(home, "Library", "Application Support", "takumi");
	if (IS_WINDOWS) return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "takumi");
	// Linux / other
	return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "takumi");
}

/**
 * Resolve the Takumi cache directory.
 *
 * macOS:   ~/Library/Caches/takumi
 * Linux:   $XDG_CACHE_HOME/takumi or ~/.cache/takumi
 * Windows: %LOCALAPPDATA%/takumi/cache
 */
export function resolveCacheDir(): string {
	if (process.env.TAKUMI_CACHE_DIR) return process.env.TAKUMI_CACHE_DIR;

	const home = os.homedir();

	if (IS_MACOS) return path.join(home, "Library", "Caches", "takumi");
	if (IS_WINDOWS) return path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "takumi", "cache");
	return path.join(process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "takumi");
}

// ── Platform summary (for agent context / doctor) ─────────────────────────────

export interface PlatformSummary {
	os: PlatformId;
	arch: string;
	release: string;
	wsl: boolean;
	terminal: TerminalId;
	shell: ShellId;
	nodeVersion: string;
	hasTmux: boolean;
	hasGit: boolean;
	hasDocker: boolean;
}

/** Collect a full platform summary (probes are async). */
export async function collectPlatformSummary(): Promise<PlatformSummary> {
	const [tmux, git, docker] = await Promise.all([hasTmux(), hasGit(), hasDocker()]);
	return {
		os: currentPlatform(),
		arch: process.arch,
		release: os.release(),
		wsl: isWSL(),
		terminal: detectTerminal(),
		shell: detectShell(),
		nodeVersion: process.version,
		hasTmux: tmux,
		hasGit: git,
		hasDocker: docker,
	};
}
