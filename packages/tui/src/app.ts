/**
 * TakumiApp — the root application class.
 *
 * Manages the lifecycle of the TUI: terminal setup, render loop,
 * input handling, and agent interaction.
 */

import type { TakumiConfig, KeyEvent, AgentEvent } from "@takumi/core";
import { ANSI, LIMITS, createLogger } from "@takumi/core";
import { RenderScheduler, initYoga } from "@takumi/render";
import { AppState } from "./state.js";
import { KeyBindingRegistry } from "./keybinds.js";
import { SlashCommandRegistry } from "./commands.js";

const log = createLogger("app");

export interface TakumiAppOptions {
	config: TakumiConfig;
	stdin?: NodeJS.ReadableStream;
	stdout?: NodeJS.WritableStream;
}

export class TakumiApp {
	readonly config: TakumiConfig;
	readonly state: AppState;
	readonly keybinds: KeyBindingRegistry;
	readonly commands: SlashCommandRegistry;

	private scheduler: RenderScheduler | null = null;
	private stdin: NodeJS.ReadableStream;
	private stdout: NodeJS.WritableStream;
	private running = false;

	constructor(options: TakumiAppOptions) {
		this.config = options.config;
		this.stdin = options.stdin ?? process.stdin;
		this.stdout = options.stdout ?? process.stdout;

		this.state = new AppState();
		this.keybinds = new KeyBindingRegistry();
		this.commands = new SlashCommandRegistry();

		this.registerDefaultKeybinds();
		this.registerDefaultCommands();
	}

	/** Initialize and start the TUI. */
	async start(): Promise<void> {
		log.info("Starting Takumi TUI");

		// Initialize Yoga for layout
		await initYoga();

		// Get terminal size
		const { columns, rows } = this.getTerminalSize();

		if (columns < LIMITS.MIN_TERMINAL_WIDTH || rows < LIMITS.MIN_TERMINAL_HEIGHT) {
			throw new Error(
				`Terminal too small (${columns}x${rows}). Minimum: ${LIMITS.MIN_TERMINAL_WIDTH}x${LIMITS.MIN_TERMINAL_HEIGHT}`,
			);
		}

		// Create render scheduler
		this.scheduler = new RenderScheduler(columns, rows, {
			write: (data) => (this.stdout as any).write(data),
		});

		// Enter alternate screen, hide cursor
		this.write(ANSI.ALT_SCREEN_ON);
		this.write(ANSI.CURSOR_HIDE);
		this.write(ANSI.MOUSE_ON);
		this.write(ANSI.BRACKETED_PASTE_ON);

		// Set up raw mode for input
		if ((this.stdin as any).setRawMode) {
			(this.stdin as any).setRawMode(true);
		}
		(this.stdin as any).resume?.();

		// Listen for input
		this.stdin.on("data", (data: Buffer) => {
			this.handleInput(data);
		});

		// Listen for resize
		process.on("SIGWINCH", () => {
			const { columns, rows } = this.getTerminalSize();
			this.scheduler?.resize(columns, rows);
			this.state.terminalSize.value = { width: columns, height: rows };
		});

		// Listen for exit signals
		process.on("SIGINT", () => this.quit());
		process.on("SIGTERM", () => this.quit());

		this.running = true;
		this.scheduler.start();

		this.state.terminalSize.value = { width: columns, height: rows };
		log.info(`TUI started: ${columns}x${rows}`);
	}

	/** Stop the TUI and restore terminal. */
	async quit(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		log.info("Shutting down Takumi TUI");

		this.scheduler?.stop();

		// Restore terminal
		this.write(ANSI.BRACKETED_PASTE_OFF);
		this.write(ANSI.MOUSE_OFF);
		this.write(ANSI.CURSOR_SHOW);
		this.write(ANSI.ALT_SCREEN_OFF);

		if ((this.stdin as any).setRawMode) {
			(this.stdin as any).setRawMode(false);
		}

		process.exit(0);
	}

	/** Handle raw input bytes from stdin. */
	private handleInput(data: Buffer): void {
		const raw = data.toString("utf-8");
		const event = parseKeyEvent(raw);

		// Ctrl+C always quits
		if (event.ctrl && event.key === "c") {
			this.quit();
			return;
		}

		// Try keybindings first
		if (this.keybinds.handle(event)) return;

		// Pass to focused component
		// (TUI panels will handle this in the full implementation)
	}

	private write(data: string): void {
		(this.stdout as any).write(data);
	}

	private getTerminalSize(): { columns: number; rows: number } {
		return {
			columns: (process.stdout as any).columns ?? 80,
			rows: (process.stdout as any).rows ?? 24,
		};
	}

	private registerDefaultKeybinds(): void {
		this.keybinds.register("ctrl+q", "Quit", () => this.quit());
		this.keybinds.register("ctrl+l", "Clear screen", () => {
			this.scheduler?.getScreen().invalidate();
			this.scheduler?.scheduleRender();
		});
	}

	private registerDefaultCommands(): void {
		this.commands.register("/quit", "Exit Takumi", () => this.quit());
		this.commands.register("/clear", "Clear conversation", () => {
			this.state.messages.value = [];
		});
		this.commands.register("/model", "Change model", (args) => {
			if (args) {
				this.state.model.value = args;
			}
		});
		this.commands.register("/theme", "Change theme", (args) => {
			if (args) {
				this.state.theme.value = args;
			}
		});
		this.commands.register("/help", "Show help", () => {
			const commands = this.commands.list();
			const helpText = commands
				.map((cmd) => `  ${cmd.name.padEnd(16)} ${cmd.description}`)
				.join("\n");
			log.info("Available commands:\n" + helpText);
		});
	}
}

/** Parse raw terminal input into a KeyEvent. */
function parseKeyEvent(raw: string): KeyEvent {
	const ctrl = raw.length === 1 && raw.charCodeAt(0) < 32;
	const alt = raw.startsWith("\x1b") && raw.length === 2;
	const shift = false; // Detected from specific sequences

	let key = raw;
	if (ctrl) {
		// Convert control character to letter
		key = String.fromCharCode(raw.charCodeAt(0) + 96);
	} else if (alt) {
		key = raw[1];
	}

	return { key, ctrl, alt, shift, meta: false, raw };
}
