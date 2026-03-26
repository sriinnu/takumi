/**
 * KeyBindingRegistry — manages keyboard shortcuts.
 * Keybinds are strings like "ctrl+k", "alt+p", "f1", "escape".
 */

import type { KeyEvent } from "@takumi/core";

export interface KeyBinding {
	id: string;
	key: string;
	description: string;
	handler: () => void;
	enabled: boolean;
	aliases: string[];
}

export interface RegisterKeyBindingOptions {
	id?: string;
	aliases?: string[];
}

const LEGACY_ID_PREFIX = "legacy.";

export class KeyBindingRegistry {
	private bindings = new Map<string, KeyBinding>();
	private bindingsById = new Map<string, KeyBinding>();

	/** Register a key binding. */
	register(key: string, description: string, handler: () => void, options: RegisterKeyBindingOptions = {}): void {
		const normalizedKey = normalizeKey(key);
		const id = normalizeBindingId(options.id ?? `${LEGACY_ID_PREFIX}${normalizedKey}`);
		const aliases = [...new Set((options.aliases ?? []).map(normalizeKey).filter((alias) => alias !== normalizedKey))];

		const existing = this.bindingsById.get(id);
		if (existing) {
			this.deleteBinding(existing);
		}

		const binding: KeyBinding = {
			id,
			key: normalizedKey,
			description,
			handler,
			enabled: true,
			aliases,
		};

		this.storeBinding(binding);
	}

	/** Unregister a key binding. */
	unregister(key: string): boolean {
		const binding = this.bindings.get(normalizeKey(key));
		if (!binding) return false;
		this.deleteBinding(binding);
		return true;
	}

	/** Unregister a binding by canonical action ID. */
	unregisterById(id: string): boolean {
		const binding = this.bindingsById.get(normalizeBindingId(id));
		if (!binding) return false;
		this.deleteBinding(binding);
		return true;
	}

	/** Enable/disable a key binding. */
	setEnabled(key: string, enabled: boolean): void {
		const binding = this.bindings.get(normalizeKey(key));
		if (binding) binding.enabled = enabled;
	}

	/** Enable/disable a binding by canonical action ID. */
	setEnabledById(id: string, enabled: boolean): void {
		const binding = this.bindingsById.get(normalizeBindingId(id));
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
		return [...this.bindingsById.values()];
	}

	/** Get a binding by key string. */
	get(key: string): KeyBinding | undefined {
		return this.bindings.get(normalizeKey(key));
	}

	/** Get a binding by canonical action ID. */
	getById(id: string): KeyBinding | undefined {
		return this.bindingsById.get(normalizeBindingId(id));
	}

	/** Check whether a binding ID currently matches the given key event. */
	matches(id: string, event: KeyEvent): boolean {
		const binding = this.getById(id);
		if (!binding || !binding.enabled) return false;
		const keyStr = eventToKeyString(event);
		return keyStr === binding.key || binding.aliases.includes(keyStr);
	}

	private storeBinding(binding: KeyBinding): void {
		this.bindings.set(binding.key, binding);
		for (const alias of binding.aliases) {
			this.bindings.set(alias, binding);
		}
		this.bindingsById.set(binding.id, binding);
	}

	private deleteBinding(binding: KeyBinding): void {
		this.bindings.delete(binding.key);
		for (const alias of binding.aliases) {
			this.bindings.delete(alias);
		}
		this.bindingsById.delete(binding.id);
	}
}

/** Normalize a key string to lowercase with consistent modifier order. */
function normalizeKey(key: string): string {
	const parts = key
		.toLowerCase()
		.split("+")
		.map((p) => p.trim());
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

function normalizeBindingId(id: string): string {
	return id.trim().toLowerCase();
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
