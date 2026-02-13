/**
 * FilePicker — dialog for @-reference file browsing.
 * Shows files matching a typed query, with filter input.
 * Pure logic/state class — no rendering.
 */

import { signal } from "@takumi/render";
import type { Signal } from "@takumi/render";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

export class FilePicker {
	private readonly _isOpen: Signal<boolean> = signal(false);
	private readonly _filterText: Signal<string> = signal("");
	private readonly _selectedIndex: Signal<number> = signal(0);
	private readonly _files: Signal<string[]> = signal([]);

	/** Called when a file is selected. */
	onSelect?: (filePath: string) => void;

	constructor() {}

	/** Show the picker and reset state. */
	open(): void {
		this._isOpen.value = true;
		this._filterText.value = "";
		this._selectedIndex.value = 0;
	}

	/** Hide the picker. */
	close(): void {
		this._isOpen.value = false;
		this._filterText.value = "";
		this._selectedIndex.value = 0;
	}

	/** Set the full list of available files. */
	setFiles(files: string[]): void {
		this._files.value = files;
		this._selectedIndex.value = 0;
	}

	/** Process a key event. Returns true if the event was consumed. */
	handleKey(event: KeyEvent): boolean {
		if (!this._isOpen.value) return false;

		// Escape closes
		if (event.raw === KEY_CODES.ESCAPE) {
			this.close();
			return true;
		}

		// Up arrow
		if (event.raw === KEY_CODES.UP) {
			const filtered = this.filteredFiles;
			if (filtered.length > 0) {
				this._selectedIndex.value = Math.max(0, this._selectedIndex.value - 1);
			}
			return true;
		}

		// Down arrow
		if (event.raw === KEY_CODES.DOWN) {
			const filtered = this.filteredFiles;
			if (filtered.length > 0) {
				this._selectedIndex.value = Math.min(filtered.length - 1, this._selectedIndex.value + 1);
			}
			return true;
		}

		// Enter — select file
		if (event.raw === KEY_CODES.ENTER) {
			const filtered = this.filteredFiles;
			if (filtered.length > 0 && this._selectedIndex.value < filtered.length) {
				const file = filtered[this._selectedIndex.value];
				this.close();
				this.onSelect?.(file);
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

	get filterText(): string {
		return this._filterText.value;
	}

	/** Get the filtered file list based on current filter text. */
	get filteredFiles(): string[] {
		const filter = this._filterText.value.toLowerCase();
		if (!filter) return this._files.value;
		return this._files.value.filter((f) => f.toLowerCase().includes(filter));
	}

	get selectedIndex(): number {
		return this._selectedIndex.value;
	}

	get isOpen(): boolean {
		return this._isOpen.value;
	}
}
