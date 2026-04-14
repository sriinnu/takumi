import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import type { CompletionItem } from "../completion.js";
import { MAX_VISIBLE_ITEMS } from "../completion.js";
import type { EditorPanel } from "./editor.js";

/**
 * Render the completion popup with a compact header, kind chips, and footer hints.
 */
export function renderEditorCompletionPopup(panel: EditorPanel, screen: Screen, rect: Rect): void {
	const items = panel.completion.items.value;
	if (items.length === 0) return;

	// Clamp visible rows to available space above the editor (chrome = 4: top/bottom border + title + footer).
	const maxAbove = rect.y - 4;
	if (maxAbove < 1) return; // not even 1 item fits
	const visibleCount = Math.min(items.length, MAX_VISIBLE_ITEMS, maxAbove);
	const selectedIdx = panel.completion.selectedIndex.value;
	const selectedItem = items[selectedIdx] ?? items[0];
	const titleText = ` ${formatCompletionTitle(selectedItem, items.length)} `;
	const footerText = ` ${formatCompletionFooter(selectedItem)} `;

	// Clamp scroll so the selected item stays within the (possibly reduced) visible window.
	let scrollOff = panel.completion.scrollOffset.value;
	if (selectedIdx < scrollOff) scrollOff = selectedIdx;
	else if (selectedIdx >= scrollOff + visibleCount) scrollOff = selectedIdx - visibleCount + 1;

	// Cap popup width: fit visible content but never exceed 60 chars or half the terminal.
	const maxPopupWidth = Math.max(40, Math.min(60, Math.floor(rect.width / 2)));
	const contentWidth = Math.max(
		...items.slice(scrollOff, scrollOff + visibleCount).map((item) => item.label.length + 8),
		titleText.length + 2,
		footerText.length + 2,
	);
	const popupWidth = Math.min(contentWidth, maxPopupWidth, rect.width - 2);
	const popupHeight = visibleCount + 4;
	const popupX = rect.x + 1;
	const popupY = rect.y - popupHeight;

	screen.writeText(popupY, popupX, `┌${"─".repeat(popupWidth - 2)}┐`, { fg: 8 });
	screen.writeText(popupY + 1, popupX, "│", { fg: 8 });
	screen.writeText(popupY + 1, popupX + 1, titleText.padEnd(popupWidth - 2).slice(0, popupWidth - 2), {
		fg: 6,
		bold: true,
	});
	screen.writeText(popupY + 1, popupX + popupWidth - 1, "│", { fg: 8 });
	screen.writeText(popupY + popupHeight - 1, popupX, `└${"─".repeat(popupWidth - 2)}┘`, { fg: 8 });

	for (let i = 0; i < visibleCount; i++) {
		const itemIdx = scrollOff + i;
		if (itemIdx >= items.length) break;
		const item = items[itemIdx];
		const isSelected = itemIdx === selectedIdx;
		const row = popupY + 2 + i;
		const innerWidth = popupWidth - 4;
		const chip = formatCompletionChip(item.kind);
		const rowText = formatCompletionRowText(item);
		const displayText = rowText.padEnd(innerWidth).slice(0, innerWidth);
		screen.writeText(row, popupX, "│ ", { fg: 8 });
		screen.writeText(
			row,
			popupX + 2,
			chip,
			isSelected
				? { fg: completionChipColor(item.kind), bg: 15, bold: true }
				: { fg: completionChipColor(item.kind), bold: true },
		);
		screen.writeText(
			row,
			popupX + 2 + chip.length + 1,
			displayText.slice(chip.length + 1),
			isSelected ? { fg: 0, bg: 15 } : { fg: 7 },
		);
		screen.writeText(row, popupX + popupWidth - 2, " │", { fg: 8 });
	}

	screen.writeText(popupY + popupHeight - 2, popupX, "│", { fg: 8 });
	screen.writeText(popupY + popupHeight - 2, popupX + 1, footerText.padEnd(popupWidth - 2).slice(0, popupWidth - 2), {
		fg: 8,
		dim: true,
	});
	screen.writeText(popupY + popupHeight - 2, popupX + popupWidth - 1, "│", { fg: 8 });
}

function formatCompletionTitle(item: CompletionItem | undefined, count: number): string {
	if (!item) return `${count} results`;
	return `${item.kind} • ${count} result${count === 1 ? "" : "s"}`;
}

function formatCompletionFooter(item: CompletionItem | undefined): string {
	if (!item?.detail) return "↵ insert • tab confirm • esc close";
	return `${item.detail} • ↵ insert • esc close`;
}

function formatCompletionChip(kind: CompletionItem["kind"]): string {
	switch (kind) {
		case "command":
			return "cmd";
		case "model":
			return "mdl";
		case "file":
			return "fs ";
		default:
			return "var";
	}
}

function completionChipColor(kind: CompletionItem["kind"]): number {
	switch (kind) {
		case "command":
			return 6;
		case "model":
			return 3;
		case "file":
			return 2;
		default:
			return 5;
	}
}

function formatCompletionRowText(item: CompletionItem): string {
	const chip = formatCompletionChip(item.kind);
	if (!item.detail) return `${chip} ${item.label}`;
	return `${chip} ${item.label}  ${item.detail}`;
}
