/**
 * KeyBindingRegistry — manages keyboard shortcuts.
 * Keybinds are strings like "ctrl+k", "alt+p", "f1", "escape".
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

export interface KeyBinding {
	key: string;
	description: string;
	handler: () => void;
	enabled: boolean;
}

export class KeyBindingRegistry {
	private bindings = new Map<string, KeyBinding>();

	/** Register a key binding. */
	register(key: string, description: string, handler: () => void): void {
		this.bindings.set(normalizeKey(key), {
			key: normalizeKey(key),
			description,
			handler,
			enabled: true,
		});
	}

	/** Unregister a key binding. */
	unregister(key: string): boolean {
		return this.bindings.delete(normalizeKey(key));
	}

	/** Enable/disable a key binding. */
	setEnabled(key: string, enabled: boolean): void {
		const binding = this.bindings.get(normalizeKey(key));
		if (binding) binding.enabled = enabled;
	}

	/** Handle a key event. Returns true if a binding was triggered. */
	handle(event: KeyEvent): boolean {
		const keyStr = eventToKeyString(event);
		const binding = this.bindings.get(keyStr);

		if (binding?.enabled) {
			binding.handler();
			return true;
		}

		return false;
	}

	/** List all registered bindings. */
	list(): KeyBinding[] {
		return [...this.bindings.values()];
	}

	/** Get a binding by key string. */
	get(key: string): KeyBinding | undefined {
		return this.bindings.get(normalizeKey(key));
	}
}

/** Normalize a key string to lowercase with consistent modifier order. */
function normalizeKey(key: string): string {
	const parts = key.toLowerCase().split("+").map((p) => p.trim());
	const modifiers: string[] = [];
	let mainKey = "";

	for (const part of parts) {
		if (part === "ctrl" || part === "control") modifiers.push("ctrl");
		else if (part === "alt" || part === "option") modifiers.push("alt");
		else if (part === "shift") modifiers.push("shift");
		else if (part === "meta" || part === "cmd" || part === "super") modifiers.push("meta");
		else mainKey = part;
	}

	// Sort modifiers for consistency: ctrl, alt, shift, meta
	modifiers.sort((a, b) => {
		const order = ["ctrl", "alt", "shift", "meta"];
		return order.indexOf(a) - order.indexOf(b);
	});

	return [...modifiers, mainKey].join("+");
}

/** Convert a KeyEvent to a normalized key string. */
function eventToKeyString(event: KeyEvent): string {
	const parts: string[] = [];
	if (event.ctrl) parts.push("ctrl");
	if (event.alt) parts.push("alt");
	if (event.shift) parts.push("shift");
	if (event.meta) parts.push("meta");
	parts.push(event.key.toLowerCase());
	return parts.join("+");
}
