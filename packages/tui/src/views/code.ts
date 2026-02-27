/**
 * CodeView — a split-pane view focused on code changes.
 *
 * Left pane: list of modified files with diff summary.
 * Right pane: unified or side-by-side diff preview of the selected file.
 *
 * Activated via `/diff` slash command or Ctrl+D.
 */

import type { KeyEvent, Rect } from "@takumi/core";
import { createLogger, KEY_CODES } from "@takumi/core";
import type { Screen, Signal } from "@takumi/render";
import { Component, getTheme, hexToRgb, signal } from "@takumi/render";

const _log = createLogger("code-view");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileChange {
	/** Relative path from project root. */
	path: string;
	/** Type of change. */
	status: "added" | "modified" | "deleted" | "renamed";
	/** Number of lines added. */
	additions: number;
	/** Number of lines deleted. */
	deletions: number;
	/** Unified diff content (raw). */
	diffContent?: string;
}

export interface CodeViewProps {
	/** Initial set of file changes to display. */
	files?: FileChange[];
}

// ── CodeView ──────────────────────────────────────────────────────────────────

export class CodeView extends Component {
	/** List of changed files. */
	readonly files: Signal<FileChange[]> = signal<FileChange[]>([]);
	/** Currently selected file index. */
	readonly selectedIndex: Signal<number> = signal(0);
	/** Scroll offset for the file list pane. */
	readonly listScroll: Signal<number> = signal(0);
	/** Scroll offset for the diff pane. */
	readonly diffScroll: Signal<number> = signal(0);
	/** Which pane has focus: "list" or "diff". */
	readonly focusedPane: Signal<"list" | "diff"> = signal<"list" | "diff">("list");

	/** Cached diff lines for the currently selected file. */
	private cachedDiffLines: string[] = [];
	private cachedDiffIndex = -1;

	private diffViewportHeight = 20;
	private listViewportHeight = 20;

	constructor(props?: CodeViewProps) {
		super();
		if (props?.files) {
			this.files.value = props.files;
		}
	}

	/** Replace the list of file changes. */
	setFiles(files: FileChange[]): void {
		this.files.value = files;
		this.selectedIndex.value = 0;
		this.listScroll.value = 0;
		this.diffScroll.value = 0;
		this.cachedDiffIndex = -1;
		this.markDirty();
	}

	/** Handle keyboard input. */
	handleKey(event: KeyEvent): boolean {
		const pane = this.focusedPane.value;

		// Tab toggles pane focus
		if (event.key === KEY_CODES.TAB) {
			this.focusedPane.value = pane === "list" ? "diff" : "list";
			this.markDirty();
			return true;
		}

		if (pane === "list") {
			return this.handleListKey(event);
		}
		return this.handleDiffKey(event);
	}

	private handleListKey(event: KeyEvent): boolean {
		const files = this.files.value;
		if (files.length === 0) return false;

		if (event.key === KEY_CODES.UP || (event.key === "k" && !event.ctrl)) {
			this.selectedIndex.value = Math.max(0, this.selectedIndex.value - 1);
			this.ensureListVisible();
			this.diffScroll.value = 0;
			this.cachedDiffIndex = -1;
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.DOWN || (event.key === "j" && !event.ctrl)) {
			this.selectedIndex.value = Math.min(files.length - 1, this.selectedIndex.value + 1);
			this.ensureListVisible();
			this.diffScroll.value = 0;
			this.cachedDiffIndex = -1;
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.ENTER) {
			// Switch focus to diff pane
			this.focusedPane.value = "diff";
			this.markDirty();
			return true;
		}

		return false;
	}

	private handleDiffKey(event: KeyEvent): boolean {
		const lines = this.getDiffLines();

		if (event.key === KEY_CODES.UP || (event.key === "k" && !event.ctrl)) {
			this.diffScroll.value = Math.max(0, this.diffScroll.value - 1);
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.DOWN || (event.key === "j" && !event.ctrl)) {
			const maxScroll = Math.max(0, lines.length - this.diffViewportHeight);
			this.diffScroll.value = Math.min(maxScroll, this.diffScroll.value + 1);
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.PAGE_UP) {
			this.diffScroll.value = Math.max(0, this.diffScroll.value - this.diffViewportHeight);
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.PAGE_DOWN) {
			const maxScroll = Math.max(0, lines.length - this.diffViewportHeight);
			this.diffScroll.value = Math.min(maxScroll, this.diffScroll.value + this.diffViewportHeight);
			this.markDirty();
			return true;
		}

		return false;
	}

	private ensureListVisible(): void {
		const idx = this.selectedIndex.value;
		if (idx < this.listScroll.value) {
			this.listScroll.value = idx;
		} else if (idx >= this.listScroll.value + this.listViewportHeight) {
			this.listScroll.value = idx - this.listViewportHeight + 1;
		}
	}

	private getDiffLines(): string[] {
		const idx = this.selectedIndex.value;
		if (idx === this.cachedDiffIndex) return this.cachedDiffLines;

		const file = this.files.value[idx];
		this.cachedDiffLines = file?.diffContent?.split("\n") ?? ["(no diff available)"];
		this.cachedDiffIndex = idx;
		return this.cachedDiffLines;
	}

	// ── Rendering ─────────────────────────────────────────────────────────

	render(screen: Screen, rect: Rect): void {
		if (rect.width < 10 || rect.height < 3) return;

		const theme = getTheme();
		const listWidth = Math.min(40, Math.floor(rect.width * 0.3));
		const dividerWidth = 1;
		const diffWidth = rect.width - listWidth - dividerWidth;

		this.listViewportHeight = rect.height - 1; // -1 for header
		this.diffViewportHeight = rect.height - 1;

		// ── File list pane ───────────────────────────────────────────
		this.renderFileList(screen, {
			x: rect.x,
			y: rect.y,
			width: listWidth,
			height: rect.height,
		});

		// ── Divider ──────────────────────────────────────────────────
		const divColor = theme.border ? toAnsi256(theme.border) : 8;
		for (let row = rect.y; row < rect.y + rect.height; row++) {
			screen.writeText(row, rect.x + listWidth, "│", { fg: divColor });
		}

		// ── Diff pane ────────────────────────────────────────────────
		this.renderDiffPane(screen, {
			x: rect.x + listWidth + dividerWidth,
			y: rect.y,
			width: diffWidth,
			height: rect.height,
		});
	}

	private renderFileList(screen: Screen, rect: Rect): void {
		const files = this.files.value;
		const isFocused = this.focusedPane.value === "list";
		const _theme = getTheme();

		// Header
		const headerLabel = ` Files (${files.length}) `;
		const headerColor = isFocused ? 14 : 7;
		screen.writeText(rect.y, rect.x, headerLabel.padEnd(rect.width), { fg: headerColor });

		// File entries
		const startIdx = this.listScroll.value;
		const endIdx = Math.min(files.length, startIdx + this.listViewportHeight);

		for (let i = startIdx; i < endIdx; i++) {
			const file = files[i];
			const y = rect.y + 1 + (i - startIdx);
			const isSelected = i === this.selectedIndex.value;

			const icon = statusIcon(file.status);
			const stats = `+${file.additions} -${file.deletions}`;
			const maxPath = rect.width - stats.length - 4;
			const path = file.path.length > maxPath ? `…${file.path.slice(-(maxPath - 1))}` : file.path;
			const line = `${` ${icon} ${path}`.padEnd(rect.width - stats.length) + stats} `;

			const fg = isSelected && isFocused ? 0 : statusColor(file.status);
			const bg = isSelected && isFocused ? 14 : undefined;
			screen.writeText(y, rect.x, line.slice(0, rect.width), { fg, bg });
		}
	}

	private renderDiffPane(screen: Screen, rect: Rect): void {
		const lines = this.getDiffLines();
		const isFocused = this.focusedPane.value === "diff";
		const file = this.files.value[this.selectedIndex.value];

		// Header
		const headerLabel = file ? ` ${file.path} ` : " (no file selected) ";
		const headerColor = isFocused ? 14 : 7;
		screen.writeText(rect.y, rect.x, headerLabel.padEnd(rect.width).slice(0, rect.width), { fg: headerColor });

		// Diff lines
		const startLine = this.diffScroll.value;
		const endLine = Math.min(lines.length, startLine + this.diffViewportHeight);

		for (let i = startLine; i < endLine; i++) {
			const y = rect.y + 1 + (i - startLine);
			const raw = lines[i] ?? "";
			const text = raw.slice(0, rect.width);

			const fg = diffLineColor(raw);
			screen.writeText(y, rect.x, text.padEnd(rect.width), { fg });
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: FileChange["status"]): string {
	switch (status) {
		case "added":
			return "+";
		case "modified":
			return "~";
		case "deleted":
			return "-";
		case "renamed":
			return "→";
	}
}

function statusColor(status: FileChange["status"]): number {
	switch (status) {
		case "added":
			return 2; // green
		case "modified":
			return 3; // yellow
		case "deleted":
			return 1; // red
		case "renamed":
			return 6; // cyan
	}
}

function diffLineColor(line: string): number {
	if (line.startsWith("+++") || line.startsWith("---")) return 15; // bright white
	if (line.startsWith("@@")) return 6; // cyan (hunk header)
	if (line.startsWith("+")) return 2; // green (addition)
	if (line.startsWith("-")) return 1; // red (deletion)
	return 7; // default
}

/** Convert a hex color to the closest ANSI 256 index. Rough approximation. */
function toAnsi256(hex: string): number {
	try {
		const [r, g, b] = hexToRgb(hex);
		// Use the 6×6×6 cube (indices 16-231)
		const ri = Math.round((r / 255) * 5);
		const gi = Math.round((g / 255) * 5);
		const bi = Math.round((b / 255) * 5);
		return 16 + 36 * ri + 6 * gi + bi;
	} catch {
		return 8;
	}
}
