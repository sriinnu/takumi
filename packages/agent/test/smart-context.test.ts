/**
 * Tests for Smart Context Window (Phase 30).
 */

import { describe, expect, it } from "vitest";
import { type ContextItem, SmartContextWindow } from "../src/context/smart-context.js";

function makeItem(overrides: Partial<ContextItem> & { id: string; content: string }): ContextItem {
	return {
		kind: "file",
		lastTouched: Date.now(),
		referenceCount: 1,
		...overrides,
	};
}

describe("SmartContextWindow", () => {
	it("upserts and retrieves items", () => {
		const win = new SmartContextWindow({ maxTokens: 10000 });
		win.upsert(makeItem({ id: "a.ts", content: "const a = 1;" }));
		win.upsert(makeItem({ id: "b.ts", content: "const b = 2;" }));

		expect(win.size).toBe(2);
		expect(win.getAll().map((i) => i.id)).toEqual(["a.ts", "b.ts"]);
	});

	it("removes items", () => {
		const win = new SmartContextWindow({ maxTokens: 10000 });
		win.upsert(makeItem({ id: "a.ts", content: "x" }));
		expect(win.remove("a.ts")).toBe(true);
		expect(win.size).toBe(0);
	});

	it("scores pinned items higher than unpinned", () => {
		const win = new SmartContextWindow({ maxTokens: 10000, pinnedWeight: 0.5 });
		const now = Date.now();

		const pinned = makeItem({ id: "pinned.ts", content: "x", pinned: true, lastTouched: now });
		const unpinned = makeItem({ id: "unpinned.ts", content: "x", pinned: false, lastTouched: now });

		const pinnedScore = win.scoreItem(pinned, now);
		const unpinnedScore = win.scoreItem(unpinned, now);

		expect(pinnedScore).toBeGreaterThan(unpinnedScore);
	});

	it("scores recent items higher than old items", () => {
		const win = new SmartContextWindow({ maxTokens: 10000, maxAgeMs: 60000 });
		const now = Date.now();

		const recent = makeItem({ id: "recent.ts", content: "x", lastTouched: now });
		const old = makeItem({ id: "old.ts", content: "x", lastTouched: now - 50000 });

		expect(win.scoreItem(recent, now)).toBeGreaterThan(win.scoreItem(old, now));
	});

	it("scores closer ripple depths higher", () => {
		const win = new SmartContextWindow({ maxTokens: 10000, rippleWeight: 0.5 });
		const now = Date.now();

		const close = makeItem({ id: "close.ts", content: "x", rippleDepth: 1, lastTouched: now });
		const far = makeItem({ id: "far.ts", content: "x", rippleDepth: 4, lastTouched: now });

		expect(win.scoreItem(close, now)).toBeGreaterThan(win.scoreItem(far, now));
	});

	it("packs items within token budget", () => {
		const win = new SmartContextWindow({ maxTokens: 50 });
		// Each item is ~5 tokens (20 chars / 4)
		win.upsert(makeItem({ id: "a.ts", content: "a".repeat(20), referenceCount: 5 }));
		win.upsert(makeItem({ id: "b.ts", content: "b".repeat(20), referenceCount: 3 }));
		win.upsert(makeItem({ id: "c.ts", content: "c".repeat(20), referenceCount: 1 }));

		const result = win.pack();
		// Should include at least some items
		expect(result.included.length).toBeGreaterThan(0);
		expect(result.totalTokens).toBeLessThanOrEqual(50);
		expect(result.packed).toBeTruthy();
	});

	it("excludes items that don't fit the budget", () => {
		const win = new SmartContextWindow({ maxTokens: 10 });
		// Each is ~25 tokens — only 1 can fit in a budget of 10... let's use big content
		win.upsert(makeItem({ id: "big.ts", content: "x".repeat(200), referenceCount: 5 }));
		win.upsert(makeItem({ id: "small.ts", content: "y".repeat(20), referenceCount: 1 }));

		const result = win.pack();
		// small fits (5 tokens), big doesn't (50 tokens)
		expect(result.included.length).toBe(1);
		expect(result.excluded.length).toBe(1);
	});

	it("touch refreshes recency and increments reference count", () => {
		const win = new SmartContextWindow({ maxTokens: 10000 });
		win.upsert(makeItem({ id: "a.ts", content: "x", referenceCount: 1 }));
		win.touch("a.ts");
		const item = win.getAll()[0];
		expect(item.referenceCount).toBe(2);
	});

	it("clears all items", () => {
		const win = new SmartContextWindow({ maxTokens: 10000 });
		win.upsert(makeItem({ id: "a.ts", content: "x" }));
		win.clear();
		expect(win.size).toBe(0);
	});
});
