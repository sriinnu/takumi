import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { beforeEach, describe, expect, it } from "vitest";
import { Editor } from "../src/editor/editor.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a KeyEvent for a single printable character. */
function charKey(ch: string): KeyEvent {
	return { key: ch, ctrl: false, alt: false, shift: false, meta: false, raw: ch };
}

/** Create a KeyEvent from a raw escape sequence. */
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

/** Create a ctrl+key event. */
function ctrlKey(ch: string, shift = false): KeyEvent {
	return { key: ch, ctrl: true, alt: false, shift, meta: false, raw: `\x1b${ch}` };
}

/** Type a string character by character into the editor. */
function typeText(editor: Editor, text: string): void {
	for (const ch of text) {
		editor.handleKey(charKey(ch));
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Editor", () => {
	let editor: Editor;

	beforeEach(() => {
		editor = new Editor();
	});

	// ── Basic insert / delete / backspace ──────────────────────────────────

	describe("basic insert/delete/backspace", () => {
		it("starts with empty buffer", () => {
			expect(editor.text).toBe("");
			expect(editor.cursorRow).toBe(0);
			expect(editor.cursorCol).toBe(0);
			expect(editor.lineCount).toBe(1);
		});

		it("inserts a single character", () => {
			editor.insert("a");
			expect(editor.text).toBe("a");
			expect(editor.cursorCol).toBe(1);
		});

		it("inserts multiple characters", () => {
			editor.insert("hello");
			expect(editor.text).toBe("hello");
			expect(editor.cursorCol).toBe(5);
		});

		it("inserts at cursor position", () => {
			editor.insert("ac");
			editor.moveLeft();
			editor.insert("b");
			expect(editor.text).toBe("abc");
			expect(editor.cursorCol).toBe(2);
		});

		it("backspace removes character before cursor", () => {
			editor.insert("abc");
			editor.backspace();
			expect(editor.text).toBe("ab");
			expect(editor.cursorCol).toBe(2);
		});

		it("backspace at beginning of buffer does nothing", () => {
			editor.backspace();
			expect(editor.text).toBe("");
			expect(editor.cursorCol).toBe(0);
		});

		it("delete removes character at cursor", () => {
			editor.insert("abc");
			editor.moveHome();
			editor.delete();
			expect(editor.text).toBe("bc");
			expect(editor.cursorCol).toBe(0);
		});

		it("delete at end of buffer does nothing", () => {
			editor.insert("abc");
			editor.delete();
			expect(editor.text).toBe("abc");
			expect(editor.cursorCol).toBe(3);
		});

		it("delete in middle of line", () => {
			editor.insert("abcd");
			editor.moveHome();
			editor.moveRight();
			editor.delete();
			expect(editor.text).toBe("acd");
			expect(editor.cursorCol).toBe(1);
		});

		it("backspace removes all characters one by one", () => {
			editor.insert("abc");
			editor.backspace();
			editor.backspace();
			editor.backspace();
			expect(editor.text).toBe("");
			expect(editor.cursorCol).toBe(0);
		});
	});

	// ── Cursor movement ───────────────────────────────────────────────────

	describe("cursor movement", () => {
		it("moveLeft from middle of line", () => {
			editor.insert("abc");
			editor.moveLeft();
			expect(editor.cursorCol).toBe(2);
		});

		it("moveLeft at beginning of buffer stays at 0,0", () => {
			editor.moveLeft();
			expect(editor.cursorRow).toBe(0);
			expect(editor.cursorCol).toBe(0);
		});

		it("moveRight from middle of line", () => {
			editor.insert("abc");
			editor.moveHome();
			editor.moveRight();
			expect(editor.cursorCol).toBe(1);
		});

		it("moveRight at end of buffer stays put", () => {
			editor.insert("abc");
			editor.moveRight();
			expect(editor.cursorCol).toBe(3);
		});

		it("moveHome moves to column 0", () => {
			editor.insert("hello");
			editor.moveHome();
			expect(editor.cursorCol).toBe(0);
		});

		it("moveEnd moves to end of line", () => {
			editor.insert("hello");
			editor.moveHome();
			editor.moveEnd();
			expect(editor.cursorCol).toBe(5);
		});

		it("moveLeft wraps to previous line", () => {
			editor.insert("ab");
			editor.newline();
			editor.insert("cd");
			editor.moveHome();
			editor.moveLeft();
			expect(editor.cursorRow).toBe(0);
			expect(editor.cursorCol).toBe(2);
		});

		it("moveRight wraps to next line", () => {
			editor.insert("ab");
			editor.newline();
			editor.insert("cd");
			// Go to end of line 0
			editor.moveUp();
			editor.moveEnd();
			editor.moveRight();
			expect(editor.cursorRow).toBe(1);
			expect(editor.cursorCol).toBe(0);
		});
	});

	// ── Word movement ─────────────────────────────────────────────────────

	describe("word movement", () => {
		it("moveWordRight skips to next word boundary", () => {
			editor.insert("hello world foo");
			editor.moveHome();
			editor.moveWordRight();
			expect(editor.cursorCol).toBe(6); // after "hello "
		});

		it("moveWordRight from middle of word", () => {
			editor.insert("hello world");
			editor.moveHome();
			editor.moveRight(); // at 'e' in hello
			editor.moveWordRight();
			expect(editor.cursorCol).toBe(6); // after "hello "
		});

		it("moveWordRight at end of line wraps to next line", () => {
			editor.insert("hello");
			editor.newline();
			editor.insert("world");
			editor.moveUp();
			editor.moveEnd();
			editor.moveWordRight();
			expect(editor.cursorRow).toBe(1);
			expect(editor.cursorCol).toBe(0);
		});

		it("moveWordLeft skips to previous word start", () => {
			editor.insert("hello world");
			editor.moveWordLeft();
			expect(editor.cursorCol).toBe(6);
		});

		it("moveWordLeft from beginning of word", () => {
			editor.insert("hello world foo");
			// Position at start of "foo"
			editor.moveEnd();
			editor.moveWordLeft();
			expect(editor.cursorCol).toBe(12); // start of "foo"
			editor.moveWordLeft();
			expect(editor.cursorCol).toBe(6); // start of "world"
		});

		it("moveWordLeft at beginning of line wraps to previous line", () => {
			editor.insert("hello");
			editor.newline();
			editor.insert("world");
			editor.moveHome();
			editor.moveWordLeft();
			expect(editor.cursorRow).toBe(0);
			expect(editor.cursorCol).toBe(5);
		});

		it("moveWordRight at end of buffer stays put", () => {
			editor.insert("hello");
			editor.moveWordRight();
			expect(editor.cursorCol).toBe(5);
		});

		it("moveWordLeft at beginning of buffer stays put", () => {
			editor.insert("hello");
			editor.moveHome();
			editor.moveWordLeft();
			expect(editor.cursorCol).toBe(0);
		});

		it("handles punctuation as word boundary", () => {
			editor.insert("foo.bar");
			editor.moveHome();
			editor.moveWordRight();
			// After "foo", stops at "."
			expect(editor.cursorCol).toBe(4); // past "foo."
		});
	});

	// ── Multi-line editing ────────────────────────────────────────────────

	describe("multi-line editing", () => {
		it("newline splits the current line", () => {
			editor.insert("helloworld");
			// Move cursor to position 5
			editor.moveHome();
			for (let i = 0; i < 5; i++) editor.moveRight();
			editor.newline();
			expect(editor.lineCount).toBe(2);
			expect(editor.getLine(0)).toBe("hello");
			expect(editor.getLine(1)).toBe("world");
			expect(editor.cursorRow).toBe(1);
			expect(editor.cursorCol).toBe(0);
		});

		it("newline at end of line creates empty line", () => {
			editor.insert("hello");
			editor.newline();
			expect(editor.lineCount).toBe(2);
			expect(editor.getLine(0)).toBe("hello");
			expect(editor.getLine(1)).toBe("");
			expect(editor.cursorRow).toBe(1);
		});

		it("moveUp from first line stays on first line", () => {
			editor.insert("hello");
			editor.moveUp();
			expect(editor.cursorRow).toBe(0);
		});

		it("moveDown from last line stays on last line", () => {
			editor.insert("hello");
			editor.moveDown();
			expect(editor.cursorRow).toBe(0);
		});

		it("moveUp/Down clamps column to line length", () => {
			editor.insert("long line here");
			editor.newline();
			editor.insert("short");
			editor.moveUp();
			// cursor was at col 5 on line 1, line 0 is 14 chars, so stays at col 5
			expect(editor.cursorCol).toBe(5);
			// Now go to end of line 0
			editor.moveEnd();
			expect(editor.cursorCol).toBe(14);
			// Move down - line 1 is only 5 chars, should clamp
			editor.moveDown();
			expect(editor.cursorCol).toBe(5);
		});

		it("backspace at beginning of line merges with previous", () => {
			editor.insert("hello");
			editor.newline();
			editor.insert("world");
			editor.moveHome();
			editor.backspace();
			expect(editor.lineCount).toBe(1);
			expect(editor.text).toBe("helloworld");
			expect(editor.cursorCol).toBe(5);
		});

		it("delete at end of line merges with next", () => {
			editor.insert("hello");
			editor.newline();
			editor.insert("world");
			editor.moveUp();
			editor.moveEnd();
			editor.delete();
			expect(editor.lineCount).toBe(1);
			expect(editor.text).toBe("helloworld");
		});

		it("set text with multiple lines", () => {
			editor.text = "line1\nline2\nline3";
			expect(editor.lineCount).toBe(3);
			expect(editor.getLine(0)).toBe("line1");
			expect(editor.getLine(1)).toBe("line2");
			expect(editor.getLine(2)).toBe("line3");
		});

		it("getLine returns empty string for out of range", () => {
			editor.insert("hello");
			expect(editor.getLine(-1)).toBe("");
			expect(editor.getLine(5)).toBe("");
		});

		it("insert multi-line text", () => {
			editor.insert("aaa");
			editor.moveHome();
			editor.moveRight(); // col 1
			editor.insert("x\ny\nz");
			expect(editor.lineCount).toBe(3);
			expect(editor.getLine(0)).toBe("ax");
			expect(editor.getLine(1)).toBe("y");
			expect(editor.getLine(2)).toBe("zaa");
			expect(editor.cursorRow).toBe(2);
			expect(editor.cursorCol).toBe(1);
		});
	});

	// ── Selection ─────────────────────────────────────────────────────────

	describe("selection", () => {
		it("selectAll selects entire buffer", () => {
			editor.insert("hello world");
			editor.selectAll();
			const sel = editor.getSelection();
			expect(sel).not.toBeNull();
			expect(sel!.start).toEqual({ row: 0, col: 0 });
			expect(sel!.end).toEqual({ row: 0, col: 11 });
		});

		it("selectAll on multi-line buffer", () => {
			editor.text = "line1\nline2\nline3";
			editor.selectAll();
			const sel = editor.getSelection();
			expect(sel).not.toBeNull();
			expect(sel!.start).toEqual({ row: 0, col: 0 });
			expect(sel!.end).toEqual({ row: 2, col: 5 });
		});

		it("no selection by default", () => {
			expect(editor.getSelection()).toBeNull();
		});

		it("shift+right extends selection", () => {
			editor.insert("hello");
			editor.moveHome();
			editor.handleKey(rawKey(KEY_CODES.SHIFT_RIGHT, { shift: true }));
			editor.handleKey(rawKey(KEY_CODES.SHIFT_RIGHT, { shift: true }));
			const sel = editor.getSelection();
			expect(sel).not.toBeNull();
			expect(sel!.start).toEqual({ row: 0, col: 0 });
			expect(sel!.end).toEqual({ row: 0, col: 2 });
		});

		it("shift+left extends selection backwards", () => {
			editor.insert("hello");
			editor.handleKey(rawKey(KEY_CODES.SHIFT_LEFT, { shift: true }));
			editor.handleKey(rawKey(KEY_CODES.SHIFT_LEFT, { shift: true }));
			const sel = editor.getSelection();
			expect(sel).not.toBeNull();
			expect(sel!.start).toEqual({ row: 0, col: 3 });
			expect(sel!.end).toEqual({ row: 0, col: 5 });
		});

		it("shift+up extends selection to previous line", () => {
			editor.text = "line1\nline2";
			// cursor is at end of line2 after set
			editor.handleKey(rawKey(KEY_CODES.SHIFT_UP, { shift: true }));
			const sel = editor.getSelection();
			expect(sel).not.toBeNull();
			expect(sel!.start.row).toBe(0);
			expect(sel!.end.row).toBe(1);
		});

		it("shift+down extends selection to next line", () => {
			editor.text = "line1\nline2";
			editor.moveHome();
			editor.moveUp(); // go to line 0 col 0
			editor.moveHome();
			editor.handleKey(rawKey(KEY_CODES.SHIFT_DOWN, { shift: true }));
			const sel = editor.getSelection();
			expect(sel).not.toBeNull();
			expect(sel!.start.row).toBe(0);
		});

		it("deleteSelection removes selected text", () => {
			editor.insert("hello world");
			editor.selectAll();
			editor.deleteSelection();
			expect(editor.text).toBe("");
			expect(editor.cursorRow).toBe(0);
			expect(editor.cursorCol).toBe(0);
		});

		it("deleteSelection on partial selection", () => {
			editor.insert("hello world");
			editor.moveHome();
			// Select "hello"
			for (let i = 0; i < 5; i++) {
				editor.handleKey(rawKey(KEY_CODES.SHIFT_RIGHT, { shift: true }));
			}
			editor.deleteSelection();
			expect(editor.text).toBe(" world");
			expect(editor.cursorCol).toBe(0);
		});

		it("deleteSelection on multi-line selection", () => {
			editor.text = "line1\nline2\nline3";
			editor.selectAll();
			editor.deleteSelection();
			expect(editor.text).toBe("");
			expect(editor.lineCount).toBe(1);
		});

		it("insert replaces selection", () => {
			editor.insert("hello world");
			editor.selectAll();
			editor.insert("replaced");
			expect(editor.text).toBe("replaced");
		});

		it("backspace deletes selection", () => {
			editor.insert("hello world");
			editor.selectAll();
			editor.backspace();
			expect(editor.text).toBe("");
		});

		it("delete key deletes selection", () => {
			editor.insert("hello world");
			editor.selectAll();
			editor.delete();
			expect(editor.text).toBe("");
		});

		it("arrow without shift clears selection and collapses to left", () => {
			editor.insert("hello");
			editor.selectAll();
			editor.handleKey(rawKey(KEY_CODES.LEFT));
			expect(editor.getSelection()).toBeNull();
			expect(editor.cursorCol).toBe(0);
		});

		it("right arrow without shift clears selection and collapses to right", () => {
			editor.insert("hello");
			editor.selectAll();
			editor.handleKey(rawKey(KEY_CODES.RIGHT));
			expect(editor.getSelection()).toBeNull();
			expect(editor.cursorCol).toBe(5);
		});

		it("deleteSelection is no-op with no selection", () => {
			editor.insert("hello");
			editor.deleteSelection();
			expect(editor.text).toBe("hello");
		});
	});

	// ── Undo / Redo ───────────────────────────────────────────────────────

	describe("undo/redo", () => {
		it("undo reverses insert", () => {
			editor.insert("hello");
			editor.undo();
			expect(editor.text).toBe("");
		});

		it("redo restores after undo", () => {
			editor.insert("hello");
			editor.undo();
			editor.redo();
			expect(editor.text).toBe("hello");
		});

		it("undo reverses backspace", () => {
			editor.insert("abc");
			editor.backspace();
			expect(editor.text).toBe("ab");
			editor.undo();
			expect(editor.text).toBe("abc");
		});

		it("undo reverses delete", () => {
			editor.insert("abc");
			editor.moveHome();
			editor.delete();
			expect(editor.text).toBe("bc");
			editor.undo();
			expect(editor.text).toBe("abc");
		});

		it("undo reverses newline", () => {
			editor.insert("hello");
			editor.newline();
			editor.insert("world");
			editor.undo(); // undo "world" insert
			editor.undo(); // undo newline
			expect(editor.text).toBe("hello");
			expect(editor.lineCount).toBe(1);
		});

		it("undo reverses clear", () => {
			editor.insert("hello");
			editor.clear();
			expect(editor.text).toBe("");
			editor.undo();
			expect(editor.text).toBe("hello");
		});

		it("multiple undo/redo", () => {
			editor.insert("a");
			editor.insert("b");
			editor.insert("c");
			expect(editor.text).toBe("abc");
			editor.undo();
			expect(editor.text).toBe("ab");
			editor.undo();
			expect(editor.text).toBe("a");
			editor.redo();
			expect(editor.text).toBe("ab");
			editor.redo();
			expect(editor.text).toBe("abc");
		});

		it("redo stack is cleared on new edit after undo", () => {
			editor.insert("a");
			editor.insert("b");
			editor.undo();
			editor.insert("c"); // This should clear the redo stack
			editor.redo(); // Should be no-op
			expect(editor.text).toBe("ac");
		});

		it("undo on empty history is no-op", () => {
			editor.undo();
			expect(editor.text).toBe("");
		});

		it("redo on empty history is no-op", () => {
			editor.redo();
			expect(editor.text).toBe("");
		});

		it("history is capped at maxHistory", () => {
			const small = new Editor({ maxHistory: 3 });
			small.insert("a");
			small.insert("b");
			small.insert("c");
			small.insert("d");
			small.insert("e");
			// 5 inserts, but only 3 undo slots should be reachable
			small.undo();
			small.undo();
			small.undo();
			// The oldest entries were evicted
			small.undo(); // Should still work (shifts)
			// Can't undo further
			const afterUndo = small.text;
			small.undo();
			expect(small.text).toBe(afterUndo);
		});

		it("undo reverses text setter", () => {
			editor.insert("original");
			editor.text = "replaced";
			editor.undo();
			expect(editor.text).toBe("original");
		});
	});

	// ── Bracket matching ──────────────────────────────────────────────────

	describe("bracket matching", () => {
		it("matches parentheses forward", () => {
			editor.insert("(hello)");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 6 });
		});

		it("matches parentheses backward", () => {
			editor.insert("(hello)");
			editor.moveEnd();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 0 });
		});

		it("matches square brackets", () => {
			editor.insert("[1, 2, 3]");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 8 });
		});

		it("matches curly braces", () => {
			editor.insert("{a: 1}");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 5 });
		});

		it("matches angle brackets", () => {
			editor.insert("<div>");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 4 });
		});

		it("handles nested brackets", () => {
			editor.insert("((inner))");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 8 });
		});

		it("handles nested different bracket types", () => {
			editor.insert("({[<>]})");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 7 });
		});

		it("matches brackets across lines", () => {
			editor.text = "(\n  hello\n)";
			// Cursor at end of last line (after set, cursor is at end)
			// Move to beginning
			editor.moveUp();
			editor.moveUp();
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 2, col: 0 });
		});

		it("returns null when no bracket at cursor", () => {
			editor.insert("hello");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toBeNull();
		});

		it("returns null for unmatched bracket", () => {
			editor.insert("(hello");
			editor.moveHome();
			const match = editor.findMatchingBracket();
			expect(match).toBeNull();
		});

		it("checks character before cursor too", () => {
			editor.insert("(hello)");
			// Cursor is at col 7, past the ')'. findMatchingBracket checks col 7 and col 6.
			// col 6 is ')'.
			const match = editor.findMatchingBracket();
			expect(match).toEqual({ row: 0, col: 0 });
		});
	});

	// ── Auto-indent ───────────────────────────────────────────────────────

	describe("auto-indent", () => {
		it("copies leading whitespace from previous line", () => {
			expect(editor.getAutoIndent("  hello")).toBe("  ");
		});

		it("adds extra indent after opening brace", () => {
			expect(editor.getAutoIndent("  if (true) {")).toBe("    ");
		});

		it("adds extra indent after colon", () => {
			expect(editor.getAutoIndent("  case 1:")).toBe("    ");
		});

		it("no indent for empty line", () => {
			expect(editor.getAutoIndent("")).toBe("");
		});

		it("no indent for line without leading whitespace", () => {
			expect(editor.getAutoIndent("hello")).toBe("");
		});

		it("tabs-based indent is preserved", () => {
			expect(editor.getAutoIndent("\t\thello")).toBe("\t\t");
		});

		it("newline applies auto-indent", () => {
			editor.insert("  function foo() {");
			editor.newline();
			expect(editor.cursorCol).toBe(4);
			expect(editor.getLine(1)).toBe("    ");
		});

		it("newline after colon adds indent", () => {
			editor.insert("  case 1:");
			editor.newline();
			expect(editor.cursorCol).toBe(4);
		});

		it("newline preserves text after cursor", () => {
			editor.insert("  {content}");
			// Move cursor before "content}"
			editor.moveHome();
			for (let i = 0; i < 3; i++) editor.moveRight(); // after "  {"
			editor.newline();
			expect(editor.getLine(0)).toBe("  {");
			expect(editor.getLine(1)).toBe("    content}");
		});

		it("configurable tab size", () => {
			const ed = new Editor({ tabSize: 4 });
			expect(ed.getAutoIndent("  if (true) {")).toBe("      ");
		});

		it("brace with trailing whitespace still adds indent", () => {
			expect(editor.getAutoIndent("  {   ")).toBe("    ");
		});
	});

	// ── handleKey routing ─────────────────────────────────────────────────

	describe("handleKey routing", () => {
		it("handles printable character", () => {
			const handled = editor.handleKey(charKey("a"));
			expect(handled).toBe(true);
			expect(editor.text).toBe("a");
		});

		it("handles left arrow", () => {
			editor.insert("ab");
			const handled = editor.handleKey(rawKey(KEY_CODES.LEFT));
			expect(handled).toBe(true);
			expect(editor.cursorCol).toBe(1);
		});

		it("handles right arrow", () => {
			editor.insert("ab");
			editor.moveHome();
			const handled = editor.handleKey(rawKey(KEY_CODES.RIGHT));
			expect(handled).toBe(true);
			expect(editor.cursorCol).toBe(1);
		});

		it("handles up arrow", () => {
			editor.text = "line1\nline2";
			const handled = editor.handleKey(rawKey(KEY_CODES.UP));
			expect(handled).toBe(true);
			expect(editor.cursorRow).toBe(0);
		});

		it("handles down arrow", () => {
			editor.text = "line1\nline2";
			editor.moveUp();
			editor.moveHome();
			const handled = editor.handleKey(rawKey(KEY_CODES.DOWN));
			expect(handled).toBe(true);
			expect(editor.cursorRow).toBe(1);
		});

		it("handles Home key", () => {
			editor.insert("hello");
			const handled = editor.handleKey(rawKey(KEY_CODES.HOME));
			expect(handled).toBe(true);
			expect(editor.cursorCol).toBe(0);
		});

		it("handles End key", () => {
			editor.insert("hello");
			editor.moveHome();
			const handled = editor.handleKey(rawKey(KEY_CODES.END));
			expect(handled).toBe(true);
			expect(editor.cursorCol).toBe(5);
		});

		it("handles backspace key", () => {
			editor.insert("ab");
			const handled = editor.handleKey(rawKey(KEY_CODES.BACKSPACE, { key: "backspace" }));
			expect(handled).toBe(true);
			expect(editor.text).toBe("a");
		});

		it("handles delete key", () => {
			editor.insert("ab");
			editor.moveHome();
			const handled = editor.handleKey(rawKey(KEY_CODES.DELETE));
			expect(handled).toBe(true);
			expect(editor.text).toBe("b");
		});

		it("handles Ctrl+A (select all)", () => {
			editor.insert("hello");
			const handled = editor.handleKey(ctrlKey("a"));
			expect(handled).toBe(true);
			expect(editor.getSelection()).not.toBeNull();
		});

		it("handles Ctrl+Z (undo)", () => {
			editor.insert("hello");
			const handled = editor.handleKey(ctrlKey("z"));
			expect(handled).toBe(true);
			expect(editor.text).toBe("");
		});

		it("handles Ctrl+Y (redo)", () => {
			editor.insert("hello");
			editor.undo();
			const handled = editor.handleKey(ctrlKey("y"));
			expect(handled).toBe(true);
			expect(editor.text).toBe("hello");
		});

		it("handles Ctrl+Shift+Z (redo)", () => {
			editor.insert("hello");
			editor.undo();
			const handled = editor.handleKey(ctrlKey("z", true));
			expect(handled).toBe(true);
			expect(editor.text).toBe("hello");
		});

		it("handles Tab key", () => {
			const handled = editor.handleKey(rawKey(KEY_CODES.TAB));
			expect(handled).toBe(true);
			expect(editor.text).toBe("  ");
		});

		it("handles Tab with custom tab size", () => {
			const ed = new Editor({ tabSize: 4 });
			ed.handleKey(rawKey(KEY_CODES.TAB));
			expect(ed.text).toBe("    ");
		});

		it("handles Shift+Enter (newline)", () => {
			editor.insert("hello");
			const handled = editor.handleKey(rawKey(KEY_CODES.ENTER, { key: "return", shift: true }));
			expect(handled).toBe(true);
			expect(editor.lineCount).toBe(2);
		});

		it("plain Enter returns false (not handled)", () => {
			editor.insert("hello");
			const handled = editor.handleKey(rawKey(KEY_CODES.ENTER, { key: "return", shift: false }));
			expect(handled).toBe(false);
		});

		it("returns false for unknown key combinations", () => {
			const handled = editor.handleKey(rawKey(KEY_CODES.F1));
			expect(handled).toBe(false);
		});

		it("returns false for unhandled ctrl combos", () => {
			const handled = editor.handleKey(ctrlKey("x"));
			expect(handled).toBe(false);
		});
	});

	// ── Edge cases ────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("empty buffer has one line", () => {
			expect(editor.lineCount).toBe(1);
			expect(editor.getLine(0)).toBe("");
		});

		it("clear resets to empty state", () => {
			editor.insert("hello");
			editor.newline();
			editor.insert("world");
			editor.clear();
			expect(editor.text).toBe("");
			expect(editor.lineCount).toBe(1);
			expect(editor.cursorRow).toBe(0);
			expect(editor.cursorCol).toBe(0);
		});

		it("set text to empty string", () => {
			editor.insert("hello");
			editor.text = "";
			expect(editor.text).toBe("");
			expect(editor.lineCount).toBe(1);
		});

		it("cursor stays valid after text setter", () => {
			editor.text = "hello\nworld";
			expect(editor.cursorRow).toBe(1);
			expect(editor.cursorCol).toBe(5);
		});

		it("very long line insert", () => {
			const longText = "x".repeat(10000);
			editor.insert(longText);
			expect(editor.text).toBe(longText);
			expect(editor.cursorCol).toBe(10000);
		});

		it("many lines", () => {
			const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
			editor.text = lines.join("\n");
			expect(editor.lineCount).toBe(1000);
			expect(editor.getLine(999)).toBe("line 999");
		});

		it("cursor clamp on moveUp to shorter line", () => {
			editor.insert("short");
			editor.newline();
			editor.insert("much longer line here");
			// Cursor at col 21 on line 1
			editor.moveUp();
			// Line 0 is "short" (5 chars), cursor should clamp to 5
			expect(editor.cursorCol).toBe(5);
		});

		it("cursor clamp on moveDown to shorter line", () => {
			editor.insert("much longer line here");
			editor.newline();
			editor.insert("short");
			editor.moveUp();
			editor.moveEnd(); // col 20 on line 0
			editor.moveDown();
			expect(editor.cursorCol).toBe(5);
		});

		it("selection cleared after clear()", () => {
			editor.insert("hello");
			editor.selectAll();
			editor.clear();
			expect(editor.getSelection()).toBeNull();
		});

		it("insert at beginning of line", () => {
			editor.insert("world");
			editor.moveHome();
			editor.insert("hello ");
			expect(editor.text).toBe("hello world");
		});

		it("multiple newlines create empty lines", () => {
			editor.newline();
			editor.newline();
			editor.newline();
			expect(editor.lineCount).toBe(4);
			expect(editor.getLine(0)).toBe("");
			expect(editor.getLine(1)).toBe("");
			expect(editor.getLine(2)).toBe("");
			expect(editor.getLine(3)).toBe("");
		});

		it("backspace across multiple line joins", () => {
			editor.text = "a\nb\nc";
			// Cursor at end of "c"
			editor.moveHome();
			editor.backspace(); // merge "c" with "b" -> "bc"
			expect(editor.lineCount).toBe(2);
			expect(editor.text).toBe("a\nbc");
			editor.moveHome();
			editor.backspace(); // merge "bc" with "a" -> "abc"
			expect(editor.lineCount).toBe(1);
			expect(editor.text).toBe("abc");
		});

		it("handleKey with typed string integration", () => {
			typeText(editor, "hello world");
			expect(editor.text).toBe("hello world");
			expect(editor.cursorCol).toBe(11);
		});
	});

	// ── Ctrl+Left / Ctrl+Right via handleKey ──────────────────────────────

	describe("ctrl+arrow word movement via handleKey", () => {
		it("ctrl+right moves to next word", () => {
			editor.insert("hello world");
			editor.moveHome();
			editor.handleKey(rawKey(KEY_CODES.CTRL_RIGHT, { ctrl: true }));
			expect(editor.cursorCol).toBe(6);
		});

		it("ctrl+left moves to previous word", () => {
			editor.insert("hello world");
			editor.handleKey(rawKey(KEY_CODES.CTRL_LEFT, { ctrl: true }));
			expect(editor.cursorCol).toBe(6);
		});
	});
});
