/**
 * FileTreePanel -- collapsible directory tree sidebar for project navigation.
 *
 * Shows the project directory tree with expand/collapse, git status markers,
 * and keyboard navigation. File selection adds context to the conversation.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyEvent, Rect } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Screen, Signal } from "@takumi/render";
import { Border, Component, effect, signal } from "@takumi/render";
import type { AppState } from "../state.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileNode {
	name: string;
	/** Path relative to root. */
	path: string;
	isDirectory: boolean;
	children?: FileNode[];
	depth: number;
	modified?: boolean;
	staged?: boolean;
}

/** Flattened visible row used for rendering and navigation. */
export interface FlatRow {
	node: FileNode;
	indent: number;
	isExpanded?: boolean;
	isLastChild: boolean;
	/** Prefix characters showing tree structure. */
	treeParts: TreePart[];
}

export type TreePart = "pipe" | "tee" | "corner" | "blank";

export interface FileTreePanelProps {
	state: AppState;
	rootPath?: string;
	width?: number;
	onFileSelect?: (filePath: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Directories always skipped regardless of .gitignore. */
const ALWAYS_SKIP = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"__pycache__",
	".cache",
	".turbo",
	".parcel-cache",
	"coverage",
]);

const MAX_DEPTH = 5;

/** Tree-drawing Unicode characters. */
const TREE_CHARS = {
	pipe: "\u2502 ", // │
	tee: "\u251C\u2500", // ├─
	corner: "\u2514\u2500", // └─
	blank: "  ",
} as const;

// ── Directory scanner ────────────────────────────────────────────────────────

/**
 * Parse a .gitignore file into a set of glob-like patterns.
 * Returns simple base-name patterns only (no path separators).
 */
export function parseGitignore(content: string): string[] {
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

/**
 * Check if a filename matches a simple .gitignore pattern.
 * Supports trailing slash (dir only), leading !, and basic glob *.
 */
export function matchesGitignore(name: string, isDir: boolean, patterns: string[]): boolean {
	for (const raw of patterns) {
		let pattern = raw;
		// Negation patterns not supported for simplicity
		if (pattern.startsWith("!")) continue;

		// Strip trailing slash (means directory only)
		const dirOnly = pattern.endsWith("/");
		if (dirOnly) {
			pattern = pattern.slice(0, -1);
			if (!isDir) continue;
		}

		// Strip leading slash (root-anchored) — treat as base match
		if (pattern.startsWith("/")) {
			pattern = pattern.slice(1);
		}

		// Exact match
		if (name === pattern) return true;

		// Glob: *.ext
		if (pattern.startsWith("*.")) {
			const ext = pattern.slice(1); // ".ext"
			if (name.endsWith(ext)) return true;
		}

		// Glob: prefix*
		if (pattern.endsWith("*")) {
			const prefix = pattern.slice(0, -1);
			if (name.startsWith(prefix)) return true;
		}
	}
	return false;
}

/**
 * Scan a directory tree recursively, respecting .gitignore patterns.
 * Returns a sorted tree of FileNode objects (directories first, then alpha).
 */
export async function scanDirectory(
	root: string,
	maxDepth: number = MAX_DEPTH,
	gitignorePatterns: string[] = [],
	currentDepth: number = 0,
	relativePath: string = "",
): Promise<FileNode[]> {
	if (currentDepth > maxDepth) return [];

	let entries: import("node:fs").Dirent[];
	try {
		entries = (await readdir(join(root, relativePath), {
			withFileTypes: true,
			encoding: "utf-8",
		})) as unknown as import("node:fs").Dirent[];
	} catch {
		return [];
	}

	const nodes: FileNode[] = [];

	for (const entry of entries) {
		const name = String(entry.name);
		const isDir = entry.isDirectory();
		const entryRelPath = relativePath ? `${relativePath}/${name}` : name;

		// Always skip
		if (ALWAYS_SKIP.has(name as string)) continue;

		// .gitignore match
		if (matchesGitignore(name as string, isDir, gitignorePatterns)) continue;

		const node: FileNode = {
			name: name as string,
			path: entryRelPath as string,
			isDirectory: isDir,
			depth: currentDepth,
		};

		if (isDir) {
			node.children = await scanDirectory(root, maxDepth, gitignorePatterns, currentDepth + 1, entryRelPath as string);
		}

		nodes.push(node);
	}

	// Sort: directories first, then alphabetical (case-insensitive)
	nodes.sort((a, b) => {
		if (a.isDirectory && !b.isDirectory) return -1;
		if (!a.isDirectory && b.isDirectory) return 1;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

	return nodes;
}

/**
 * Load .gitignore patterns from the project root.
 */
export async function loadGitignore(root: string): Promise<string[]> {
	try {
		const content = await readFile(join(root, ".gitignore"), "utf-8");
		return parseGitignore(content);
	} catch {
		return [];
	}
}

// ── Flattening ───────────────────────────────────────────────────────────────

/**
 * Flatten the tree into visible rows based on which directories are expanded.
 */
export function flattenTree(nodes: FileNode[], expandedDirs: Set<string>, parentParts: TreePart[] = []): FlatRow[] {
	const rows: FlatRow[] = [];

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		const isLast = i === nodes.length - 1;
		const treeParts = [...parentParts];
		const isExpanded = node.isDirectory && expandedDirs.has(node.path);

		rows.push({
			node,
			indent: node.depth,
			isExpanded: node.isDirectory ? isExpanded : undefined,
			isLastChild: isLast,
			treeParts: [...treeParts, (isLast ? "corner" : "tee") as TreePart],
		});

		// Recurse into expanded directories
		if (isExpanded && node.children && node.children.length > 0) {
			const childParts: TreePart[] = [...parentParts, (isLast ? "blank" : "pipe") as TreePart];
			const childRows = flattenTree(node.children, expandedDirs, childParts);
			rows.push(...childRows);
		}
	}

	return rows;
}

// ── Git status helpers ───────────────────────────────────────────────────────

/**
 * Apply git status markers (modified/staged) to a file tree.
 */
export function applyGitStatus(nodes: FileNode[], modified: string[], staged: string[]): void {
	const modifiedSet = new Set(modified);
	const stagedSet = new Set(staged);

	function walk(nodeList: FileNode[]): void {
		for (const node of nodeList) {
			if (!node.isDirectory) {
				node.modified = modifiedSet.has(node.path);
				node.staged = stagedSet.has(node.path);
			}
			if (node.children) {
				walk(node.children);
			}
		}
	}
	walk(nodes);
}

// ── Panel ────────────────────────────────────────────────────────────────────

export class FileTreePanel extends Component {
	private state: AppState;
	private panelWidth: number;
	private border: Border;
	private disposeEffects: (() => void)[] = [];
	private onFileSelect: ((filePath: string) => void) | null;

	// Reactive state
	readonly files: Signal<FileNode[]> = signal<FileNode[]>([]);
	readonly selectedIndex: Signal<number> = signal(0);
	readonly scrollOffset: Signal<number> = signal(0);
	readonly expandedDirs: Signal<Set<string>> = signal(new Set<string>());
	readonly rootPath: Signal<string>;

	/** Cached flattened rows. */
	private flatRows: FlatRow[] = [];
	/** Last known panel height for scroll calculations. */
	private viewportHeight = 20;

	constructor(props: FileTreePanelProps) {
		super();
		this.state = props.state;
		this.panelWidth = props.width ?? 30;
		this.rootPath = signal(props.rootPath ?? process.cwd());
		this.onFileSelect = props.onFileSelect ?? null;

		this.border = new Border({
			style: "single",
			title: "Files",
			color: 8,
			titleColor: 15,
		});

		// Re-flatten and re-render when files or expanded dirs change
		this.disposeEffects.push(
			effect(() => {
				const _files = this.files.value;
				const _expanded = this.expandedDirs.value;
				this.flatRows = flattenTree(this.files.value, this.expandedDirs.value);
				this.markDirty();
				return undefined;
			}),
		);

		// React to selection changes
		this.disposeEffects.push(
			effect(() => {
				const _sel = this.selectedIndex.value;
				const _off = this.scrollOffset.value;
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
		super.onUnmount();
	}

	/** Scan the project directory and update the tree. */
	async scan(): Promise<void> {
		const root = this.rootPath.value;
		const patterns = await loadGitignore(root);
		const tree = await scanDirectory(root, MAX_DEPTH, patterns);
		this.files.value = tree;
	}

	/**
	 * Refresh git status markers on the existing tree.
	 * Expects arrays of relative paths from gitStatus().
	 */
	refreshGitStatus(modified: string[], staged: string[]): void {
		const tree = this.files.value;
		if (tree.length === 0) return;
		applyGitStatus(tree, modified, staged);
		// Trigger re-render by assigning a new reference
		this.files.value = [...tree];
	}

	/** Navigate selection up. */
	selectPrev(): void {
		if (this.selectedIndex.value > 0) {
			this.selectedIndex.value--;
			this.ensureVisible();
		}
	}

	/** Navigate selection down. */
	selectNext(): void {
		if (this.selectedIndex.value < this.flatRows.length - 1) {
			this.selectedIndex.value++;
			this.ensureVisible();
		}
	}

	/** Toggle expand/collapse of the selected directory. */
	toggleExpand(): void {
		const row = this.flatRows[this.selectedIndex.value];
		if (!row || !row.node.isDirectory) return;

		const expanded = new Set(this.expandedDirs.value);
		if (expanded.has(row.node.path)) {
			expanded.delete(row.node.path);
		} else {
			expanded.add(row.node.path);
		}
		this.expandedDirs.value = expanded;

		// Clamp selected index after re-flatten
		if (this.selectedIndex.value >= this.flatRows.length) {
			this.selectedIndex.value = Math.max(0, this.flatRows.length - 1);
		}
	}

	/**
	 * Handle Enter key: toggle directory or select file.
	 * Returns the selected file path (relative) or null for directories.
	 */
	confirmSelection(): string | null {
		const row = this.flatRows[this.selectedIndex.value];
		if (!row) return null;

		if (row.node.isDirectory) {
			this.toggleExpand();
			return null;
		}

		// File selected -- notify callback (normalize to forward slashes for cross-platform)
		const fullPath = join(this.rootPath.value, row.node.path).replace(/\\/g, "/");
		this.onFileSelect?.(fullPath);
		return fullPath;
	}

	/** Handle keyboard input. Returns true if consumed. */
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

	/** Get the currently selected flat row. */
	getSelectedRow(): FlatRow | null {
		return this.flatRows[this.selectedIndex.value] ?? null;
	}

	/** Get the count of visible (flattened) rows. */
	get visibleRowCount(): number {
		return this.flatRows.length;
	}

	/** Ensure the selected index is visible within the scroll viewport. */
	private ensureVisible(): void {
		const sel = this.selectedIndex.value;
		const offset = this.scrollOffset.value;
		const visible = this.viewportHeight;

		if (sel < offset) {
			this.scrollOffset.value = sel;
		} else if (sel >= offset + visible) {
			this.scrollOffset.value = sel - visible + 1;
		}
	}

	render(screen: Screen, rect: Rect): void {
		if (!this.state.sidebarVisible.value) return;

		const panelRect: Rect = {
			x: rect.x,
			y: rect.y,
			width: Math.min(this.panelWidth, rect.width),
			height: rect.height,
		};

		// Draw border
		this.border.render(screen, panelRect);

		const innerX = panelRect.x + 1;
		const innerW = panelRect.width - 2;
		const innerY = panelRect.y + 1;
		const innerH = panelRect.height - 2;

		if (innerW < 1 || innerH < 1) return;

		this.viewportHeight = innerH;

		// Empty state
		if (this.flatRows.length === 0) {
			screen.writeText(innerY, innerX, "(empty)", { fg: 8, dim: true });
			return;
		}

		// Clamp scroll offset
		const maxOffset = Math.max(0, this.flatRows.length - innerH);
		if (this.scrollOffset.value > maxOffset) {
			this.scrollOffset.value = maxOffset;
		}

		const startIdx = this.scrollOffset.value;
		const selectedIdx = this.selectedIndex.value;

		for (let i = 0; i < innerH; i++) {
			const rowIdx = startIdx + i;
			if (rowIdx >= this.flatRows.length) break;

			const row = this.flatRows[rowIdx];
			const isSelected = rowIdx === selectedIdx;

			const lineText = this.formatRow(row, innerW);

			if (isSelected) {
				// Invert colors for selected row
				const padded = lineText.padEnd(innerW);
				screen.writeText(innerY + i, innerX, padded, {
					fg: 0,
					bg: 7,
					bold: true,
				});
			} else {
				// Status-based coloring
				let fg = -1;
				const dim = false;

				if (row.node.modified) {
					fg = 3; // yellow
				} else if (row.node.staged) {
					fg = 2; // green
				} else if (row.node.isDirectory) {
					fg = 4; // blue
				}

				screen.writeText(innerY + i, innerX, lineText, {
					fg,
					dim,
					bold: row.node.isDirectory,
				});
			}
		}

		// Scrollbar indicator if content exceeds viewport
		if (this.flatRows.length > innerH) {
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

	/** Format a flat row into a display string with tree lines. */
	private formatRow(row: FlatRow, maxWidth: number): string {
		let prefix = "";

		// Build tree-line prefix from treeParts
		for (const part of row.treeParts) {
			prefix += TREE_CHARS[part];
		}

		// Dir indicator
		let icon = "";
		if (row.node.isDirectory) {
			icon = row.isExpanded ? "\u25BC " : "\u25B6 "; // down/right triangle
		} else {
			icon = "  ";
		}

		// Status indicator suffix
		let suffix = "";
		if (row.node.modified) {
			suffix = " \u25CF"; // filled circle
		} else if (row.node.staged) {
			suffix = " +";
		}

		const text = `${prefix}${icon}${row.node.name}${suffix}`;

		// Truncate to fit
		if (text.length > maxWidth) {
			return `${text.slice(0, maxWidth - 1)}\u2026`;
		}
		return text;
	}
}
