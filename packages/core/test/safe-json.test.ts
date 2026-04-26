/**
 * Tests for safe-json — size guards and prototype pollution defense.
 *
 * I verify the size ceiling works, the silent variant returns null,
 * and that __proto__ / constructor.prototype keys don't leak through
 * to pollute downstream objects.
 */

import {
	JSON_MAX_CHECKPOINT,
	JSON_MAX_DAEMON,
	JSON_MAX_FILE,
	JSON_MAX_SSE_CHUNK,
	safeJsonParse,
	safeJsonParseOrNull,
} from "@takumi/core";
import { describe, expect, it } from "vitest";

describe("safeJsonParse", () => {
	// ── Basic functionality ───────────────────────────────────

	it("parses valid JSON and returns the typed result", () => {
		const result = safeJsonParse<{ name: string }>('{"name":"takumi"}');
		expect(result).toEqual({ name: "takumi" });
	});

	it("parses arrays", () => {
		const result = safeJsonParse<number[]>("[1,2,3]");
		expect(result).toEqual([1, 2, 3]);
	});

	it("parses primitives", () => {
		expect(safeJsonParse<number>("42")).toBe(42);
		expect(safeJsonParse<string>('"hello"')).toBe("hello");
		expect(safeJsonParse<boolean>("true")).toBe(true);
		expect(safeJsonParse<null>("null")).toBe(null);
	});

	// ── Size guard ────────────────────────────────────────────

	it("throws RangeError when payload exceeds the default limit", () => {
		const huge = `{"data":"${"x".repeat(JSON_MAX_FILE)}"}`;
		expect(() => safeJsonParse(huge)).toThrow(RangeError);
		expect(() => safeJsonParse(huge)).toThrow(/too large/);
	});

	it("throws RangeError when payload exceeds a custom limit", () => {
		const payload = '{"a":1}';
		expect(() => safeJsonParse(payload, 3)).toThrow(RangeError);
	});

	it("accepts payload exactly at the limit", () => {
		const payload = '{"a":1}';
		// length is 7
		expect(() => safeJsonParse(payload, 7)).not.toThrow();
	});

	it("rejects payload one byte over the limit", () => {
		const payload = '{"a":1}';
		expect(() => safeJsonParse(payload, 6)).toThrow(RangeError);
	});

	it("throws SyntaxError for invalid JSON", () => {
		expect(() => safeJsonParse("{invalid}")).toThrow(SyntaxError);
	});

	it("throws SyntaxError for empty string", () => {
		expect(() => safeJsonParse("")).toThrow();
	});

	// ── Size constants are sane ───────────────────────────────

	it("exports size constants in ascending order", () => {
		expect(JSON_MAX_SSE_CHUNK).toBeLessThan(JSON_MAX_FILE);
		expect(JSON_MAX_FILE).toBeLessThan(JSON_MAX_DAEMON);
		expect(JSON_MAX_DAEMON).toBeLessThan(JSON_MAX_CHECKPOINT);
	});

	// ── Bug #5: Prototype pollution via __proto__ ─────────────

	describe("prototype pollution defense (Bug #5)", () => {
		it("does not allow __proto__ key to pollute Object.prototype", () => {
			const malicious = '{"__proto__": {"polluted": true}}';
			const _result = safeJsonParse<Record<string, unknown>>(malicious);

			// The parsed object should NOT have polluted the global prototype
			const fresh: Record<string, unknown> = {};
			expect(fresh).not.toHaveProperty("polluted");
			expect(Object.prototype).not.toHaveProperty("polluted");
		});

		it("strips __proto__ key via safe reviver (Bug #5 fix)", () => {
			const malicious = '{"__proto__": {"polluted": true}}';
			const result = safeJsonParse<Record<string, unknown>>(malicious);

			// After fix: the reviver strips __proto__, constructor, and prototype keys.
			const hasProto = Object.hasOwn(result, "__proto__");
			expect(hasProto).toBe(false);
		});

		it("nested __proto__ does not pollute prototypes", () => {
			const nested = '{"a": {"__proto__": {"injected": true}}}';
			const _result = safeJsonParse<{ a: Record<string, unknown> }>(nested);

			const fresh: Record<string, unknown> = {};
			expect(fresh).not.toHaveProperty("injected");
		});

		it("constructor.prototype pollution via JSON does not reach Object.prototype", () => {
			const malicious = '{"constructor": {"prototype": {"pwned": true}}}';
			const _result = safeJsonParse<Record<string, unknown>>(malicious);

			const fresh: Record<string, unknown> = {};
			expect(fresh).not.toHaveProperty("pwned");
		});
	});
});

describe("safeJsonParseOrNull", () => {
	it("returns parsed result for valid JSON", () => {
		const result = safeJsonParseOrNull<{ ok: boolean }>('{"ok":true}');
		expect(result).toEqual({ ok: true });
	});

	it("returns null for invalid JSON (no throw)", () => {
		const result = safeJsonParseOrNull("{bad}");
		expect(result).toBeNull();
	});

	it("returns null when payload exceeds size limit (no throw)", () => {
		const huge = "x".repeat(JSON_MAX_FILE + 1);
		const result = safeJsonParseOrNull(huge);
		expect(result).toBeNull();
	});

	it("returns null for empty string", () => {
		const result = safeJsonParseOrNull("");
		expect(result).toBeNull();
	});

	it("respects custom size limit", () => {
		const result = safeJsonParseOrNull('{"a":1}', 3);
		expect(result).toBeNull();
	});
});
