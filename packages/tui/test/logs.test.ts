/**
 * Tests for the LogsView scrollable log viewer.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { describe, expect, it } from "vitest";
import type { LogEntry, LogLevel } from "../src/views/logs.js";
import { LogsView } from "../src/views/logs.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeKey(key: string, mods?: Partial<KeyEvent>): KeyEvent {
	return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods };
}

function makeEntry(overrides?: Partial<LogEntry>): LogEntry {
	return {
		timestamp: "2025-01-15T10:30:00.123Z",
		level: "info",
		source: "test",
		message: "test message",
		...overrides,
	};
}

function pushMany(view: LogsView, count: number, level: LogLevel = "info"): void {
	for (let i = 0; i < count; i++) {
		view.push(makeEntry({ level, message: `msg-${i}`, source: `src-${i}` }));
	}
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("LogsView", () => {
	describe("construction", () => {
		it("creates with default state", () => {
			const view = new LogsView();
			expect(view.entries.value).toEqual([]);
			expect(view.minLevel.value).toBe("info");
			expect(view.scrollOffset.value).toBe(0);
			expect(view.autoScroll.value).toBe(true);
			expect(view.filter.value).toBe("");
		});

		it("accepts custom maxEntries and minLevel", () => {
			const view = new LogsView({ maxEntries: 500, minLevel: "warn" });
			expect(view.minLevel.value).toBe("warn");
		});
	});

	describe("push", () => {
		it("appends entries", () => {
			const view = new LogsView();
			view.push(makeEntry({ message: "first" }));
			view.push(makeEntry({ message: "second" }));
			expect(view.entries.value).toHaveLength(2);
			expect(view.entries.value[0].message).toBe("first");
		});

		it("evicts oldest entries when over capacity", () => {
			const view = new LogsView({ maxEntries: 5 });
			pushMany(view, 8);

			expect(view.entries.value).toHaveLength(5);
			// Oldest entries should be evicted
			expect(view.entries.value[0].message).toBe("msg-3");
		});

		it("marks component dirty", () => {
			const view = new LogsView();
			view.clearDirty();

			view.push(makeEntry());
			expect(view.dirty).toBe(true);
		});
	});

	describe("clear", () => {
		it("removes all entries", () => {
			const view = new LogsView();
			pushMany(view, 5);
			expect(view.entries.value).toHaveLength(5);

			view.clear();
			expect(view.entries.value).toHaveLength(0);
		});

		it("resets scroll offset", () => {
			const view = new LogsView();
			pushMany(view, 10);
			view.scrollOffset.value = 5;

			view.clear();
			expect(view.scrollOffset.value).toBe(0);
		});

		it("marks dirty", () => {
			const view = new LogsView();
			pushMany(view, 3);
			view.clearDirty();

			view.clear();
			expect(view.dirty).toBe(true);
		});
	});

	describe("filteredEntries", () => {
		it("filters by minimum log level", () => {
			const view = new LogsView();
			view.push(makeEntry({ level: "debug", message: "debug msg" }));
			view.push(makeEntry({ level: "info", message: "info msg" }));
			view.push(makeEntry({ level: "warn", message: "warn msg" }));
			view.push(makeEntry({ level: "error", message: "error msg" }));

			view.minLevel.value = "warn";
			const filtered = view.filteredEntries();
			expect(filtered).toHaveLength(2);
			expect(filtered[0].level).toBe("warn");
			expect(filtered[1].level).toBe("error");
		});

		it("returns all entries at debug level", () => {
			const view = new LogsView({ minLevel: "debug" });
			view.push(makeEntry({ level: "debug" }));
			view.push(makeEntry({ level: "info" }));
			view.push(makeEntry({ level: "error" }));

			const filtered = view.filteredEntries();
			expect(filtered).toHaveLength(3);
		});

		it("filters by text in message", () => {
			const view = new LogsView({ minLevel: "debug" });
			view.push(makeEntry({ message: "connecting to server" }));
			view.push(makeEntry({ message: "loading config" }));
			view.push(makeEntry({ message: "connection established" }));

			view.filter.value = "connect";
			const filtered = view.filteredEntries();
			expect(filtered).toHaveLength(2);
		});

		it("filters by text in source (case-insensitive)", () => {
			const view = new LogsView({ minLevel: "debug" });
			view.push(makeEntry({ source: "MCP-client", message: "alpha" }));
			view.push(makeEntry({ source: "loop", message: "beta" }));

			view.filter.value = "mcp";
			const filtered = view.filteredEntries();
			expect(filtered).toHaveLength(1);
			expect(filtered[0].source).toBe("MCP-client");
		});

		it("returns empty for no matches", () => {
			const view = new LogsView({ minLevel: "debug" });
			view.push(makeEntry({ message: "hello" }));

			view.filter.value = "zzz-no-match";
			expect(view.filteredEntries()).toHaveLength(0);
		});
	});

	describe("cycleLevel", () => {
		it("cycles debug → info → warn → error → debug", () => {
			const view = new LogsView({ minLevel: "debug" });
			expect(view.minLevel.value).toBe("debug");

			view.cycleLevel();
			expect(view.minLevel.value).toBe("info");

			view.cycleLevel();
			expect(view.minLevel.value).toBe("warn");

			view.cycleLevel();
			expect(view.minLevel.value).toBe("error");

			view.cycleLevel();
			expect(view.minLevel.value).toBe("debug");
		});

		it("resets scroll offset on cycle", () => {
			const view = new LogsView();
			view.scrollOffset.value = 10;

			view.cycleLevel();
			expect(view.scrollOffset.value).toBe(0);
		});

		it("marks dirty", () => {
			const view = new LogsView();
			view.clearDirty();

			view.cycleLevel();
			expect(view.dirty).toBe(true);
		});
	});

	describe("keyboard navigation", () => {
		it("scrolls down with j", () => {
			const view = new LogsView();
			pushMany(view, 50);
			// autoScroll places offset at bottom; reset to test j movement
			view.scrollOffset.value = 0;

			const handled = view.handleKey(makeKey("j"));
			expect(handled).toBe(true);
			expect(view.scrollOffset.value).toBe(1);
		});

		it("scrolls down with arrow down", () => {
			const view = new LogsView();
			pushMany(view, 50);
			view.scrollOffset.value = 0;

			view.handleKey(makeKey(KEY_CODES.DOWN));
			expect(view.scrollOffset.value).toBe(1);
		});

		it("scrolls up with k", () => {
			const view = new LogsView();
			pushMany(view, 50);
			view.scrollOffset.value = 5;

			view.handleKey(makeKey("k"));
			expect(view.scrollOffset.value).toBe(4);
		});

		it("clamps scroll at top", () => {
			const view = new LogsView();
			pushMany(view, 5);
			view.scrollOffset.value = 0;

			view.handleKey(makeKey("k"));
			expect(view.scrollOffset.value).toBe(0);
		});

		it("disables auto-scroll on manual up-scroll", () => {
			const view = new LogsView();
			pushMany(view, 50);
			view.scrollOffset.value = 5;
			view.autoScroll.value = true;

			view.handleKey(makeKey("k"));
			expect(view.autoScroll.value).toBe(false);
		});

		it("scrolls by page with PageUp/PageDown", () => {
			const view = new LogsView();
			pushMany(view, 100);
			view.scrollOffset.value = 0;

			view.handleKey(makeKey(KEY_CODES.PAGE_DOWN));
			expect(view.scrollOffset.value).toBeGreaterThan(0);
		});

		it("cycles level with l key", () => {
			const view = new LogsView();
			view.handleKey(makeKey("l"));
			// Default is "info", after cycle should be "warn"
			expect(view.minLevel.value).toBe("warn");
		});

		it("goes to top with g key", () => {
			const view = new LogsView();
			pushMany(view, 50);
			view.scrollOffset.value = 20;

			view.handleKey(makeKey("g"));
			expect(view.scrollOffset.value).toBe(0);
		});

		it("goes to bottom with G key and enables auto-scroll", () => {
			const view = new LogsView();
			pushMany(view, 50);
			view.scrollOffset.value = 0;
			view.autoScroll.value = false;

			view.handleKey(makeKey("G"));
			expect(view.autoScroll.value).toBe(true);
		});

		it("returns false for unhandled keys", () => {
			const view = new LogsView();
			const handled = view.handleKey(makeKey("x"));
			expect(handled).toBe(false);
		});

		it("does not handle ctrl+k (reserved)", () => {
			const view = new LogsView();
			pushMany(view, 10);
			view.scrollOffset.value = 5;

			const handled = view.handleKey(makeKey("k", { ctrl: true }));
			expect(handled).toBe(false);
		});
	});
});
