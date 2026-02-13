/**
 * TakumiApp — the root application class.
 *
 * Manages the lifecycle of the TUI: terminal setup, render loop,
 * input handling, and agent interaction.
 */

import type { TakumiConfig, KeyEvent, MouseEvent, AgentEvent, ToolDefinition, Message, AutoSaver, SessionData, ContentBlock } from "@takumi/core";
import { ANSI, LIMITS, createLogger, loadSession, saveSession, listSessions, generateSessionId, createAutoSaver } from "@takumi/core";
import { writeFile } from "node:fs/promises";
import { RenderScheduler, initYoga } from "@takumi/render";
import { ToolRegistry, compactHistory } from "@takumi/agent";
import type { MessagePayload } from "@takumi/agent";
import { gitDiff, ChitraguptaBridge } from "@takumi/bridge";
import type { MemoryResult, ChitraguptaSessionInfo } from "@takumi/bridge";
import { AppState } from "./state.js";
import { KeyBindingRegistry } from "./keybinds.js";
import { SlashCommandRegistry } from "./commands.js";
import { RootView } from "./views/root.js";
import type { ChatView } from "./views/chat.js";
import { AgentRunner } from "./agent-runner.js";

const log = createLogger("app");

export interface TakumiAppOptions {
	config: TakumiConfig;
	stdin?: NodeJS.ReadableStream;
	stdout?: NodeJS.WritableStream;
	/** Optional: provide a sendMessage function and tool registry to enable the agent loop. */
	sendMessage?: (messages: MessagePayload[], system: string, tools?: ToolDefinition[]) => AsyncIterable<AgentEvent>;
	tools?: ToolRegistry;
	/** Optional: resume a previous session by ID (loads messages from disk). */
	resumeSessionId?: string;
}

export class TakumiApp {
	readonly config: TakumiConfig;
	readonly state: AppState;
	readonly keybinds: KeyBindingRegistry;
	readonly commands: SlashCommandRegistry;
	readonly rootView: RootView;
	readonly agentRunner: AgentRunner | null;

	/** Convenience accessor — delegates to rootView.chatView. */
	get chatView(): ChatView {
		return this.rootView.chatView;
	}

	private scheduler: RenderScheduler | null = null;
	private stdin: NodeJS.ReadableStream;
	private stdout: NodeJS.WritableStream;
	private running = false;
	private autoSaver: AutoSaver | null = null;
	private resumeSessionId: string | undefined;

	constructor(options: TakumiAppOptions) {
		this.config = options.config;
		this.stdin = options.stdin ?? process.stdin;
		this.stdout = options.stdout ?? process.stdout;
		this.resumeSessionId = options.resumeSessionId;

		this.state = new AppState();
		this.keybinds = new KeyBindingRegistry();
		this.commands = new SlashCommandRegistry();

		// Create the root view (which owns ChatView + SidebarPanel)
		this.rootView = new RootView({ state: this.state, commands: this.commands });

		// Wire up the agent runner if sendMessage + tools are provided
		if (options.sendMessage && options.tools) {
			this.agentRunner = new AgentRunner(
				this.state,
				this.config,
				options.sendMessage,
				options.tools,
			);
			this.rootView.chatView.agentRunner = this.agentRunner;
		} else {
			this.agentRunner = null;
		}

		this.registerDefaultKeybinds();
		this.registerDefaultCommands();
	}

	/** Initialize and start the TUI. */
	async start(): Promise<void> {
		log.info("Starting Takumi TUI");

		// Resume a previous session from disk, or generate a new session ID
		if (this.resumeSessionId) {
			const loaded = await loadSession(this.resumeSessionId);
			if (loaded) {
				this.state.sessionId.value = loaded.id;
				this.state.model.value = loaded.model;
				this.state.messages.value = loaded.messages;
				this.state.totalInputTokens.value = loaded.tokenUsage.inputTokens;
				this.state.totalOutputTokens.value = loaded.tokenUsage.outputTokens;
				this.state.totalCost.value = loaded.tokenUsage.totalCost;
				log.info(`Resumed session: ${loaded.id} (${loaded.messages.length} messages)`);
			} else {
				log.info(`Session ${this.resumeSessionId} not found, starting new session`);
				this.state.sessionId.value = generateSessionId();
			}
		} else if (!this.state.sessionId.value) {
			this.state.sessionId.value = generateSessionId();
		}

		// Start the auto-saver for session persistence
		this.startAutoSaver();

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

		// Connect the root component to the scheduler's render tree
		this.scheduler.setRoot(this.rootView);

		this.running = true;
		this.scheduler.start();

		this.state.terminalSize.value = { width: columns, height: rows };
		log.info(`TUI started: ${columns}x${rows}`);

		// Connect to Chitragupta in the background (non-blocking, best-effort)
		this.connectChitragupta();
	}

	/** Stop the TUI and restore terminal. */
	async quit(): Promise<void> {
		if (!this.running) return;
		this.running = false;

		log.info("Shutting down Takumi TUI");

		// Final session save before exit
		if (this.autoSaver) {
			try {
				await this.autoSaver.save();
			} catch {
				// Non-fatal — best effort
			}
			this.autoSaver.stop();
			this.autoSaver = null;
		}

		// Best-effort handover and disconnect from Chitragupta
		await this.disconnectChitragupta();

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

	/**
	 * Force an immediate render frame outside the scheduler's timing loop.
	 * Useful after input handling or state changes that need instant visual feedback.
	 */
	renderFrame(): void {
		this.scheduler?.forceRender();
	}

	/** Handle raw input bytes from stdin. */
	private handleInput(data: Buffer): void {
		const raw = data.toString("utf-8");

		// Try mouse event first
		const mouseEvent = parseMouseEvent(raw);
		if (mouseEvent) {
			this.handleMouse(mouseEvent);
			return;
		}

		const event = parseKeyEvent(raw);

		// Ctrl+C: cancel streaming or quit
		if (event.ctrl && event.key === "c") {
			if (this.agentRunner?.isRunning) {
				this.agentRunner.cancel();
				return;
			}
			this.quit();
			return;
		}

		// Try keybindings first
		if (this.keybinds.handle(event)) return;

		// Route input through the root view (which delegates to chat/sidebar)
		this.rootView.handleKey(event);
	}

	/** Handle parsed mouse events. */
	private handleMouse(event: MouseEvent): void {
		// Wheel: scroll message list
		if (event.type === "wheel") {
			this.rootView.chatView.scrollMessages(event.wheelDelta > 0 ? -3 : 3);
			return;
		}

		// Click: focus panel based on position
		if (event.type === "mousedown") {
			const { width } = this.state.terminalSize.value;
			const sidebarWidth = this.state.sidebarVisible.value
				? Math.min(30, Math.floor(width * 0.25))
				: 0;

			if (event.x >= width - sidebarWidth && this.state.sidebarVisible.value) {
				this.state.focusedPanel.value = "sidebar";
			} else {
				this.state.focusedPanel.value = "input";
			}
		}
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

	/** Add an informational message to the conversation display. */
	private addInfoMessage(text: string): void {
		const msg: Message = {
			id: `info-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};
		this.state.addMessage(msg);
	}

	/** Build a SessionData snapshot from the current state. */
	private buildSessionData(): SessionData {
		const messages = this.state.messages.value;
		// Derive a title from the first user message, or default
		let title = "Untitled session";
		for (const m of messages) {
			if (m.role === "user" && m.content.length > 0) {
				const first = m.content[0];
				if (first.type === "text") {
					title = first.text.slice(0, 80).replace(/\n/g, " ");
					break;
				}
			}
		}
		return {
			id: this.state.sessionId.value,
			title,
			createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
			updatedAt: Date.now(),
			messages,
			model: this.state.model.value,
			tokenUsage: {
				inputTokens: this.state.totalInputTokens.value,
				outputTokens: this.state.totalOutputTokens.value,
				totalCost: this.state.totalCost.value,
			},
		};
	}

	/** Start the periodic auto-saver for session persistence. */
	private startAutoSaver(): void {
		if (this.autoSaver) return;
		this.autoSaver = createAutoSaver(
			this.state.sessionId.value,
			() => this.buildSessionData(),
		);
	}

	/**
	 * Attempt to connect to Chitragupta MCP memory server in the background.
	 * This is fully non-blocking — if the binary is not found or connection
	 * fails, we silently set chitraguptaConnected=false. The TUI continues
	 * to work without Chitragupta features.
	 */
	private connectChitragupta(): void {
		const bridge = new ChitraguptaBridge({
			projectPath: process.cwd(),
			startupTimeoutMs: 8_000,
		});

		// Store the bridge instance immediately so commands can reference it
		this.state.chitraguptaBridge.value = bridge;

		bridge.connect()
			.then(async () => {
				this.state.chitraguptaConnected.value = true;
				log.info("Chitragupta bridge connected");

				// Load relevant memory for the current project
				try {
					const cwd = process.cwd();
					const projectName = cwd.split("/").pop() ?? cwd;
					const results = await bridge.memorySearch(projectName, 5);
					if (results.length > 0) {
						log.info(`Loaded ${results.length} memory entries from Chitragupta`);
					}
				} catch (err) {
					log.debug(`Chitragupta memory preload failed: ${(err as Error).message}`);
				}
			})
			.catch((err) => {
				log.debug(`Chitragupta bridge connection failed: ${(err as Error).message}`);
				this.state.chitraguptaConnected.value = false;
				this.state.chitraguptaBridge.value = null;
			});

		// Listen for disconnection events
		bridge.mcpClient.on("disconnected", () => {
			this.state.chitraguptaConnected.value = false;
			log.info("Chitragupta bridge disconnected");
		});

		bridge.mcpClient.on("error", (err) => {
			log.debug(`Chitragupta bridge error: ${(err as Error).message}`);
			this.state.chitraguptaConnected.value = false;
		});
	}

	/**
	 * Best-effort handover and disconnect from Chitragupta on shutdown.
	 * Errors are silently logged — we never block TUI exit.
	 */
	private async disconnectChitragupta(): Promise<void> {
		const bridge = this.state.chitraguptaBridge.value;
		if (!bridge || !bridge.isConnected) return;

		try {
			await Promise.race([
				bridge.handover(),
				new Promise((_, reject) => setTimeout(() => reject(new Error("handover timeout")), 3_000)),
			]);
			log.debug("Chitragupta handover completed");
		} catch (err) {
			log.debug(`Chitragupta handover failed: ${(err as Error).message}`);
		}

		try {
			await bridge.disconnect();
		} catch (err) {
			log.debug(`Chitragupta disconnect failed: ${(err as Error).message}`);
		}

		this.state.chitraguptaConnected.value = false;
		this.state.chitraguptaBridge.value = null;
	}

	private registerDefaultKeybinds(): void {
		this.keybinds.register("ctrl+q", "Quit", () => this.quit());
		this.keybinds.register("ctrl+l", "Clear screen", () => {
			this.scheduler?.getScreen().invalidate();
			this.scheduler?.scheduleRender();
		});

		// Command palette
		this.keybinds.register("ctrl+k", "Command palette", () => {
			if (this.state.activeDialog.value === "command-palette") {
				this.state.activeDialog.value = null;
			} else {
				this.state.activeDialog.value = "command-palette";
			}
		});

		// Toggle sidebar
		this.keybinds.register("ctrl+b", "Toggle sidebar", () => {
			this.state.sidebarVisible.value = !this.state.sidebarVisible.value;
		});

		// Session list
		this.keybinds.register("ctrl+o", "Session list", () => {
			this.state.activeDialog.value = "session-list";
		});

		// Exit on empty input (Ctrl+D)
		this.keybinds.register("ctrl+d", "Exit", () => {
			const value = this.chatView.getEditorValue();
			if (!value) this.quit();
		});
	}

	private registerDefaultCommands(): void {
		this.commands.register("/quit", "Exit Takumi", () => this.quit(), ["/exit"]);
		this.commands.register("/clear", "Clear conversation", () => {
			this.state.messages.value = [];
			this.agentRunner?.clearHistory();
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
		this.commands.register("/status", "Show session statistics", () => {
			log.info(
				`Session: ${this.state.sessionId.value || "(none)"}\n` +
				`Turns: ${this.state.turnCount.value}\n` +
				`Tokens: ${this.state.totalTokens.value} (in: ${this.state.totalInputTokens.value}, out: ${this.state.totalOutputTokens.value})\n` +
				`Cost: ${this.state.formattedCost.value}\n` +
				`Messages: ${this.state.messageCount.value}\n` +
				`Model: ${this.state.model.value}`,
			);
		});
		this.commands.register("/compact", "Trigger conversation compaction", () => {
			const messages = this.state.messages.value;
			if (messages.length === 0) {
				log.info("Nothing to compact");
				return;
			}
			const result = compactHistory(messages, { keepRecent: 10 });
			if (result.compactedTurns === 0) {
				log.info("No compaction needed");
				return;
			}
			this.state.messages.value = result.messages;
			this.agentRunner?.clearHistory();
			log.info(`Compacted ${result.compactedTurns} turns`);
		});
		this.commands.register("/session", "Session management", async (args) => {
			if (!args || args === "info") {
				// Show current session info
				const info = [
					`Session: ${this.state.sessionId.value || "(none)"}`,
					`Model: ${this.state.model.value}`,
					`Turns: ${this.state.turnCount.value}`,
					`Tokens: ${this.state.totalTokens.value}`,
					`Cost: ${this.state.formattedCost.value}`,
				];
				this.addInfoMessage(info.join("\n"));
				return;
			}

			if (args === "list") {
				// Show saved sessions from disk
				try {
					const sessions = await listSessions(20);
					if (sessions.length === 0) {
						this.addInfoMessage("No saved sessions found.");
					} else {
						const lines = sessions.map((s) => {
							const date = new Date(s.updatedAt).toLocaleString();
							return `  ${s.id}  ${date}  (${s.messageCount} msgs)  ${s.title}`;
						});
						this.addInfoMessage(`Saved sessions:\n${lines.join("\n")}`);
					}
				} catch (err) {
					this.addInfoMessage(`Failed to list sessions: ${(err as Error).message}`);
				}
				return;
			}

			if (args.startsWith("resume ")) {
				const sessionId = args.slice(7).trim();
				if (sessionId) {
					const loaded = await loadSession(sessionId);
					if (loaded) {
						// Stop current auto-saver before switching sessions
						if (this.autoSaver) {
							this.autoSaver.stop();
							this.autoSaver = null;
						}
						this.state.sessionId.value = loaded.id;
						this.state.model.value = loaded.model;
						this.state.messages.value = loaded.messages;
						this.state.totalInputTokens.value = loaded.tokenUsage.inputTokens;
						this.state.totalOutputTokens.value = loaded.tokenUsage.outputTokens;
						this.state.totalCost.value = loaded.tokenUsage.totalCost;
						this.agentRunner?.clearHistory();
						this.startAutoSaver();
						this.addInfoMessage(`Resumed session: ${sessionId} (${loaded.messages.length} messages)`);
					} else {
						this.addInfoMessage(`Session not found: ${sessionId}`);
					}
				}
				return;
			}

			if (args === "save") {
				try {
					const data = this.buildSessionData();
					await saveSession(data);
					this.addInfoMessage(`Session saved: ${data.id}`);
				} catch (err) {
					this.addInfoMessage(`Failed to save session: ${(err as Error).message}`);
				}
				return;
			}

			this.addInfoMessage("Usage: /session [info|list|resume <id>|save]");
		});
		this.commands.register("/diff", "Show git diff", () => {
			const diff = gitDiff(process.cwd());
			if (!diff) {
				log.info("No changes");
				return;
			}
			const diffMessage: Message = {
				id: `diff-${Date.now()}`,
				role: "assistant",
				content: [{ type: "text", text: `\`\`\`diff\n${diff}\n\`\`\`` }],
				timestamp: Date.now(),
			};
			this.state.addMessage(diffMessage);
		});
		this.commands.register("/cost", "Show token costs breakdown", () => {
			const inCost = this.state.totalInputTokens.value * 3 / 1_000_000;
			const outCost = this.state.totalOutputTokens.value * 15 / 1_000_000;
			log.info(
				`Cost breakdown:\n` +
				`  Input:  ${this.state.totalInputTokens.value} tokens  ($${inCost.toFixed(4)})\n` +
				`  Output: ${this.state.totalOutputTokens.value} tokens  ($${outCost.toFixed(4)})\n` +
				`  Total:  ${this.state.formattedCost.value}`,
			);
		});
		this.commands.register("/sidebar", "Toggle sidebar", () => {
			this.state.sidebarVisible.value = !this.state.sidebarVisible.value;
		});
		this.commands.register("/memory", "Search project memory", async (args) => {
			if (!args) {
				this.addInfoMessage("Usage: /memory <search query>");
				return;
			}

			const bridge = this.state.chitraguptaBridge.value;
			if (!bridge || !this.state.chitraguptaConnected.value) {
				this.addInfoMessage("Memory search requires Chitragupta connection (not connected)");
				return;
			}

			this.addInfoMessage(`Searching memory for: ${args}...`);
			try {
				const results = await bridge.memorySearch(args, 10);
				if (results.length === 0) {
					this.addInfoMessage("No memory results found.");
				} else {
					const formatted = results
						.map((r, i) => {
							const src = r.source ? ` (${r.source})` : "";
							return `  ${i + 1}. [${(r.relevance * 100).toFixed(0)}%]${src}\n     ${r.content.slice(0, 200)}`;
						})
						.join("\n");
					this.addInfoMessage(`Memory results:\n${formatted}`);
				}
			} catch (err) {
				this.addInfoMessage(`Memory search failed: ${(err as Error).message}`);
			}
		});
		this.commands.register("/sessions", "List Chitragupta sessions", async (args) => {
			const bridge = this.state.chitraguptaBridge.value;
			if (!bridge || !this.state.chitraguptaConnected.value) {
				this.addInfoMessage("Session listing requires Chitragupta connection (not connected)");
				return;
			}

			try {
				const limit = args ? parseInt(args, 10) || 10 : 10;
				const sessions = await bridge.sessionList(limit);
				if (sessions.length === 0) {
					this.addInfoMessage("No Chitragupta sessions found.");
				} else {
					const formatted = sessions
						.map((s) => {
							const date = new Date(s.timestamp).toLocaleDateString();
							return `  ${s.id}  ${date}  (${s.turns} turns)  ${s.title}`;
						})
						.join("\n");
					this.addInfoMessage(`Chitragupta sessions:\n${formatted}`);
				}
			} catch (err) {
				this.addInfoMessage(`Session listing failed: ${(err as Error).message}`);
			}
		});
		this.commands.register("/undo", "Undo last file change", async () => {
			this.addInfoMessage("Running: git checkout -- .");
			try {
				const { execSync } = await import("node:child_process");
				const result = execSync("git diff --name-only", { encoding: "utf-8", cwd: process.cwd() }).trim();
				if (!result) {
					this.addInfoMessage("No changes to undo");
					return;
				}
				execSync("git checkout -- .", { cwd: process.cwd() });
				this.addInfoMessage(`Reverted changes in:\n${result}`);
			} catch (err) {
				this.addInfoMessage(`Undo failed: ${(err as Error).message}`);
			}
		});
		this.commands.register("/permission", "Manage tool permissions", (args) => {
			if (!args) {
				// Show current rules
				if (this.agentRunner) {
					const rules = this.agentRunner.permissions.getRules();
					if (rules.length === 0) {
						this.addInfoMessage("No permission rules configured");
					} else {
						const lines = rules.map(r =>
							`  ${r.allow ? "allow" : "deny"} ${r.tool} ${r.pattern} (${r.scope})`,
						);
						this.addInfoMessage(`Permission rules:\n${lines.join("\n")}`);
					}
				} else {
					this.addInfoMessage("No agent runner configured");
				}
				return;
			}

			if (args === "reset") {
				this.agentRunner?.permissions.reset();
				this.addInfoMessage("Session permissions reset");
				return;
			}

			this.addInfoMessage("Usage: /permission [reset]");
		});
		this.commands.register("/code", "Start coding agent", async (args) => {
			if (!args) {
				this.addInfoMessage("Usage: /code <task description>");
				return;
			}
			if (!this.agentRunner) {
				this.addInfoMessage("No agent runner configured");
				return;
			}
			const { CodingAgent } = await import("./coding-agent.js");
			const coder = new CodingAgent(this.state, this.agentRunner);
			await coder.start(args);
		});

		// ── /think — Toggle extended thinking ────────────────────────────────────
		this.commands.register("/think", "Toggle extended thinking", (args) => {
			if (!args) {
				// Toggle
				this.state.thinking.value = !this.state.thinking.value;
				const status = this.state.thinking.value ? "enabled" : "disabled";
				const budgetInfo = this.state.thinking.value
					? ` (budget: ${this.state.thinkingBudget.value} tokens)`
					: "";
				this.addInfoMessage(`Extended thinking ${status}${budgetInfo}`);
				return;
			}

			if (args === "on") {
				this.state.thinking.value = true;
				this.addInfoMessage(`Extended thinking enabled (budget: ${this.state.thinkingBudget.value} tokens)`);
				return;
			}

			if (args === "off") {
				this.state.thinking.value = false;
				this.addInfoMessage("Extended thinking disabled");
				return;
			}

			if (args.startsWith("budget ")) {
				const budgetStr = args.slice(7).trim();
				const budget = parseInt(budgetStr, 10);
				if (isNaN(budget) || budget <= 0) {
					this.addInfoMessage(`Invalid budget: "${budgetStr}" — must be a positive number`);
					return;
				}
				this.state.thinkingBudget.value = budget;
				this.addInfoMessage(`Thinking budget set to ${budget} tokens`);
				return;
			}

			this.addInfoMessage("Usage: /think [on|off|budget <tokens>]");
		});

		// ── /export — Export conversation to file ─────────────────────────────────
		this.commands.register("/export", "Export conversation to file", async (args) => {
			const messages = this.state.messages.value;
			if (messages.length === 0) {
				this.addInfoMessage("No messages to export");
				return;
			}

			// Parse arguments: format and/or path
			let format: "md" | "json" = "md";
			let outputPath = "";

			if (args) {
				const parts = args.trim().split(/\s+/);
				for (const part of parts) {
					if (part === "json") {
						format = "json";
					} else if (part === "md" || part === "markdown") {
						format = "md";
					} else {
						// Treat as output path
						outputPath = part;
					}
				}
			}

			// Determine output path if not specified
			if (!outputPath) {
				const date = new Date().toISOString().slice(0, 10);
				outputPath = `./takumi-export-${date}.${format === "json" ? "json" : "md"}`;
			}

			try {
				let content: string;
				if (format === "json") {
					content = JSON.stringify(messages, null, 2);
				} else {
					content = formatMessagesAsMarkdown(
						messages,
						this.state.sessionId.value,
						this.state.model.value,
					);
				}

				await writeFile(outputPath, content, "utf-8");
				this.addInfoMessage(`Session exported to ${outputPath}`);
			} catch (err) {
				this.addInfoMessage(`Export failed: ${(err as Error).message}`);
			}
		});

		// ── /retry — Retry last assistant response ────────────────────────────────
		this.commands.register("/retry", "Retry last response", async (args) => {
			const messages = this.state.messages.value;
			if (messages.length === 0) {
				this.addInfoMessage("No messages to retry");
				return;
			}

			if (!this.agentRunner) {
				this.addInfoMessage("No agent runner configured");
				return;
			}

			if (this.agentRunner.isRunning) {
				this.addInfoMessage("Cannot retry while agent is running");
				return;
			}

			let turnIndex: number | undefined;
			if (args) {
				turnIndex = parseInt(args.trim(), 10);
				if (isNaN(turnIndex) || turnIndex < 0) {
					this.addInfoMessage(`Invalid turn number: "${args.trim()}"`);
					return;
				}
			}

			// Find the last user message text for re-submission
			let lastUserText = "";
			let cutIndex: number;

			if (turnIndex !== undefined) {
				// Rewind to turn N: keep messages 0..turnIndex-1
				cutIndex = turnIndex;
				if (cutIndex > messages.length) {
					cutIndex = messages.length;
				}
				// Find the last user message before the cut point
				for (let i = cutIndex - 1; i >= 0; i--) {
					if (messages[i].role === "user") {
						for (const block of messages[i].content) {
							if (block.type === "text") {
								lastUserText = block.text;
								break;
							}
						}
						if (lastUserText) break;
					}
				}
				this.addInfoMessage(`Retrying from turn ${turnIndex}...`);
			} else {
				// Remove last assistant message(s) and associated tool results
				cutIndex = messages.length;
				// Walk backwards to find and remove last assistant turn
				// (which may include tool_use + tool_result blocks)
				while (cutIndex > 0 && messages[cutIndex - 1].role === "assistant") {
					cutIndex--;
				}
				// Find the last user message text
				for (let i = cutIndex - 1; i >= 0; i--) {
					if (messages[i].role === "user") {
						for (const block of messages[i].content) {
							if (block.type === "text") {
								lastUserText = block.text;
								break;
							}
						}
						if (lastUserText) break;
					}
				}
				this.addInfoMessage("Retrying last response...");
			}

			if (!lastUserText) {
				this.addInfoMessage("No user message found to retry");
				return;
			}

			// Truncate messages
			this.state.messages.value = messages.slice(0, cutIndex);
			// Clear agent history so it rebuilds from messages
			this.agentRunner.clearHistory();
			// Re-submit the last user message
			await this.agentRunner.submit(lastUserText);
		});
	}
}

/**
 * Parse SGR-encoded mouse escape sequences into a MouseEvent.
 *
 * SGR mouse format: \x1b[<button;x;y[Mm]
 *   M = press/move, m = release
 *   button encoding: 0=left, 1=middle, 2=right, 32+button=move, 64=wheel up, 65=wheel down
 *   Modifiers: +4=shift, +8=alt, +16=ctrl
 */
export function parseMouseEvent(raw: string): MouseEvent | null {
	const match = raw.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
	if (!match) return null;

	const code = parseInt(match[1], 10);
	const x = parseInt(match[2], 10) - 1; // 1-based to 0-based
	const y = parseInt(match[3], 10) - 1;
	const isRelease = match[4] === "m";

	const shift = (code & 4) !== 0;
	const alt = (code & 8) !== 0;
	const ctrl = (code & 16) !== 0;
	const baseCode = code & ~(4 | 8 | 16);

	// Wheel events
	if (baseCode === 64 || baseCode === 65) {
		return {
			type: "wheel",
			x,
			y,
			button: 0,
			shift,
			alt,
			ctrl,
			wheelDelta: baseCode === 64 ? 1 : -1,
		};
	}

	// Move events (button + 32)
	if (baseCode >= 32 && baseCode < 64) {
		return {
			type: "mousemove",
			x,
			y,
			button: baseCode - 32,
			shift,
			alt,
			ctrl,
			wheelDelta: 0,
		};
	}

	// Click events
	return {
		type: isRelease ? "mouseup" : "mousedown",
		x,
		y,
		button: baseCode,
		shift,
		alt,
		ctrl,
		wheelDelta: 0,
	};
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

// ── Export helpers ────────────────────────────────────────────────────────────

/**
 * Format messages as a Markdown document suitable for /export.
 */
export function formatMessagesAsMarkdown(
	messages: Message[],
	sessionId: string,
	model: string,
): string {
	const date = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		`# Takumi Session: ${sessionId}`,
		`Date: ${date}`,
		`Model: ${model}`,
		"",
		"---",
		"",
	];

	for (const msg of messages) {
		const role = msg.role === "user" ? "User" : "Assistant";
		lines.push(`## ${role}`);
		lines.push("");

		for (const block of msg.content) {
			switch (block.type) {
				case "text":
					lines.push(block.text);
					lines.push("");
					break;
				case "thinking":
					lines.push("<details><summary>Thinking</summary>");
					lines.push("");
					lines.push(block.thinking);
					lines.push("");
					lines.push("</details>");
					lines.push("");
					break;
				case "tool_use":
					lines.push(`### Tool: ${block.name} (${block.id})`);
					lines.push("");
					lines.push("```json");
					lines.push(JSON.stringify(block.input, null, 2));
					lines.push("```");
					lines.push("");
					break;
				case "tool_result":
					lines.push(`### Tool Result (${block.toolUseId})`);
					lines.push("");
					lines.push("```");
					lines.push(block.content);
					lines.push("```");
					lines.push("");
					break;
				case "image":
					lines.push(`[Image: ${block.mediaType}]`);
					lines.push("");
					break;
			}
		}

		lines.push("---");
		lines.push("");
	}

	return lines.join("\n");
}
