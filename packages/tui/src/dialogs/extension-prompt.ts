/**
 * ExtensionPromptDialog — logic-only state for extension-driven confirm/pick prompts.
 *
 * I keep prompt interaction here so the overlay can stay focused on rendering
 * and host routing while the same prompt semantics remain portable to other
 * shells later.
 */

import type { PickItem } from "@takumi/agent";
import { KEY_CODES, type KeyEvent } from "@takumi/core";
import type { ExtensionUiPrompt } from "../extension-ui-store.js";

export type ExtensionPromptOutcome = { kind: "pending" } | { kind: "cancel" } | { kind: "resolve"; value: unknown };

export interface ExtensionPromptWindow {
	items: Array<PickItem<unknown>>;
	offset: number;
}

const PICK_WINDOW_SIZE = 6;

function matchesFilter(item: PickItem<unknown>, filter: string): boolean {
	if (!filter) return true;
	const lowered = filter.toLowerCase();
	return item.label.toLowerCase().includes(lowered) || item.description?.toLowerCase().includes(lowered) === true;
}

function isPrintableKey(event: KeyEvent): boolean {
	return event.key.length === 1 && !event.ctrl && !event.alt && !event.meta;
}

export class ExtensionPromptDialog {
	private promptValue: ExtensionUiPrompt | null = null;
	private filterValue = "";
	private selectedIndexValue = 0;

	/** Open a prompt unless it is already active. */
	open(prompt: ExtensionUiPrompt): void {
		if (this.promptValue?.id === prompt.id) return;
		this.promptValue = prompt;
		this.filterValue = "";
		this.selectedIndexValue = 0;
	}

	/** Close the prompt and clear local selection state. */
	close(): void {
		this.promptValue = null;
		this.filterValue = "";
		this.selectedIndexValue = 0;
	}

	/** Process a key and return a host action for the active prompt. */
	handleKey(event: KeyEvent): ExtensionPromptOutcome {
		const prompt = this.promptValue;
		if (!prompt) return { kind: "pending" };
		if (prompt.kind === "confirm") {
			return this.handleConfirmKey(event);
		}
		return this.handlePickKey(event);
	}

	/** Return the filtered pick items around the current selection. */
	getPickWindow(limit = PICK_WINDOW_SIZE): ExtensionPromptWindow {
		const items = this.getPickItems();
		if (items.length <= limit) {
			return { items, offset: 0 };
		}
		const start = Math.max(0, Math.min(this.selectedIndexValue - Math.floor(limit / 2), items.length - limit));
		return { items: items.slice(start, start + limit), offset: start };
	}

	/** Return the filtered pick list for the active prompt. */
	getPickItems(): Array<PickItem<unknown>> {
		const prompt = this.promptValue;
		if (!prompt || prompt.kind !== "pick") return [];
		return prompt.items.filter((item) => matchesFilter(item, this.filterValue));
	}

	get prompt(): ExtensionUiPrompt | null {
		return this.promptValue;
	}

	get filterText(): string {
		return this.filterValue;
	}

	get selectedIndex(): number {
		return this.selectedIndexValue;
	}

	get isOpen(): boolean {
		return this.promptValue !== null;
	}

	private handleConfirmKey(event: KeyEvent): ExtensionPromptOutcome {
		if (event.key === "y" || event.raw === KEY_CODES.ENTER) {
			this.close();
			return { kind: "resolve", value: true };
		}
		if (event.key === "n" || event.raw === KEY_CODES.ESCAPE) {
			this.close();
			return { kind: "cancel" };
		}
		return { kind: "pending" };
	}

	private handlePickKey(event: KeyEvent): ExtensionPromptOutcome {
		if (event.raw === KEY_CODES.ESCAPE) {
			this.close();
			return { kind: "cancel" };
		}
		if (event.raw === KEY_CODES.UP || (!event.ctrl && event.key === "k")) {
			this.selectedIndexValue = Math.max(0, this.selectedIndexValue - 1);
			return { kind: "pending" };
		}
		if (event.raw === KEY_CODES.DOWN || (!event.ctrl && event.key === "j")) {
			const items = this.getPickItems();
			this.selectedIndexValue = Math.min(Math.max(0, items.length - 1), this.selectedIndexValue + 1);
			return { kind: "pending" };
		}
		if (event.raw === KEY_CODES.BACKSPACE) {
			if (this.filterValue.length > 0) {
				this.filterValue = this.filterValue.slice(0, -1);
				this.clampSelectedIndex();
			}
			return { kind: "pending" };
		}
		if (event.raw === KEY_CODES.ENTER) {
			const item = this.getPickItems()[this.selectedIndexValue];
			if (!item) return { kind: "pending" };
			this.close();
			return { kind: "resolve", value: item.value };
		}
		if (isPrintableKey(event)) {
			this.filterValue += event.key;
			this.clampSelectedIndex();
			return { kind: "pending" };
		}
		return { kind: "pending" };
	}

	private clampSelectedIndex(): void {
		const items = this.getPickItems();
		this.selectedIndexValue = Math.max(0, Math.min(this.selectedIndexValue, Math.max(0, items.length - 1)));
	}
}
