/**
 * Process Orchestrator — cross-platform fallback for tmux.
 *
 * When tmux is unavailable (Windows, containers, etc.) provides isolated
 * child processes for side agents with output capture via Node child_process.
 * API mirrors TmuxOrchestrator for drop-in substitution.
 *
 * @module
 */

import { type ChildProcess, execFile } from "node:child_process";
import { resolveExeName } from "@takumi/core";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProcessWindow {
	id: string;
	name: string;
	process: ChildProcess | null;
	output: string[];
	exitCode: number | null;
}

const MAX_CAPTURE_LINES = 500;

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class ProcessOrchestrator {
	private readonly windows = new Map<string, ProcessWindow>();
	private counter = 0;

	/** Create a new isolated process "window" running a command. */
	async createWindow(name: string, command: string, args: string[] = [], cwd?: string): Promise<ProcessWindow> {
		const id = `proc-${++this.counter}`;
		const win: ProcessWindow = { id, name, process: null, output: [], exitCode: null };
		this.windows.set(id, win);

		const resolvedCmd = resolveExeName(command);
		const child = execFile(resolvedCmd, args, {
			cwd,
			maxBuffer: 10 * 1024 * 1024,
			timeout: 0,
		});

		win.process = child;

		const capture = (data: Buffer | string) => {
			const lines = String(data).split("\n");
			for (const line of lines) {
				if (line) {
					win.output.push(line);
					if (win.output.length > MAX_CAPTURE_LINES) {
						win.output.shift();
					}
				}
			}
		};

		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		child.on("exit", (code) => {
			win.exitCode = code ?? 1;
			win.process = null;
		});
		child.on("error", () => {
			win.exitCode = 1;
			win.process = null;
		});

		return win;
	}

	/** Send a command string to a running process via stdin. */
	sendKeys(id: string, text: string): void {
		const win = this.windows.get(id);
		if (win?.process?.stdin?.writable) {
			win.process.stdin.write(text);
		}
	}

	/** Capture recent output from a process window. */
	captureOutput(id: string, lines = MAX_CAPTURE_LINES): string {
		const win = this.windows.get(id);
		if (!win) return "";
		return win.output.slice(-lines).join("\n");
	}

	/** Kill a running process window. */
	async killWindow(id: string): Promise<void> {
		const win = this.windows.get(id);
		if (!win) return;
		if (win.process && !win.process.killed) {
			win.process.kill("SIGTERM");
			// Give 2s for graceful shutdown, then force
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					if (win.process && !win.process.killed) {
						win.process.kill("SIGKILL");
					}
					resolve();
				}, 2000);
				if (win.process) {
					win.process.on("exit", () => {
						clearTimeout(timer);
						resolve();
					});
				} else {
					clearTimeout(timer);
					resolve();
				}
			});
		}
		this.windows.delete(id);
	}

	/** Destroy all running processes. */
	async destroyAll(): Promise<void> {
		const ids = [...this.windows.keys()];
		await Promise.all(ids.map((id) => this.killWindow(id)));
	}

	/** List all active windows. */
	listWindows(): ProcessWindow[] {
		return [...this.windows.values()];
	}

	/** Check if there are any running processes. */
	get hasRunning(): boolean {
		return [...this.windows.values()].some((w) => w.process !== null);
	}

	/** Static check — always available (it's pure Node.js). */
	static async isAvailable(): Promise<boolean> {
		return true;
	}
}
