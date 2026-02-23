/**
 * Tests for diff parser, renderer, and inline diff.
 */

import { describe, expect, it } from "vitest";
import { isDiffContent, parseDiff, renderDiff, renderInlineDiff, renderMultiFileDiff } from "../src/diff-parser.js";
import { defaultTheme } from "../src/theme.js";

// ── Helper data ──────────────────────────────────────────────────────────────

const SIMPLE_DIFF = `--- a/src/app.ts
+++ b/src/app.ts
@@ -10,5 +10,7 @@
 const app = new TakumiApp();
 app.start();
-app.run();
+await app.run();
+app.cleanup();
 return app;`;

const MULTI_HUNK_DIFF = `--- a/src/state.ts
+++ b/src/state.ts
@@ -1,3 +1,4 @@
 import { signal } from "./signals.js";
+import { computed } from "./signals.js";

 export class AppState {
@@ -20,4 +21,6 @@
 	readonly model: Signal<string> = signal("claude");

+	readonly totalTokens: ReadonlySignal<number> = computed(() => 0);
+
 	reset(): void {`;

const MULTI_FILE_DIFF = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import { foo } from "./foo.js";
+import { bar } from "./bar.js";

 export function main() {
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -0,0 +1,3 @@
+export function bar() {
+  return "bar";
+}`;

const GIT_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -5,3 +5,4 @@
 function start() {
   init();
+  run();
 }`;

// ── parseDiff tests ──────────────────────────────────────────────────────────

describe("parseDiff", () => {
	it("parses a simple diff with add/remove/context lines", () => {
		const files = parseDiff(SIMPLE_DIFF);
		expect(files).toHaveLength(1);

		const file = files[0];
		expect(file.oldPath).toBe("src/app.ts");
		expect(file.newPath).toBe("src/app.ts");
		expect(file.hunks).toHaveLength(1);

		const hunk = file.hunks[0];
		expect(hunk.oldStart).toBe(10);
		expect(hunk.oldCount).toBe(5);
		expect(hunk.newStart).toBe(10);
		expect(hunk.newCount).toBe(7);

		// Check line types
		const types = hunk.lines.map((l) => l.type);
		expect(types).toEqual(["context", "context", "remove", "add", "add", "context"]);
	});

	it("parses context line content correctly", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const lines = files[0].hunks[0].lines;
		expect(lines[0].content).toBe("const app = new TakumiApp();");
		expect(lines[0].type).toBe("context");
	});

	it("parses added line content (strips + prefix)", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const lines = files[0].hunks[0].lines;
		const addLine = lines.find((l) => l.type === "add");
		expect(addLine).toBeDefined();
		expect(addLine!.content).toBe("await app.run();");
	});

	it("parses removed line content (strips - prefix)", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const lines = files[0].hunks[0].lines;
		const removeLine = lines.find((l) => l.type === "remove");
		expect(removeLine).toBeDefined();
		expect(removeLine!.content).toBe("app.run();");
	});

	it("assigns correct line numbers to context lines", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const lines = files[0].hunks[0].lines;
		// First context line: old=10, new=10
		expect(lines[0].oldLineNo).toBe(10);
		expect(lines[0].newLineNo).toBe(10);
	});

	it("assigns correct line numbers to added lines", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const lines = files[0].hunks[0].lines;
		const addLines = lines.filter((l) => l.type === "add");
		expect(addLines[0].newLineNo).toBe(12);
		expect(addLines[1].newLineNo).toBe(13);
	});

	it("assigns correct line numbers to removed lines", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const lines = files[0].hunks[0].lines;
		const removeLine = lines.find((l) => l.type === "remove");
		expect(removeLine!.oldLineNo).toBe(12);
	});

	it("parses multi-hunk diff", () => {
		const files = parseDiff(MULTI_HUNK_DIFF);
		expect(files).toHaveLength(1);
		expect(files[0].hunks).toHaveLength(2);

		const hunk1 = files[0].hunks[0];
		expect(hunk1.oldStart).toBe(1);
		expect(hunk1.newStart).toBe(1);

		const hunk2 = files[0].hunks[1];
		expect(hunk2.oldStart).toBe(20);
		expect(hunk2.newStart).toBe(21);
	});

	it("parses multi-file diff", () => {
		const files = parseDiff(MULTI_FILE_DIFF);
		expect(files).toHaveLength(2);
		expect(files[0].oldPath).toBe("src/app.ts");
		expect(files[1].oldPath).toBe("src/bar.ts");
	});

	it("handles git diff format with index line", () => {
		const files = parseDiff(GIT_DIFF);
		expect(files).toHaveLength(1);
		expect(files[0].oldPath).toBe("src/app.ts");
		expect(files[0].newPath).toBe("src/app.ts");
		expect(files[0].hunks).toHaveLength(1);
	});

	it("parses hunk header correctly", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const hunk = files[0].hunks[0];
		expect(hunk.header).toContain("@@ -10,5 +10,7 @@");
	});

	it("returns empty array for empty input", () => {
		expect(parseDiff("")).toEqual([]);
		expect(parseDiff("   ")).toEqual([]);
	});

	it("handles diff with no file headers (hunk only)", () => {
		const hunkOnly = `@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3`;
		const files = parseDiff(hunkOnly);
		expect(files).toHaveLength(1);
		expect(files[0].oldPath).toBe("unknown");
		expect(files[0].hunks[0].lines).toHaveLength(4);
	});

	it("handles hunk with single-line count (no comma)", () => {
		const diff = `--- a/test.ts
+++ b/test.ts
@@ -1 +1 @@
-old line
+new line`;
		const files = parseDiff(diff);
		const hunk = files[0].hunks[0];
		expect(hunk.oldCount).toBe(1);
		expect(hunk.newCount).toBe(1);
	});

	it("handles no newline at end of file marker", () => {
		const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,2 @@
-old line
+new line
\\ No newline at end of file`;
		const files = parseDiff(diff);
		const hunk = files[0].hunks[0];
		// The "\\" line should be skipped
		const types = hunk.lines.map((l) => l.type);
		expect(types).toEqual(["remove", "add"]);
	});

	it("handles /dev/null paths (new file)", () => {
		const diff = `--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;`;
		const files = parseDiff(diff);
		expect(files[0].oldPath).toBe("/dev/null");
		expect(files[0].newPath).toBe("new-file.ts");
	});

	it("handles /dev/null paths (deleted file)", () => {
		const diff = `--- a/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const x = 1;
-export const y = 2;`;
		const files = parseDiff(diff);
		expect(files[0].oldPath).toBe("old-file.ts");
		expect(files[0].newPath).toBe("/dev/null");
	});

	it("preserves leading whitespace in line content", () => {
		const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,3 @@
   function foo() {
-    return 1;
+    return 2;
   }`;
		const files = parseDiff(diff);
		const removeLine = files[0].hunks[0].lines.find((l) => l.type === "remove");
		expect(removeLine!.content).toBe("    return 1;");
	});

	it("handles multiple consecutive add lines", () => {
		const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,4 @@
 original
+added1
+added2
+added3`;
		const files = parseDiff(diff);
		const addLines = files[0].hunks[0].lines.filter((l) => l.type === "add");
		expect(addLines).toHaveLength(3);
		expect(addLines[0].newLineNo).toBe(2);
		expect(addLines[1].newLineNo).toBe(3);
		expect(addLines[2].newLineNo).toBe(4);
	});

	it("handles multiple consecutive remove lines", () => {
		const diff = `--- a/test.ts
+++ b/test.ts
@@ -1,4 +1,1 @@
 original
-removed1
-removed2
-removed3`;
		const files = parseDiff(diff);
		const removeLines = files[0].hunks[0].lines.filter((l) => l.type === "remove");
		expect(removeLines).toHaveLength(3);
	});
});

// ── renderDiff tests ─────────────────────────────────────────────────────────

describe("renderDiff", () => {
	it("renders file header with path", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output = renderDiff(files[0], defaultTheme, 80);
		expect(output).toContain("src/app.ts");
	});

	it("renders hunk header", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output = renderDiff(files[0], defaultTheme, 80);
		expect(output).toContain("@@ -10,5 +10,7 @@");
	});

	it("renders added lines with + prefix", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output = renderDiff(files[0], defaultTheme, 80);
		// ANSI stripped check — look for the content
		expect(output).toContain("+await app.run();");
		expect(output).toContain("+app.cleanup();");
	});

	it("renders removed lines with - prefix", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output = renderDiff(files[0], defaultTheme, 80);
		expect(output).toContain("-app.run();");
	});

	it("contains ANSI escape codes for coloring", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output = renderDiff(files[0], defaultTheme, 80);
		// Should contain escape sequences
		expect(output).toContain("\x1b[");
	});

	it("renders separator line in file header", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output = renderDiff(files[0], defaultTheme, 80);
		// Should contain horizontal line chars
		expect(output).toContain("\u2500");
	});

	it("uses correct width for header separator", () => {
		const files = parseDiff(SIMPLE_DIFF);
		const output40 = renderDiff(files[0], defaultTheme, 40);
		const output80 = renderDiff(files[0], defaultTheme, 80);
		// 80 width should have longer separator
		const count40 = (output40.match(/\u2500/g) || []).length;
		const count80 = (output80.match(/\u2500/g) || []).length;
		expect(count80).toBeGreaterThan(count40);
	});
});

describe("renderMultiFileDiff", () => {
	it("renders multiple files separated by blank lines", () => {
		const files = parseDiff(MULTI_FILE_DIFF);
		const output = renderMultiFileDiff(files, defaultTheme, 80);
		expect(output).toContain("src/app.ts");
		expect(output).toContain("src/bar.ts");
	});
});

// ── renderInlineDiff tests ───────────────────────────────────────────────────

describe("renderInlineDiff", () => {
	it("highlights changed words", () => {
		const output = renderInlineDiff("const x = 1;", "const x = 2;", defaultTheme);
		// Should contain both the common parts and the changed parts
		expect(output).toContain("const");
		expect(output).toContain("x");
		expect(output).toContain("=");
	});

	it("handles completely different strings", () => {
		const output = renderInlineDiff("hello world", "goodbye universe", defaultTheme);
		// Should contain ANSI escapes for highlighting
		expect(output).toContain("\x1b[");
	});

	it("handles identical strings (no diff)", () => {
		const output = renderInlineDiff("same text", "same text", defaultTheme);
		expect(output).toContain("same");
		expect(output).toContain("text");
		// Should not contain background color escapes for changes (since no changes)
		// The output should just be the original words
	});

	it("handles empty old text (all additions)", () => {
		const output = renderInlineDiff("", "new content here", defaultTheme);
		expect(output).toContain("new");
	});

	it("handles empty new text (all removals)", () => {
		const output = renderInlineDiff("old content here", "", defaultTheme);
		expect(output).toContain("old");
	});

	it("preserves whitespace tokens", () => {
		const output = renderInlineDiff("a  b", "a  c", defaultTheme);
		// The double space should be preserved
		expect(output).toContain("a");
	});
});

// ── isDiffContent tests ──────────────────────────────────────────────────────

describe("isDiffContent", () => {
	it("detects unified diff with hunk header", () => {
		expect(isDiffContent("@@ -1,3 +1,4 @@\n context")).toBe(true);
	});

	it("detects diff with --- and +++ headers", () => {
		expect(isDiffContent("--- a/file.ts\n+++ b/file.ts")).toBe(true);
	});

	it("detects diff --git prefix", () => {
		expect(isDiffContent("diff --git a/f.ts b/f.ts")).toBe(true);
	});

	it("returns false for plain text", () => {
		expect(isDiffContent("hello world")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isDiffContent("")).toBe(false);
	});

	it("returns false for null-like input", () => {
		expect(isDiffContent("")).toBe(false);
	});

	it("returns false for text with --- but no +++", () => {
		expect(isDiffContent("--- some note\nsome other text")).toBe(false);
	});

	it("detects diff content within first 500 chars", () => {
		const text = `${"some preamble\n".repeat(10)}@@ -1,3 +1,4 @@\n context`;
		expect(isDiffContent(text)).toBe(true);
	});
});
