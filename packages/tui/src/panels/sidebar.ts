/**
 * SidebarPanel — collapsible side panel showing modified files,
 * session info, and keybind hints.
 */

import type { Rect } from "@takumi/core";
import type { ListItem, Screen } from "@takumi/render";
import { Border, Component, effect, List } from "@takumi/render";
import type { ExtensionUiStore } from "../extension-ui-store.js";
import type { AppState } from "../state.js";
import { ClusterStatusPanel } from "./cluster-status.js";
import { ExtensionWidgetsPanel } from "./extension-widgets-panel.js";
import { LaneTrackerPanel } from "./lane-tracker.js";
import { RouteCardPanel } from "./route-card.js";
import { SabhaPanel } from "./sabha-panel.js";
import { SideLanesPanel } from "./side-lanes-panel.js";

export interface SidebarPanelProps {
	state: AppState;
	extensionUiStore?: ExtensionUiStore;
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
	/** Cluster status widget — toggle with Ctrl+Shift+C. */
	readonly clusterPanel: ClusterStatusPanel;
	/** Route card — latest routing decision with authority/enforcement badges. */
	readonly routeCard: RouteCardPanel;
	/** Lane tracker — recent routing history shown as lanes. */
	readonly laneTracker: LaneTrackerPanel;
	/** Side-lane tracker — active workflow side agents surfaced in the sidebar. */
	readonly sideLanesPanel: SideLanesPanel;
	/** Sabha panel — deliberation council state and predictions. */
	readonly sabhaPanel: SabhaPanel;
	/** Extension widgets panel — host-owned sidebar surface for extension widgets. */
	readonly extensionWidgetsPanel: ExtensionWidgetsPanel | null;

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
				return undefined;
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
				return undefined;
			}),
		);

		this.clusterPanel = new ClusterStatusPanel({ state: props.state });
		this.routeCard = new RouteCardPanel({ state: props.state });
		this.laneTracker = new LaneTrackerPanel({ state: props.state, maxLanes: 4 });
		this.sideLanesPanel = new SideLanesPanel({ state: props.state, maxLanes: 2 });
		this.sabhaPanel = new SabhaPanel({ state: props.state });
		this.extensionWidgetsPanel = props.extensionUiStore
			? new ExtensionWidgetsPanel({ extensionUiStore: props.extensionUiStore })
			: null;
	}

	onUnmount(): void {
		for (const dispose of this.disposeEffects) {
			dispose();
		}
		this.disposeEffects = [];
		this.clusterPanel.onUnmount();
		this.routeCard.onUnmount();
		this.laneTracker.onUnmount();
		this.sideLanesPanel.onUnmount();
		this.sabhaPanel.onUnmount();
		this.extensionWidgetsPanel?.onUnmount();
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
		const reservedAfterFiles =
			this.computeFixedSectionHeight() +
			this.computeTrailingPanelHeight(
				this.clusterPanel.height,
				this.routeCard.height,
				this.laneTracker.height,
				this.sideLanesPanel.height,
				this.sabhaPanel.height,
				this.extensionWidgetsPanel?.measure(innerW) ?? 0,
			);
		if (files.length === 0) {
			screen.writeText(cursorY, innerX, "(no files)", { fg: 8, dim: true });
			cursorY++;
		} else {
			const fileAreaHeight = Math.min(files.length, maxY - cursorY - reservedAfterFiles);
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

		// ── Section: Cluster Status ────────────────────────────────────
		const clusterHeight = this.clusterPanel.height;
		if (clusterHeight > 0 && cursorY + clusterHeight <= maxY) {
			cursorY += SECTION_GAP;
			if (cursorY < maxY) {
				this.clusterPanel.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: clusterHeight,
				});
				cursorY += clusterHeight;
			}
		}

		// ── Section: Route Card ────────────────────────────────────────────
		const routeHeight = this.routeCard.height;
		if (routeHeight > 0 && cursorY + routeHeight <= maxY) {
			cursorY += SECTION_GAP;
			if (cursorY < maxY) {
				this.routeCard.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: routeHeight,
				});
				cursorY += routeHeight;
			}
		}

		// ── Section: Lane Tracker ──────────────────────────────────────────
		const laneHeight = this.laneTracker.height;
		if (laneHeight > 0 && cursorY + laneHeight <= maxY) {
			cursorY += SECTION_GAP;
			if (cursorY < maxY) {
				this.laneTracker.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: laneHeight,
				});
				cursorY += laneHeight;
			}
		}

		// ── Section: Side Lanes ────────────────────────────────────────────
		const sideLaneHeight = this.sideLanesPanel.height;
		if (sideLaneHeight > 0 && cursorY + sideLaneHeight <= maxY) {
			cursorY += SECTION_GAP;
			if (cursorY < maxY) {
				this.sideLanesPanel.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: sideLaneHeight,
				});
				cursorY += sideLaneHeight;
			}
		}

		// ── Section: Sabha Panel ───────────────────────────────────────────
		const sabhaHeight = this.sabhaPanel.height;
		if (sabhaHeight > 0 && cursorY + sabhaHeight <= maxY) {
			cursorY += SECTION_GAP;
			if (cursorY < maxY) {
				this.sabhaPanel.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: sabhaHeight,
				});
			}
		}

		// ── Section: Extension Widgets ───────────────────────────────────────
		const widgetHeight = this.extensionWidgetsPanel?.measure(innerW) ?? 0;
		if (this.extensionWidgetsPanel && widgetHeight > 0 && cursorY + widgetHeight <= maxY) {
			cursorY += SECTION_GAP;
			if (cursorY < maxY) {
				this.extensionWidgetsPanel.render(screen, {
					x: innerX,
					y: cursorY,
					width: innerW,
					height: widgetHeight,
				});
			}
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
		return `${text.slice(0, width - 1)}\u2026`;
	}

	/** Height reserved for the fixed session + keybind sections below the file list. */
	private computeFixedSectionHeight(): number {
		return (
			SECTION_GAP + SECTION_HEADER_HEIGHT + SESSION_INFO_ROWS + SECTION_GAP + SECTION_HEADER_HEIGHT + KEYBIND_HINT_ROWS
		);
	}

	/** Height reserved for dynamic panels below the fixed sections, including gaps. */
	private computeTrailingPanelHeight(...panelHeights: number[]): number {
		return panelHeights.reduce((total, height) => total + (height > 0 ? SECTION_GAP + height : 0), 0);
	}
}
