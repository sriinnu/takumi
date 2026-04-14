/**
 * Extension runtime helpers for the TUI host.
 *
 * I keep the session/UI glue here so the app shell can stay thin while the
 * same contract remains reusable for future desktop and mobile clients.
 */

import type { ExtensionRunner, NotifyLevel, SessionContextActions, UIContextActions } from "@takumi/agent";
import type { AgentEvent, Message, TakumiConfig, ToolDefinition } from "@takumi/core";
import type { AgentRunner } from "./agent/agent-runner.js";
import type { ExtensionUiStore } from "./extension-ui-store.js";
import type { AppState } from "./state.js";

export interface CreateExtensionUiActionsOptions {
	addInfoMessage(text: string): void;
	uiStore: ExtensionUiStore;
}

export interface CreateExtensionSessionActionsOptions {
	getMessages(): Message[];
	getSessionId(): string;
	getSessionTitle(): string | null;
	setSessionTitle(title: string | null): void;
}

/** Create the currently supported UI actions for extension contexts. */
export function createExtensionUiActions(options: CreateExtensionUiActionsOptions): UIContextActions {
	return {
		hasUI: () => true,
		notify: (message, level) => {
			options.addInfoMessage(formatNotification(message, level));
		},
		confirm: (message, title) => options.uiStore.requestConfirm(message, title),
		pick: (items, title) => options.uiStore.requestPick(items, title),
		setWidget: (key, renderer) => {
			options.uiStore.setWidget(key, renderer);
		},
		removeWidget: (key) => {
			options.uiStore.removeWidget(key);
		},
	};
}

/** Create live session actions backed by the current TUI state. */
export function createExtensionSessionActions(options: CreateExtensionSessionActionsOptions): SessionContextActions {
	return {
		getSnapshot: () => {
			const entries = options.getMessages().map((message, index) => ({ index, message }));
			return {
				entries,
				length: entries.length,
				sessionId: options.getSessionId() || undefined,
			};
		},
		getName: () => options.getSessionTitle() ?? undefined,
		setName: (title) => {
			options.setSessionTitle(normalizeSessionTitle(title));
		},
	};
}

/** Emit the initial extension session lifecycle event when a session is live. */
export async function emitExtensionSessionStart(extensionRunner: ExtensionRunner, sessionId: string): Promise<void> {
	if (!sessionId) return;
	await extensionRunner.emit({ type: "session_start", sessionId });
}

/** Resolve the persisted session title from an explicit override or message history. */
export function buildSessionTitle(messages: Message[], explicitTitle: string | null): string {
	if (explicitTitle) return explicitTitle;
	for (const message of messages) {
		if (message.role !== "user" || message.content.length === 0) continue;
		const first = message.content[0];
		if (first.type === "text") return first.text.slice(0, 80).replace(/\n/g, " ");
	}
	return "Untitled session";
}

/** Normalize session titles so empty or placeholder values stay unset. */
export function normalizeSessionTitle(title: string | null | undefined): string | null {
	const trimmed = title?.trim();
	if (!trimmed || trimmed === "Untitled session") return null;
	return trimmed;
}

function formatNotification(message: string, level: NotifyLevel): string {
	if (level === "info") return message;
	return `${level.toUpperCase()}: ${message}`;
}

/** Options for binding extension runner actions to the TUI runtime. */
export interface BindExtensionActionsContext {
	state: AppState;
	agentRunner: AgentRunner | null;
	config: TakumiConfig;
	extensionUiStore: ExtensionUiStore;
	getSessionTitleOverride(): string | null;
	setSessionTitleOverride(title: string | null): void;
	addInfoMessage(text: string): void;
	quit(): void;
}

/** Wire the extension runner's four action surfaces into the live TUI runtime. */
export async function bindExtensionRunnerActions(
	runner: ExtensionRunner,
	ctx: BindExtensionActionsContext,
): Promise<void> {
	runner.bindActions(
		{
			getModel: () => ctx.state.model.value || undefined,
			getSessionId: () => ctx.state.sessionId.value || undefined,
			getCwd: () => process.cwd(),
			isIdle: () => !ctx.state.isStreaming.value,
			abort: () => ctx.agentRunner?.cancel(),
			getContextUsage: () => ({
				tokens: ctx.state.contextTokens.value,
				contextWindow: ctx.state.contextWindow.value,
				percent: ctx.state.contextPercent.value,
			}),
			getSystemPrompt: () => ctx.config.systemPrompt || "",
			compact: () => {
				/* future: trigger manual compaction */
			},
			shutdown: () => void ctx.quit(),
		},
		{
			sendUserMessage: (content) => ctx.agentRunner?.submit(content),
			getActiveTools: () => (ctx.agentRunner ? ctx.agentRunner.getTools().listNames() : []),
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
			addInfoMessage: (text) => ctx.addInfoMessage(text),
			uiStore: ctx.extensionUiStore,
		}),
		createExtensionSessionActions({
			getMessages: () => ctx.state.messages.value,
			getSessionId: () => ctx.state.sessionId.value,
			getSessionTitle: () => ctx.getSessionTitleOverride(),
			setSessionTitle: (title) => ctx.setSessionTitleOverride(title),
		}),
	);
	await emitExtensionSessionStart(runner, ctx.state.sessionId.value);
}
