/**
 * Tests for ToolResultCache (Phase 40)
 */

import type { ToolResult } from "@takumi/core";
import { beforeEach, describe, expect, it } from "vitest";
import { ToolResultCache } from "../src/tools/tool-cache.js";

function okResult(output: string): ToolResult {
	return { output, isError: false };
}

function errResult(output: string): ToolResult {
	return { output, isError: true };
}

describe("ToolResultCache", () => {
	let cache: ToolResultCache;

	beforeEach(() => {
		cache = new ToolResultCache({ maxEntries: 5 });
	});

	describe("get() / set()", () => {
		it("misses on first access", () => {
			const result = cache.get("read_file", { path: "/foo.ts" });
			expect(result).toBeNull();
		});

		it("hits after set", () => {
			cache.set("read_file", { path: "/foo.ts" }, okResult("file contents"));
			const result = cache.get("read_file", { path: "/foo.ts" });
			expect(result).not.toBeNull();
			expect(result?.output).toBe("file contents");
		});

		it("returns null for non-cacheable tools", () => {
			cache.set("bash", { command: "rm -rf /" }, okResult("deleted"));
			expect(cache.get("bash", { command: "rm -rf /" })).toBeNull();
		});

		it("does not cache error results", () => {
			cache.set("read_file", { path: "/missing.ts" }, errResult("ENOENT"));
			expect(cache.get("read_file", { path: "/missing.ts" })).toBeNull();
		});

		it("distinguishes different inputs for same tool", () => {
			cache.set("read_file", { path: "/a.ts" }, okResult("aaa"));
			cache.set("read_file", { path: "/b.ts" }, okResult("bbb"));
			expect(cache.get("read_file", { path: "/a.ts" })?.output).toBe("aaa");
			expect(cache.get("read_file", { path: "/b.ts" })?.output).toBe("bbb");
		});

		it("is deterministic regardless of key order in input", () => {
			cache.set("grep", { pattern: "foo", path: "/src" }, okResult("match"));
			// Same keys, different insertion order
			const result = cache.get("grep", { path: "/src", pattern: "foo" });
			expect(result?.output).toBe("match");
		});
	});

	describe("LRU eviction", () => {
		it("evicts oldest entries when maxEntries exceeded", () => {
			for (let i = 0; i < 7; i++) {
				cache.set("read_file", { path: `/file${i}.ts` }, okResult(`content-${i}`));
			}
			// Only 5 should remain
			const stats = cache.getStats();
			expect(stats.entries).toBe(5);
			expect(stats.evictions).toBe(2);
		});
	});

	describe("TTL", () => {
		it("expires entries after TTL", async () => {
			const ttlCache = new ToolResultCache({ ttlMs: 50 });
			ttlCache.set("read_file", { path: "/foo.ts" }, okResult("data"));
			expect(ttlCache.get("read_file", { path: "/foo.ts" })).not.toBeNull();

			// Wait for TTL to expire
			await new Promise((r) => setTimeout(r, 80));
			expect(ttlCache.get("read_file", { path: "/foo.ts" })).toBeNull();
		});
	});

	describe("invalidation", () => {
		it("invalidateForPath clears matching entries", () => {
			cache.set("read_file", { path: "/src/foo.ts" }, okResult("foo content"));
			cache.set("read_file", { path: "/src/bar.ts" }, okResult("bar content"));
			const removed = cache.invalidateForPath("/src/foo.ts");
			expect(removed).toBeGreaterThanOrEqual(1);
		});

		it("invalidateTool clears all entries", () => {
			cache.set("read_file", { path: "/a.ts" }, okResult("a"));
			cache.set("grep", { pattern: "x" }, okResult("x"));
			cache.invalidateTool("read_file");
			expect(cache.getStats().entries).toBe(0);
		});

		it("clear() removes everything", () => {
			cache.set("read_file", { path: "/a.ts" }, okResult("a"));
			cache.clear();
			expect(cache.getStats().entries).toBe(0);
		});
	});

	describe("isCacheable()", () => {
		it("returns true for known read-only tools", () => {
			expect(cache.isCacheable("read_file")).toBe(true);
			expect(cache.isCacheable("glob")).toBe(true);
			expect(cache.isCacheable("grep")).toBe(true);
		});

		it("returns false for write tools", () => {
			expect(cache.isCacheable("bash")).toBe(false);
			expect(cache.isCacheable("write_file")).toBe(false);
		});
	});

	describe("getStats()", () => {
		it("tracks hits and misses", () => {
			cache.set("read_file", { path: "/f.ts" }, okResult("x"));
			cache.get("read_file", { path: "/f.ts" }); // hit
			cache.get("read_file", { path: "/missing.ts" }); // miss

			const stats = cache.getStats();
			expect(stats.hits).toBe(1);
			expect(stats.misses).toBe(1);
			expect(stats.hitRate).toBe(0.5);
		});

		it("hitRate is 0 with no lookups", () => {
			const stats = cache.getStats();
			expect(stats.hitRate).toBe(0);
		});
	});

	describe("custom cacheable tools", () => {
		it("respects custom cacheableTools set", () => {
			const custom = new ToolResultCache({
				cacheableTools: new Set(["my_tool"]),
			});
			custom.set("my_tool", { x: 1 }, okResult("ok"));
			expect(custom.get("my_tool", { x: 1 })?.output).toBe("ok");
			// Default tools should not be cacheable
			expect(custom.isCacheable("read_file")).toBe(false);
		});
	});
});
