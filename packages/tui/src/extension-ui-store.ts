/**
 * Extension UI store.
 *
 * I keep extension-driven prompts and sidebar widgets in one host-owned store
 * so TUI, desktop, and future device clients can share the same contract.
 */

import type { PickItem, WidgetRenderer } from "@takumi/agent";
import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";

export interface ExtensionWidgetEntry {
	key: string;
	renderer: WidgetRenderer;
}

export interface ExtensionConfirmPrompt {
	id: string;
	kind: "confirm";
	title?: string;
	message: string;
	resolve: (value: boolean) => void;
	fallbackValue: false;
}

export interface ExtensionPickPrompt {
	id: string;
	kind: "pick";
	title?: string;
	message: string;
	items: Array<PickItem<unknown>>;
	resolve: (value: unknown) => void;
	fallbackValue: undefined;
}

export type ExtensionUiPrompt = ExtensionConfirmPrompt | ExtensionPickPrompt;

export class ExtensionUiStore {
	readonly activePrompt: Signal<ExtensionUiPrompt | null> = signal(null);
	readonly widgets: Signal<ExtensionWidgetEntry[]> = signal<ExtensionWidgetEntry[]>([]);
	private promptQueue: ExtensionUiPrompt[] = [];
	private promptCounter = 0;

	/** Queue a confirm prompt and resolve when the operator answers it. */
	requestConfirm(message: string, title?: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			this.enqueuePrompt({
				id: this.nextPromptId(),
				kind: "confirm",
				title,
				message,
				resolve,
				fallbackValue: false,
			});
		});
	}

	/** Queue a pick prompt and resolve with the chosen value, or undefined on cancel. */
	requestPick<T>(items: PickItem<T>[], title?: string): Promise<T | undefined> {
		return new Promise<T | undefined>((resolve) => {
			this.enqueuePrompt({
				id: this.nextPromptId(),
				kind: "pick",
				title,
				message: title ?? "Select an option",
				items: items as Array<PickItem<unknown>>,
				resolve: resolve as (value: unknown) => void,
				fallbackValue: undefined,
			});
		});
	}

	/** Resolve the active prompt and advance the queue. */
	resolveActivePrompt(value: unknown): void {
		const prompt = this.activePrompt.value;
		if (!prompt) return;
		this.resolvePrompt(prompt, value);
		this.advanceQueue();
	}

	/** Cancel the active prompt with its neutral fallback value. */
	cancelActivePrompt(): void {
		const prompt = this.activePrompt.value;
		if (!prompt) return;
		this.resolvePrompt(prompt, prompt.fallbackValue);
		this.advanceQueue();
	}

	/** Dismiss all pending prompts and clear the queue. */
	dismissAllPrompts(): void {
		const active = this.activePrompt.value;
		if (active) {
			this.resolvePrompt(active, active.fallbackValue);
		}
		for (const prompt of this.promptQueue) {
			this.resolvePrompt(prompt, prompt.fallbackValue);
		}
		this.promptQueue = [];
		this.activePrompt.value = null;
	}

	/** Add or replace a sidebar widget by stable key. */
	setWidget(key: string, renderer: WidgetRenderer): void {
		const next = [...this.widgets.value];
		const index = next.findIndex((entry) => entry.key === key);
		if (index >= 0) next[index] = { key, renderer };
		else next.push({ key, renderer });
		this.widgets.value = next;
	}

	/** Remove a sidebar widget if it exists. */
	removeWidget(key: string): void {
		this.widgets.value = this.widgets.value.filter((entry) => entry.key !== key);
	}

	/** Clear all session-scoped UI state before a session boundary. */
	resetSessionUi(): void {
		this.dismissAllPrompts();
		this.widgets.value = [];
	}

	private enqueuePrompt(prompt: ExtensionUiPrompt): void {
		if (!this.activePrompt.value) {
			this.activePrompt.value = prompt;
			return;
		}
		this.promptQueue.push(prompt);
	}

	private advanceQueue(): void {
		this.activePrompt.value = this.promptQueue.shift() ?? null;
	}

	private resolvePrompt(prompt: ExtensionUiPrompt, value: unknown): void {
		if (prompt.kind === "confirm") {
			prompt.resolve(Boolean(value));
			return;
		}
		prompt.resolve(value);
	}

	private nextPromptId(): string {
		this.promptCounter += 1;
		return `ext-ui-${this.promptCounter}`;
	}
}
