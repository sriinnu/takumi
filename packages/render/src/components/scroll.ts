/**
 * Scroll component — virtual viewport that shows a window into
 * content larger than the visible area. Supports both vertical
 * and horizontal scrolling.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";

export interface ScrollProps {
	key?: string;
	scrollX?: number;
	scrollY?: number;
	contentWidth?: number;
	contentHeight?: number;
	showScrollbar?: boolean;
}

export class Scroll extends Component {
	private scrollX = 0;
	private scrollY = 0;
	private contentWidth = 0;
	private contentHeight = 0;
	private showScrollbar: boolean;

	constructor(props: ScrollProps = {}) {
		super();
		this.key = props.key;
		this.scrollX = props.scrollX ?? 0;
		this.scrollY = props.scrollY ?? 0;
		this.contentWidth = props.contentWidth ?? 0;
		this.contentHeight = props.contentHeight ?? 0;
		this.showScrollbar = props.showScrollbar ?? true;
	}

	/** Scroll to an absolute position. */
	scrollTo(x: number, y: number): void {
		this.scrollX = Math.max(0, x);
		this.scrollY = Math.max(0, y);
		this.clampScroll();
		this.markDirty();
	}

	/** Scroll by a relative offset. */
	scrollBy(dx: number, dy: number): void {
		this.scrollTo(this.scrollX + dx, this.scrollY + dy);
	}

	/** Scroll to ensure a row is visible. */
	scrollToRow(row: number): void {
		const rect = this.getLayoutRect();
		const viewportHeight = rect.height;

		if (row < this.scrollY) {
			this.scrollY = row;
		} else if (row >= this.scrollY + viewportHeight) {
			this.scrollY = row - viewportHeight + 1;
		}
		this.clampScroll();
		this.markDirty();
	}

	/** Scroll to the bottom. */
	scrollToBottom(): void {
		const rect = this.getLayoutRect();
		this.scrollY = Math.max(0, this.contentHeight - rect.height);
		this.markDirty();
	}

	/** Update content dimensions. */
	setContentSize(width: number, height: number): void {
		this.contentWidth = width;
		this.contentHeight = height;
		this.clampScroll();
		this.markDirty();
	}

	/** Get current scroll position. */
	getScroll(): { x: number; y: number } {
		return { x: this.scrollX, y: this.scrollY };
	}

	private clampScroll(): void {
		const rect = this.getLayoutRect();
		this.scrollX = Math.max(0, Math.min(this.scrollX, Math.max(0, this.contentWidth - rect.width)));
		this.scrollY = Math.max(0, Math.min(this.scrollY, Math.max(0, this.contentHeight - rect.height)));
	}

	render(screen: Screen, rect: Rect): void {
		// Children are rendered with an offset by the parent reconciler.
		// Here we just render the scrollbar if enabled.
		if (!this.showScrollbar || this.contentHeight <= rect.height) return;

		const barCol = rect.x + rect.width - 1;
		const ratio = rect.height / this.contentHeight;
		const thumbHeight = Math.max(1, Math.round(ratio * rect.height));
		const thumbOffset = Math.round(
			(this.scrollY / Math.max(1, this.contentHeight - rect.height)) * (rect.height - thumbHeight),
		);

		for (let row = 0; row < rect.height; row++) {
			const isThumb = row >= thumbOffset && row < thumbOffset + thumbHeight;
			screen.set(rect.y + row, barCol, {
				char: isThumb ? "█" : "░",
				fg: isThumb ? 7 : 8,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}
	}
}
