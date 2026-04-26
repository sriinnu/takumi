/**
 * Orchestrator Factory — picks the right side-agent orchestrator for the
 * current platform. Prefers tmux when available, falls back to
 * ProcessOrchestrator on Windows / containers / CI.
 *
 * @module
 */

import { ProcessOrchestrator } from "./process-orchestrator.js";
import { TmuxOrchestrator } from "./tmux-orchestrator.js";

// ── Shared interface ──────────────────────────────────────────────────────────

/**
 * Thin common interface consumed by side-agent tooling.
 * Both TmuxOrchestrator and ProcessOrchestrator satisfy this shape.
 * @deprecated Use {@link MuxAdapter} from `./mux-adapter.js` instead.
 */
export interface Orchestrator {
	createWindow(name: string, ...rest: unknown[]): Promise<unknown>;
	sendKeys(id: string, text: string): void | Promise<void>;
	captureOutput(id: string, lines?: number): string | Promise<string>;
	isWindowAlive(id: string): boolean | Promise<boolean>;
	killWindow(id: string): Promise<void>;
	/** Wait for a named tmux channel signal. Returns false on timeout/abort/unsupported. */
	waitForChannel?(channel: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create the best available orchestrator.
 *
 * 1. If tmux is present and we're not on Windows → TmuxOrchestrator
 * 2. Otherwise → ProcessOrchestrator (Node child_process, always available)
 */
export async function createOrchestrator(sessionName?: string): Promise<TmuxOrchestrator | ProcessOrchestrator> {
	if (process.platform !== "win32" && (await TmuxOrchestrator.isAvailable())) {
		return new TmuxOrchestrator(sessionName);
	}
	return new ProcessOrchestrator();
}
