import type { MessagePayload, ToolRegistry } from "@takumi/agent";
import type { AgentEvent, AutoSaver, Message, SessionData, TakumiConfig, ToolDefinition } from "@takumi/core";
import { ANSI, createAutoSaver, createLogger, generateSessionId, LIMITS, loadSession } from "@takumi/core";
import { effect, initYoga, RenderScheduler } from "@takumi/render";
import { AgentRunner } from "./agent-runner.js";
import { connectChitragupta, disconnectChitragupta } from "./app-chitragupta.js";
import type { AppCommandContext, ProviderFactory } from "./app-command-context.js";
import { registerAppCommands } from "./app-commands.js";
import { formatMessagesAsMarkdown } from "./app-export.js";
import { parseKeyEvent, parseMouseEvent } from "./app-input.js";
import type { CodingAgent } from "./coding-agent.js";
import { SlashCommandRegistry } from "./commands.js";
import { KeyBindingRegistry } from "./keybinds.js";
import { AppState } from "./state.js";
import type { ChatView } from "./views/chat.js";
import { RootView } from "./views/root.js";

const log = createLogger("app");

export interface TakumiAppOptions {
	config: TakumiConfig;
	stdin?: NodeJS.ReadableStream;
	stdout?: NodeJS.WritableStream;
	sendMessage?: (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<AgentEvent>;
	tools?: ToolRegistry;
	resumeSessionId?: string;
	providerFactory?: ProviderFactory;
	autoPr?: boolean;
	autoShip?: boolean;
}

export class TakumiApp {
	readonly config: TakumiConfig;
	readonly state: AppState;
	readonly keybinds: KeyBindingRegistry;
	readonly commands: SlashCommandRegistry;
	readonly rootView: RootView;
	readonly agentRunner: AgentRunner | null;

	get chatView(): ChatView {
		return this.rootView.chatView;
	}

	private scheduler: RenderScheduler | null = null;
	private stdin: NodeJS.ReadableStream;
	private stdout: NodeJS.WritableStream;
	private running = false;
	private autoSaver: AutoSaver | null = null;
	private resumeSessionId: string | undefined;
	private activeCoder: CodingAgent | null = null;
	private vasanaRefreshInterval: ReturnType<typeof setInterval> | null = null;
	private autoPr: boolean;
	private autoShip: boolean;
	private providerFactory?: ProviderFactory;

	constructor(options: TakumiAppOptions) {
		this.config = options.config;
		this.stdin = options.stdin ?? process.stdin;
		this.stdout = options.stdout ?? process.stdout;
		this.resumeSessionId = options.resumeSessionId;
		this.autoPr = options.autoPr ?? false;
		this.autoShip = options.autoShip ?? false;
		this.providerFactory = options.providerFactory;
		this.state = new AppState();
		this.keybinds = new KeyBindingRegistry();
		this.commands = new SlashCommandRegistry();
		this.rootView = new RootView({ state: this.state, commands: this.commands });
		if (options.sendMessage && options.tools) {
			this.agentRunner = new AgentRunner(this.state, this.config, options.sendMessage, options.tools);
			this.rootView.chatView.agentRunner = this.agentRunner;
		} else {
			this.agentRunner = null;
		}
		this.registerDefaultKeybinds();
		this.registerDefaultCommands();
	}

	async start(): Promise<void> {
		log.info("Starting Takumi TUI");
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
				this.state.sessionId.value = generateSessionId();
			}
		} else if (!this.state.sessionId.value) {
			this.state.sessionId.value = generateSessionId();
		}

		this.startAutoSaver();
		await initYoga();
		const { columns, rows } = this.getTerminalSize();
		if (columns < LIMITS.MIN_TERMINAL_WIDTH || rows < LIMITS.MIN_TERMINAL_HEIGHT) {
			throw new Error(
				`Terminal too small (${columns}x${rows}). Minimum: ${LIMITS.MIN_TERMINAL_WIDTH}x${LIMITS.MIN_TERMINAL_HEIGHT}`,
			);
		}

		this.scheduler = new RenderScheduler(columns, rows, {
			write: (data) => (this.stdout as any).write(data),
		});
		this.write(ANSI.ALT_SCREEN_ON);
		this.write(ANSI.CURSOR_HIDE);
		this.write(ANSI.MOUSE_ON);
		this.write(ANSI.BRACKETED_PASTE_ON);
		if ((this.stdin as any).setRawMode) (this.stdin as any).setRawMode(true);
		(this.stdin as any).resume?.();
		this.stdin.on("data", (data: Buffer) => this.handleInput(data));
		process.on("SIGWINCH", () => {
			const { columns, rows } = this.getTerminalSize();
			this.scheduler?.resize(columns, rows);
			this.state.terminalSize.value = { width: columns, height: rows };
		});
		process.on("SIGINT", () => this.quit());
		process.on("SIGTERM", () => this.quit());
		this.scheduler.setRoot(this.rootView);
		this.running = true;
		this.scheduler.start();
		this.state.terminalSize.value = { width: columns, height: rows };

		const scheduler = this.scheduler;
		effect(() => {
			void this.state.messages.value;
			void this.state.streamingText.value;
			void this.state.thinkingText.value;
			void this.state.isStreaming.value;
			void this.state.codingPhase.value;
			void this.state.activeTool.value;
			void this.state.toolOutput.value;
			void this.state.dialogStack.value;
			scheduler?.scheduleRender();
			return undefined;
		});

		connectChitragupta(this.state, this.agentRunner, (timer) => {
			this.vasanaRefreshInterval = timer;
		});
	}

	async quit(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		if (this.autoSaver) {
			try {
				await this.autoSaver.save();
			} catch {
				/* best effort */
			}
			this.autoSaver.stop();
			this.autoSaver = null;
		}
		if (this.vasanaRefreshInterval) {
			clearInterval(this.vasanaRefreshInterval);
			this.vasanaRefreshInterval = null;
		}
		await disconnectChitragupta(this.state);
		this.scheduler?.stop();
		this.write(ANSI.BRACKETED_PASTE_OFF);
		this.write(ANSI.MOUSE_OFF);
		this.write(ANSI.CURSOR_SHOW);
		this.write(ANSI.ALT_SCREEN_OFF);
		if ((this.stdin as any).setRawMode) (this.stdin as any).setRawMode(false);
		process.exit(0);
	}

	renderFrame(): void {
		this.scheduler?.forceRender();
	}

	private handleInput(data: Buffer): void {
		const raw = data.toString("utf-8");
		const mouseEvent = parseMouseEvent(raw);
		if (mouseEvent) {
			this.handleMouse(mouseEvent);
			this.scheduler?.forceRender();
			return;
		}
		const event = parseKeyEvent(raw);
		if (event.ctrl && event.key === "c") {
			if (this.agentRunner?.isRunning) {
				this.agentRunner.cancel();
				return;
			}
			void this.quit();
			return;
		}
		if (this.keybinds.handle(event)) return;
		this.rootView.handleKey(event);
		this.scheduler?.forceRender();
	}

	private handleMouse(event: { type: string; x: number; wheelDelta: number }): void {
		if (event.type === "wheel") {
			this.rootView.chatView.scrollMessages(event.wheelDelta > 0 ? -3 : 3);
			return;
		}
		if (event.type !== "mousedown") return;
		const { width } = this.state.terminalSize.value;
		const sidebarWidth = this.state.sidebarVisible.value ? Math.min(30, Math.floor(width * 0.25)) : 0;
		this.state.focusedPanel.value =
			event.x >= width - sidebarWidth && this.state.sidebarVisible.value ? "sidebar" : "input";
	}

	private write(data: string): void {
		(this.stdout as any).write(data);
	}

	private getTerminalSize(): { columns: number; rows: number } {
		return { columns: (process.stdout as any).columns ?? 80, rows: (process.stdout as any).rows ?? 24 };
	}

	private addInfoMessage(text: string): void {
		const msg: Message = {
			id: `info-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};
		this.state.addMessage(msg);
	}

	private buildSessionData(): SessionData {
		const messages = this.state.messages.value;
		let title = "Untitled session";
		for (const m of messages) {
			if (m.role !== "user" || m.content.length === 0) continue;
			const first = m.content[0];
			if (first.type === "text") {
				title = first.text.slice(0, 80).replace(/\n/g, " ");
				break;
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

	private startAutoSaver(): void {
		if (!this.autoSaver) {
			this.autoSaver = createAutoSaver(this.state.sessionId.value, () => this.buildSessionData());
		}
	}

	private registerDefaultKeybinds(): void {
		this.keybinds.register("ctrl+q", "Quit", () => this.quit());
		this.keybinds.register("ctrl+l", "Clear screen", () => {
			this.scheduler?.getScreen().invalidate();
			this.scheduler?.scheduleRender();
		});
		const toggleCommandPalette = () => {
			if (this.state.topDialog === "command-palette") this.state.popDialog();
			else this.state.pushDialog("command-palette");
		};
		this.keybinds.register("ctrl+p", "Command palette", toggleCommandPalette);
		this.keybinds.register("ctrl+k", "Command palette", toggleCommandPalette);
		this.keybinds.register("ctrl+m", "Model picker", () => {
			if (this.state.topDialog === "model-picker") this.state.popDialog();
			else this.state.pushDialog("model-picker");
		});
		this.keybinds.register("ctrl+b", "Toggle sidebar", () => {
			this.state.sidebarVisible.value = !this.state.sidebarVisible.value;
		});
		this.keybinds.register("ctrl+shift+c", "Toggle cluster status", () => {
			this.rootView.sidebar.clusterPanel.toggle();
		});
		this.keybinds.register("ctrl+o", "Session list", () => this.state.pushDialog("session-list"));
		this.keybinds.register("ctrl+d", "Exit", () => {
			if (!this.chatView.getEditorValue()) void this.quit();
		});
	}

	private registerDefaultCommands(): void {
		registerAppCommands(this.createCommandContext());
	}

	private createCommandContext(): AppCommandContext {
		return {
			commands: this.commands,
			state: this.state,
			agentRunner: this.agentRunner,
			config: this.config,
			autoPr: this.autoPr,
			autoShip: this.autoShip,
			providerFactory: this.providerFactory,
			addInfoMessage: (text) => this.addInfoMessage(text),
			buildSessionData: () => this.buildSessionData(),
			startAutoSaver: () => this.startAutoSaver(),
			quit: () => this.quit(),
			getActiveCoder: () => this.activeCoder,
			setActiveCoder: (coder) => {
				this.activeCoder = coder;
			},
		};
	}
}

export { formatMessagesAsMarkdown, parseMouseEvent };
