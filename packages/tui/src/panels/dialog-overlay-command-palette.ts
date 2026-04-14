/**
 * Command-palette overlay helpers.
 *
 * I keep the grouped palette presentation out of `dialog-overlay.ts` so that
 * file stays a coordinator instead of quietly mutating into another god-panel.
 */

import type { CommandPalette, CommandPaletteItem } from "../dialogs/command-palette.js";
import {
	getCommandPaletteGroupId,
	getCommandPaletteGroupLabel,
	getCommandPaletteItemKey,
} from "../dialogs/command-palette-groups.js";

const MAX_VISIBLE_ROWS = 10;
/** Height threshold below which the detail pane is collapsed. */
const COMPACT_HEIGHT_THRESHOLD = 28;

interface CommandPaletteDialogModel {
	maxWidth: number;
	title: string;
	lines: string[];
}

interface PaletteRow {
	kind: "group" | "item";
	label: string;
	item?: CommandPaletteItem;
	itemIndex?: number;
}

/**
 * I assemble the palette dialog content with grouped rows and a small detail
 * pane for the selected action. The detail pane collapses on short terminals.
 */
export function buildCommandPaletteDialogModel(
	palette: CommandPalette,
	terminalHeight = 40,
): CommandPaletteDialogModel {
	const items = palette.getItems();
	const groups = palette.getGroups();
	const compact = terminalHeight < COMPACT_HEIGHT_THRESHOLD;
	const maxRows = compact ? Math.max(4, Math.min(MAX_VISIBLE_ROWS, terminalHeight - 10)) : MAX_VISIBLE_ROWS;
	const rows = flattenPaletteRows(items, groups);
	const visibleRows = sliceRowsAroundSelection(rows, palette.selectedIndex, maxRows);
	const selected = palette.getSelectedItem();

	const commandLines =
		visibleRows.length > 0
			? visibleRows.map((row) => formatPaletteRow(row, palette.selectedIndex))
			: ["No matching commands or shortcuts."];

	const lines: string[] = [`Filter: ${palette.filterText || "(type to search)"}`, "", ...commandLines];

	if (!compact) {
		lines.push("", "Details", ...buildSelectedItemLines(selected));
	} else {
		// Single-line compact hint
		const name = selected?.name ?? "";
		const desc = selected?.description ?? "";
		lines.push("", name ? `${name} — ${desc}` : "↑/↓ move • Enter selects • Esc closes");
	}

	return { title: "Command Palette", maxWidth: 96, lines };
}

function flattenPaletteRows(
	items: readonly CommandPaletteItem[],
	groups: ReturnType<CommandPalette["getGroups"]>,
): PaletteRow[] {
	const itemIndexByKey = new Map(items.map((item, index) => [getCommandPaletteItemKey(item), index]));
	const rows: PaletteRow[] = [];

	for (const group of groups) {
		rows.push({ kind: "group", label: group.label });
		for (const item of group.items) {
			rows.push({
				kind: "item",
				label: item.name,
				item,
				itemIndex: itemIndexByKey.get(getCommandPaletteItemKey(item)) ?? 0,
			});
		}
	}

	return rows;
}

function sliceRowsAroundSelection(
	rows: readonly PaletteRow[],
	selectedItemIndex: number,
	maxRows: number,
): PaletteRow[] {
	if (rows.length <= maxRows) return [...rows];

	const selectedRowIndex = rows.findIndex((row) => row.kind === "item" && row.itemIndex === selectedItemIndex);
	if (selectedRowIndex < 0) return rows.slice(0, maxRows);

	let start = Math.max(0, selectedRowIndex - Math.floor(maxRows / 2));
	let end = Math.min(rows.length, start + maxRows);
	start = Math.max(0, end - maxRows);

	if (rows[start]?.kind === "item") {
		const headerIndex = findHeaderIndexBefore(rows, start);
		if (headerIndex >= 0) {
			const shift = start - headerIndex;
			start = headerIndex;
			end = Math.min(rows.length, end + shift);
			if (end - start > maxRows) {
				end = start + maxRows;
			}
		}
	}

	return rows.slice(start, end);
}

function findHeaderIndexBefore(rows: readonly PaletteRow[], start: number): number {
	for (let index = start; index >= 0; index--) {
		if (rows[index]?.kind === "group") return index;
	}
	return -1;
}

function formatPaletteRow(row: PaletteRow, selectedItemIndex: number): string {
	if (row.kind === "group") {
		return row.label;
	}

	const marker = row.itemIndex === selectedItemIndex ? ">" : " ";
	const item = row.item!;
	const name = item.name.padEnd(18);
	return `${marker} ${name} ${item.description}`;
}

function buildSelectedItemLines(item: CommandPaletteItem | null): string[] {
	if (!item) {
		return ["  Nothing selected.", "", "  Enter executes the selected item.", "  Esc closes the palette."];
	}

	const groupLabel = getCommandPaletteGroupLabel(getCommandPaletteGroupId(item));
	const aliases = item.aliases?.length ? item.aliases.join(", ") : "none";
	const typeLabel = item.type === "command" ? "Command" : "Shortcut";
	const actionLine = item.type === "keybind" && item.id ? `  Action: ${item.id}` : null;
	const originLine = item.originLabel ? `  Origin: ${item.originLabel}` : null;

	return [
		`  ${item.name}`,
		`  Group: ${groupLabel} • ${typeLabel}`,
		`  ${item.description}`,
		...(originLine ? [originLine] : []),
		`  Aliases: ${aliases}`,
		...(actionLine ? [actionLine] : []),
		"",
		"  Enter executes the selected item.",
		"  Esc closes the palette • ↑/↓ move selection.",
	];
}
