import type { ConventionFiles, ExtensionRunner, MessagePayload, ToolRegistry } from "@takumi/agent";
import type { HttpBridgeServer } from "@takumi/bridge";
import type { AgentEvent, AutoSaver, Message, SessionData, TakumiConfig, ToolDefinition } from "@takumi/core";
import { ANSI, createAutoSaver, createLogger, generateSessionId, LIMITS, loadSession } from "@takumi/core";
import {
	detectCapabilities,
	effect,
	initYoga,
	osc133CommandDone,
	osc133CommandStart,
	RenderScheduler,
} from "@takumi/render";
import { AgentRunner } from "./agent/agent-runner.js";
import type { CodingAgent } from "./agent/coding-agent.js";
import { formatMessagesAsMarkdown } from "./app-export.js";
import { formatExtensionHostReport, registerExtensionHostSurfaces } from "./app-extension-host.js";
import {
	buildSessionTitle,
	createExtensionSessionActions,
	createExtensionUiActions,
	emitExtensionSessionStart,
	normalizeSessionTitle,
} from "./app-extension-runtime.js";
import { bindAppRenderSignals } from "./app-render-signals.js";
import { attachSessionToRuntime } from "./app-session-attach.js";
import { applyPersistedSessionState, buildSessionControlPlaneState } from "./app-session-control-plane.js";
import {
	applyStartupControlPlaneState,
	formatStartupSummary,
	type StartupControlPlaneState,
	type StartupSummary,
} from "./app-startup.js";
import type { AutocycleAgent } from "./autocycle/autocycle-agent.js";
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
import { parseKeyEvent, parseMouseEvent } from "./input/app-input.js";
import {
	DEFAULT_KEYBINDING_DEFINITIONS,
	ensureUserKeybindingConfigFile,
	formatKeybindingStartupNotice,
	type KeybindingConfigLoadResult,
	loadUserKeybindingDefinitions,
	syncDefaultKeybindingRegistry,
} from "./input/keybinding-config.js";
import { KeyBindingRegistry } from "./input/keybinds.js";
import { handleReplayKey } from "./input/replay-keybinds.js";
import { cycleProviderModel, cycleThinkingLevel, describeThinkingLevel } from "./runtime-ux.js";
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
	private autoSaver: AutoSaver | null = null;
	private resumeSessionId: string | undefined;
	private activeCoder: CodingAgent | null = null;
	private activeAutocycle: AutocycleAgent | null = null;
	private chitraguptaIntervals: ReturnType<typeof setInterval>[] = [];
	private autoPr: boolean;
	private autoShip: boolean;
	private providerFactory?: ProviderFactory;
	private extensionRunner: ExtensionRunner | null = null;
	private conventionFiles: ConventionFiles | null = null;
	private startupSummary?: TakumiAppOptions["startupSummary"];
	private httpBridge: HttpBridgeServer | null = null;
	private terminalCapabilities = detectCapabilities();
	private extensionHostMessage: string | null = null;
	private keybindingStartupNotice: string | null = null;
	private sessionTitleOverride: string | null = null;
	private readonly extensionUiStore = new ExtensionUiStore();

	constructor(options: TakumiAppOptions) {
		this.config = options.config;
		this.stdin = options.stdin ?? process.stdin;
		this.stdout = options.stdout ?? process.stdout;
		this.resumeSessionId = options.resumeSessionId;
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
		this.state.setAvailableProviderModels(this.startupSummary?.availableProviderModels ?? {});
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
			onResumeSession: (sessionId) => this.resumeSession(sessionId),
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
					activateSession: (session, notice, reason) => this.activateSession(session, notice, reason),
					resumeSession: (sessionId) => this.resumeSession(sessionId),
				}),
			);
		}
	}

	async start(): Promise<void> {
		log.info("Starting Takumi TUI");
		const keybindingResult = await this.reloadKeybindings();
		this.keybindingStartupNotice = formatKeybindingStartupNotice(keybindingResult);
		if (this.resumeSessionId) {
			const loaded = await loadSession(this.resumeSessionId);
			if (loaded) {
				this.applySessionState(loaded);
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
		if (this.terminalCapabilities.osc133) {
			this.write(osc133CommandStart());
		}
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
			this.extensionRunner.bindActions(
				{
					getModel: () => this.state.model.value || undefined,
					getSessionId: () => this.state.sessionId.value || undefined,
					getCwd: () => process.cwd(),
					isIdle: () => !this.state.isStreaming.value,
					abort: () => this.agentRunner?.cancel(),
					getContextUsage: () => ({
						tokens: this.state.contextTokens.value,
						contextWindow: this.state.contextWindow.value,
						percent: this.state.contextPercent.value,
					}),
					getSystemPrompt: () => this.config.systemPrompt || "",
					compact: () => {
						/* future: trigger manual compaction */
					},
					shutdown: () => void this.quit(),
				},
				{
					sendUserMessage: (content) => this.agentRunner?.submit(content),
					getActiveTools: () => (this.agentRunner ? this.agentRunner.getTools().listNames() : []),
					setActiveTools: () => {
						/* future: dynamic tool enable/disable */
					},
					exec: async (command, args) => {
						const { execFile } = await import("node:child_process");
						const { promisify } = await import("node:util");
						const execFileAsync = promisify(execFile);
						try {
							const { stdout, stderr } = await execFileAsync(command, args ?? []);
							return { stdout, stderr, exitCode: 0 };
						} catch (err: unknown) {
							const e = err as { stdout?: string; stderr?: string; code?: number };
							return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
						}
					},
				},
				createExtensionUiActions({
					addInfoMessage: (text) => this.addInfoMessage(text),
					uiStore: this.extensionUiStore,
				}),
				createExtensionSessionActions({
					getMessages: () => this.state.messages.value,
					getSessionId: () => this.state.sessionId.value,
					getSessionTitle: () => this.sessionTitleOverride,
					setSessionTitle: (title) => {
						this.sessionTitleOverride = title;
					},
				}),
			);
			await emitExtensionSessionStart(this.extensionRunner, this.state.sessionId.value);
			log.info("Extension runner actions bound");
		}

		const scheduler = this.scheduler!;
		bindAppRenderSignals(this.state, scheduler);
		void this.reconnectChitragupta();

		this.httpBridge = await startDesktopBridge(this.state, this.agentRunner, this.extensionUiStore, {
			attachSession: (sessionId) =>
				attachSessionToRuntime({
					sessionId,
					model: this.state.model.value,
					chitragupta: this.state.chitraguptaBridge.value,
					activateSession: (session, notice) => this.activateSession(session, notice, "resume"),
				}),
			persistSession: async () => {
				await this.autoSaver?.save();
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
		await this.cleanupActiveWork("Application exit requested.");
		if (this.autoSaver) {
			try {
				await this.autoSaver.save();
			} catch {
				/* best effort */
			}
			this.autoSaver.stop();
			this.autoSaver = null;
		}
		this.clearChitraguptaIntervals();
		await disconnectChitragupta(this.state);
		await this.httpBridge?.stop();
		this.httpBridge = null;
		this.extensionUiStore.resetSessionUi();
		this.scheduler?.stop();
		this.write(ANSI.BRACKETED_PASTE_OFF);
		this.write(ANSI.MOUSE_OFF);
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

	private handleInput(data: Buffer): void {
		const raw = data.toString("utf-8");
		const mouseEvent = parseMouseEvent(raw);
		if (mouseEvent) {
			this.handleMouse(mouseEvent);
			this.scheduler?.schedulePriorityRender();
			return;
		}
		const event = parseKeyEvent(raw);
		if (event.ctrl && event.key === "c") {
			if (this.agentRunner?.isRunning) {
				this.agentRunner.cancel();
				return;
			}
			if (this.activeAutocycle?.isActive) {
				this.activeAutocycle.cancel();
				this.addInfoMessage("Autocycle cancelled.");
				return;
			}
			void this.quit();
			return;
		}
		if (this.state.replayMode.value && handleReplayKey(event, this.replayKeyContext())) {
			this.scheduler?.schedulePriorityRender();
			return;
		}
		if (this.keybinds.handle(event)) {
			this.scheduler?.schedulePriorityRender();
			return;
		}
		this.rootView.handleKey(event);
		this.scheduler?.schedulePriorityRender();
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

	private applySessionState(session: SessionData): void {
		this.sessionTitleOverride = normalizeSessionTitle(session.title);
		this.extensionUiStore.resetSessionUi();
		applyPersistedSessionState(this.state, session);
		this.agentRunner?.hydrateHistory(session.messages);
	}

	private async cleanupActiveWork(reason: string): Promise<void> {
		if (this.agentRunner?.isRunning) {
			this.agentRunner.cancel();
		}

		const activeAutocycle = this.activeAutocycle;
		this.activeAutocycle = null;
		if (activeAutocycle?.isActive) {
			activeAutocycle.cancel();
		}

		const activeCoder = this.activeCoder;
		this.activeCoder = null;
		if (!activeCoder) {
			return;
		}

		if (activeCoder.isActive) {
			await activeCoder.cancel(reason);
		}
		await activeCoder.shutdown();
	}

	private async rotateAutoSaver(): Promise<void> {
		if (!this.autoSaver) return;
		try {
			await this.autoSaver.save();
		} catch {
			/* best effort */
		}
		this.autoSaver.stop();
		this.autoSaver = null;
	}

	private async activateSession(
		session: SessionData,
		notice?: string,
		reason: "new" | "resume" = "resume",
	): Promise<void> {
		const previousSessionId = this.state.sessionId.value || undefined;
		if (this.extensionRunner) {
			const cancelled = await this.extensionRunner.emitCancellable({
				type: "session_before_switch",
				reason,
				targetSessionId: session.id,
			});
			if (cancelled?.cancel) {
				this.addInfoMessage("Session switch blocked by extension.");
				return;
			}
		}

		await this.cleanupActiveWork(`Switching to session ${session.id}.`);
		await this.rotateAutoSaver();
		this.applySessionState(session);
		this.resumeSessionId = session.id;
		this.startAutoSaver();
		if (this.extensionRunner) {
			await this.extensionRunner.emit({
				type: "session_switch",
				reason,
				previousSessionId,
			});
		}
		if (notice) {
			this.addInfoMessage(notice);
		}
		this.scheduler?.scheduleRender();
	}

	private async resumeSession(sessionId: string): Promise<void> {
		const result = await attachSessionToRuntime({
			sessionId,
			model: this.state.model.value,
			chitragupta: this.state.chitraguptaBridge.value,
			activateSession: (session, notice) => this.activateSession(session, notice, "resume"),
		});
		if (!result.success) {
			this.addInfoMessage(result.error ?? `Could not resume session: ${sessionId}`);
		}
	}

	private buildSessionData(): SessionData {
		const messages = this.state.messages.value;
		const controlPlane = buildSessionControlPlaneState(this.state);
		return {
			id: this.state.sessionId.value,
			title: buildSessionTitle(messages, this.sessionTitleOverride),
			createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
			updatedAt: Date.now(),
			messages,
			model: this.state.model.value,
			tokenUsage: {
				inputTokens: this.state.totalInputTokens.value,
				outputTokens: this.state.totalOutputTokens.value,
				totalCost: this.state.totalCost.value,
			},
			controlPlane,
		};
	}

	private startAutoSaver(): void {
		if (!this.autoSaver) {
			this.autoSaver = createAutoSaver(this.state.sessionId.value, () => this.buildSessionData());
		}
	}

	private replayKeyContext() {
		return {
			state: this.state,
			addInfoMessage: (text: string) => this.addInfoMessage(text),
			scheduleRender: () => this.scheduler?.scheduleRender(),
		};
	}

	private createDefaultKeybindingHandlers(): Record<string, () => void> {
		const toggleCommandPalette = () => {
			if (this.state.topDialog === "command-palette") this.state.popDialog();
			else this.state.pushDialog("command-palette");
		};

		return {
			"app.quit": () => this.quit(),
			"app.screen.clear": () => {
				this.scheduler?.getScreen().invalidate();
				this.scheduler?.scheduleRender();
			},
			"app.command-palette.toggle": toggleCommandPalette,
			"app.preview.toggle": () => {
				this.rootView.togglePreview();
			},
			"app.model-picker.toggle": () => {
				if (this.state.topDialog === "model-picker") this.state.popDialog();
				else this.state.pushDialog("model-picker");
			},
			"app.sidebar.toggle": () => {
				this.state.sidebarVisible.value = !this.state.sidebarVisible.value;
			},
			"app.cluster-status.toggle": () => {
				this.rootView.sidebar.clusterPanel.toggle();
			},
			"app.sessions.list": () => this.state.pushDialog("session-list"),
			"app.sessions.tree": () => {
				void this.commands.execute("/session-tree");
			},
			"app.exit-if-editor-empty": () => {
				if (!this.chatView.getEditorValue()) void this.quit();
			},
			"app.thinking.cycle": () => {
				const level = cycleThinkingLevel(this.state, 1);
				this.addInfoMessage(`Thinking level: ${describeThinkingLevel(level)}`);
			},
			"app.model.cycle": () => {
				const selected = cycleProviderModel(this.state, 1);
				if (selected) {
					this.addInfoMessage(`Model cycled to: ${selected} (${this.state.provider.value})`);
				}
			},
			"app.editor.external": () => {
				void this.commands.execute("/editor");
			},
		};
	}

	private syncDefaultKeybinds(definitions = DEFAULT_KEYBINDING_DEFINITIONS): void {
		syncDefaultKeybindingRegistry(this.keybinds, this.createDefaultKeybindingHandlers(), definitions);
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
			buildSessionData: () => this.buildSessionData(),
			startAutoSaver: () => this.startAutoSaver(),
			resumeSession: (sessionId) => this.resumeSession(sessionId),
			activateSession: (session, notice, reason) => this.activateSession(session, notice, reason),
			reconnectChitragupta: () => this.reconnectChitragupta(),
			quit: () => this.quit(),
			getExtensionRunner: () => this.extensionRunner,
			getConventionFiles: () => this.conventionFiles,
			ensureKeybindingsFile: () => this.ensureKeybindingsFile(),
			reloadKeybindings: () => this.reloadKeybindings(),
			getActiveCoder: () => this.activeCoder,
			setActiveCoder: (coder) => {
				this.activeCoder = coder;
			},
			getActiveAutocycle: () => this.activeAutocycle,
			setActiveAutocycle: (agent) => {
				this.activeAutocycle = agent;
			},
		};
	}
}

export { formatMessagesAsMarkdown, parseMouseEvent };
