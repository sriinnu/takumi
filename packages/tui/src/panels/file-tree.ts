/**
 * FileTreePanel -- collapsible directory tree sidebar for project navigation.
 */

import { join } from "node:path";
import type { KeyEvent, Rect } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Screen, Signal } from "@takumi/render";
import { Border, Component, effect, signal } from "@takumi/render";
import type { AppState } from "../state.js";
import {
	applyGitStatus,
	type FileNode,
	type FlatRow,
	flattenTree,
	formatRow,
	loadGitignore,
	scanDirectory,
} from "./file-tree-helpers.js";

export type { FileNode, FlatRow, TreePart } from "./file-tree-helpers.js";
export {
	applyGitStatus,
	flattenTree,
	formatRow,
	loadGitignore,
	matchesGitignore,
	parseGitignore,
	scanDirectory,
} from "./file-tree-helpers.js";

export interface FileTreePanelProps {
	state: AppState;
	rootPath?: string;
	width?: number;
	onFileSelect?: (filePath: string) => void;
}

const MAX_DEPTH = 5;

export class FileTreePanel extends Component {
	private state: AppState;
	private panelWidth: number;
	private border: Border;
	private disposeEffects: (() => void)[] = [];
	private onFileSelect: ((filePath: string) => void) | null;

	readonly files: Signal<FileNode[]> = signal<FileNode[]>([]);
	readonly selectedIndex: Signal<number> = signal(0);
	readonly scrollOffset: Signal<number> = signal(0);
	readonly expandedDirs: Signal<Set<string>> = signal(new Set<string>());
	readonly rootPath: Signal<string>;

	private flatRows: FlatRow[] = [];
	private viewportHeight = 20;

	constructor(props: FileTreePanelProps) {
		super();
		this.state = props.state;
		this.panelWidth = props.width ?? 30;
		this.rootPath = signal(props.rootPath ?? process.cwd());
		this.onFileSelect = props.onFileSelect ?? null;
		this.border = new Border({ style: "single", title: "Files", color: 8, titleColor: 15 });

		this.disposeEffects.push(
			effect(() => {
				void this.files.value;
				void this.expandedDirs.value;
				this.flatRows = flattenTree(this.files.value, this.expandedDirs.value);
				this.markDirty();
				return undefined;
			}),
		);

		this.disposeEffects.push(
			effect(() => {
				void this.selectedIndex.value;
				void this.scrollOffset.value;
				this.markDirty();
				return undefined;
			}),
		);
	}

	onUnmount(): void {
		for (const dispose of this.disposeEffects) dispose();
		this.disposeEffects = [];
		super.onUnmount();
	}

	/** Scan the project directory and update the tree. */
	async scan(): Promise<void> {
		const root = this.rootPath.value;
		const patterns = await loadGitignore(root);
		this.files.value = await scanDirectory(root, MAX_DEPTH, patterns);
	}

	/** Refresh git status markers on the existing tree. */
	refreshGitStatus(modified: string[], staged: string[]): void {
		const tree = this.files.value;
		if (tree.length === 0) return;
		applyGitStatus(tree, modified, staged);
		this.files.value = [...tree];
	}

	selectPrev(): void {
		if (this.selectedIndex.value <= 0) return;
		this.selectedIndex.value--;
		this.ensureVisible();
	}

	selectNext(): void {
		if (this.selectedIndex.value >= this.flatRows.length - 1) return;
		this.selectedIndex.value++;
		this.ensureVisible();
	}

	toggleExpand(): void {
		const row = this.flatRows[this.selectedIndex.value];
		if (!row || !row.node.isDirectory) return;

		const expanded = new Set(this.expandedDirs.value);
		if (expanded.has(row.node.path)) expanded.delete(row.node.path);
		else expanded.add(row.node.path);
		this.expandedDirs.value = expanded;

		if (this.selectedIndex.value >= this.flatRows.length) {
			this.selectedIndex.value = Math.max(0, this.flatRows.length - 1);
		}
	}

	/** Handle Enter: toggle dir or select file. */
	confirmSelection(): string | null {
		const row = this.flatRows[this.selectedIndex.value];
		if (!row) return null;
		if (row.node.isDirectory) {
			this.toggleExpand();
			return null;
		}

		const fullPath = join(this.rootPath.value, row.node.path).replace(/\\/g, "/");
		this.onFileSelect?.(fullPath);
		return fullPath;
	}

	handleKey(event: KeyEvent): boolean {
		switch (event.raw) {
			case KEY_CODES.UP:
				this.selectPrev();
				return true;
			case KEY_CODES.DOWN:
				this.selectNext();
				return true;
			case KEY_CODES.ENTER:
				this.confirmSelection();
				return true;
			case " ":
				this.toggleExpand();
				return true;
			case KEY_CODES.PAGE_UP: {
				const jump = Math.max(1, this.viewportHeight - 2);
				this.selectedIndex.value = Math.max(0, this.selectedIndex.value - jump);
				this.ensureVisible();
				return true;
			}
			case KEY_CODES.PAGE_DOWN: {
				const jump = Math.max(1, this.viewportHeight - 2);
				this.selectedIndex.value = Math.min(this.flatRows.length - 1, this.selectedIndex.value + jump);
				this.ensureVisible();
				return true;
			}
			default:
				return false;
		}
	}

	getSelectedRow(): FlatRow | null {
		return this.flatRows[this.selectedIndex.value] ?? null;
	}

	get visibleRowCount(): number {
		return this.flatRows.length;
	}

	private ensureVisible(): void {
		const sel = this.selectedIndex.value;
		const offset = this.scrollOffset.value;
		const visible = this.viewportHeight;
		if (sel < offset) this.scrollOffset.value = sel;
		else if (sel >= offset + visible) this.scrollOffset.value = sel - visible + 1;
	}

	render(screen: Screen, rect: Rect): void {
		if (!this.state.sidebarVisible.value) return;

		const panelRect: Rect = {
			x: rect.x,
			y: rect.y,
			width: Math.min(this.panelWidth, rect.width),
			height: rect.height,
		};
		this.border.render(screen, panelRect);

		const innerX = panelRect.x + 1;
		const innerW = panelRect.width - 2;
		const innerY = panelRect.y + 1;
		const innerH = panelRect.height - 2;
		if (innerW < 1 || innerH < 1) return;
		this.viewportHeight = innerH;

		if (this.flatRows.length === 0) {
			screen.writeText(innerY, innerX, "(empty)", { fg: 8, dim: true });
			return;
		}

		const maxOffset = Math.max(0, this.flatRows.length - innerH);
		if (this.scrollOffset.value > maxOffset) this.scrollOffset.value = maxOffset;

		const startIdx = this.scrollOffset.value;
		const selectedIdx = this.selectedIndex.value;

		for (let i = 0; i < innerH; i++) {
			const rowIdx = startIdx + i;
			if (rowIdx >= this.flatRows.length) break;
			const row = this.flatRows[rowIdx];
			const isSelected = rowIdx === selectedIdx;
			const lineText = formatRow(row, innerW);

			if (isSelected) {
				screen.writeText(innerY + i, innerX, lineText.padEnd(innerW), { fg: 0, bg: 7, bold: true });
				continue;
			}

			let fg = -1;
			if (row.node.modified) fg = 3;
			else if (row.node.staged) fg = 2;
			else if (row.node.isDirectory) fg = 4;
			screen.writeText(innerY + i, innerX, lineText, { fg, dim: false, bold: row.node.isDirectory });
		}

		if (this.flatRows.length <= innerH) return;

		const scrollbarHeight = Math.max(1, Math.floor((innerH * innerH) / this.flatRows.length));
		const scrollbarPos = Math.floor((startIdx * (innerH - scrollbarHeight)) / maxOffset);
		for (let i = 0; i < scrollbarHeight; i++) {
			const row = innerY + scrollbarPos + i;
			if (row < innerY + innerH) {
				screen.writeText(row, panelRect.x + panelRect.width - 1, "\u2588", { fg: 8 });
			}
		}
	}
}
