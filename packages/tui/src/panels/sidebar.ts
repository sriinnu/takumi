/**
 * SidebarPanel — collapsible side panel showing modified files,
 * session info, and keybind hints.
 */

import type { Rect } from "@takumi/core";
import { Component, Border, List } from "@takumi/render";
import type { Screen } from "@takumi/render";
import type { ListItem } from "@takumi/render";
import { effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface SidebarPanelProps {
	state: AppState;
	width?: number;
}

/** Section header row height. */
const SECTION_HEADER_HEIGHT = 1;
/** Session info rows. */
const SESSION_INFO_ROWS = 4;
/** Keybind hint rows. */
const KEYBIND_HINT_ROWS = 5;
/** Spacing between sections. */
const SECTION_GAP = 1;

export class SidebarPanel extends Component {
	private state: AppState;
	private sidebarWidth: number;
	private border: Border;
	private fileList: List;
	private disposeEffects: (() => void)[] = [];

	constructor(props: SidebarPanelProps) {
		super();
		this.state = props.state;
		this.sidebarWidth = props.width ?? 30;

		this.border = new Border({
			style: "single",
			title: "Sidebar",
			color: 8,
			titleColor: 15,
		});

		this.fileList = new List({
			items: [],
			selectedColor: 15,
			selectedBg: 4,
		});

		// React to file list changes
		this.disposeEffects.push(
			effect(() => {
				const files = this.state.modifiedFiles.value;
				const items: ListItem[] = files.map((f, i) => ({
					id: `file-${i}`,
					label: f,
					icon: "\u25CF",
				}));
				this.fileList.setItems(items);
				this.markDirty();
			}),
		);

		// React to usage/session changes
		this.disposeEffects.push(
			effect(() => {
				// Touch signals to subscribe
				this.state.turnCount.value;
				this.state.totalTokens.value;
				this.state.formattedCost.value;
				this.state.model.value;
				this.markDirty();
			}),
		);
	}

	onUnmount(): void {
		for (const dispose of this.disposeEffects) {
			dispose();
		}
		this.disposeEffects = [];
		super.onUnmount();
	}

	/** Set the items displayed in the file list manually. */
	setItems(items: ListItem[]): void {
		this.fileList.setItems(items);
		this.markDirty();
	}

	/** Select previous item. */
	selectPrev(): void {
		this.fileList.selectPrev();
	}

	/** Select next item. */
	selectNext(): void {
		this.fileList.selectNext();
	}

	get visible(): boolean {
		return this.state.sidebarVisible.value;
	}

	render(screen: Screen, rect: Rect): void {
		if (!this.state.sidebarVisible.value) return;

		const sidebarRect: Rect = {
			x: rect.x,
			y: rect.y,
			width: Math.min(this.sidebarWidth, rect.width),
			height: rect.height,
		};

		// Draw outer border
		this.border.render(screen, sidebarRect);

		const innerX = sidebarRect.x + 1;
		const innerW = sidebarRect.width - 2;
		let cursorY = sidebarRect.y + 1;
		const maxY = sidebarRect.y + sidebarRect.height - 1;

		if (innerW < 1 || cursorY >= maxY) return;

		// ── Section: Modified Files ──────────────────────────────────────
		cursorY = this.renderSectionHeader(screen, innerX, cursorY, innerW, "Modified Files", maxY);
		if (cursorY >= maxY) return;

		const files = this.state.modifiedFiles.value;
		if (files.length === 0) {
			screen.writeText(cursorY, innerX, "(no files)", { fg: 8, dim: true });
			cursorY++;
		} else {
			const fileAreaHeight = Math.min(files.length, maxY - cursorY - SESSION_INFO_ROWS - KEYBIND_HINT_ROWS - 2 * SECTION_GAP - 2 * SECTION_HEADER_HEIGHT);
			if (fileAreaHeight > 0) {
				this.fileList.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: fileAreaHeight,
				});
				cursorY += fileAreaHeight;
			}
		}

		cursorY += SECTION_GAP;
		if (cursorY >= maxY) return;

		// ── Section: Session Info ────────────────────────────────────────
		cursorY = this.renderSectionHeader(screen, innerX, cursorY, innerW, "Session", maxY);
		if (cursorY >= maxY) return;

		const sessionRows = [
			`Model: ${this.truncField(this.state.model.value, innerW - 7)}`,
			`Turns: ${this.state.turnCount.value}`,
			`Tokens: ${this.state.totalTokens.value}`,
			`Cost: ${this.state.formattedCost.value}`,
		];

		for (const row of sessionRows) {
			if (cursorY >= maxY) break;
			screen.writeText(cursorY, innerX, this.truncField(row, innerW), { fg: 7 });
			cursorY++;
		}

		cursorY += SECTION_GAP;
		if (cursorY >= maxY) return;

		// ── Section: Keybinds ────────────────────────────────────────────
		cursorY = this.renderSectionHeader(screen, innerX, cursorY, innerW, "Keybinds", maxY);
		if (cursorY >= maxY) return;

		const keybinds = [
			["Ctrl+Q", "Quit"],
			["Ctrl+L", "Redraw"],
			["Ctrl+C", "Cancel/Quit"],
			["/help", "Commands"],
			["/sidebar", "Toggle"],
		];

		for (const [key, desc] of keybinds) {
			if (cursorY >= maxY) break;
			const keyStr = key.padEnd(9);
			const text = this.truncField(`${keyStr} ${desc}`, innerW);
			screen.writeText(cursorY, innerX, text, { fg: 8 });
			cursorY++;
		}
	}

	/** Render a section header with dimmed separator line. Returns next Y. */
	private renderSectionHeader(
		screen: Screen,
		x: number,
		y: number,
		width: number,
		title: string,
		maxY: number,
	): number {
		if (y >= maxY) return y;
		const header = title.toUpperCase();
		const truncated = header.length > width ? header.slice(0, width) : header;
		screen.writeText(y, x, truncated, { fg: 6, bold: true });
		return y + SECTION_HEADER_HEIGHT;
	}

	/** Truncate a string to fit within the given width. */
	private truncField(text: string, width: number): string {
		if (text.length <= width) return text;
		return text.slice(0, width - 1) + "\u2026";
	}
}
