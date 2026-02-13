import { describe, it, expect, vi, beforeEach } from "vitest";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import {
	CompletionEngine,
	CompletionPopup,
	MAX_VISIBLE_ITEMS,
} from "../src/completion.js";
import type { CompletionItem } from "../src/completion.js";
import { SlashCommandRegistry } from "../src/commands.js";

// ── Mock fs ──────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => {
	interface MockDirent {
		name: string;
		isDirectory(): boolean;
		isFile(): boolean;
	}

	const dirStructure: Record<string, MockDirent[]> = {
		"/project": [
			{ name: "src", isDirectory: () => true, isFile: () => false },
			{ name: "test", isDirectory: () => true, isFile: () => false },
			{ name: "node_modules", isDirectory: () => true, isFile: () => false },
			{ name: ".git", isDirectory: () => true, isFile: () => false },
			{ name: "dist", isDirectory: () => true, isFile: () => false },
			{ name: "package.json", isDirectory: () => false, isFile: () => true },
			{ name: "tsconfig.json", isDirectory: () => false, isFile: () => true },
			{ name: "app.ts", isDirectory: () => false, isFile: () => true },
			{ name: "README.md", isDirectory: () => false, isFile: () => true },
		],
		"/project/src": [
			{ name: "panels", isDirectory: () => true, isFile: () => false },
			{ name: "views", isDirectory: () => true, isFile: () => false },
			{ name: "app.ts", isDirectory: () => false, isFile: () => true },
			{ name: "state.ts", isDirectory: () => false, isFile: () => true },
			{ name: "agent-runner.ts", isDirectory: () => false, isFile: () => true },
		],
		"/project/src/panels": [
			{ name: "message-list.ts", isDirectory: () => false, isFile: () => true },
			{ name: "editor.ts", isDirectory: () => false, isFile: () => true },
			{ name: "file-tree.ts", isDirectory: () => false, isFile: () => true },
		],
		"/project/src/views": [
			{ name: "chat.ts", isDirectory: () => false, isFile: () => true },
			{ name: "root.ts", isDirectory: () => false, isFile: () => true },
		],
		"/empty": [],
	};

	return {
		readdir: vi.fn(async (dir: string, _opts?: unknown) => {
			const entries = dirStructure[dir];
			if (!entries) throw new Error(`ENOENT: ${dir}`);
			return entries;
		}),
		readFile: vi.fn(async () => ""),
	};
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function rawKey(raw: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
	return {
		key: raw,
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		raw,
		...overrides,
	};
}

function makeItems(labels: string[]): CompletionItem[] {
	return labels.map((l) => ({
		label: l,
		insertText: l,
		kind: "command" as const,
	}));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CompletionEngine", () => {
	let engine: CompletionEngine;

	beforeEach(() => {
		engine = new CompletionEngine();
		engine.setProjectRoot("/project");
	});

	// ── File completions ──────────────────────────────────────────────────

	describe("file completions (@)", () => {
		it("returns files for @ with empty path", async () => {
			const items = await engine.getCompletions("@", 1);
			expect(items.length).toBeGreaterThan(0);
			// Should include src/ and test/ directories
			const labels = items.map((i) => i.label);
			expect(labels).toContain("src/");
			expect(labels).toContain("test/");
		});

		it("excludes node_modules from file results", async () => {
			const items = await engine.getCompletions("@", 1);
			const labels = items.map((i) => i.label);
			expect(labels).not.toContain("node_modules/");
		});

		it("excludes .git from file results", async () => {
			const items = await engine.getCompletions("@", 1);
			const labels = items.map((i) => i.label);
			expect(labels).not.toContain(".git/");
		});

		it("excludes dist from file results", async () => {
			const items = await engine.getCompletions("@", 1);
			const labels = items.map((i) => i.label);
			expect(labels).not.toContain("dist/");
		});

		it("fuzzy matches files containing query", async () => {
			const items = await engine.getCompletions("@app", 4);
			const labels = items.map((i) => i.label);
			expect(labels).toContain("app.ts");
		});

		it("lists directory contents with trailing slash", async () => {
			const items = await engine.getCompletions("@src/", 5);
			const labels = items.map((i) => i.label);
			expect(labels).toContain("panels/");
			expect(labels).toContain("views/");
			expect(labels).toContain("app.ts");
			expect(labels).toContain("state.ts");
		});

		it("filters within subdirectory", async () => {
			const items = await engine.getCompletions("@src/app", 8);
			const labels = items.map((i) => i.label);
			expect(labels).toContain("app.ts");
			expect(labels).not.toContain("state.ts");
		});

		it("nested directory completion @src/panels/", async () => {
			const items = await engine.getCompletions("@src/panels/", 12);
			const labels = items.map((i) => i.label);
			expect(labels).toContain("message-list.ts");
			expect(labels).toContain("editor.ts");
		});

		it("returns empty for non-existent directory", async () => {
			const items = await engine.getCompletions("@nonexistent/", 13);
			expect(items).toEqual([]);
		});

		it("sorts directories before files", async () => {
			const items = await engine.getCompletions("@", 1);
			const dirIndices = items
				.map((item, idx) => ({ item, idx }))
				.filter(({ item }) => item.label.endsWith("/"));
			const fileIndices = items
				.map((item, idx) => ({ item, idx }))
				.filter(({ item }) => !item.label.endsWith("/"));

			if (dirIndices.length > 0 && fileIndices.length > 0) {
				const maxDirIdx = Math.max(...dirIndices.map((d) => d.idx));
				const minFileIdx = Math.min(...fileIndices.map((f) => f.idx));
				expect(maxDirIdx).toBeLessThan(minFileIdx);
			}
		});

		it("file items have kind 'file'", async () => {
			const items = await engine.getCompletions("@", 1);
			for (const item of items) {
				expect(item.kind).toBe("file");
			}
		});

		it("directory items have detail 'directory'", async () => {
			const items = await engine.getCompletions("@", 1);
			const dirs = items.filter((i) => i.label.endsWith("/"));
			for (const dir of dirs) {
				expect(dir.detail).toBe("directory");
			}
		});

		it("insertText includes @ prefix", async () => {
			const items = await engine.getCompletions("@", 1);
			for (const item of items) {
				expect(item.insertText.startsWith("@")).toBe(true);
			}
		});

		it("returns empty when no project root is set", async () => {
			const bare = new CompletionEngine();
			const items = await bare.getCompletions("@test", 5);
			expect(items).toEqual([]);
		});

		it("handles @ in the middle of text", async () => {
			const items = await engine.getCompletions("check @src/", 11);
			const labels = items.map((i) => i.label);
			expect(labels).toContain("app.ts");
		});
	});

	// ── Slash command completions ─────────────────────────────────────────

	describe("slash command completions (/)", () => {
		it("returns command completions for partial /", async () => {
			const commands = new SlashCommandRegistry();
			commands.register("/help", "Show help", () => {});
			commands.register("/theme", "Change theme", () => {});
			commands.register("/think", "Toggle thinking", () => {});
			engine.setCommands(commands);

			const items = await engine.getCompletions("/th", 3);
			const labels = items.map((i) => i.label);
			expect(labels).toContain("/theme");
			expect(labels).toContain("/think");
			expect(labels).not.toContain("/help");
		});

		it("returns all commands for bare /", async () => {
			const commands = new SlashCommandRegistry();
			commands.register("/help", "Show help", () => {});
			commands.register("/quit", "Quit", () => {});
			engine.setCommands(commands);

			const items = await engine.getCompletions("/", 1);
			expect(items.length).toBe(2);
		});

		it("command items have kind 'command'", async () => {
			const commands = new SlashCommandRegistry();
			commands.register("/help", "Show help", () => {});
			engine.setCommands(commands);

			const items = await engine.getCompletions("/h", 2);
			for (const item of items) {
				expect(item.kind).toBe("command");
			}
		});

		it("command items include description as detail", async () => {
			const commands = new SlashCommandRegistry();
			commands.register("/help", "Show help", () => {});
			engine.setCommands(commands);

			const items = await engine.getCompletions("/h", 2);
			expect(items[0].detail).toBe("Show help");
		});

		it("returns empty when no commands are set", async () => {
			const items = await engine.getCompletions("/h", 2);
			expect(items).toEqual([]);
		});

		it("does not trigger slash completion after space", async () => {
			const commands = new SlashCommandRegistry();
			commands.register("/help", "Show help", () => {});
			engine.setCommands(commands);

			const items = await engine.getCompletions("/help arg", 9);
			expect(items).toEqual([]);
		});
	});

	// ── Model completions ────────────────────────────────────────────────

	describe("model completions (/model)", () => {
		it("returns model completions for /model cl", async () => {
			const items = await engine.getCompletions("/model cl", 9);
			const labels = items.map((i) => i.label);
			expect(labels.some((l) => l.includes("claude"))).toBe(true);
		});

		it("returns gpt models for /model gpt", async () => {
			const items = await engine.getCompletions("/model gpt", 10);
			const labels = items.map((i) => i.label);
			expect(labels.some((l) => l.includes("gpt"))).toBe(true);
		});

		it("model items have kind 'model'", async () => {
			const items = await engine.getCompletions("/model cl", 9);
			for (const item of items) {
				expect(item.kind).toBe("model");
			}
		});

		it("returns all models for /model (empty query)", async () => {
			const items = await engine.getCompletions("/model ", 7);
			expect(items.length).toBeGreaterThan(5);
		});

		it("insertText includes /model prefix", async () => {
			const items = await engine.getCompletions("/model cl", 9);
			for (const item of items) {
				expect(item.insertText.startsWith("/model ")).toBe(true);
			}
		});
	});

	// ── Edge cases ────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("returns empty for plain text with no trigger", async () => {
			const items = await engine.getCompletions("hello world", 11);
			expect(items).toEqual([]);
		});

		it("returns empty for empty input", async () => {
			const items = await engine.getCompletions("", 0);
			expect(items).toEqual([]);
		});
	});
});

// ── CompletionPopup ──────────────────────────────────────────────────────────

describe("CompletionPopup", () => {
	let popup: CompletionPopup;

	beforeEach(() => {
		popup = new CompletionPopup();
	});

	describe("show/hide", () => {
		it("starts hidden", () => {
			expect(popup.isVisible.value).toBe(false);
			expect(popup.items.value).toEqual([]);
		});

		it("show makes popup visible with items", () => {
			const items = makeItems(["a", "b", "c"]);
			popup.show(items);
			expect(popup.isVisible.value).toBe(true);
			expect(popup.items.value).toEqual(items);
			expect(popup.selectedIndex.value).toBe(0);
		});

		it("show with empty items hides popup", () => {
			popup.show(makeItems(["a"]));
			popup.show([]);
			expect(popup.isVisible.value).toBe(false);
		});

		it("hide clears items and resets selection", () => {
			popup.show(makeItems(["a", "b"]));
			popup.selectNext();
			popup.hide();
			expect(popup.isVisible.value).toBe(false);
			expect(popup.items.value).toEqual([]);
			expect(popup.selectedIndex.value).toBe(0);
			expect(popup.scrollOffset.value).toBe(0);
		});
	});

	describe("navigation", () => {
		it("selectNext moves to next item", () => {
			popup.show(makeItems(["a", "b", "c"]));
			expect(popup.selectedIndex.value).toBe(0);
			popup.selectNext();
			expect(popup.selectedIndex.value).toBe(1);
		});

		it("selectNext wraps around", () => {
			popup.show(makeItems(["a", "b"]));
			popup.selectNext();
			popup.selectNext();
			expect(popup.selectedIndex.value).toBe(0); // wrapped
		});

		it("selectPrev moves to previous item", () => {
			popup.show(makeItems(["a", "b", "c"]));
			popup.selectNext();
			popup.selectNext();
			popup.selectPrev();
			expect(popup.selectedIndex.value).toBe(1);
		});

		it("selectPrev wraps around to last item", () => {
			popup.show(makeItems(["a", "b", "c"]));
			popup.selectPrev();
			expect(popup.selectedIndex.value).toBe(2); // wrapped to last
		});

		it("navigation with empty items does nothing", () => {
			popup.selectNext();
			expect(popup.selectedIndex.value).toBe(0);
			popup.selectPrev();
			expect(popup.selectedIndex.value).toBe(0);
		});
	});

	describe("confirm", () => {
		it("confirm returns selected item and hides popup", () => {
			const items = makeItems(["a", "b", "c"]);
			popup.show(items);
			popup.selectNext(); // select "b"
			const result = popup.confirm();
			expect(result).toEqual(items[1]);
			expect(popup.isVisible.value).toBe(false);
		});

		it("confirm returns null when hidden", () => {
			const result = popup.confirm();
			expect(result).toBeNull();
		});

		it("confirm returns null when items are empty", () => {
			popup.show([]);
			const result = popup.confirm();
			expect(result).toBeNull();
		});
	});

	describe("handleKey", () => {
		it("returns false when hidden", () => {
			const result = popup.handleKey(rawKey(KEY_CODES.UP));
			expect(result).toBe(false);
		});

		it("up arrow selects previous item", () => {
			popup.show(makeItems(["a", "b", "c"]));
			popup.selectNext();
			const consumed = popup.handleKey(rawKey(KEY_CODES.UP));
			expect(consumed).toBe(true);
			expect(popup.selectedIndex.value).toBe(0);
		});

		it("down arrow selects next item", () => {
			popup.show(makeItems(["a", "b", "c"]));
			const consumed = popup.handleKey(rawKey(KEY_CODES.DOWN));
			expect(consumed).toBe(true);
			expect(popup.selectedIndex.value).toBe(1);
		});

		it("escape hides popup", () => {
			popup.show(makeItems(["a"]));
			const consumed = popup.handleKey(rawKey(KEY_CODES.ESCAPE));
			expect(consumed).toBe(true);
			expect(popup.isVisible.value).toBe(false);
		});

		it("tab is consumed when visible", () => {
			popup.show(makeItems(["a"]));
			const consumed = popup.handleKey(rawKey(KEY_CODES.TAB));
			expect(consumed).toBe(true);
		});

		it("enter is consumed when visible", () => {
			popup.show(makeItems(["a"]));
			const consumed = popup.handleKey(rawKey(KEY_CODES.ENTER));
			expect(consumed).toBe(true);
		});

		it("other keys are not consumed", () => {
			popup.show(makeItems(["a"]));
			const consumed = popup.handleKey(rawKey("x"));
			expect(consumed).toBe(false);
		});
	});

	describe("scroll offset", () => {
		it("scroll offset adjusts when selection goes below visible area", () => {
			// Create more items than MAX_VISIBLE_ITEMS
			const labels = Array.from({ length: 12 }, (_, i) => `item-${i}`);
			popup.show(makeItems(labels));

			// Navigate past visible area
			for (let i = 0; i < MAX_VISIBLE_ITEMS + 1; i++) {
				popup.selectNext();
			}

			// Scroll offset should have increased
			expect(popup.scrollOffset.value).toBeGreaterThan(0);
		});

		it("scroll offset adjusts when selection goes above visible area", () => {
			const labels = Array.from({ length: 12 }, (_, i) => `item-${i}`);
			popup.show(makeItems(labels));

			// Navigate to bottom to get a non-zero scroll offset
			for (let i = 0; i < 10; i++) {
				popup.selectNext();
			}
			expect(popup.scrollOffset.value).toBeGreaterThan(0);

			// Now navigate back to the first item
			// selectPrev wraps, so go backward from position 10 to position 0
			for (let i = 0; i < 10; i++) {
				popup.selectPrev();
			}

			// Scroll offset should now be 0 since selection is at the top
			expect(popup.selectedIndex.value).toBe(0);
			expect(popup.scrollOffset.value).toBe(0);
		});
	});
});
