/**
 * Tests for OSC 52 clipboard integration.
 */

import { describe, it, expect } from "vitest";
import {
	copyToClipboard,
	requestClipboard,
	parseClipboardResponse,
	clearClipboard,
} from "../src/clipboard.js";

// ─── copyToClipboard ──────────────────────────────────────────────────────────

describe("copyToClipboard", () => {
	it("returns a valid OSC 52 escape sequence", () => {
		const result = copyToClipboard("hello");
		expect(result).toMatch(/^\x1b\]52;c;[A-Za-z0-9+/=]+\x07$/);
	});

	it("base64-encodes the text content", () => {
		const result = copyToClipboard("hello");
		const encoded = Buffer.from("hello", "utf-8").toString("base64");
		expect(result).toContain(encoded);
	});

	it("starts with OSC 52 prefix", () => {
		const result = copyToClipboard("test");
		expect(result.startsWith("\x1b]52;c;")).toBe(true);
	});

	it("ends with BEL character", () => {
		const result = copyToClipboard("test");
		expect(result.endsWith("\x07")).toBe(true);
	});

	it("handles empty string", () => {
		const result = copyToClipboard("");
		expect(result).toMatch(/^\x1b\]52;c;[A-Za-z0-9+/=]*\x07$/);
		// Empty string still gets base64 encoded
		const decoded = parseClipboardResponse(result);
		expect(decoded).toBe("");
	});

	it("handles unicode text", () => {
		const result = copyToClipboard("Hello, World! \u2603");
		expect(result).toMatch(/^\x1b\]52;c;[A-Za-z0-9+/=]+\x07$/);
	});

	it("handles multi-line text", () => {
		const result = copyToClipboard("line1\nline2\nline3");
		const decoded = parseClipboardResponse(result);
		expect(decoded).toBe("line1\nline2\nline3");
	});

	it("supports primary selection target", () => {
		const result = copyToClipboard("test", "p");
		expect(result).toMatch(/^\x1b\]52;p;[A-Za-z0-9+/=]+\x07$/);
	});

	it("defaults to clipboard target", () => {
		const result = copyToClipboard("test");
		expect(result).toContain(";c;");
	});

	it("roundtrips text through encode/decode", () => {
		const original = "Complex text with special chars: <>&\"'\\n\\t";
		const encoded = copyToClipboard(original);
		const decoded = parseClipboardResponse(encoded);
		expect(decoded).toBe(original);
	});
});

// ─── requestClipboard ─────────────────────────────────────────────────────────

describe("requestClipboard", () => {
	it("returns a valid OSC 52 request escape", () => {
		const result = requestClipboard();
		expect(result).toBe("\x1b]52;c;?\x07");
	});

	it("contains the ? query marker", () => {
		const result = requestClipboard();
		expect(result).toContain(";?");
	});

	it("supports primary selection target", () => {
		const result = requestClipboard("p");
		expect(result).toBe("\x1b]52;p;?\x07");
	});

	it("ends with BEL character", () => {
		const result = requestClipboard();
		expect(result.endsWith("\x07")).toBe(true);
	});

	it("starts with OSC escape", () => {
		const result = requestClipboard();
		expect(result.startsWith("\x1b]")).toBe(true);
	});
});

// ─── parseClipboardResponse ───────────────────────────────────────────────────

describe("parseClipboardResponse", () => {
	it("extracts text from a valid BEL-terminated response", () => {
		const encoded = Buffer.from("hello world", "utf-8").toString("base64");
		const response = `\x1b]52;c;${encoded}\x07`;
		const result = parseClipboardResponse(response);
		expect(result).toBe("hello world");
	});

	it("extracts text from a valid ST-terminated response", () => {
		const encoded = Buffer.from("hello", "utf-8").toString("base64");
		const response = `\x1b]52;c;${encoded}\x1b\\`;
		const result = parseClipboardResponse(response);
		expect(result).toBe("hello");
	});

	it("returns null for invalid input", () => {
		expect(parseClipboardResponse("not an osc response")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseClipboardResponse("")).toBeNull();
	});

	it("returns null for malformed OSC sequence", () => {
		expect(parseClipboardResponse("\x1b]52;c;!!!\x07")).toBeNull();
	});

	it("parses response from primary selection", () => {
		const encoded = Buffer.from("primary", "utf-8").toString("base64");
		const response = `\x1b]52;p;${encoded}\x07`;
		const result = parseClipboardResponse(response);
		expect(result).toBe("primary");
	});

	it("handles unicode content", () => {
		const original = "Hello \ud83c\udf0d \u2603";
		const encoded = Buffer.from(original, "utf-8").toString("base64");
		const response = `\x1b]52;c;${encoded}\x07`;
		const result = parseClipboardResponse(response);
		expect(result).toBe(original);
	});

	it("handles multi-line content", () => {
		const original = "line1\nline2\nline3";
		const encoded = Buffer.from(original, "utf-8").toString("base64");
		const response = `\x1b]52;c;${encoded}\x07`;
		const result = parseClipboardResponse(response);
		expect(result).toBe(original);
	});

	it("handles response with surrounding data", () => {
		const encoded = Buffer.from("data", "utf-8").toString("base64");
		// Some terminals may prepend/append other escape sequences
		const response = `other stuff\x1b]52;c;${encoded}\x07more stuff`;
		const result = parseClipboardResponse(response);
		expect(result).toBe("data");
	});
});

// ─── clearClipboard ───────────────────────────────────────────────────────────

describe("clearClipboard", () => {
	it("returns OSC 52 sequence with empty content", () => {
		const result = clearClipboard();
		expect(result).toBe("\x1b]52;c;\x07");
	});

	it("supports primary selection target", () => {
		const result = clearClipboard("p");
		expect(result).toBe("\x1b]52;p;\x07");
	});

	it("starts with OSC prefix", () => {
		const result = clearClipboard();
		expect(result.startsWith("\x1b]52;")).toBe(true);
	});

	it("ends with BEL", () => {
		const result = clearClipboard();
		expect(result.endsWith("\x07")).toBe(true);
	});
});
