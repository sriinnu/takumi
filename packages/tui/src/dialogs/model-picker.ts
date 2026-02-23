/**
 * ModelPicker — dialog for selecting the AI model.
 * Shows available models with provider info.
 * Pure logic/state class — no rendering.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";

const DEFAULT_MODELS = ["claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-haiku-3-20250307"];

export class ModelPicker {
	private readonly _isOpen: Signal<boolean> = signal(false);
	private readonly _selectedIndex: Signal<number> = signal(0);
	private readonly _models: Signal<string[]>;

	/** Called when a model is selected. */
	onSelect?: (model: string) => void;

	constructor(models?: string[]) {
		this._models = signal(models ?? DEFAULT_MODELS);
	}

	/** Show the picker and reset selection. */
	open(): void {
		this._isOpen.value = true;
		this._selectedIndex.value = 0;
	}

	/** Hide the picker. */
	close(): void {
		this._isOpen.value = false;
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
			const models = this._models.value;
			if (models.length > 0) {
				this._selectedIndex.value = Math.max(0, this._selectedIndex.value - 1);
			}
			return true;
		}

		// Down arrow
		if (event.raw === KEY_CODES.DOWN) {
			const models = this._models.value;
			if (models.length > 0) {
				this._selectedIndex.value = Math.min(models.length - 1, this._selectedIndex.value + 1);
			}
			return true;
		}

		// Enter — select model
		if (event.raw === KEY_CODES.ENTER) {
			const models = this._models.value;
			if (models.length > 0 && this._selectedIndex.value < models.length) {
				const model = models[this._selectedIndex.value];
				this.close();
				this.onSelect?.(model);
			}
			return true;
		}

		return true; // Consume all keys while open
	}

	/** Get the list of available models. */
	getModels(): string[] {
		return this._models.value;
	}

	get selectedIndex(): number {
		return this._selectedIndex.value;
	}

	get isOpen(): boolean {
		return this._isOpen.value;
	}
}
