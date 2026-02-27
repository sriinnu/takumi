/**
 * Tests for the Table component and column width computation.
 */

import type { Rect } from "@takumi/core";
import { describe, expect, it } from "vitest";
import type { ColumnDefinition } from "../src/components/table.js";
import { computeColumnWidths, Table } from "../src/components/table.js";
import { Screen } from "../src/screen.js";

// ── computeColumnWidths ───────────────────────────────────────────────────────

describe("computeColumnWidths", () => {
	it("returns fixed widths for columns with explicit width", () => {
		const cols: ColumnDefinition[] = [
			{ header: "A", width: 10 },
			{ header: "B", width: 20 },
		];
		const widths = computeColumnWidths(cols, [], 80, false);
		expect(widths).toEqual([10, 20]);
	});

	it("auto-sizes columns to fit content", () => {
		const cols: ColumnDefinition[] = [{ header: "Name" }, { header: "Value" }];
		const rows = [
			["hello", "12345"],
			["world", "67890"],
		];
		const widths = computeColumnWidths(cols, rows, 80, false);
		// Auto columns should > 0 and fit within 80
		expect(widths.every((w) => w > 0)).toBe(true);
		expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(80);
	});

	it("reserves space for separators", () => {
		const cols: ColumnDefinition[] = [
			{ header: "A", width: 30 },
			{ header: "B", width: 30 },
			{ header: "C", width: 30 },
		];
		// 3 columns = 2 separators. With 80 usable, all 3 can't have 30
		const widths = computeColumnWidths(cols, [], 62, true);
		// Separator overhead = 2 chars, usable = 60
		expect(widths).toEqual([30, 30, 30]);
	});

	it("respects minWidth for auto columns", () => {
		const cols: ColumnDefinition[] = [{ header: "X", minWidth: 15 }];
		const widths = computeColumnWidths(cols, [["a"]], 80, false);
		expect(widths[0]).toBeGreaterThanOrEqual(15);
	});

	it("respects maxWidth for auto columns", () => {
		const cols: ColumnDefinition[] = [{ header: "X", maxWidth: 10 }];
		const rows = [["a really really long value that should be truncated"]];
		const widths = computeColumnWidths(cols, rows, 80, false);
		expect(widths[0]).toBeLessThanOrEqual(80); // clamped
	});

	it("handles mixed fixed and auto columns", () => {
		const cols: ColumnDefinition[] = [{ header: "Fixed", width: 20 }, { header: "Auto" }];
		const widths = computeColumnWidths(cols, [["x", "value"]], 60, false);
		expect(widths[0]).toBe(20);
		expect(widths[1]).toBeGreaterThan(0);
	});

	it("handles zero rows gracefully", () => {
		const cols: ColumnDefinition[] = [{ header: "Name" }, { header: "Age" }];
		const widths = computeColumnWidths(cols, [], 40, false);
		expect(widths.length).toBe(2);
		expect(widths.every((w) => w > 0)).toBe(true);
	});
});

// ── Table component ───────────────────────────────────────────────────────────

describe("Table", () => {
	it("constructs with provided props", () => {
		const table = new Table({
			columns: [{ header: "Name" }],
			rows: [["hello"]],
		});
		expect(table).toBeDefined();
	});

	it("sets key from props", () => {
		const table = new Table({
			key: "my-table",
			columns: [{ header: "A" }],
			rows: [],
		});
		expect(table.key).toBe("my-table");
	});

	it("marks dirty when rows are updated", () => {
		const table = new Table({
			columns: [{ header: "Name" }],
			rows: [["a"]],
		});
		// Component starts dirty
		table.clearDirty();
		expect(table.dirty).toBe(false);

		table.setRows([["b"]]);
		expect(table.dirty).toBe(true);
	});

	it("marks dirty when columns are updated", () => {
		const table = new Table({
			columns: [{ header: "Name" }],
			rows: [],
		});
		table.clearDirty();

		table.setColumns([{ header: "New Header" }]);
		expect(table.dirty).toBe(true);
	});

	it("renders without crashing on a real Screen", () => {
		const screen = new Screen(80, 24);
		const rect: Rect = { x: 0, y: 0, width: 80, height: 24 };
		const table = new Table({
			columns: [
				{ header: "Name", width: 20 },
				{ header: "Value", width: 20 },
			],
			rows: [
				["hello", "world"],
				["foo", "bar"],
			],
		});

		// Should not throw
		expect(() => table.render(screen, rect)).not.toThrow();
	});

	it("renders nothing when rect is too small", () => {
		const screen = new Screen(80, 24);
		const rect: Rect = { x: 0, y: 0, width: 2, height: 0 };
		const table = new Table({
			columns: [{ header: "Name" }],
			rows: [["x"]],
		});

		// Should silently return
		expect(() => table.render(screen, rect)).not.toThrow();
	});

	it("renders with selected row highlighting", () => {
		const screen = new Screen(60, 10);
		const rect: Rect = { x: 0, y: 0, width: 60, height: 10 };
		const table = new Table({
			columns: [{ header: "A", width: 10 }],
			rows: [["row0"], ["row1"], ["row2"]],
			selectedRow: 1,
		});

		expect(() => table.render(screen, rect)).not.toThrow();
	});

	it("renders with separators disabled", () => {
		const screen = new Screen(40, 10);
		const rect: Rect = { x: 0, y: 0, width: 40, height: 10 };
		const table = new Table({
			columns: [
				{ header: "A", width: 10 },
				{ header: "B", width: 10 },
			],
			rows: [["x", "y"]],
			showSeparators: false,
		});

		expect(() => table.render(screen, rect)).not.toThrow();
	});

	it("renders with header disabled", () => {
		const screen = new Screen(40, 10);
		const rect: Rect = { x: 0, y: 0, width: 40, height: 10 };
		const table = new Table({
			columns: [{ header: "A", width: 10 }],
			rows: [["x"]],
			showHeader: false,
		});

		expect(() => table.render(screen, rect)).not.toThrow();
	});

	it("handles rows with missing cells gracefully", () => {
		const screen = new Screen(80, 24);
		const rect: Rect = { x: 0, y: 0, width: 80, height: 24 };
		const table = new Table({
			columns: [
				{ header: "A", width: 10 },
				{ header: "B", width: 10 },
				{ header: "C", width: 10 },
			],
			rows: [["only-one"]],
		});

		expect(() => table.render(screen, rect)).not.toThrow();
	});
});
