/**
 * Tests for the CodeView split-pane code/diff viewer.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { describe, expect, it } from "vitest";
import type { FileChange } from "../src/views/code.js";
import { CodeView } from "../src/views/code.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeKey(key: string, mods?: Partial<KeyEvent>): KeyEvent {
	return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

function sampleFiles(): FileChange[] {
	return [
		{
			path: "src/app.ts",
			status: "modified",
			additions: 10,
			deletions: 3,
			diffContent: [
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,5 +1,7 @@",
				" import { createApp } from './core.js';",
				"-const old = true;",
				"+const app = createApp();",
				"+app.start();",
				" export default app;",
			].join("\n"),
		},
		{
			path: "src/utils.ts",
			status: "added",
			additions: 20,
			deletions: 0,
			diffContent: "+export function helper() { return true; }",
		},
		{
			path: "src/legacy.ts",
			status: "deleted",
			additions: 0,
			deletions: 50,
		},
		{
			path: "src/old-name.ts",
			status: "renamed",
			additions: 2,
			deletions: 2,
			diffContent: "renamed to new-name.ts",
		},
	];
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("CodeView", () => {
	describe("construction", () => {
		it("creates with default empty files", () => {
			const view = new CodeView();
			expect(view.files.value).toEqual([]);
			expect(view.selectedIndex.value).toBe(0);
			expect(view.focusedPane.value).toBe("list");
		});

		it("accepts initial files via props", () => {
			const files = sampleFiles();
			const view = new CodeView({ files });
			expect(view.files.value).toHaveLength(4);
		});
	});

	describe("setFiles", () => {
		it("replaces file list and resets state", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.selectedIndex.value = 2;
			view.listScroll.value = 1;
			view.diffScroll.value = 5;

			view.setFiles([sampleFiles()[0]]);

			expect(view.files.value).toHaveLength(1);
			expect(view.selectedIndex.value).toBe(0);
			expect(view.listScroll.value).toBe(0);
			expect(view.diffScroll.value).toBe(0);
		});

		it("marks component dirty", () => {
			const view = new CodeView();
			view.clearDirty();

			view.setFiles(sampleFiles());
			expect(view.dirty).toBe(true);
		});
	});

	describe("keyboard navigation (list pane)", () => {
		it("moves selection down with j", () => {
			const view = new CodeView({ files: sampleFiles() });

			const handled = view.handleKey(makeKey("j"));
			expect(handled).toBe(true);
			expect(view.selectedIndex.value).toBe(1);
		});

		it("moves selection down with arrow down", () => {
			const view = new CodeView({ files: sampleFiles() });

			view.handleKey(makeKey(KEY_CODES.DOWN));
			expect(view.selectedIndex.value).toBe(1);
		});

		it("moves selection up with k", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.selectedIndex.value = 2;

			view.handleKey(makeKey("k"));
			expect(view.selectedIndex.value).toBe(1);
		});

		it("moves selection up with arrow up", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.selectedIndex.value = 2;

			view.handleKey(makeKey(KEY_CODES.UP));
			expect(view.selectedIndex.value).toBe(1);
		});

		it("clamps selection at top", () => {
			const view = new CodeView({ files: sampleFiles() });
			expect(view.selectedIndex.value).toBe(0);

			view.handleKey(makeKey("k"));
			expect(view.selectedIndex.value).toBe(0);
		});

		it("clamps selection at bottom", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.selectedIndex.value = 3; // last item

			view.handleKey(makeKey("j"));
			expect(view.selectedIndex.value).toBe(3);
		});

		it("Enter switches focus to diff pane", () => {
			const view = new CodeView({ files: sampleFiles() });

			view.handleKey(makeKey(KEY_CODES.ENTER));
			expect(view.focusedPane.value).toBe("diff");
		});

		it("returns false for unhandled keys", () => {
			const view = new CodeView({ files: sampleFiles() });

			const handled = view.handleKey(makeKey("x"));
			expect(handled).toBe(false);
		});

		it("returns false when files are empty", () => {
			const view = new CodeView();

			const handled = view.handleKey(makeKey("j"));
			expect(handled).toBe(false);
		});

		it("resets diff scroll on selection change", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.diffScroll.value = 5;

			view.handleKey(makeKey("j"));
			expect(view.diffScroll.value).toBe(0);
		});
	});

	describe("keyboard navigation (diff pane)", () => {
		it("scrolls down with j in diff pane", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.focusedPane.value = "diff";

			const handled = view.handleKey(makeKey("j"));
			expect(handled).toBe(true);
		});

		it("scrolls up with k in diff pane", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.focusedPane.value = "diff";
			view.diffScroll.value = 3;

			view.handleKey(makeKey("k"));
			expect(view.diffScroll.value).toBe(2);
		});

		it("clamps scroll at top", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.focusedPane.value = "diff";
			view.diffScroll.value = 0;

			view.handleKey(makeKey("k"));
			expect(view.diffScroll.value).toBe(0);
		});
	});

	describe("Tab toggles pane focus", () => {
		it("switches from list to diff", () => {
			const view = new CodeView({ files: sampleFiles() });
			expect(view.focusedPane.value).toBe("list");

			view.handleKey(makeKey(KEY_CODES.TAB));
			expect(view.focusedPane.value).toBe("diff");
		});

		it("switches from diff to list", () => {
			const view = new CodeView({ files: sampleFiles() });
			view.focusedPane.value = "diff";

			view.handleKey(makeKey(KEY_CODES.TAB));
			expect(view.focusedPane.value).toBe("list");
		});
	});
});
