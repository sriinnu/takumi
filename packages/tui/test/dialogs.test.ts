import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry } from "../src/commands.js";
import { CommandPalette } from "../src/dialogs/command-palette.js";
import { FilePicker } from "../src/dialogs/file-picker.js";
import { ModelPicker } from "../src/dialogs/model-picker.js";
import { PermissionDialog } from "../src/dialogs/permission.js";
import { SessionList } from "../src/dialogs/session-list.js";
import { KeyBindingRegistry } from "../src/keybinds.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function key(k: string, overrides?: Partial<KeyEvent>): KeyEvent {
	return {
		key: k,
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		raw: k,
		...overrides,
	};
}

function escapeKey(): KeyEvent {
	return key("escape", { raw: KEY_CODES.ESCAPE });
}

function enterKey(): KeyEvent {
	return key("enter", { raw: KEY_CODES.ENTER });
}

function upKey(): KeyEvent {
	return key("up", { raw: KEY_CODES.UP });
}

function downKey(): KeyEvent {
	return key("down", { raw: KEY_CODES.DOWN });
}

function backspaceKey(): KeyEvent {
	return key("backspace", { raw: KEY_CODES.BACKSPACE });
}

function charKey(ch: string): KeyEvent {
	return key(ch, { raw: ch });
}

/* ── CommandPalette ─────────────────────────────────────────────────────────── */

describe("CommandPalette", () => {
	let commands: SlashCommandRegistry;
	let keybinds: KeyBindingRegistry;
	let palette: CommandPalette;

	beforeEach(() => {
		commands = new SlashCommandRegistry();
		keybinds = new KeyBindingRegistry();
		commands.register("/help", "Show help", vi.fn());
		commands.register("/clear", "Clear conversation", vi.fn(), ["/wipe"]);
		commands.register("/model", "Change model", vi.fn());
		keybinds.register("ctrl+k", "Command palette", vi.fn());
		keybinds.register("ctrl+q", "Quit", vi.fn());
		palette = new CommandPalette(commands, keybinds);
	});

	describe("open/close", () => {
		it("starts closed", () => {
			expect(palette.isOpen).toBe(false);
		});

		it("opens when open() is called", () => {
			palette.open();
			expect(palette.isOpen).toBe(true);
		});

		it("closes when close() is called", () => {
			palette.open();
			palette.close();
			expect(palette.isOpen).toBe(false);
		});

		it("resets filter and selection on open", () => {
			palette.open();
			palette.handleKey(charKey("h"));
			palette.handleKey(downKey());
			expect(palette.filterText).toBe("h");

			palette.open(); // reopen
			expect(palette.filterText).toBe("");
			expect(palette.selectedIndex).toBe(0);
		});

		it("resets filter and selection on close", () => {
			palette.open();
			palette.handleKey(charKey("h"));
			palette.close();
			expect(palette.filterText).toBe("");
			expect(palette.selectedIndex).toBe(0);
		});
	});

	describe("getItems", () => {
		it("returns all commands and keybindings when no filter", () => {
			palette.open();
			const items = palette.getItems();
			// 3 commands + 2 keybindings
			expect(items.length).toBe(5);
		});

		it("includes command items with type 'command'", () => {
			palette.open();
			const items = palette.getItems();
			const commandItems = items.filter((i) => i.type === "command");
			expect(commandItems.length).toBe(3);
			expect(commandItems.map((c) => c.name)).toContain("/help");
		});

		it("includes keybind items with type 'keybind'", () => {
			palette.open();
			const items = palette.getItems();
			const keybindItems = items.filter((i) => i.type === "keybind");
			expect(keybindItems.length).toBe(2);
			expect(keybindItems.map((k) => k.name)).toContain("ctrl+k");
		});
	});

	describe("filter", () => {
		it("filters items by name substring (case-insensitive)", () => {
			palette.open();
			palette.handleKey(charKey("h"));
			palette.handleKey(charKey("e"));
			palette.handleKey(charKey("l"));
			palette.handleKey(charKey("p"));
			const items = palette.getItems();
			expect(items.some((i) => i.name === "/help")).toBe(true);
			// "help" should not match /clear or /model by name
		});

		it("filters items by description substring", () => {
			palette.open();
			palette.handleKey(charKey("Q")); // Should match "Quit" description
			const items = palette.getItems();
			expect(items.some((i) => i.description === "Quit")).toBe(true);
		});

		it("matches slash commands by alias and ranks them ahead of weaker matches", () => {
			palette.open();
			palette.handleKey(charKey("w"));
			palette.handleKey(charKey("i"));
			palette.handleKey(charKey("p"));
			palette.handleKey(charKey("e"));
			const items = palette.getItems();
			expect(items[0]?.name).toBe("/clear");
		});

		it("returns empty list when no match", () => {
			palette.open();
			palette.handleKey(charKey("z"));
			palette.handleKey(charKey("z"));
			palette.handleKey(charKey("z"));
			expect(palette.getItems().length).toBe(0);
		});

		it("resets selection index when filter changes", () => {
			palette.open();
			palette.handleKey(downKey());
			palette.handleKey(downKey());
			expect(palette.selectedIndex).toBe(2);

			palette.handleKey(charKey("h"));
			expect(palette.selectedIndex).toBe(0);
		});

		it("backspace removes last filter character", () => {
			palette.open();
			palette.handleKey(charKey("h"));
			palette.handleKey(charKey("e"));
			expect(palette.filterText).toBe("he");

			palette.handleKey(backspaceKey());
			expect(palette.filterText).toBe("h");
		});

		it("backspace on empty filter does nothing", () => {
			palette.open();
			palette.handleKey(backspaceKey());
			expect(palette.filterText).toBe("");
		});
	});

	describe("navigation", () => {
		it("down arrow increments selectedIndex", () => {
			palette.open();
			expect(palette.selectedIndex).toBe(0);
			palette.handleKey(downKey());
			expect(palette.selectedIndex).toBe(1);
		});

		it("up arrow decrements selectedIndex", () => {
			palette.open();
			palette.handleKey(downKey());
			palette.handleKey(downKey());
			expect(palette.selectedIndex).toBe(2);
			palette.handleKey(upKey());
			expect(palette.selectedIndex).toBe(1);
		});

		it("up arrow does not go below 0", () => {
			palette.open();
			palette.handleKey(upKey());
			expect(palette.selectedIndex).toBe(0);
		});

		it("down arrow does not exceed last item", () => {
			palette.open();
			const count = palette.getItems().length;
			for (let i = 0; i < count + 5; i++) {
				palette.handleKey(downKey());
			}
			expect(palette.selectedIndex).toBe(count - 1);
		});
	});

	describe("selection", () => {
		it("enter executes the selected command", () => {
			palette.open();
			const executed = vi.fn();
			palette.onExecute = executed;
			palette.handleKey(enterKey());
			expect(executed).toHaveBeenCalledOnce();
		});

		it("enter closes the palette", () => {
			palette.open();
			palette.handleKey(enterKey());
			expect(palette.isOpen).toBe(false);
		});

		it("escape closes the palette", () => {
			palette.open();
			palette.handleKey(escapeKey());
			expect(palette.isOpen).toBe(false);
		});

		it("enter on filtered list executes correct item", () => {
			palette.open();
			const executed = vi.fn();
			palette.onExecute = executed;

			// Type "mod" to filter to /model
			palette.handleKey(charKey("m"));
			palette.handleKey(charKey("o"));
			palette.handleKey(charKey("d"));

			palette.handleKey(enterKey());
			expect(executed).toHaveBeenCalledWith(expect.objectContaining({ name: "/model", type: "command" }));
		});
	});

	describe("key handling", () => {
		it("returns false when not open", () => {
			expect(palette.handleKey(charKey("a"))).toBe(false);
		});

		it("returns true for all keys when open", () => {
			palette.open();
			expect(palette.handleKey(charKey("a"))).toBe(true);
			expect(palette.handleKey(upKey())).toBe(true);
			expect(palette.handleKey(downKey())).toBe(true);
			expect(palette.handleKey(enterKey())).toBe(true);
		});

		it("does not append ctrl key combos to filter", () => {
			palette.open();
			palette.handleKey(key("a", { ctrl: true }));
			expect(palette.filterText).toBe("");
		});
	});
});

/* ── PermissionDialog ───────────────────────────────────────────────────────── */

describe("PermissionDialog", () => {
	let dialog: PermissionDialog;

	beforeEach(() => {
		dialog = new PermissionDialog();
	});

	describe("show", () => {
		it("opens the dialog", () => {
			dialog.show("bash", { command: "ls" });
			expect(dialog.isOpen).toBe(true);
		});

		it("stores tool name", () => {
			dialog.show("bash", { command: "ls" });
			expect(dialog.toolName).toBe("bash");
		});

		it("stores truncated args preview", () => {
			dialog.show("bash", { command: "ls -la" });
			expect(dialog.argsPreview).toContain("ls -la");
		});

		it("truncates long args to 200 chars", () => {
			const longValue = "x".repeat(500);
			dialog.show("bash", { command: longValue });
			expect(dialog.argsPreview.length).toBeLessThanOrEqual(203); // 200 + "..."
			expect(dialog.argsPreview.endsWith("...")).toBe(true);
		});

		it("returns a promise", () => {
			const result = dialog.show("bash", {});
			expect(result).toBeInstanceOf(Promise);
		});
	});

	describe("allow (y key)", () => {
		it("resolves with allowed=true, remember=false", async () => {
			const promise = dialog.show("bash", { command: "ls" });
			dialog.handleKey(charKey("y"));
			const result = await promise;
			expect(result).toEqual({ allowed: true, remember: false });
		});

		it("closes the dialog", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(charKey("y"));
			await promise;
			expect(dialog.isOpen).toBe(false);
		});
	});

	describe("allow (Enter key)", () => {
		it("resolves with allowed=true, remember=false", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(enterKey());
			const result = await promise;
			expect(result).toEqual({ allowed: true, remember: false });
		});
	});

	describe("always allow (a key)", () => {
		it("resolves with allowed=true, remember=true", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(charKey("a"));
			const result = await promise;
			expect(result).toEqual({ allowed: true, remember: true });
		});

		it("closes the dialog", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(charKey("a"));
			await promise;
			expect(dialog.isOpen).toBe(false);
		});
	});

	describe("deny (n key)", () => {
		it("resolves with allowed=false, remember=false", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(charKey("n"));
			const result = await promise;
			expect(result).toEqual({ allowed: false, remember: false });
		});

		it("closes the dialog", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(charKey("n"));
			await promise;
			expect(dialog.isOpen).toBe(false);
		});
	});

	describe("deny (Escape key)", () => {
		it("resolves with allowed=false, remember=false", async () => {
			const promise = dialog.show("bash", {});
			dialog.handleKey(escapeKey());
			const result = await promise;
			expect(result).toEqual({ allowed: false, remember: false });
		});
	});

	describe("key handling", () => {
		it("returns false when not open", () => {
			expect(dialog.handleKey(charKey("y"))).toBe(false);
		});

		it("returns true for all keys when open", () => {
			dialog.show("bash", {});
			expect(dialog.handleKey(charKey("x"))).toBe(true); // unknown key still consumed
		});

		it("can be shown again after closing", async () => {
			const p1 = dialog.show("bash", {});
			dialog.handleKey(charKey("y"));
			await p1;

			const p2 = dialog.show("read", { path: "/etc/passwd" });
			expect(dialog.isOpen).toBe(true);
			expect(dialog.toolName).toBe("read");

			dialog.handleKey(charKey("n"));
			const result = await p2;
			expect(result).toEqual({ allowed: false, remember: false });
		});
	});
});

/* ── ModelPicker ────────────────────────────────────────────────────────────── */

describe("ModelPicker", () => {
	let picker: ModelPicker;

	beforeEach(() => {
		picker = new ModelPicker();
	});

	describe("open/close", () => {
		it("starts closed", () => {
			expect(picker.isOpen).toBe(false);
		});

		it("opens when open() is called", () => {
			picker.open();
			expect(picker.isOpen).toBe(true);
		});

		it("closes when close() is called", () => {
			picker.open();
			picker.close();
			expect(picker.isOpen).toBe(false);
		});

		it("resets selection on open", () => {
			picker.open();
			picker.handleKey(downKey());
			picker.close();
			picker.open();
			expect(picker.selectedIndex).toBe(0);
		});
	});

	describe("getModels", () => {
		it("returns default models when none provided", () => {
			const models = picker.getModels();
			expect(models.length).toBeGreaterThan(0);
			expect(models.some((m) => m.includes("claude"))).toBe(true);
		});

		it("returns custom models when provided in constructor", () => {
			const custom = new ModelPicker(["gpt-4", "gemini-pro"]);
			const models = custom.getModels();
			expect(models).toEqual(["gpt-4", "gemini-pro"]);
		});
	});

	describe("navigation", () => {
		it("down arrow increments selectedIndex", () => {
			picker.open();
			picker.handleKey(downKey());
			expect(picker.selectedIndex).toBe(1);
		});

		it("up arrow decrements selectedIndex", () => {
			picker.open();
			picker.handleKey(downKey());
			picker.handleKey(downKey());
			picker.handleKey(upKey());
			expect(picker.selectedIndex).toBe(1);
		});

		it("up arrow does not go below 0", () => {
			picker.open();
			picker.handleKey(upKey());
			expect(picker.selectedIndex).toBe(0);
		});

		it("down arrow does not exceed list length", () => {
			picker.open();
			const count = picker.getModels().length;
			for (let i = 0; i < count + 5; i++) {
				picker.handleKey(downKey());
			}
			expect(picker.selectedIndex).toBe(count - 1);
		});
	});

	describe("selection", () => {
		it("enter calls onSelect with selected model", () => {
			picker.open();
			const callback = vi.fn();
			picker.onSelect = callback;

			picker.handleKey(downKey()); // select second model
			picker.handleKey(enterKey());

			const models = picker.getModels();
			expect(callback).toHaveBeenCalledWith(models[1]);
		});

		it("enter closes the picker", () => {
			picker.open();
			picker.onSelect = vi.fn();
			picker.handleKey(enterKey());
			expect(picker.isOpen).toBe(false);
		});

		it("escape closes without selecting", () => {
			picker.open();
			const callback = vi.fn();
			picker.onSelect = callback;
			picker.handleKey(escapeKey());
			expect(picker.isOpen).toBe(false);
			expect(callback).not.toHaveBeenCalled();
		});
	});

	describe("key handling", () => {
		it("returns false when not open", () => {
			expect(picker.handleKey(downKey())).toBe(false);
		});

		it("returns true for all keys when open", () => {
			picker.open();
			expect(picker.handleKey(charKey("x"))).toBe(true);
		});
	});
});

/* ── SessionList ────────────────────────────────────────────────────────────── */

describe("SessionList", () => {
	let dialog: SessionList;

	const sampleSessions = [
		{ id: "session-2025-01-15-a1b2", date: "2025-01-15", turns: 12, preview: "Refactored auth" },
		{ id: "session-2025-01-14-c3d4", date: "2025-01-14", turns: 5, preview: "Fixed bug #42" },
		{ id: "session-2025-01-13-e5f6", date: "2025-01-13", turns: 20, preview: "Added tests" },
	];

	beforeEach(() => {
		dialog = new SessionList();
	});

	describe("open/close", () => {
		it("starts closed", () => {
			expect(dialog.isOpen).toBe(false);
		});

		it("opens with provided sessions", () => {
			dialog.open(sampleSessions);
			expect(dialog.isOpen).toBe(true);
		});

		it("closes when close() is called", () => {
			dialog.open(sampleSessions);
			dialog.close();
			expect(dialog.isOpen).toBe(false);
		});

		it("resets selection on open", () => {
			dialog.open(sampleSessions);
			dialog.handleKey(downKey());
			dialog.close();
			dialog.open(sampleSessions);
			expect(dialog.selectedIndex).toBe(0);
		});

		it("stores provided sessions", () => {
			dialog.open(sampleSessions);
			expect(dialog.getSessions()).toEqual(sampleSessions);
		});
	});

	describe("navigation", () => {
		it("down arrow increments selectedIndex", () => {
			dialog.open(sampleSessions);
			dialog.handleKey(downKey());
			expect(dialog.selectedIndex).toBe(1);
		});

		it("up arrow decrements selectedIndex", () => {
			dialog.open(sampleSessions);
			dialog.handleKey(downKey());
			dialog.handleKey(downKey());
			dialog.handleKey(upKey());
			expect(dialog.selectedIndex).toBe(1);
		});

		it("up arrow does not go below 0", () => {
			dialog.open(sampleSessions);
			dialog.handleKey(upKey());
			expect(dialog.selectedIndex).toBe(0);
		});

		it("down arrow does not exceed session count", () => {
			dialog.open(sampleSessions);
			for (let i = 0; i < 10; i++) {
				dialog.handleKey(downKey());
			}
			expect(dialog.selectedIndex).toBe(sampleSessions.length - 1);
		});
	});

	describe("selection", () => {
		it("enter calls onSelect with session id", () => {
			dialog.open(sampleSessions);
			const callback = vi.fn();
			dialog.onSelect = callback;

			dialog.handleKey(downKey()); // second session
			dialog.handleKey(enterKey());

			expect(callback).toHaveBeenCalledWith("session-2025-01-14-c3d4");
		});

		it("enter closes the dialog", () => {
			dialog.open(sampleSessions);
			dialog.onSelect = vi.fn();
			dialog.handleKey(enterKey());
			expect(dialog.isOpen).toBe(false);
		});

		it("escape closes without selecting", () => {
			dialog.open(sampleSessions);
			const callback = vi.fn();
			dialog.onSelect = callback;
			dialog.handleKey(escapeKey());
			expect(dialog.isOpen).toBe(false);
			expect(callback).not.toHaveBeenCalled();
		});

		it("enter on empty sessions list does nothing", () => {
			dialog.open([]);
			const callback = vi.fn();
			dialog.onSelect = callback;
			dialog.handleKey(enterKey());
			expect(callback).not.toHaveBeenCalled();
		});
	});

	describe("key handling", () => {
		it("returns false when not open", () => {
			expect(dialog.handleKey(downKey())).toBe(false);
		});

		it("returns true for all keys when open", () => {
			dialog.open(sampleSessions);
			expect(dialog.handleKey(charKey("x"))).toBe(true);
		});
	});
});

/* ── FilePicker ─────────────────────────────────────────────────────────────── */

describe("FilePicker", () => {
	let picker: FilePicker;

	const sampleFiles = ["src/index.ts", "src/app.ts", "src/state.ts", "test/app.test.ts", "package.json", "README.md"];

	beforeEach(() => {
		picker = new FilePicker();
	});

	describe("open/close", () => {
		it("starts closed", () => {
			expect(picker.isOpen).toBe(false);
		});

		it("opens when open() is called", () => {
			picker.open();
			expect(picker.isOpen).toBe(true);
		});

		it("closes when close() is called", () => {
			picker.open();
			picker.close();
			expect(picker.isOpen).toBe(false);
		});

		it("resets filter and selection on open", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(charKey("s"));
			picker.handleKey(downKey());

			picker.open(); // reopen
			expect(picker.filterText).toBe("");
			expect(picker.selectedIndex).toBe(0);
		});

		it("resets filter and selection on close", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(charKey("s"));
			picker.close();
			expect(picker.filterText).toBe("");
			expect(picker.selectedIndex).toBe(0);
		});
	});

	describe("setFiles", () => {
		it("sets the file list", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			expect(picker.filteredFiles).toEqual(sampleFiles);
		});

		it("resets selection when files change", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(downKey());
			picker.handleKey(downKey());
			picker.setFiles(["a.ts", "b.ts"]);
			expect(picker.selectedIndex).toBe(0);
		});
	});

	describe("filter", () => {
		it("filters files by substring match (case-insensitive)", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(charKey("a"));
			picker.handleKey(charKey("p"));
			picker.handleKey(charKey("p"));
			// Should match "src/app.ts", "test/app.test.ts"
			const filtered = picker.filteredFiles;
			expect(filtered.length).toBe(2);
			expect(filtered).toContain("src/app.ts");
			expect(filtered).toContain("test/app.test.ts");
		});

		it("returns all files when filter is empty", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			expect(picker.filteredFiles.length).toBe(sampleFiles.length);
		});

		it("returns empty when nothing matches", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(charKey("z"));
			picker.handleKey(charKey("z"));
			picker.handleKey(charKey("z"));
			expect(picker.filteredFiles.length).toBe(0);
		});

		it("resets selection when filter changes", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(downKey());
			picker.handleKey(downKey());
			expect(picker.selectedIndex).toBe(2);

			picker.handleKey(charKey("s"));
			expect(picker.selectedIndex).toBe(0);
		});

		it("backspace removes last filter character", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(charKey("s"));
			picker.handleKey(charKey("r"));
			expect(picker.filterText).toBe("sr");

			picker.handleKey(backspaceKey());
			expect(picker.filterText).toBe("s");
		});
	});

	describe("navigation", () => {
		it("down arrow increments selectedIndex", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(downKey());
			expect(picker.selectedIndex).toBe(1);
		});

		it("up arrow decrements selectedIndex", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(downKey());
			picker.handleKey(downKey());
			picker.handleKey(upKey());
			expect(picker.selectedIndex).toBe(1);
		});

		it("up arrow does not go below 0", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.handleKey(upKey());
			expect(picker.selectedIndex).toBe(0);
		});

		it("down arrow does not exceed filtered list length", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			for (let i = 0; i < sampleFiles.length + 5; i++) {
				picker.handleKey(downKey());
			}
			expect(picker.selectedIndex).toBe(sampleFiles.length - 1);
		});
	});

	describe("selection", () => {
		it("enter calls onSelect with the selected file", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			const callback = vi.fn();
			picker.onSelect = callback;

			picker.handleKey(downKey()); // second file
			picker.handleKey(enterKey());

			expect(callback).toHaveBeenCalledWith("src/app.ts");
		});

		it("enter closes the picker", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			picker.onSelect = vi.fn();
			picker.handleKey(enterKey());
			expect(picker.isOpen).toBe(false);
		});

		it("escape closes without selecting", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			const callback = vi.fn();
			picker.onSelect = callback;
			picker.handleKey(escapeKey());
			expect(picker.isOpen).toBe(false);
			expect(callback).not.toHaveBeenCalled();
		});

		it("enter on empty filtered list does nothing", () => {
			picker.setFiles([]);
			picker.open();
			const callback = vi.fn();
			picker.onSelect = callback;
			picker.handleKey(enterKey());
			expect(callback).not.toHaveBeenCalled();
		});

		it("enter selects from filtered list, not full list", () => {
			picker.setFiles(sampleFiles);
			picker.open();
			const callback = vi.fn();
			picker.onSelect = callback;

			// Filter to just JSON files
			picker.handleKey(charKey("j"));
			picker.handleKey(charKey("s"));
			picker.handleKey(charKey("o"));
			picker.handleKey(charKey("n"));

			picker.handleKey(enterKey());
			expect(callback).toHaveBeenCalledWith("package.json");
		});
	});

	describe("key handling", () => {
		it("returns false when not open", () => {
			expect(picker.handleKey(charKey("a"))).toBe(false);
		});

		it("returns true for all keys when open", () => {
			picker.open();
			expect(picker.handleKey(charKey("a"))).toBe(true);
		});

		it("does not append ctrl key combos to filter", () => {
			picker.open();
			picker.handleKey(key("a", { ctrl: true }));
			expect(picker.filterText).toBe("");
		});
	});
});
