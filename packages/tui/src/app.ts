import type { ConventionFiles, ExtensionRunner, MessagePayload, ToolRegistry } from "@takumi/agent";
import type { HttpBridgeServer } from "@takumi/bridge";
import type { AgentEvent, Message, TakumiConfig, ToolDefinition } from "@takumi/core";
import { ANSI, createLogger, generateSessionId, LIMITS, loadSession } from "@takumi/core";
import {
	detectCapabilities,
	effect,
	initYoga,
	osc133CommandDone,
	osc133CommandStart,
	RenderScheduler,
} from "@takumi/render";
import { AgentRunner } from "./agent/agent-runner.js";
import { formatMessagesAsMarkdown } from "./app-export.js";
import { formatExtensionHostReport, registerExtensionHostSurfaces } from "./app-extension-host.js";
import { bindExtensionRunnerActions } from "./app-extension-runtime.js";
import { createInputHandler, parseMouseEvent } from "./app-input-handler.js";
import { createDefaultKeybindingHandlers } from "./app-keybinds-runtime.js";
import { bindAppRenderSignals } from "./app-render-signals.js";
import { SessionManager } from "./app-session-lifecycle.js";
import {
	applyStartupControlPlaneState,
	formatStartupSummary,
	type StartupControlPlaneState,
	type StartupSummary,
} from "./app-startup.js";

import {
	type ChitraguptaConnectResult,
	connectChitragupta,
	disconnectChitragupta,
} from "./chitragupta/app-chitragupta.js";
import type { AppCommandContext, ProviderFactory } from "./commands/app-command-context.js";
import { registerAppCommands } from "./commands/app-commands.js";
import { SlashCommandRegistry } from "./commands/commands.js";
import { ExtensionUiStore } from "./extension-ui-store.js";
import { startDesktopBridge } from "./http-bridge/http-bridge-runtime.js";

import {
	DEFAULT_KEYBINDING_DEFINITIONS,
	ensureUserKeybindingConfigFile,
	formatKeybindingStartupNotice,
	type KeybindingConfigLoadResult,
	loadUserKeybindingDefinitions,
	syncDefaultKeybindingRegistry,
} from "./input/keybinding-config.js";
import { KeyBindingRegistry } from "./input/keybinds.js";

import { AppState } from "./state.js";
import type { ChatView } from "./views/chat.js";
import { RootView } from "./views/root.js";

const log = createLogger("app");

export interface TakumiAppOptions {
	config: TakumiConfig;
	startupSummary?: StartupSummary;
	startupControlPlane?: StartupControlPlaneState;
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
	extensionRunner?: ExtensionRunner;
	conventionFiles?: ConventionFiles;
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
	private chitraguptaIntervals: ReturnType<typeof setInterval>[] = [];
	private autoPr: boolean;
	private autoShip: boolean;
	private providerFactory?: ProviderFactory;
	private extensionRunner: ExtensionRunner | null = null;
	private conventionFiles: ConventionFiles | null = null;
	private startupSummary?: TakumiAppOptions["startupSummary"];
	private httpBridge: HttpBridgeServer | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private terminalCapabilities = detectCapabilities();
	private extensionHostMessage: string | null = null;
	private keybindingStartupNotice: string | null = null;
	private readonly extensionUiStore = new ExtensionUiStore();
	readonly session: SessionManager;

	constructor(options: TakumiAppOptions) {
		this.config = options.config;
		this.stdin = options.stdin ?? process.stdin;
		this.stdout = options.stdout ?? process.stdout;
		this.autoPr = options.autoPr ?? false;
		this.autoShip = options.autoShip ?? false;
		this.providerFactory = options.providerFactory;
		this.extensionRunner = options.extensionRunner ?? null;
		this.conventionFiles = options.conventionFiles ?? null;
		this.startupSummary = options.startupSummary;
		this.state = new AppState();
		applyStartupControlPlaneState(this.state, options.startupControlPlane);
		this.state.provider.value = this.config.provider;
		this.state.model.value = this.config.model;
		this.state.setAvailableProviderModels(
			this.startupSummary?.availableProviderModels ?? {},
			this.startupSummary?.providerCatalogAuthority ?? "merge",
		);
		this.state.theme.value = typeof this.config.theme === "string" ? this.config.theme : "default";
		this.state.thinking.value = this.config.thinking;
		this.state.thinkingBudget.value = this.config.thinkingBudget;
		this.keybinds = new KeyBindingRegistry();
		this.commands = new SlashCommandRegistry();
		this.rootView = new RootView({
			state: this.state,
			config: this.config,
			commands: this.commands,
			keybinds: this.keybinds,
			extensionUiStore: this.extensionUiStore,
			onResumeSession: (sessionId) => this.session.resumeSession(sessionId),
		});
		if (options.sendMessage && options.tools) {
			this.agentRunner = new AgentRunner(
				this.state,
				this.config,
				options.sendMessage,
				options.tools,
				this.extensionRunner ?? undefined,
				this.conventionFiles ?? undefined,
				this.state.steeringQueue,
				{
					resolveProviderSendMessage: this.providerFactory,
				},
			);
			this.rootView.chatView.agentRunner = this.agentRunner;
		} else {
			this.agentRunner = null;
		}
		this.session = new SessionManager({
			state: this.state,
			getAgentRunner: () => this.agentRunner,
			extensionRunner: this.extensionRunner,
			extensionUiStore: this.extensionUiStore,
			getScheduler: () => this.scheduler,
			addInfoMessage: (text) => this.addInfoMessage(text),
		});
		this.session.resumeSessionId = options.resumeSessionId;
		this.syncDefaultKeybinds();
		this.registerDefaultCommands();
		if (this.extensionRunner) {
			this.extensionHostMessage = formatExtensionHostReport(
				registerExtensionHostSurfaces({
					extensionRunner: this.extensionRunner,
					commands: this.commands,
					keybinds: this.keybinds,
					state: this.state,
					addInfoMessage: (text) => this.addInfoMessage(text),
					activateSession: (session, notice, reason) => this.session.activateSession(session, notice, reason),
					resumeSession: (sessionId) => this.session.resumeSession(sessionId),
				}),
			);
		}
	}

	async start(): Promise<void> {
		log.info("Starting Takumi TUI");
		const keybindingResult = await this.reloadKeybindings();
		this.keybindingStartupNotice = formatKeybindingStartupNotice(keybindingResult);
		if (this.session.resumeSessionId) {
			const loaded = await loadSession(this.session.resumeSessionId);
			if (loaded) {
				this.session.applySessionState(loaded);
				log.info(`Resumed session: ${loaded.id} (${loaded.messages.length} messages)`);
			} else {
				this.state.sessionId.value = generateSessionId();
			}
		} else if (!this.state.sessionId.value) {
			this.state.sessionId.value = generateSessionId();
		}
		this.session.startAutoSaver();
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
		if (this.terminalCapabilities.osc133) {
			this.write(osc133CommandStart());
		}
		this.write(ANSI.ALT_SCREEN_ON);
		this.write(ANSI.CURSOR_HIDE);
		this.write(ANSI.BRACKETED_PASTE_ON);
		if ((this.stdin as any).setRawMode) (this.stdin as any).setRawMode(true);
		(this.stdin as any).resume?.();
		this.stdin.on(
			"data",
			createInputHandler({
				state: this.state,
				rootView: this.rootView,
				keybinds: this.keybinds,
				agentRunner: this.agentRunner,
				getActiveAutocycle: () => this.session.activeAutocycle,
				getScheduler: () => this.scheduler,
				addInfoMessage: (text) => this.addInfoMessage(text),
				write: (data) => this.write(data),
				quit: () => this.quit(),
				replayKeyContext: () => this.replayKeyContext(),
			}),
		);
		process.on("SIGWINCH", () => {
			if (this.resizeTimer) clearTimeout(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				this.resizeTimer = null;
				const { columns, rows } = this.getTerminalSize();
				this.scheduler?.resize(columns, rows);
				this.state.terminalSize.value = { width: columns, height: rows };
			}, 16);
		});
		process.on("SIGINT", () => this.quit());
		process.on("SIGTERM", () => this.quit());
		process.on("SIGHUP", () => this.quit());
		this.scheduler.setRoot(this.rootView);
		this.running = true;
		this.scheduler.start();
		this.state.terminalSize.value = { width: columns, height: rows };

		if (this.startupSummary) {
			this.addInfoMessage(formatStartupSummary(this.startupSummary));
		}
		if (this.extensionHostMessage) {
			this.addInfoMessage(this.extensionHostMessage);
		}
		if (this.keybindingStartupNotice) {
			this.addInfoMessage(this.keybindingStartupNotice);
		}

		// Phase 45 — bind extension runner actions
		if (this.extensionRunner) {
			await bindExtensionRunnerActions(this.extensionRunner, {
				state: this.state,
				agentRunner: this.agentRunner,
				config: this.config,
				extensionUiStore: this.extensionUiStore,
				getSessionTitleOverride: () => this.session.sessionTitleOverride,
				setSessionTitleOverride: (title) => {
					this.session.sessionTitleOverride = title;
				},
				addInfoMessage: (text) => this.addInfoMessage(text),
				quit: () => this.quit(),
			});
			log.info("Extension runner actions bound");
		}

		const scheduler = this.scheduler!;
		bindAppRenderSignals(this.state, scheduler);
		void this.reconnectChitragupta();

		this.httpBridge = await startDesktopBridge(this.state, this.agentRunner, this.extensionUiStore, {
			attachSession: async (sessionId) => {
				await this.session.resumeSession(sessionId);
				return { success: true };
			},
			persistSession: async () => {
				await this.session.autoSaver?.save();
			},
		});

		effect(() => {
			void this.state.messages.value;
			void this.state.streamingText.value;
			void this.state.isStreaming.value;
			void this.state.activeTool.value;
			void this.state.contextPercent.value;
			void this.state.pendingPermission.value;
			void this.state.sessionId.value;
			void this.state.provider.value;
			void this.state.model.value;
			void this.state.chitraguptaConnected.value;
			void this.state.continuityGrants.value;
			void this.state.continuityEvents.value;
			void this.state.continuityLease.value;
			this.httpBridge?.notifyStateChange();
			return undefined;
		});
	}

	async quit(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		if (this.resizeTimer) {
			clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
		this.stdin.removeAllListeners?.("data");
		await this.session.cleanupActiveWork("Application exit requested.");
		await this.session.rotateAutoSaver();
		this.clearChitraguptaIntervals();
		await disconnectChitragupta(this.state);
		await this.httpBridge?.stop();
		this.httpBridge = null;
		this.extensionUiStore.resetSessionUi();
		this.scheduler?.stop();
		this.write(ANSI.BRACKETED_PASTE_OFF);
		this.write(ANSI.CURSOR_SHOW);
		this.write(ANSI.ALT_SCREEN_OFF);
		if (this.terminalCapabilities.osc133) {
			this.write(osc133CommandDone(0));
		}
		if ((this.stdin as any).setRawMode) (this.stdin as any).setRawMode(false);
		process.exit(0);
	}

	renderFrame(): void {
		this.scheduler?.forceRender();
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

	private replayKeyContext() {
		return {
			state: this.state,
			addInfoMessage: (text: string) => this.addInfoMessage(text),
			scheduleRender: () => this.scheduler?.scheduleRender(),
		};
	}

	private syncDefaultKeybinds(definitions = DEFAULT_KEYBINDING_DEFINITIONS): void {
		syncDefaultKeybindingRegistry(
			this.keybinds,
			createDefaultKeybindingHandlers({
				state: this.state,
				rootView: this.rootView,
				chatView: this.chatView,
				commands: this.commands,
				getScheduler: () => this.scheduler,
				addInfoMessage: (text) => this.addInfoMessage(text),
				quit: () => this.quit(),
			}),
			definitions,
		);
	}

	private async ensureKeybindingsFile(): Promise<{ filePath: string; created: boolean }> {
		return ensureUserKeybindingConfigFile();
	}

	private async reloadKeybindings(): Promise<KeybindingConfigLoadResult> {
		const result = await loadUserKeybindingDefinitions();
		this.syncDefaultKeybinds(result.definitions);
		return result;
	}

	private registerDefaultCommands(): void {
		registerAppCommands(this.createCommandContext());
	}

	private async reconnectChitragupta(): Promise<ChitraguptaConnectResult> {
		this.clearChitraguptaIntervals();
		await disconnectChitragupta(this.state);
		return connectChitragupta(
			this.state,
			this.agentRunner,
			(timer) => {
				this.chitraguptaIntervals.push(timer);
			},
			this.config.chitraguptaDaemon?.socketPath,
		);
	}

	private clearChitraguptaIntervals(): void {
		for (const timer of this.chitraguptaIntervals) {
			clearInterval(timer);
		}
		this.chitraguptaIntervals = [];
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
			buildSessionData: () => this.session.buildSessionData(),
			startAutoSaver: () => this.session.startAutoSaver(),
			resumeSession: (sessionId) => this.session.resumeSession(sessionId),
			activateSession: (session, notice, reason) => this.session.activateSession(session, notice, reason),
			reconnectChitragupta: () => this.reconnectChitragupta(),
			quit: () => this.quit(),
			getExtensionRunner: () => this.extensionRunner,
			getConventionFiles: () => this.conventionFiles,
			ensureKeybindingsFile: () => this.ensureKeybindingsFile(),
			reloadKeybindings: () => this.reloadKeybindings(),
			getActiveCoder: () => this.session.activeCoder,
			setActiveCoder: (coder) => {
				this.session.activeCoder = coder;
			},
			getActiveAutocycle: () => this.session.activeAutocycle,
			setActiveAutocycle: (agent) => {
				this.session.activeAutocycle = agent;
			},
		};
	}
}

export { formatMessagesAsMarkdown, parseMouseEvent };
