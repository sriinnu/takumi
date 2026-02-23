/**
 * Virtual list component — efficiently renders large lists by
 * only rendering items within the visible viewport.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { truncate } from "../text.js";

export interface ListItem {
	id: string;
	label: string;
	description?: string;
	icon?: string;
	data?: unknown;
}

export interface ListProps {
	key?: string;
	items: ListItem[];
	selectedIndex?: number;
	itemHeight?: number;
	showIndex?: boolean;
	selectedColor?: number;
	selectedBg?: number;
	onSelect?: (item: ListItem, index: number) => void;
}

export class List extends Component {
	private props: ListProps;
	private _selectedIndex: number;
	private scrollOffset = 0;

	constructor(props: ListProps) {
		super();
		this.props = props;
		this.key = props.key;
		this._selectedIndex = props.selectedIndex ?? 0;
	}

	get selectedIndex(): number {
		return this._selectedIndex;
	}

	get selectedItem(): ListItem | undefined {
		return this.props.items[this._selectedIndex];
	}

	/** Update the item list. */
	setItems(items: ListItem[]): void {
		this.props = { ...this.props, items };
		if (this._selectedIndex >= items.length) {
			this._selectedIndex = Math.max(0, items.length - 1);
		}
		this.markDirty();
	}

	/** Move selection up. */
	selectPrev(): void {
		if (this._selectedIndex > 0) {
			this._selectedIndex--;
			this.ensureVisible();
			this.markDirty();
		}
	}

	/** Move selection down. */
	selectNext(): void {
		if (this._selectedIndex < this.props.items.length - 1) {
			this._selectedIndex++;
			this.ensureVisible();
			this.markDirty();
		}
	}

	/** Jump to index. */
	selectIndex(index: number): void {
		this._selectedIndex = Math.max(0, Math.min(index, this.props.items.length - 1));
		this.ensureVisible();
		this.markDirty();
	}

	/** Confirm current selection. */
	confirm(): void {
		const item = this.props.items[this._selectedIndex];
		if (item) {
			this.props.onSelect?.(item, this._selectedIndex);
		}
	}

	private ensureVisible(): void {
		const rect = this.getLayoutRect();
		const viewportHeight = rect.height;
		const itemH = this.props.itemHeight ?? 1;

		const visibleItems = Math.floor(viewportHeight / itemH);
		if (this._selectedIndex < this.scrollOffset) {
			this.scrollOffset = this._selectedIndex;
		} else if (this._selectedIndex >= this.scrollOffset + visibleItems) {
			this.scrollOffset = this._selectedIndex - visibleItems + 1;
		}
	}

	render(screen: Screen, rect: Rect): void {
		const itemH = this.props.itemHeight ?? 1;
		const visibleItems = Math.floor(rect.height / itemH);
		const items = this.props.items;
		const selColor = this.props.selectedColor ?? 15;
		const selBg = this.props.selectedBg ?? 4;
		const showIdx = this.props.showIndex ?? false;

		for (let i = 0; i < visibleItems; i++) {
			const itemIndex = this.scrollOffset + i;
			if (itemIndex >= items.length) break;

			const item = items[itemIndex];
			const row = rect.y + i * itemH;
			const isSelected = itemIndex === this._selectedIndex;

			// Build display text
			let text = "";
			if (showIdx) text += `${String(itemIndex + 1).padStart(3)} `;
			if (item.icon) text += `${item.icon} `;
			text += item.label;
			if (item.description) text += `  ${item.description}`;

			// Truncate and pad to fill width
			text = truncate(text, rect.width);
			const padded = text.padEnd(rect.width);

			if (isSelected) {
				screen.writeText(row, rect.x, padded, {
					fg: selColor,
					bg: selBg,
					bold: true,
				});
			} else {
				screen.writeText(row, rect.x, padded, {
					fg: item.description ? 7 : -1,
				});
			}
		}
	}
}
