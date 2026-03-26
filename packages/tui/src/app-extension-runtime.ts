/**
 * Extension runtime helpers for the TUI host.
 *
 * I keep the session/UI glue here so the app shell can stay thin while the
 * same contract remains reusable for future desktop and mobile clients.
 */

import type { ExtensionRunner, NotifyLevel, SessionContextActions, UIContextActions } from "@takumi/agent";
import type { Message } from "@takumi/core";
import type { ExtensionUiStore } from "./extension-ui-store.js";

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
