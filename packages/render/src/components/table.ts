/**
 * Table component — renders aligned columns with headers,
 * auto-width calculation, truncation, and optional borders.
 */

import type { Cell, Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { measureText, truncate } from "../text.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ColumnAlign = "left" | "center" | "right";

export interface ColumnDefinition {
	/** Column header text. */
	header: string;
	/** Fixed width (in columns). If omitted, auto-calculated. */
	width?: number;
	/** Minimum width. Default: header length + 2. */
	minWidth?: number;
	/** Maximum width. Truncates content beyond this. */
	maxWidth?: number;
	/** Text alignment within the cell. Default: "left". */
	align?: ColumnAlign;
}

export interface TableProps {
	key?: string;
	/** Column definitions. */
	columns: ColumnDefinition[];
	/** Row data — each row is an array of strings matching column order. */
	rows: string[][];
	/** Whether to render a header row. Default: true. */
	showHeader?: boolean;
	/** Whether to render column separator characters. Default: true. */
	showSeparators?: boolean;
	/** Color index for headers (256-palette). Default: 15 (bright white). */
	headerColor?: number;
	/** Color index for row text. Default: 7 (white). */
	rowColor?: number;
	/** Color index for separator characters. Default: 8 (gray). */
	separatorColor?: number;
	/** Character used to separate columns. Default: "│". */
	separator?: string;
	/** Highlight the selected row index (0-based). Default: -1 (none). */
	selectedRow?: number;
	/** Background color for the selected row. Default: 236. */
	selectedBg?: number;
}

// ── Table component ───────────────────────────────────────────────────────────

export class Table extends Component {
	private props: TableProps;

	constructor(props: TableProps) {
		super();
		this.props = props;
		this.key = props.key;
	}

	/** Update the row data. */
	setRows(rows: string[][]): void {
		this.props = { ...this.props, rows };
		this.markDirty();
	}

	/** Update column definitions. */
	setColumns(columns: ColumnDefinition[]): void {
		this.props = { ...this.props, columns };
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		if (rect.width < 3 || rect.height < 1) return;

		const {
			columns,
			rows,
			showHeader = true,
			showSeparators = true,
			headerColor = 15,
			rowColor = 7,
			separatorColor = 8,
			separator = "│",
			selectedRow = -1,
			selectedBg = 236,
		} = this.props;

		// ── Compute column widths ────────────────────────────────────
		const widths = computeColumnWidths(columns, rows, rect.width, showSeparators);

		let y = rect.y;
		const maxY = rect.y + rect.height;

		// ── Header ───────────────────────────────────────────────────
		if (showHeader && y < maxY) {
			drawRow(
				screen,
				rect.x,
				y,
				columns.map((c) => c.header),
				widths,
				columns,
				{
					fg: headerColor,
					bg: -1,
					separator: showSeparators ? separator : "",
					separatorColor,
					maxWidth: rect.width,
				},
			);
			y++;

			// Header underline
			if (y < maxY) {
				const line = widths.map((w) => "─".repeat(w)).join(showSeparators ? "┼" : "─");
				screen.writeText(y, rect.x, truncate(line, rect.width), { fg: separatorColor });
				y++;
			}
		}

		// ── Data rows ────────────────────────────────────────────────
		for (let r = 0; r < rows.length && y < maxY; r++) {
			const row = rows[r];
			const isSelected = r === selectedRow;
			drawRow(screen, rect.x, y, row, widths, columns, {
				fg: rowColor,
				bg: isSelected ? selectedBg : -1,
				separator: showSeparators ? separator : "",
				separatorColor,
				maxWidth: rect.width,
			});
			y++;
		}
	}
}

// ── Layout helpers ────────────────────────────────────────────────────────────

/**
 * Compute column widths to fit within the available space.
 *
 * Fixed-width columns get their exact width.
 * Auto columns split remaining space proportionally,
 * clamped to [minWidth, maxWidth].
 */
export function computeColumnWidths(
	columns: ColumnDefinition[],
	rows: string[][],
	availableWidth: number,
	showSeparators: boolean,
): number[] {
	const separatorOverhead = showSeparators ? columns.length - 1 : 0;
	const usable = availableWidth - separatorOverhead;

	const widths: number[] = new Array(columns.length).fill(0);
	let usedByFixed = 0;
	const autoIndices: number[] = [];

	for (let i = 0; i < columns.length; i++) {
		const col = columns[i];
		if (col.width !== undefined) {
			widths[i] = Math.min(col.width, usable);
			usedByFixed += widths[i];
		} else {
			autoIndices.push(i);
		}
	}

	if (autoIndices.length === 0) return widths;

	// Auto-size: measure content, then distribute proportionally
	const remaining = Math.max(0, usable - usedByFixed);
	const contentWidths = autoIndices.map((idx) => {
		const col = columns[idx];
		let maxContent = measureText(col.header);
		for (const row of rows) {
			const cell = row[idx] ?? "";
			maxContent = Math.max(maxContent, measureText(cell));
		}
		const min = col.minWidth ?? measureText(col.header) + 2;
		const max = col.maxWidth ?? Infinity;
		return Math.min(Math.max(maxContent + 1, min), max);
	});

	const totalDesired = contentWidths.reduce((a, b) => a + b, 0);

	for (let j = 0; j < autoIndices.length; j++) {
		const col = columns[autoIndices[j]];
		const min = col.minWidth ?? 4;
		const ratio = totalDesired > 0 ? contentWidths[j] / totalDesired : 1 / autoIndices.length;
		widths[autoIndices[j]] = Math.max(min, Math.floor(remaining * ratio));
	}

	return widths;
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

interface DrawRowOptions {
	fg: number;
	bg: number;
	separator: string;
	separatorColor: number;
	maxWidth: number;
}

function drawRow(
	screen: Screen,
	x: number,
	y: number,
	cells: string[],
	widths: number[],
	columns: ColumnDefinition[],
	opts: DrawRowOptions,
): void {
	let cx = x;
	const cellStyle: Partial<Cell> = { fg: opts.fg };
	if (opts.bg >= 0) cellStyle.bg = opts.bg;
	const sepStyle: Partial<Cell> = { fg: opts.separatorColor };
	if (opts.bg >= 0) sepStyle.bg = opts.bg;

	for (let i = 0; i < widths.length; i++) {
		if (cx - x >= opts.maxWidth) break;

		if (i > 0 && opts.separator) {
			screen.writeText(y, cx, opts.separator, sepStyle);
			cx++;
		}

		const raw = cells[i] ?? "";
		const w = widths[i];
		const align = columns[i]?.align ?? "left";
		const padded = alignText(raw, w, align);
		screen.writeText(y, cx, padded, cellStyle);
		cx += w;
	}
}

/**
 * Align text within a fixed-width field.
 * Truncates if text exceeds width.
 */
function alignText(text: string, width: number, align: ColumnAlign): string {
	const len = measureText(text);

	if (len >= width) {
		return truncate(text, width);
	}

	const gap = width - len;

	switch (align) {
		case "right":
			return " ".repeat(gap) + text;
		case "center": {
			const left = Math.floor(gap / 2);
			const right = gap - left;
			return " ".repeat(left) + text + " ".repeat(right);
		}
		default:
			return text + " ".repeat(gap);
	}
}
