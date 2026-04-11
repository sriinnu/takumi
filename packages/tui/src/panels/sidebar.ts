/**
 * SidebarPanel — collapsible side panel showing modified files, session info,
 * operator cockpit state, and keybind hints.
 */

import type { Rect } from "@takumi/core";
import type { ListItem, Screen } from "@takumi/render";
import { Border, Component, effect, List } from "@takumi/render";
import type { ExtensionUiStore } from "../extension-ui-store.js";
import type { AppState } from "../state.js";
import { ClusterStatusPanel } from "./cluster-status.js";
import { ExtensionWidgetsPanel } from "./extension-widgets-panel.js";
import { OperatorBoardPanel } from "./operator-board.js";
import { SabhaPanel } from "./sabha-panel.js";

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
	private readonly state: AppState;
	private readonly sidebarWidth: number;
	private readonly border: Border;
	private readonly fileList: List;
	private disposeEffects: (() => void)[] = [];
	/** Cluster status widget — toggle with Ctrl+Shift+C. */
	readonly clusterPanel: ClusterStatusPanel;
	/** Operator board — canonical read-only route/sync/review/lane cockpit. */
	readonly operatorBoard: OperatorBoardPanel;
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
		this.fileList = new List({ items: [] });
		this.clusterPanel = new ClusterStatusPanel({ state: props.state });
		this.operatorBoard = new OperatorBoardPanel({
			state: props.state,
			maxRecentRoutes: 2,
			maxSideLanes: 2,
		});
		this.sabhaPanel = new SabhaPanel({ state: props.state });
		this.extensionWidgetsPanel = props.extensionUiStore
			? new ExtensionWidgetsPanel({ extensionUiStore: props.extensionUiStore })
			: null;

		this.disposeEffects.push(
			effect(() => {
				const items: ListItem[] = this.state.modifiedFiles.value.map((filePath, index) => ({
					id: `file-${index}`,
					label: filePath,
					icon: "●",
				}));
				this.fileList.setItems(items);
				this.markDirty();
				return undefined;
			}),
		);

		this.disposeEffects.push(
			effect(() => {
				void this.state.turnCount.value;
				void this.state.totalTokens.value;
				void this.state.formattedCost.value;
				void this.state.model.value;
				this.markDirty();
				return undefined;
			}),
		);
	}

	onUnmount(): void {
		for (const dispose of this.disposeEffects) {
			dispose();
		}
		this.disposeEffects = [];
		this.clusterPanel.onUnmount();
		this.operatorBoard.onUnmount();
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

		this.border.render(screen, sidebarRect);

		const innerX = sidebarRect.x + 1;
		const innerW = sidebarRect.width - 2;
		let cursorY = sidebarRect.y + 1;
		const maxY = sidebarRect.y + sidebarRect.height - 1;
		if (innerW < 1 || cursorY >= maxY) return;

		cursorY = this.renderSectionHeader(screen, innerX, cursorY, innerW, "Modified Files", maxY);
		if (cursorY >= maxY) return;

		const files = this.state.modifiedFiles.value;
		const reservedAfterFiles = this.computeFixedSectionHeight() + this.computeDynamicPanelHeight(innerW);
		if (files.length === 0) {
			screen.writeText(cursorY, innerX, "(no files)", { fg: 8, dim: true });
			cursorY++;
		} else {
			const availableRows = Math.max(0, maxY - cursorY - reservedAfterFiles);
			const fileAreaHeight = Math.min(files.length, availableRows);
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

		cursorY = this.renderDynamicPanel(
			screen,
			innerX,
			innerW,
			cursorY,
			maxY,
			this.operatorBoard,
			this.operatorBoard.height,
		);
		cursorY += SECTION_GAP;
		if (cursorY >= maxY) return;

		cursorY = this.renderSectionHeader(screen, innerX, cursorY, innerW, "Keybinds", maxY);
		if (cursorY >= maxY) return;

		for (const [key, desc] of this.getKeybindRows()) {
			if (cursorY >= maxY) break;
			screen.writeText(cursorY, innerX, this.truncField(`${key.padEnd(9)} ${desc}`, innerW), { fg: 8 });
			cursorY++;
		}

		cursorY = this.renderDynamicPanel(
			screen,
			innerX,
			innerW,
			cursorY,
			maxY,
			this.clusterPanel,
			this.clusterPanel.height,
		);
		cursorY = this.renderDynamicPanel(screen, innerX, innerW, cursorY, maxY, this.sabhaPanel, this.sabhaPanel.height);
		cursorY = this.renderDynamicPanel(
			screen,
			innerX,
			innerW,
			cursorY,
			maxY,
			this.extensionWidgetsPanel,
			this.extensionWidgetsPanel?.measure(innerW) ?? 0,
		);
	}

	/** Render a section header and return the next cursor row. */
	private renderSectionHeader(
		screen: Screen,
		x: number,
		y: number,
		width: number,
		title: string,
		maxY: number,
	): number {
		if (y >= maxY) return y;
		screen.writeText(y, x, this.truncField(title.toUpperCase(), width), { fg: 6, bold: true });
		return y + SECTION_HEADER_HEIGHT;
	}

	/** Render a dynamic panel when it has height and fits in the remaining viewport. */
	private renderDynamicPanel(
		screen: Screen,
		x: number,
		width: number,
		cursorY: number,
		maxY: number,
		panel: Pick<Component, "render"> | null,
		height: number,
	): number {
		if (!panel || height <= 0) return cursorY;
		if (cursorY + SECTION_GAP + height > maxY) return cursorY;
		cursorY += SECTION_GAP;
		if (cursorY >= maxY) return cursorY;
		panel.render(screen, {
			x,
			y: cursorY,
			width,
			height,
		});
		return cursorY + height;
	}

	/** Reserve space below the file list for fixed session and keybind rows. */
	private computeFixedSectionHeight(): number {
		return (
			SECTION_GAP + SECTION_HEADER_HEIGHT + SESSION_INFO_ROWS + SECTION_GAP + SECTION_HEADER_HEIGHT + KEYBIND_HINT_ROWS
		);
	}

	/** Reserve rows used by optional panels below the fixed sections. */
	private computeDynamicPanelHeight(width: number): number {
		return [
			this.operatorBoard.height,
			this.clusterPanel.height,
			this.sabhaPanel.height,
			this.extensionWidgetsPanel?.measure(width) ?? 0,
		].reduce((total, height) => total + (height > 0 ? SECTION_GAP + height : 0), 0);
	}

	/** Shared keybind rows so the render path stays predictable. */
	private getKeybindRows(): Array<[string, string]> {
		return [
			["Ctrl+Q", "Quit"],
			["Ctrl+L", "Redraw"],
			["Ctrl+P", "Preview"],
			["Ctrl+K", "Commands"],
			["/sidebar", "Toggle"],
		];
	}

	/** Truncate text to fit the available width. */
	private truncField(text: string, width: number): string {
		if (text.length <= width) return text;
		if (width <= 1) return text.slice(0, width);
		return `${text.slice(0, width - 1)}…`;
	}
}
