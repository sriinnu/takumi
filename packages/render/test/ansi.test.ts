import {
	bg,
	bgRgb,
	bold,
	clearLine,
	clearScreen,
	cursorHide,
	cursorMove,
	cursorShow,
	cursorTo,
	dim,
	fg,
	fgRgb,
	italic,
	reset,
	underline,
	visibleLength,
} from "@takumi/render";
import { describe, expect, it } from "vitest";

describe("cursor movement", () => {
	it("cursorTo generates correct CSI sequence", () => {
		expect(cursorTo(1, 1)).toBe("\x1b[1;1H");
		expect(cursorTo(10, 20)).toBe("\x1b[10;20H");
	});

	it("cursorMove generates relative movement", () => {
		expect(cursorMove(3, 0)).toBe("\x1b[3B");
		expect(cursorMove(-2, 0)).toBe("\x1b[2A");
		expect(cursorMove(0, 5)).toBe("\x1b[5C");
		expect(cursorMove(0, -3)).toBe("\x1b[3D");
		expect(cursorMove(1, 2)).toBe("\x1b[1B\x1b[2C");
	});

	it("cursorShow/Hide produce correct sequences", () => {
		expect(cursorShow()).toBe("\x1b[?25h");
		expect(cursorHide()).toBe("\x1b[?25l");
	});
});

describe("screen operations", () => {
	it("clearScreen produces CSI 2J", () => {
		expect(clearScreen()).toBe("\x1b[2J");
	});

	it("clearLine produces CSI 2K", () => {
		expect(clearLine()).toBe("\x1b[2K");
	});
});

describe("colors", () => {
	it("fg produces 256-color foreground", () => {
		expect(fg(1)).toBe("\x1b[38;5;1m");
		expect(fg(255)).toBe("\x1b[38;5;255m");
	});

	it("bg produces 256-color background", () => {
		expect(bg(0)).toBe("\x1b[48;5;0m");
	});

	it("rejects out-of-range colors", () => {
		expect(fg(-1)).toBe("");
		expect(fg(256)).toBe("");
		expect(bg(-1)).toBe("");
	});

	it("fgRgb/bgRgb produce truecolor sequences", () => {
		expect(fgRgb(255, 128, 0)).toBe("\x1b[38;2;255;128;0m");
		expect(bgRgb(0, 0, 0)).toBe("\x1b[48;2;0;0;0m");
	});
});

describe("text styles", () => {
	it("bold wraps text with SGR 1/22", () => {
		expect(bold("hi")).toBe("\x1b[1mhi\x1b[22m");
	});

	it("dim wraps text with SGR 2/22", () => {
		expect(dim("hi")).toBe("\x1b[2mhi\x1b[22m");
	});

	it("italic wraps text with SGR 3/23", () => {
		expect(italic("hi")).toBe("\x1b[3mhi\x1b[23m");
	});

	it("underline wraps text with SGR 4/24", () => {
		expect(underline("hi")).toBe("\x1b[4mhi\x1b[24m");
	});

	it("reset produces SGR 0", () => {
		expect(reset()).toBe("\x1b[0m");
	});
});

describe("visibleLength", () => {
	it("returns length of plain ASCII", () => {
		expect(visibleLength("hello")).toBe(5);
		expect(visibleLength("")).toBe(0);
	});

	it("strips ANSI escapes", () => {
		expect(visibleLength("\x1b[1mhello\x1b[0m")).toBe(5);
		expect(visibleLength("\x1b[38;5;196mred\x1b[0m")).toBe(3);
	});

	it("counts CJK characters as width 2", () => {
		expect(visibleLength("漢字")).toBe(4);
		expect(visibleLength("aあb")).toBe(4); // 1 + 2 + 1
	});

	it("handles mixed ANSI + CJK", () => {
		expect(visibleLength("\x1b[1m漢字\x1b[0m")).toBe(4);
	});
});
