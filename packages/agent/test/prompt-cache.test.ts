/**
 * Tests for Prompt Cache Layer (Phase 34).
 */

import { describe, expect, it } from "vitest";
import { PromptCache } from "../src/context/prompt-cache.js";

function makeCache(overrides: Record<string, unknown> = {}): PromptCache {
	return new PromptCache({ persistToDisk: false, ...overrides });
}

describe("PromptCache", () => {
	it("returns null on cache miss", () => {
		const cache = makeCache();
		expect(cache.get("nonexistent")).toBeNull();
	});

	it("stores and retrieves a cached response", () => {
		const cache = makeCache();
		const key = cache.computeKey("gpt-4o", "You are helpful.", ["Hello"]);
		cache.set(key, "Hi there!", "gpt-4o", 50);
		expect(cache.get(key)).toBe("Hi there!");
	});

	it("computes deterministic keys for same input", () => {
		const cache = makeCache();
		const key1 = cache.computeKey("gpt-4o", "system", ["msg1", "msg2"]);
		const key2 = cache.computeKey("gpt-4o", "system", ["msg1", "msg2"]);
		expect(key1).toBe(key2);
	});

	it("computes different keys for different inputs", () => {
		const cache = makeCache();
		const key1 = cache.computeKey("gpt-4o", "system a", ["msg1"]);
		const key2 = cache.computeKey("gpt-4o", "system b", ["msg1"]);
		expect(key1).not.toBe(key2);
	});

	it("normalizes whitespace for near-duplicate detection", () => {
		const cache = makeCache();
		const key1 = cache.computeKey("gpt-4o", "You   are   helpful.", ["Hello  world"]);
		const key2 = cache.computeKey("gpt-4o", "You are helpful.", ["Hello world"]);
		expect(key1).toBe(key2);
	});

	it("evicts oldest entry when at capacity", () => {
		const cache = makeCache({ maxMemoryEntries: 2 });
		const k1 = cache.computeKey("m", "s", ["a"]);
		const k2 = cache.computeKey("m", "s", ["b"]);
		const k3 = cache.computeKey("m", "s", ["c"]);

		cache.set(k1, "resp-a", "m", 10);
		cache.set(k2, "resp-b", "m", 10);
		cache.set(k3, "resp-c", "m", 10);

		// k1 should have been evicted (oldest)
		expect(cache.get(k1)).toBeNull();
		expect(cache.get(k2)).toBe("resp-b");
		expect(cache.get(k3)).toBe("resp-c");
	});

	it("respects TTL — expired entries return null", () => {
		const cache = new PromptCache({ persistToDisk: false, ttlMs: 1 });
		const key = cache.computeKey("m", "s", ["msg"]);
		cache.set(key, "response", "m", 10);

		// Wait just enough for TTL to expire
		const start = Date.now();
		while (Date.now() - start < 5) {
			/* spin */
		}

		expect(cache.get(key)).toBeNull();
	});

	it("tracks hit/miss stats correctly", () => {
		const cache = makeCache();
		const key = cache.computeKey("m", "s", ["msg"]);

		cache.get("nonexistent"); // miss
		cache.set(key, "response", "m", 50);
		cache.get(key); // hit
		cache.get(key); // hit
		cache.get("another-miss"); // miss

		const stats = cache.getStats();
		expect(stats.hits).toBe(2);
		expect(stats.misses).toBe(2);
	});

	it("invalidate removes a specific entry", () => {
		const cache = makeCache();
		const key = cache.computeKey("m", "s", ["msg"]);
		cache.set(key, "response", "m", 10);
		expect(cache.get(key)).toBe("response");

		cache.invalidate(key);
		expect(cache.get(key)).toBeNull();
	});

	it("clear removes all entries", () => {
		const cache = makeCache();
		cache.set(cache.computeKey("m", "s", ["a"]), "r1", "m", 10);
		cache.set(cache.computeKey("m", "s", ["b"]), "r2", "m", 10);
		cache.clear();

		const stats = cache.getStats();
		expect(stats.memoryEntries).toBe(0);
	});

	it("hitRate returns 0 when no lookups", () => {
		const cache = makeCache();
		expect(cache.hitRate).toBe(0);
	});

	it("hitRate calculates correct percentage", () => {
		const cache = makeCache();
		const key = cache.computeKey("m", "s", ["msg"]);
		cache.set(key, "resp", "m", 10);

		cache.get(key); // hit
		cache.get(key); // hit
		cache.get("miss"); // miss

		expect(cache.hitRate).toBe(67); // 2/3 ≈ 67%
	});

	it("tracks eviction count", () => {
		const cache = makeCache({ maxMemoryEntries: 1 });
		cache.set(cache.computeKey("m", "s", ["a"]), "r1", "m", 10);
		cache.set(cache.computeKey("m", "s", ["b"]), "r2", "m", 10);
		cache.set(cache.computeKey("m", "s", ["c"]), "r3", "m", 10);

		const stats = cache.getStats();
		expect(stats.evictions).toBe(2);
	});

	it("tracks tokensSaved on cache hits", () => {
		const cache = makeCache();
		const key = cache.computeKey("m", "s", ["msg"]);
		cache.set(key, "response", "m", 500);

		cache.get(key); // hit — saves 500 tokens
		cache.get(key); // hit — saves 500 more

		const stats = cache.getStats();
		expect(stats.tokensSaved).toBe(1000);
	});
});
