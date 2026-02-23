import { isFullwidth, measureText, segmentGraphemes, truncate, wrapText } from "@takumi/render";
import { describe, expect, it } from "vitest";

describe("measureText", () => {
	it("measures plain ASCII", () => {
		expect(measureText("hello")).toBe(5);
		expect(measureText("")).toBe(0);
	});

	it("measures CJK as double width", () => {
		expect(measureText("漢字")).toBe(4);
	});

	it("strips ANSI escapes", () => {
		expect(measureText("\x1b[1mbold\x1b[0m")).toBe(4);
	});
});

describe("segmentGraphemes", () => {
	it("segments ASCII normally", () => {
		expect(segmentGraphemes("abc")).toEqual(["a", "b", "c"]);
	});

	it("handles emoji", () => {
		const result = segmentGraphemes("a😀b");
		expect(result.length).toBeGreaterThanOrEqual(3);
		expect(result[0]).toBe("a");
	});

	it("handles empty string", () => {
		expect(segmentGraphemes("")).toEqual([]);
	});
});

describe("isFullwidth", () => {
	it("identifies CJK characters", () => {
		expect(isFullwidth("漢")).toBe(true);
		expect(isFullwidth("あ")).toBe(true);
		expect(isFullwidth("ア")).toBe(true);
	});

	it("identifies non-fullwidth characters", () => {
		expect(isFullwidth("a")).toBe(false);
		expect(isFullwidth("1")).toBe(false);
		expect(isFullwidth(" ")).toBe(false);
	});
});

describe("wrapText", () => {
	it("does not wrap short lines", () => {
		expect(wrapText("hello", 80)).toEqual(["hello"]);
	});

	it("wraps at word boundaries", () => {
		const result = wrapText("hello world foo bar", 10);
		expect(result[0]).toBe("hello");
		expect(result.length).toBeGreaterThan(1);
	});

	it("preserves existing newlines", () => {
		const result = wrapText("line1\nline2", 80);
		expect(result).toEqual(["line1", "line2"]);
	});

	it("breaks very long words character by character", () => {
		const result = wrapText("abcdefghij", 5);
		expect(result.length).toBe(2);
		expect(result[0]).toBe("abcde");
		expect(result[1]).toBe("fghij");
	});

	it("returns empty array for zero width", () => {
		expect(wrapText("hello", 0)).toEqual([]);
	});
});

describe("truncate", () => {
	it("returns text unchanged if it fits", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("truncates and adds ellipsis", () => {
		const result = truncate("hello world", 8);
		expect(measureText(result)).toBeLessThanOrEqual(8);
		expect(result).toContain("\u2026");
	});

	it("handles very small maxWidth", () => {
		expect(truncate("hello", 1)).toBe("\u2026");
	});

	it("returns empty for zero width", () => {
		expect(truncate("hello", 0)).toBe("");
	});

	it("supports custom ellipsis", () => {
		const result = truncate("hello world", 9, "...");
		expect(result.endsWith("...")).toBe(true);
		expect(measureText(result)).toBeLessThanOrEqual(9);
	});
});
