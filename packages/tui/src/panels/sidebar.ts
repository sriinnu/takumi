/**
 * SidebarPanel — collapsible side panel for file tree, history, etc.
 */

import type { Rect } from "@takumi/core";
import { Component, Border, List } from "@takumi/render";
import type { Screen } from "@takumi/render";
import type { ListItem } from "@takumi/render";
import type { AppState } from "../state.js";

export interface SidebarPanelProps {
	state: AppState;
	width?: number;
}

export class SidebarPanel extends Component {
	private state: AppState;
	private sidebarWidth: number;
	private border: Border;
	private list: List;
	private items: ListItem[] = [];

	constructor(props: SidebarPanelProps) {
		super();
		this.state = props.state;
		this.sidebarWidth = props.width ?? 30;

		this.border = new Border({
			style: "single",
			title: "Files",
			color: 8,
			titleColor: 15,
		});

		this.list = new List({
			items: [],
			selectedColor: 15,
			selectedBg: 4,
		});
	}

	/** Set the items displayed in the sidebar. */
	setItems(items: ListItem[]): void {
		this.items = items;
		this.list.setItems(items);
		this.markDirty();
	}

	/** Select previous item. */
	selectPrev(): void {
		this.list.selectPrev();
	}

	/** Select next item. */
	selectNext(): void {
		this.list.selectNext();
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

		// Draw border
		this.border.render(screen, sidebarRect);

		// Draw list inside border
		if (sidebarRect.width > 2 && sidebarRect.height > 2) {
			this.list.render(screen, {
				x: sidebarRect.x + 1,
				y: sidebarRect.y + 1,
				width: sidebarRect.width - 2,
				height: sidebarRect.height - 2,
			});
		}
	}
}
