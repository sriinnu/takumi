/**
 * CommandPalette — fuzzy-searchable list of slash commands and keybindings.
 * Triggered by Ctrl+K. Pure logic/state class — no rendering.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";
import type { SlashCommandRegistry } from "../commands.js";
import type { KeyBindingRegistry } from "../keybinds.js";

export interface CommandPaletteItem {
	name: string;
	description: string;
	type: "command" | "keybind";
}

export class CommandPalette {
	private readonly commands: SlashCommandRegistry;
	private readonly keybinds: KeyBindingRegistry;

	private readonly _isOpen: Signal<boolean> = signal(false);
	private readonly _filterText: Signal<string> = signal("");
	private readonly _selectedIndex: Signal<number> = signal(0);

	/** Called when a command/keybind is executed from the palette. */
	onExecute?: (item: CommandPaletteItem) => void;

	constructor(commands: SlashCommandRegistry, keybinds: KeyBindingRegistry) {
		this.commands = commands;
		this.keybinds = keybinds;
	}

	/** Show the palette and reset filter/selection. */
	open(): void {
		this._isOpen.value = true;
		this._filterText.value = "";
		this._selectedIndex.value = 0;
	}

	/** Hide the palette. */
	close(): void {
		this._isOpen.value = false;
		this._filterText.value = "";
		this._selectedIndex.value = 0;
	}

	/** Process a key event. Returns true if the event was consumed. */
	handleKey(event: KeyEvent): boolean {
		if (!this._isOpen.value) return false;

		// Escape closes the palette
		if (event.raw === KEY_CODES.ESCAPE) {
			this.close();
			return true;
		}

		// Up arrow — navigate up
		if (event.raw === KEY_CODES.UP) {
			const items = this.getItems();
			if (items.length > 0) {
				this._selectedIndex.value = Math.max(0, this._selectedIndex.value - 1);
			}
			return true;
		}

		// Down arrow — navigate down
		if (event.raw === KEY_CODES.DOWN) {
			const items = this.getItems();
			if (items.length > 0) {
				this._selectedIndex.value = Math.min(items.length - 1, this._selectedIndex.value + 1);
			}
			return true;
		}

		// Enter — execute selected item
		if (event.raw === KEY_CODES.ENTER) {
			const items = this.getItems();
			if (items.length > 0 && this._selectedIndex.value < items.length) {
				const item = items[this._selectedIndex.value];
				this.close();
				if (item.type === "command") {
					this.commands.execute(item.name);
				}
				this.onExecute?.(item);
			}
			return true;
		}

		// Backspace — remove last filter character
		if (event.raw === KEY_CODES.BACKSPACE) {
			if (this._filterText.value.length > 0) {
				this._filterText.value = this._filterText.value.slice(0, -1);
				this._selectedIndex.value = 0;
			}
			return true;
		}

		// Printable character — append to filter
		if (event.key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
			this._filterText.value += event.key;
			this._selectedIndex.value = 0;
			return true;
		}

		return true; // Consume all keys while open
	}

	/** Get filtered list of items matching current filter text. */
	getItems(): CommandPaletteItem[] {
		const allItems = this.getAllItems();
		const filter = this._filterText.value.toLowerCase();

		if (!filter) return allItems;

		return allItems.filter(
			(item) => item.name.toLowerCase().includes(filter) || item.description.toLowerCase().includes(filter),
		);
	}

	/** Get all available items (commands + keybindings). */
	private getAllItems(): CommandPaletteItem[] {
		const items: CommandPaletteItem[] = [];

		// Add slash commands
		for (const cmd of this.commands.list()) {
			items.push({
				name: cmd.name,
				description: cmd.description,
				type: "command",
			});
		}

		// Add keybindings
		for (const kb of this.keybinds.list()) {
			items.push({
				name: kb.key,
				description: kb.description,
				type: "keybind",
			});
		}

		return items;
	}

	get selectedIndex(): number {
		return this._selectedIndex.value;
	}

	get filterText(): string {
		return this._filterText.value;
	}

	get isOpen(): boolean {
		return this._isOpen.value;
	}
}
