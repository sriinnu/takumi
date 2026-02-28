/**
 * Renderer — the Kagami (鏡) pipeline orchestrator.
 *
 * Central entry-point for the rendering engine. Owns terminal
 * initialization (alternate screen, raw mode, cursor, mouse),
 * the RenderScheduler, resize handling, and graceful teardown.
 *
 * This provides a high-level API so the TUI application doesn't
 * need to manage ANSI escape sequences or RenderScheduler details.
 *
 * Pipeline: Signal Change → Dirty → Yoga Layout → Render → Diff → ANSI → Flush
 */

import type { Size } from "@takumi/core";
import { ANSI, createLogger } from "@takumi/core";
import type { Component } from "./component.js";
import { RenderScheduler } from "./reconciler.js";
import type { Screen } from "./screen.js";
import { beginSyncUpdate, detectCapabilities, endSyncUpdate, type TerminalCapabilities } from "./terminal.js";

const log = createLogger("renderer");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RendererOptions {
	/** Target frames per second (default: 60). */
	fps?: number;
	/** Standard input stream (default: process.stdin). */
	stdin?: NodeJS.ReadStream;
	/** Standard output stream (default: process.stdout). */
	stdout?: NodeJS.WriteStream;
	/** Enable mouse tracking (default: true). */
	mouse?: boolean;
	/** Enable bracketed paste mode (default: true). */
	bracketedPaste?: boolean;
	/** Use synchronized output when the terminal supports it (default: true). */
	synchronizedOutput?: boolean;
	/** Custom environment for terminal detection (default: process.env). */
	env?: Record<string, string | undefined>;
}

export interface RendererStats {
	frameCount: number;
	terminalSize: Size;
	capabilities: TerminalCapabilities;
	running: boolean;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export class Renderer {
	private scheduler: RenderScheduler;
	private stdin: NodeJS.ReadStream;
	private stdout: NodeJS.WriteStream;
	private running = false;
	private disposed = false;
	private mouseEnabled: boolean;
	private bracketedPasteEnabled: boolean;
	private useSyncOutput: boolean;

	readonly capabilities: TerminalCapabilities;

	constructor(options?: RendererOptions) {
		this.stdin = options?.stdin ?? (process.stdin as NodeJS.ReadStream);
		this.stdout = options?.stdout ?? (process.stdout as NodeJS.WriteStream);
		this.mouseEnabled = options?.mouse ?? true;
		this.bracketedPasteEnabled = options?.bracketedPaste ?? true;

		// Detect terminal capabilities
		const env = options?.env ?? (process.env as Record<string, string | undefined>);
		this.capabilities = detectCapabilities(env);
		this.useSyncOutput = (options?.synchronizedOutput ?? true) && this.capabilities.synchronizedOutput;

		log.info(`Terminal: ${this.capabilities.name}`, {
			truecolor: this.capabilities.truecolor,
			syncOutput: this.useSyncOutput,
		});

		// Create scheduler
		const size = this.getTerminalSize();
		const writeFn = this.useSyncOutput
			? (data: string) => this.write(beginSyncUpdate() + data + endSyncUpdate())
			: (data: string) => this.write(data);

		this.scheduler = new RenderScheduler(size.width, size.height, {
			fps: options?.fps,
			write: writeFn,
		});
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Enter the rendering mode.
	 * Switches to alternate screen, hides cursor, enables raw mode,
	 * sets up mouse/paste/resize listeners, and starts the render loop.
	 */
	start(root: Component): void {
		if (this.disposed) throw new Error("Renderer has been disposed");
		if (this.running) return;

		log.info("Starting renderer");

		// Terminal setup
		this.write(ANSI.ALT_SCREEN_ON);
		this.write(ANSI.CURSOR_HIDE);
		if (this.mouseEnabled) this.write(ANSI.MOUSE_ON);
		if (this.bracketedPasteEnabled) this.write(ANSI.BRACKETED_PASTE_ON);
		this.enableRawMode();

		// Resize handler
		process.on("SIGWINCH", this.onResize);

		// Mount root and start
		this.scheduler.setRoot(root);
		this.running = true;
		this.scheduler.start();

		log.info("Renderer started", this.getTerminalSize());
	}

	/**
	 * Gracefully stop the renderer and restore the terminal.
	 * Restores cursor, exits alternate screen, disables raw mode.
	 * Safe to call multiple times.
	 */
	stop(): void {
		if (!this.running) return;
		this.running = false;

		log.info("Stopping renderer");

		this.scheduler.stop();
		process.removeListener("SIGWINCH", this.onResize);

		// Restore terminal
		if (this.bracketedPasteEnabled) this.write(ANSI.BRACKETED_PASTE_OFF);
		if (this.mouseEnabled) this.write(ANSI.MOUSE_OFF);
		this.write(ANSI.CURSOR_SHOW);
		this.write(ANSI.ALT_SCREEN_OFF);
		this.disableRawMode();
	}

	/**
	 * Stop and permanently dispose the renderer.
	 * After disposal, the renderer cannot be restarted.
	 */
	dispose(): void {
		this.stop();
		this.disposed = true;
	}

	// ── Root component ────────────────────────────────────────────────────

	/** Replace the root component. Triggers a full re-render. */
	setRoot(component: Component): void {
		this.scheduler.setRoot(component);
	}

	// ── Render control ────────────────────────────────────────────────────

	/** Request a render on the next frame (debounced). */
	scheduleRender(): void {
		this.scheduler.scheduleRender();
	}

	/** Force an immediate synchronous render. */
	forceRender(): void {
		this.scheduler.forceRender();
	}

	/**
	 * Force a full-screen invalidation and re-render.
	 * Useful after external terminal corruption (e.g. subprocess output).
	 */
	invalidate(): void {
		this.scheduler.getScreen().invalidate();
		this.scheduler.scheduleRender();
	}

	// ── Screen access ─────────────────────────────────────────────────────

	/** Get the underlying screen for direct cell manipulation. */
	getScreen(): Screen {
		return this.scheduler.getScreen();
	}

	// ── Terminal info ─────────────────────────────────────────────────────

	/** Get the current terminal dimensions. */
	getTerminalSize(): Size {
		return {
			width: this.stdout.columns ?? 80,
			height: this.stdout.rows ?? 24,
		};
	}

	/** Get renderer statistics. */
	getStats(): RendererStats {
		const schedulerStats = this.scheduler.getStats();
		return {
			frameCount: schedulerStats.frameCount,
			terminalSize: schedulerStats.screenSize as Size,
			capabilities: this.capabilities,
			running: this.running,
		};
	}

	/** Whether the renderer is currently running. */
	get isRunning(): boolean {
		return this.running;
	}

	// ── Internal helpers ──────────────────────────────────────────────────

	private write(data: string): void {
		(this.stdout as any).write(data);
	}

	private enableRawMode(): void {
		if (typeof (this.stdin as any).setRawMode === "function") {
			(this.stdin as any).setRawMode(true);
			(this.stdin as any).resume?.();
		}
	}

	private disableRawMode(): void {
		if (typeof (this.stdin as any).setRawMode === "function") {
			(this.stdin as any).setRawMode(false);
		}
	}

	private readonly onResize = (): void => {
		const { width, height } = this.getTerminalSize();
		log.info(`Resize: ${width}x${height}`);
		this.scheduler.resize(width, height);
	};
}
