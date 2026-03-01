/**
 * vim.test.ts — unit tests for the VimMode state machine.
 */

import { describe, expect, it } from "vitest";
import { VimMode } from "../src/vim.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function make(): VimMode {
	return new VimMode();
}

/** Send a raw key and return the resulting op. */
function press(vm: VimMode, raw: string, value = "") {
	return vm.process(raw, value);
}

// ── Initial state ─────────────────────────────────────────────────────────────

describe("initial state", () => {
	it("starts in INSERT mode", () => {
		expect(make().mode).toBe("INSERT");
	});
	it("starts with cursor 0", () => {
		expect(make().cursor).toBe(0);
	});
	it("label is [I] in INSERT mode", () => {
		expect(make().label).toBe(" [I] ");
	});
});

// ── INSERT mode passthrough ───────────────────────────────────────────────────

describe("INSERT mode", () => {
	it("passes through printable characters", () => {
		const vm = make();
		expect(press(vm, "a").op).toBe("passthrough");
		expect(press(vm, "z").op).toBe("passthrough");
		expect(press(vm, " ").op).toBe("passthrough");
	});

	it("passes through Enter in INSERT mode", () => {
		const vm = make();
		expect(press(vm, "\r").op).toBe("passthrough");
	});

	it("switches to NORMAL on Escape", () => {
		const vm = make();
		const op = press(vm, "\x1b", "hello");
		expect(vm.mode).toBe("NORMAL");
		expect(op.op).toBe("setCursor");
	});

	it("clamps cursor to last char on Escape", () => {
		const vm = make();
		vm.cursor = 10; // simulated past end
		const op = press(vm, "\x1b", "hi") as { op: string; col: number };
		expect(op.col).toBe(1); // last valid col = length - 1 = 1
	});

	it("clamps cursor to 0 for empty string on Escape", () => {
		const vm = make();
		const op = press(vm, "\x1b", "") as { op: string; col: number };
		expect(op.col).toBe(0);
	});

	it("label is [N] in NORMAL mode", () => {
		const vm = make();
		press(vm, "\x1b", "x");
		expect(vm.label).toBe(" [N] ");
	});
});

// ── NORMAL mode: enter insert ─────────────────────────────────────────────────

describe("NORMAL mode: enter insert", () => {
	function inNormal(value = "hello"): VimMode {
		const vm = make();
		press(vm, "\x1b", value);
		return vm;
	}

	it("i enters INSERT mode", () => {
		const vm = inNormal();
		const op = press(vm, "i");
		expect(vm.mode).toBe("INSERT");
		expect(op.op).toBe("setMode");
	});

	it("a enters INSERT and advances cursor by 1", () => {
		const vm = inNormal("hello"); // cursor at 4 after Esc (length-1)
		vm.cursor = 2;
		press(vm, "a", "hello");
		expect(vm.mode).toBe("INSERT");
		expect(vm.cursor).toBe(3);
	});

	it("A enters INSERT and moves cursor to end", () => {
		const vm = inNormal("hello");
		press(vm, "A", "hello");
		expect(vm.mode).toBe("INSERT");
		expect(vm.cursor).toBe(5);
	});

	it("I enters INSERT and moves cursor to start", () => {
		const vm = inNormal("hello");
		press(vm, "I");
		expect(vm.mode).toBe("INSERT");
		expect(vm.cursor).toBe(0);
	});
});

// ── NORMAL mode: movement ─────────────────────────────────────────────────────

describe("NORMAL mode: movement", () => {
	function inNormal(value: string, cursor: number): VimMode {
		const vm = make();
		press(vm, "\x1b", value);
		vm.cursor = cursor;
		return vm;
	}

	it("h moves cursor left", () => {
		const vm = inNormal("hello", 3);
		press(vm, "h");
		expect(vm.cursor).toBe(2);
	});

	it("h does not go below 0", () => {
		const vm = inNormal("hi", 0);
		press(vm, "h");
		expect(vm.cursor).toBe(0);
	});

	it("l moves cursor right", () => {
		const vm = inNormal("hello", 2);
		press(vm, "l", "hello");
		expect(vm.cursor).toBe(3);
	});

	it("l does not go past last char", () => {
		const vm = inNormal("hi", 1);
		press(vm, "l");
		expect(vm.cursor).toBe(1);
	});

	it("0 moves to start", () => {
		const vm = inNormal("hello", 3);
		press(vm, "0");
		expect(vm.cursor).toBe(0);
	});

	it("$ moves to last char", () => {
		const vm = inNormal("hello", 0);
		press(vm, "$", "hello");
		expect(vm.cursor).toBe(4);
	});

	it("G moves to last char (like $)", () => {
		const vm = inNormal("hello", 0);
		press(vm, "G", "hello");
		expect(vm.cursor).toBe(4);
	});

	it("gg moves to first char", () => {
		const vm = inNormal("hello", 4);
		press(vm, "g"); // first g
		press(vm, "g"); // second g
		expect(vm.cursor).toBe(0);
	});

	it("w moves to next word", () => {
		const vm = inNormal("foo bar", 0);
		press(vm, "w", "foo bar");
		expect(vm.cursor).toBe(4); // "bar" starts at index 4
	});

	it("w at end stays at last char", () => {
		const vm = inNormal("foo", 2);
		press(vm, "w", "foo");
		expect(vm.cursor).toBe(2);
	});

	it("b moves to start of previous word", () => {
		const vm = inNormal("foo bar", 4);
		press(vm, "b");
		expect(vm.cursor).toBe(0);
	});
});

// ── NORMAL mode: delete ───────────────────────────────────────────────────────

describe("NORMAL mode: delete", () => {
	function inNormal(value: string, cursor: number): VimMode {
		const vm = make();
		press(vm, "\x1b", value);
		vm.cursor = cursor;
		return vm;
	}

	it("x deletes char at cursor", () => {
		const vm = inNormal("hello", 1);
		const op = press(vm, "x", "hello") as { op: string; text: string; cursor: number };
		expect(op.op).toBe("setText");
		expect(op.text).toBe("hllo");
		expect(op.cursor).toBe(1);
	});

	it("x on last char adjusts cursor", () => {
		const vm = inNormal("hi", 1);
		const op = press(vm, "x", "hi") as { op: string; text: string; cursor: number };
		expect(op.text).toBe("h");
		expect(op.cursor).toBe(0);
	});

	it("x on empty string is noop", () => {
		const vm = inNormal("", 0);
		const op = press(vm, "x", "");
		expect(op.op).toBe("noop");
	});

	it("dd clears the line", () => {
		const vm = inNormal("hello", 2);
		const op = press(vm, "d", "hello");
		expect(op.op).toBe("noop"); // waiting for second d
		const op2 = press(vm, "d", "hello") as { op: string; text: string; cursor: number };
		expect(op2.op).toBe("setText");
		expect(op2.text).toBe("");
		expect(op2.cursor).toBe(0);
	});

	it("dw deletes current word and following space", () => {
		const vm = inNormal("foo bar", 0);
		const op = press(vm, "d", "foo bar");
		expect(op.op).toBe("noop");
		const op2 = press(vm, "w", "foo bar") as { op: string; text: string };
		expect(op2.op).toBe("setText");
		expect(op2.text).toBe("bar");
	});
});

// ── NORMAL mode: submit ───────────────────────────────────────────────────────

describe("NORMAL mode: submit", () => {
	it("Enter in NORMAL mode produces submit op", () => {
		const vm = make();
		press(vm, "\x1b", "test");
		const op = press(vm, "\r");
		expect(op.op).toBe("submit");
	});
});

// ── sync and reset ────────────────────────────────────────────────────────────

describe("sync and reset", () => {
	it("sync updates cursor and clears pending", () => {
		const vm = make();
		vm.cursor = 0;
		vm.sync(5);
		expect(vm.cursor).toBe(5);
	});

	it("reset returns to INSERT mode with cursor 0", () => {
		const vm = make();
		press(vm, "\x1b", "hello");
		vm.reset();
		expect(vm.mode).toBe("INSERT");
		expect(vm.cursor).toBe(0);
	});

	it("reset clears pending multi-key sequence", () => {
		const vm = make();
		press(vm, "\x1b", "foo");
		press(vm, "d", "foo"); // set pending="d"
		vm.reset();
		// After reset, entering NORMAL and pressing "d" + "d" should work cleanly
		press(vm, "\x1b", "abc");
		press(vm, "d", "abc");
		const op = press(vm, "d", "abc") as { op: string; text: string };
		expect(op.op).toBe("setText");
		expect(op.text).toBe("");
	});
});

// ── Escape in NORMAL mode ─────────────────────────────────────────────────────

describe("Escape in NORMAL mode", () => {
	it("Escape in NORMAL mode is noop (stays NORMAL)", () => {
		const vm = make();
		press(vm, "\x1b", "hi");
		const op = press(vm, "\x1b", "hi");
		expect(op.op).toBe("noop");
		expect(vm.mode).toBe("NORMAL");
	});
});
