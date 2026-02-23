import { describe, expect, it } from "vitest";
import { parseMouseEvent } from "../src/app.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Build an SGR mouse escape sequence. */
function sgr(code: number, x: number, y: number, release = false): string {
	return `\x1b[<${code};${x};${y}${release ? "m" : "M"}`;
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("parseMouseEvent", () => {
	/* ---- Click events ---------------------------------------------------- */

	describe("click events", () => {
		it("parses left click (button 0)", () => {
			const event = parseMouseEvent(sgr(0, 10, 5));
			expect(event).toEqual({
				type: "mousedown",
				x: 9,
				y: 4,
				button: 0,
				shift: false,
				alt: false,
				ctrl: false,
				wheelDelta: 0,
			});
		});

		it("parses middle click (button 1)", () => {
			const event = parseMouseEvent(sgr(1, 20, 10));
			expect(event).toEqual({
				type: "mousedown",
				x: 19,
				y: 9,
				button: 1,
				shift: false,
				alt: false,
				ctrl: false,
				wheelDelta: 0,
			});
		});

		it("parses right click (button 2)", () => {
			const event = parseMouseEvent(sgr(2, 15, 8));
			expect(event).toEqual({
				type: "mousedown",
				x: 14,
				y: 7,
				button: 2,
				shift: false,
				alt: false,
				ctrl: false,
				wheelDelta: 0,
			});
		});
	});

	/* ---- Release events -------------------------------------------------- */

	describe("release events", () => {
		it("parses left button release", () => {
			const event = parseMouseEvent(sgr(0, 10, 5, true));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("mouseup");
			expect(event!.button).toBe(0);
		});

		it("parses right button release", () => {
			const event = parseMouseEvent(sgr(2, 15, 8, true));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("mouseup");
			expect(event!.button).toBe(2);
		});
	});

	/* ---- Wheel events ---------------------------------------------------- */

	describe("wheel events", () => {
		it("parses wheel up (code 64)", () => {
			const event = parseMouseEvent(sgr(64, 10, 5));
			expect(event).toEqual({
				type: "wheel",
				x: 9,
				y: 4,
				button: 0,
				shift: false,
				alt: false,
				ctrl: false,
				wheelDelta: 1,
			});
		});

		it("parses wheel down (code 65)", () => {
			const event = parseMouseEvent(sgr(65, 10, 5));
			expect(event).toEqual({
				type: "wheel",
				x: 9,
				y: 4,
				button: 0,
				shift: false,
				alt: false,
				ctrl: false,
				wheelDelta: -1,
			});
		});
	});

	/* ---- Mouse move events ----------------------------------------------- */

	describe("mouse move events", () => {
		it("parses mouse move with left button held (code 32)", () => {
			const event = parseMouseEvent(sgr(32, 20, 15));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("mousemove");
			expect(event!.button).toBe(0);
			expect(event!.x).toBe(19);
			expect(event!.y).toBe(14);
			expect(event!.wheelDelta).toBe(0);
		});

		it("parses mouse move with middle button held (code 33)", () => {
			const event = parseMouseEvent(sgr(33, 5, 3));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("mousemove");
			expect(event!.button).toBe(1);
		});

		it("parses mouse move with right button held (code 34)", () => {
			const event = parseMouseEvent(sgr(34, 5, 3));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("mousemove");
			expect(event!.button).toBe(2);
		});
	});

	/* ---- Modifier keys --------------------------------------------------- */

	describe("modifier keys", () => {
		it("parses shift modifier (+4)", () => {
			const event = parseMouseEvent(sgr(4, 10, 5));
			expect(event).not.toBeNull();
			expect(event!.shift).toBe(true);
			expect(event!.alt).toBe(false);
			expect(event!.ctrl).toBe(false);
		});

		it("parses alt modifier (+8)", () => {
			const event = parseMouseEvent(sgr(8, 10, 5));
			expect(event).not.toBeNull();
			expect(event!.shift).toBe(false);
			expect(event!.alt).toBe(true);
			expect(event!.ctrl).toBe(false);
		});

		it("parses ctrl modifier (+16)", () => {
			const event = parseMouseEvent(sgr(16, 10, 5));
			expect(event).not.toBeNull();
			expect(event!.shift).toBe(false);
			expect(event!.alt).toBe(false);
			expect(event!.ctrl).toBe(true);
		});

		it("parses combined shift+alt+ctrl modifiers (+4+8+16=28)", () => {
			const event = parseMouseEvent(sgr(28, 10, 5));
			expect(event).not.toBeNull();
			expect(event!.shift).toBe(true);
			expect(event!.alt).toBe(true);
			expect(event!.ctrl).toBe(true);
			expect(event!.button).toBe(0);
		});

		it("parses shift+wheel up (code 64+4=68)", () => {
			const event = parseMouseEvent(sgr(68, 10, 5));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("wheel");
			expect(event!.shift).toBe(true);
			expect(event!.wheelDelta).toBe(1);
		});

		it("parses ctrl+left click (code 0+16=16)", () => {
			const event = parseMouseEvent(sgr(16, 10, 5));
			expect(event).not.toBeNull();
			expect(event!.type).toBe("mousedown");
			expect(event!.ctrl).toBe(true);
			expect(event!.button).toBe(0);
		});
	});

	/* ---- Coordinate conversion ------------------------------------------- */

	describe("coordinate conversion (1-based to 0-based)", () => {
		it("converts column 1 to x=0", () => {
			const event = parseMouseEvent(sgr(0, 1, 5));
			expect(event).not.toBeNull();
			expect(event!.x).toBe(0);
		});

		it("converts row 1 to y=0", () => {
			const event = parseMouseEvent(sgr(0, 5, 1));
			expect(event).not.toBeNull();
			expect(event!.y).toBe(0);
		});

		it("converts column 1, row 1 (top-left corner) to (0, 0)", () => {
			const event = parseMouseEvent(sgr(0, 1, 1));
			expect(event).not.toBeNull();
			expect(event!.x).toBe(0);
			expect(event!.y).toBe(0);
		});

		it("handles large coordinates", () => {
			const event = parseMouseEvent(sgr(0, 200, 50));
			expect(event).not.toBeNull();
			expect(event!.x).toBe(199);
			expect(event!.y).toBe(49);
		});
	});

	/* ---- Non-mouse input ------------------------------------------------- */

	describe("non-mouse input", () => {
		it("returns null for regular characters", () => {
			expect(parseMouseEvent("a")).toBeNull();
		});

		it("returns null for arrow key escape sequences", () => {
			expect(parseMouseEvent("\x1b[A")).toBeNull();
		});

		it("returns null for control characters", () => {
			expect(parseMouseEvent("\x03")).toBeNull();
		});

		it("returns null for empty string", () => {
			expect(parseMouseEvent("")).toBeNull();
		});

		it("returns null for partial SGR sequence", () => {
			expect(parseMouseEvent("\x1b[<0;10")).toBeNull();
		});

		it("returns null for function key sequences", () => {
			expect(parseMouseEvent("\x1bOP")).toBeNull();
		});
	});
});
