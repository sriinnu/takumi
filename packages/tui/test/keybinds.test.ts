import type { KeyEvent } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { KeyBindingRegistry } from "../src/input/keybinds.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeKeyEvent(overrides?: Partial<KeyEvent>): KeyEvent {
	return {
		key: "",
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		raw: "",
		...overrides,
	};
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("KeyBindingRegistry", () => {
	/* ---- register -------------------------------------------------------- */

	describe("register", () => {
		it("adds a binding", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());

			expect(reg.get("ctrl+k")).toBeDefined();
			expect(reg.get("ctrl+k")!.id).toBe("legacy.ctrl+k");
		});

		it("stores a canonical namespaced id when provided", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Command palette", vi.fn(), { id: "app.command-palette.toggle" });

			expect(reg.getById("app.command-palette.toggle")?.key).toBe("ctrl+k");
		});

		it("supports alias keys for the same action", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+p", "Preview", vi.fn(), {
				id: "app.test-action",
				aliases: ["ctrl+shift+p"],
			});

			expect(reg.get("ctrl+p")?.id).toBe("app.test-action");
			expect(reg.get("ctrl+shift+p")?.id).toBe("app.test-action");
		});

		it("stores description", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());

			expect(reg.get("ctrl+k")!.description).toBe("Kill line");
		});

		it("sets enabled to true by default", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());

			expect(reg.get("ctrl+k")!.enabled).toBe(true);
		});

		it("normalizes the key on register", () => {
			const reg = new KeyBindingRegistry();
			reg.register("Control+K", "Kill line", vi.fn());

			// Should be stored as normalized "ctrl+k"
			expect(reg.get("ctrl+k")).toBeDefined();
			expect(reg.get("Control+K")).toBeDefined(); // get also normalizes
		});

		it("overwrites existing binding for the same key", () => {
			const reg = new KeyBindingRegistry();
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			reg.register("ctrl+k", "First", handler1);
			reg.register("ctrl+k", "Second", handler2);

			const binding = reg.get("ctrl+k");
			expect(binding!.description).toBe("Second");
			expect(binding!.handler).toBe(handler2);
		});

		it("removes stale ids when a different action claims the same key", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Quit", vi.fn(), { id: "app.quit" });
			reg.register("ctrl+k", "Palette", vi.fn(), { id: "app.command-palette.toggle" });

			expect(reg.getById("app.quit")).toBeUndefined();
			expect(reg.getById("app.command-palette.toggle")?.key).toBe("ctrl+k");
		});
	});

	/* ---- handle ---------------------------------------------------------- */

	describe("handle", () => {
		it("triggers handler and returns true for registered key", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+k", "Kill line", handler);

			const result = reg.handle(makeKeyEvent({ key: "k", ctrl: true }));

			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("returns false for unregistered key", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());

			const result = reg.handle(makeKeyEvent({ key: "l", ctrl: true }));
			expect(result).toBe(false);
		});

		it("handles modifier-less key events", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("escape", "Close dialog", handler);

			const result = reg.handle(makeKeyEvent({ key: "escape" }));

			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("handles multi-modifier key events", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+shift+p", "Command palette", handler);

			const result = reg.handle(makeKeyEvent({ key: "p", ctrl: true, shift: true }));

			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("distinguishes different modifier combinations", () => {
			const reg = new KeyBindingRegistry();
			const ctrlHandler = vi.fn();
			const altHandler = vi.fn();
			reg.register("ctrl+k", "Ctrl action", ctrlHandler);
			reg.register("alt+k", "Alt action", altHandler);

			reg.handle(makeKeyEvent({ key: "k", ctrl: true }));
			expect(ctrlHandler).toHaveBeenCalledOnce();
			expect(altHandler).not.toHaveBeenCalled();

			reg.handle(makeKeyEvent({ key: "k", alt: true }));
			expect(altHandler).toHaveBeenCalledOnce();
		});

		it("triggers through alias keys", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+p", "Preview", handler, {
				id: "app.test-action",
				aliases: ["ctrl+shift+p"],
			});

			const result = reg.handle(makeKeyEvent({ key: "p", ctrl: true, shift: true }));

			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("does not trigger disabled bindings", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+k", "Kill line", handler);
			reg.setEnabled("ctrl+k", false);

			const result = reg.handle(makeKeyEvent({ key: "k", ctrl: true }));

			expect(result).toBe(false);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	/* ---- setEnabled ------------------------------------------------------ */

	describe("setEnabled", () => {
		it("disables a binding", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());
			reg.setEnabled("ctrl+k", false);

			expect(reg.get("ctrl+k")!.enabled).toBe(false);
		});

		it("re-enables a disabled binding", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+k", "Kill line", handler);
			reg.setEnabled("ctrl+k", false);
			reg.setEnabled("ctrl+k", true);

			expect(reg.get("ctrl+k")!.enabled).toBe(true);

			// Handler should work again
			const result = reg.handle(makeKeyEvent({ key: "k", ctrl: true }));
			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("normalizes key before toggling", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());
			reg.setEnabled("Control+K", false);

			expect(reg.get("ctrl+k")!.enabled).toBe(false);
		});

		it("no-ops for unknown key", () => {
			const reg = new KeyBindingRegistry();
			// Should not throw
			reg.setEnabled("ctrl+z", false);
			expect(reg.get("ctrl+z")).toBeUndefined();
		});

		it("can disable by namespaced id", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Command palette", vi.fn(), { id: "app.command-palette.toggle" });
			reg.setEnabledById("app.command-palette.toggle", false);

			expect(reg.getById("app.command-palette.toggle")?.enabled).toBe(false);
		});
	});

	/* ---- unregister ------------------------------------------------------ */

	describe("unregister", () => {
		it("removes a binding", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());
			const result = reg.unregister("ctrl+k");

			expect(result).toBe(true);
			expect(reg.get("ctrl+k")).toBeUndefined();
		});

		it("returns false for unknown key", () => {
			const reg = new KeyBindingRegistry();
			expect(reg.unregister("ctrl+z")).toBe(false);
		});

		it("normalizes key before unregistering", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());
			const result = reg.unregister("Control+K");

			expect(result).toBe(true);
			expect(reg.get("ctrl+k")).toBeUndefined();
		});

		it("makes handle return false after unregister", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+k", "Kill line", handler);
			reg.unregister("ctrl+k");

			const result = reg.handle(makeKeyEvent({ key: "k", ctrl: true }));
			expect(result).toBe(false);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	/* ---- key normalization ----------------------------------------------- */

	describe("key normalization", () => {
		it("lowercases key names", () => {
			const reg = new KeyBindingRegistry();
			reg.register("Ctrl+K", "Kill", vi.fn());
			expect(reg.get("ctrl+k")).toBeDefined();
		});

		it("normalizes 'control' to 'ctrl'", () => {
			const reg = new KeyBindingRegistry();
			reg.register("control+k", "Kill", vi.fn());
			expect(reg.get("ctrl+k")).toBeDefined();
		});

		it("normalizes 'option' to 'alt'", () => {
			const reg = new KeyBindingRegistry();
			reg.register("option+p", "Preview", vi.fn());
			expect(reg.get("alt+p")).toBeDefined();
		});

		it("normalizes 'cmd' to 'meta'", () => {
			const reg = new KeyBindingRegistry();
			reg.register("cmd+s", "Save", vi.fn());
			expect(reg.get("meta+s")).toBeDefined();
		});

		it("normalizes 'super' to 'meta'", () => {
			const reg = new KeyBindingRegistry();
			reg.register("super+s", "Save", vi.fn());
			expect(reg.get("meta+s")).toBeDefined();
		});

		it("handles mixed case modifiers", () => {
			const reg = new KeyBindingRegistry();
			reg.register("CTRL+SHIFT+P", "Palette", vi.fn());
			expect(reg.get("ctrl+shift+p")).toBeDefined();
		});
	});

	/* ---- modifier order normalization ------------------------------------ */

	describe("modifier order normalization", () => {
		it("sorts modifiers as ctrl, alt, shift, meta", () => {
			const reg = new KeyBindingRegistry();
			reg.register("shift+ctrl+k", "Kill", vi.fn());
			// Should be stored as ctrl+shift+k
			expect(reg.get("ctrl+shift+k")).toBeDefined();
		});

		it("normalizes alt+ctrl to ctrl+alt", () => {
			const reg = new KeyBindingRegistry();
			reg.register("alt+ctrl+a", "Action", vi.fn());
			expect(reg.get("ctrl+alt+a")).toBeDefined();
		});

		it("normalizes meta+shift+alt+ctrl to ctrl+alt+shift+meta", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("meta+shift+alt+ctrl+x", "Extreme", handler);

			expect(reg.get("ctrl+alt+shift+meta+x")).toBeDefined();

			// Also verify the event builds the same string
			const result = reg.handle(makeKeyEvent({ key: "x", ctrl: true, alt: true, shift: true, meta: true }));
			expect(result).toBe(true);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("single modifier keys need no reordering", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+c", "Copy", vi.fn());
			expect(reg.get("ctrl+c")).toBeDefined();
		});
	});

	/* ---- list ------------------------------------------------------------ */

	describe("list", () => {
		it("returns all registered bindings", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill", vi.fn());
			reg.register("ctrl+l", "Clear", vi.fn());
			reg.register("escape", "Close", vi.fn());

			const bindings = reg.list();
			expect(bindings).toHaveLength(3);
		});

		it("returns empty array when no bindings registered", () => {
			const reg = new KeyBindingRegistry();
			expect(reg.list()).toEqual([]);
		});

		it("returns binding objects with correct shape", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+k", "Kill line", handler);

			const bindings = reg.list();
			expect(bindings[0]).toEqual({
				id: "legacy.ctrl+k",
				key: "ctrl+k",
				description: "Kill line",
				handler,
				enabled: true,
				aliases: [],
			});
		});

		it("can unregister by canonical id", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Command palette", vi.fn(), { id: "app.command-palette.toggle" });

			expect(reg.unregisterById("app.command-palette.toggle")).toBe(true);
			expect(reg.get("ctrl+k")).toBeUndefined();
			expect(reg.getById("app.command-palette.toggle")).toBeUndefined();
		});

		describe("matches", () => {
			it("matches a namespaced action id against a key event", () => {
				const reg = new KeyBindingRegistry();
				reg.register("ctrl+p", "Preview", vi.fn(), {
					id: "app.test-action",
					aliases: ["ctrl+shift+p"],
				});

				expect(reg.matches("app.test-action", makeKeyEvent({ key: "p", ctrl: true }))).toBe(true);
				expect(reg.matches("app.test-action", makeKeyEvent({ key: "p", ctrl: true, shift: true }))).toBe(true);
				expect(reg.matches("app.test-action", makeKeyEvent({ key: "x", ctrl: true }))).toBe(false);
			});
		});

		it("reflects disabled state", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());
			reg.setEnabled("ctrl+k", false);

			const bindings = reg.list();
			expect(bindings[0].enabled).toBe(false);
		});

		it("does not include unregistered bindings", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill", vi.fn());
			reg.register("ctrl+l", "Clear", vi.fn());
			reg.unregister("ctrl+k");

			const bindings = reg.list();
			expect(bindings).toHaveLength(1);
			expect(bindings[0].key).toBe("ctrl+l");
		});
	});

	/* ---- get ------------------------------------------------------------- */

	describe("get", () => {
		it("returns the binding for a registered key", () => {
			const reg = new KeyBindingRegistry();
			const handler = vi.fn();
			reg.register("ctrl+k", "Kill line", handler);

			const binding = reg.get("ctrl+k");
			expect(binding).toBeDefined();
			expect(binding!.key).toBe("ctrl+k");
			expect(binding!.description).toBe("Kill line");
			expect(binding!.handler).toBe(handler);
			expect(binding!.enabled).toBe(true);
		});

		it("returns undefined for unknown key", () => {
			const reg = new KeyBindingRegistry();
			expect(reg.get("ctrl+z")).toBeUndefined();
		});

		it("normalizes the key before lookup", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());

			// Different input format should still find it
			expect(reg.get("Control+K")).toBeDefined();
			expect(reg.get("CTRL+k")).toBeDefined();
		});

		it("returns undefined after unregister", () => {
			const reg = new KeyBindingRegistry();
			reg.register("ctrl+k", "Kill line", vi.fn());
			reg.unregister("ctrl+k");
			expect(reg.get("ctrl+k")).toBeUndefined();
		});
	});
});
