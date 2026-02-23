import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Screen } from "@takumi/render";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectLanguage, FilePreviewPanel } from "../src/panels/file-preview.js";

// ── Mock fs ──────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => {
	const files: Record<string, string> = {
		"/project/src/app.ts": [
			'import { run } from "./runner";',
			"",
			"const x = 42;",
			"export function main(): void {",
			'  console.log("hello");',
			"}",
		].join("\n"),
		"/project/empty.txt": "",
		"/project/data.json": '{"key": "value"}',
		"/project/styles.css": "body { color: red; }",
		"/project/readme.md": "# Title\n\nSome text",
		"/project/script.sh": '#!/bin/bash\necho "hello"',
	};

	// Generate a large file for truncation test
	const largeLines: string[] = [];
	for (let i = 0; i < 12000; i++) {
		largeLines.push(`line ${i + 1}: some content here`);
	}
	files["/project/large-file.ts"] = largeLines.join("\n");

	return {
		readFile: vi.fn(async (path: string) => {
			// Normalize backslashes to forward slashes for cross-platform mock lookup
			const normalized = path.replace(/\\/g, "/");
			const content = files[normalized];
			if (content === undefined) throw new Error(`ENOENT: ${path}`);
			return content;
		}),
		readdir: vi.fn(async () => []),
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FilePreviewPanel", () => {
	let panel: FilePreviewPanel;

	beforeEach(() => {
		panel = new FilePreviewPanel();
	});

	describe("loadFile", () => {
		it("loads file and sets content", async () => {
			await panel.loadFile("/project/src/app.ts");
			expect(panel.filePath.value).toBe("/project/src/app.ts");
			expect(panel.content.value.length).toBe(6);
			expect(panel.content.value[0]).toContain("import");
		});

		it("detects language from extension", async () => {
			await panel.loadFile("/project/src/app.ts");
			expect(panel.language.value).toBe("typescript");
		});

		it("resets scroll offset on load", async () => {
			panel.scrollOffset.value = 10;
			await panel.loadFile("/project/src/app.ts");
			expect(panel.scrollOffset.value).toBe(0);
		});

		it("handles empty file", async () => {
			await panel.loadFile("/project/empty.txt");
			expect(panel.content.value.length).toBe(1); // split("") gives [""]
			expect(panel.content.value[0]).toBe("");
		});

		it("handles read error gracefully", async () => {
			await panel.loadFile("/nonexistent/file.ts");
			expect(panel.filePath.value).toBe("/nonexistent/file.ts");
			expect(panel.content.value[0]).toBe("(Unable to read file)");
		});

		it("truncates large files", async () => {
			await panel.loadFile("/project/large-file.ts");
			expect(panel.content.value.length).toBe(10000);
			expect(panel.truncated.value).toBe(true);
		});

		it("does not truncate small files", async () => {
			await panel.loadFile("/project/src/app.ts");
			expect(panel.truncated.value).toBe(false);
		});
	});

	describe("detectLanguage", () => {
		it("detects typescript", () => {
			expect(detectLanguage("foo.ts")).toBe("typescript");
		});

		it("detects javascript", () => {
			expect(detectLanguage("foo.js")).toBe("javascript");
		});

		it("detects python", () => {
			expect(detectLanguage("foo.py")).toBe("python");
		});

		it("detects json", () => {
			expect(detectLanguage("foo.json")).toBe("json");
		});

		it("detects css", () => {
			expect(detectLanguage("foo.css")).toBe("css");
		});

		it("detects markdown", () => {
			expect(detectLanguage("foo.md")).toBe("markdown");
		});

		it("detects bash", () => {
			expect(detectLanguage("foo.sh")).toBe("bash");
		});

		it("returns empty for unknown extensions", () => {
			expect(detectLanguage("foo.xyz")).toBe("");
		});

		it("handles files with no extension", () => {
			expect(detectLanguage("Makefile")).toBe("");
		});
	});

	describe("scrolling", () => {
		beforeEach(async () => {
			await panel.loadFile("/project/large-file.ts");
		});

		it("scrollDown increases scroll offset", () => {
			panel.scrollDown(5);
			expect(panel.scrollOffset.value).toBe(5);
		});

		it("scrollUp decreases scroll offset", () => {
			panel.scrollDown(10);
			panel.scrollUp(3);
			expect(panel.scrollOffset.value).toBe(7);
		});

		it("scrollUp does not go below 0", () => {
			panel.scrollUp(5);
			expect(panel.scrollOffset.value).toBe(0);
		});

		it("scrollDown clamps to max offset", () => {
			// Viewport height defaults to 20
			panel.scrollDown(100000);
			const maxOffset = Math.max(0, panel.content.value.length - 20);
			expect(panel.scrollOffset.value).toBe(maxOffset);
		});

		it("default scroll amount is 1 line", () => {
			panel.scrollDown();
			expect(panel.scrollOffset.value).toBe(1);
			panel.scrollUp();
			expect(panel.scrollOffset.value).toBe(0);
		});
	});

	describe("key handling", () => {
		beforeEach(async () => {
			await panel.loadFile("/project/large-file.ts");
		});

		it("up arrow scrolls up", () => {
			panel.scrollDown(5);
			const consumed = panel.handleKey(rawKey(KEY_CODES.UP));
			expect(consumed).toBe(true);
			expect(panel.scrollOffset.value).toBe(4);
		});

		it("down arrow scrolls down", () => {
			const consumed = panel.handleKey(rawKey(KEY_CODES.DOWN));
			expect(consumed).toBe(true);
			expect(panel.scrollOffset.value).toBe(1);
		});

		it("page up scrolls by viewport height", () => {
			panel.scrollDown(50);
			const consumed = panel.handleKey(rawKey(KEY_CODES.PAGE_UP));
			expect(consumed).toBe(true);
			expect(panel.scrollOffset.value).toBeLessThan(50);
		});

		it("page down scrolls by viewport height", () => {
			const consumed = panel.handleKey(rawKey(KEY_CODES.PAGE_DOWN));
			expect(consumed).toBe(true);
			expect(panel.scrollOffset.value).toBeGreaterThan(0);
		});

		it("home scrolls to top", () => {
			panel.scrollDown(100);
			const consumed = panel.handleKey(rawKey(KEY_CODES.HOME));
			expect(consumed).toBe(true);
			expect(panel.scrollOffset.value).toBe(0);
		});

		it("end scrolls to bottom", () => {
			const consumed = panel.handleKey(rawKey(KEY_CODES.END));
			expect(consumed).toBe(true);
			expect(panel.scrollOffset.value).toBeGreaterThan(0);
		});

		it("other keys are not consumed", () => {
			const consumed = panel.handleKey(rawKey("x"));
			expect(consumed).toBe(false);
		});
	});

	describe("clear", () => {
		it("clears all state", async () => {
			await panel.loadFile("/project/src/app.ts");
			panel.scrollDown(3);
			panel.clear();

			expect(panel.filePath.value).toBe("");
			expect(panel.content.value).toEqual([]);
			expect(panel.scrollOffset.value).toBe(0);
			expect(panel.language.value).toBe("");
			expect(panel.truncated.value).toBe(false);
		});
	});

	describe("render", () => {
		it("renders without errors", async () => {
			await panel.loadFile("/project/src/app.ts");
			const screen = new Screen(80, 24);
			panel.render(screen, { x: 0, y: 0, width: 40, height: 20 });
			// Should not throw
		});

		it("renders empty state without errors", () => {
			const screen = new Screen(80, 24);
			panel.render(screen, { x: 0, y: 0, width: 40, height: 20 });
			// Should not throw
		});

		it("renders json file without errors", async () => {
			await panel.loadFile("/project/data.json");
			const screen = new Screen(80, 24);
			panel.render(screen, { x: 0, y: 0, width: 40, height: 20 });
			expect(panel.language.value).toBe("json");
		});

		it("renders unknown language as plain text without errors", async () => {
			await panel.loadFile("/project/empty.txt");
			const screen = new Screen(80, 24);
			panel.render(screen, { x: 0, y: 0, width: 40, height: 20 });
			expect(panel.language.value).toBe("");
		});
	});
});
