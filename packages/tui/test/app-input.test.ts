import { KEY_CODES } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { parseKeyEvent } from "../src/input/app-input.js";

describe("parseKeyEvent", () => {
	it("treats Enter as return (not Ctrl+M)", () => {
		const event = parseKeyEvent(KEY_CODES.ENTER);
		expect(event.key).toBe("return");
		expect(event.ctrl).toBe(false);
		expect(event.alt).toBe(false);
		expect(event.raw).toBe(KEY_CODES.ENTER);
	});

	it("treats Tab as tab (not Ctrl+I)", () => {
		const event = parseKeyEvent(KEY_CODES.TAB);
		expect(event.key).toBe("tab");
		expect(event.ctrl).toBe(false);
		expect(event.alt).toBe(false);
		expect(event.raw).toBe(KEY_CODES.TAB);
	});

	it("still parses control letters as ctrl shortcuts", () => {
		const event = parseKeyEvent(KEY_CODES.CTRL_K);
		expect(event.key).toBe("k");
		expect(event.ctrl).toBe(true);
		expect(event.alt).toBe(false);
	});
});
