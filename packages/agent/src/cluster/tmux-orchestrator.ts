/**
 * Tmux Orchestrator — Phase 21.3: Side Agent Isolation
 *
 * Manages tmux windows for side agents, providing isolated terminal sessions
 * with output capture. Each side agent gets its own tmux window inside a shared
 * session, enabling parallel work with full terminal I/O.
 *
 * Uses `child_process.execFile` (promisified) for all tmux interactions —
 * no shell interpretation, which avoids injection risks.
 */

import { execFile } from "node:child_process";

/** Promise wrapper for execFile that preserves {stdout, stderr} shape. */
function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, (error, stdout, stderr) => {
			if (error) reject(error);
			else resolve({ stdout, stderr });
		});
	});
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TmuxWindow {
	sessionName: string;
	windowId: string;
	windowName: string;
	paneId: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SESSION_PREFIX = "takumi-agents";
const DEFAULT_CAPTURE_LINES = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Execute a tmux subcommand, returning stdout trimmed. */
async function tmux(...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("tmux", args);
	return stdout.trim();
}

/** Build a target specifier: `session:window.pane` */
function target(win: TmuxWindow): string {
	return `${win.sessionName}:${win.windowId}`;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class TmuxOrchestrator {
	private readonly sessionName: string;
	private readonly windows: Map<string, TmuxWindow> = new Map();
	private sessionCreated = false;

	constructor(sessionName?: string) {
		this.sessionName = sessionName ?? `${DEFAULT_SESSION_PREFIX}-${Date.now()}`;
	}

	// ── Static Queries ──────────────────────────────────────────────────────

	/** Check if tmux is available on the system. */
	static async isAvailable(): Promise<boolean> {
		try {
			await execFileAsync("tmux", ["-V"]);
			return true;
		} catch {
			return false;
		}
	}

	/** Check if we're currently inside a tmux session. */
	static isInsideTmux(): boolean {
		return typeof process.env.TMUX === "string" && process.env.TMUX.length > 0;
	}

	// ── Session Bootstrap ───────────────────────────────────────────────────

	/** Ensure the shared tmux session exists, creating it detached if needed. */
	private async ensureSession(): Promise<void> {
		if (this.sessionCreated) return;

		try {
			await tmux("has-session", "-t", this.sessionName);
			this.sessionCreated = true;
		} catch {
			// Session doesn't exist — create it detached.
			await tmux("new-session", "-d", "-s", this.sessionName);
			this.sessionCreated = true;
		}
	}

	// ── Window Lifecycle ────────────────────────────────────────────────────

	/** Create a new tmux window for a side agent. */
	async createWindow(agentId: string, cwd: string, command?: string): Promise<TmuxWindow> {
		if (this.windows.has(agentId)) {
			throw new Error(`Tmux window already exists for agent "${agentId}"`);
		}

		await this.ensureSession();

		const windowName = `agent-${agentId}`;
		const args = [
			"new-window",
			"-t",
			this.sessionName,
			"-n",
			windowName,
			"-c",
			cwd,
			"-P",
			"-F",
			"#{window_id}:#{pane_id}",
		];

		if (command) {
			args.push(command);
		}

		const raw = await tmux(...args);
		// Output format: "@<window_id>:%<pane_id>" — e.g. "@1:%3"
		const parts = raw.split(":");
		const windowId = parts[0] ?? raw;
		const paneId = parts[1] ?? "0";

		const win: TmuxWindow = {
			sessionName: this.sessionName,
			windowId,
			windowName,
			paneId,
		};

		this.windows.set(agentId, win);
		return win;
	}

	/** Send a command/text to a tmux window pane, followed by Enter. */
	async sendKeys(agentId: string, text: string): Promise<void> {
		const win = this.requireWindow(agentId);
		await tmux("send-keys", "-t", target(win), text, "Enter");
	}

	/**
	 * Capture visible output from a tmux window pane.
	 * @param agentId  Side agent identifier
	 * @param lines    Number of scrollback lines to capture (default 500)
	 */
	async captureOutput(agentId: string, lines?: number): Promise<string> {
		const win = this.requireWindow(agentId);
		const count = lines ?? DEFAULT_CAPTURE_LINES;
		return tmux("capture-pane", "-t", target(win), "-p", "-S", `-${count}`);
	}

	/** Kill a tmux window, removing it from the managed set. */
	async killWindow(agentId: string): Promise<void> {
		const win = this.windows.get(agentId);
		if (!win) return; // idempotent — already gone

		try {
			await tmux("kill-window", "-t", target(win));
		} catch {
			// Window may already be dead — swallow error.
		}

		this.windows.delete(agentId);
	}

	// ── Queries ─────────────────────────────────────────────────────────────

	/** Return all managed windows (read-only snapshot). */
	getWindows(): Map<string, TmuxWindow> {
		return new Map(this.windows);
	}

	/** Check whether a managed window is still alive in tmux. */
	async isWindowAlive(agentId: string): Promise<boolean> {
		const win = this.windows.get(agentId);
		if (!win) return false;

		try {
			const output = await tmux("list-windows", "-t", win.sessionName, "-F", "#{window_id}");
			const ids = output.split("\n").map((l) => l.trim());
			return ids.includes(win.windowId);
		} catch {
			return false;
		}
	}

	// ── Cleanup ─────────────────────────────────────────────────────────────

	/** Kill all managed windows and destroy the session if we created it. */
	async cleanup(): Promise<void> {
		const ids = [...this.windows.keys()];
		await Promise.allSettled(ids.map((id) => this.killWindow(id)));

		if (this.sessionCreated) {
			try {
				await tmux("kill-session", "-t", this.sessionName);
			} catch {
				// Session may already be gone.
			}
			this.sessionCreated = false;
		}
	}

	// ── Internal ────────────────────────────────────────────────────────────

	/** Retrieve a managed window or throw. */
	private requireWindow(agentId: string): TmuxWindow {
		const win = this.windows.get(agentId);
		if (!win) {
			throw new Error(`No tmux window found for agent "${agentId}"`);
		}
		return win;
	}
}
