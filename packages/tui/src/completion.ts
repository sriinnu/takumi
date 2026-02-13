/**
 * CompletionEngine — tab completion for the editor input.
 *
 * Provides contextual completions for:
 * - File paths after @ prefix
 * - Slash commands after / prefix
 * - Model names after /model
 *
 * CompletionPopup manages the popup state (visibility, selection, navigation).
 */

import { readdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { signal } from "@takumi/render";
import type { Signal } from "@takumi/render";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { SlashCommandRegistry } from "./commands.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type CompletionKind = "file" | "command" | "model" | "variable";

export interface CompletionItem {
	/** Display text shown in the popup. */
	label: string;
	/** Text to insert when the completion is confirmed. */
	insertText: string;
	/** Category of completion. */
	kind: CompletionKind;
	/** Secondary description shown alongside the label. */
	detail?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Directories to always skip during file completion. */
const SKIP_DIRS = new Set([
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

/** Maximum number of completion results returned. */
const MAX_RESULTS = 50;

/** Maximum items visible in the popup at once. */
export const MAX_VISIBLE_ITEMS = 8;

/** Known model identifiers for /model completion. */
const KNOWN_MODELS = [
	"claude-opus-4-20250514",
	"claude-sonnet-4-20250514",
	"claude-haiku-3-20250307",
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4.1-nano",
	"o3",
	"o4-mini",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
];

// ── CompletionEngine ─────────────────────────────────────────────────────────

export class CompletionEngine {
	private projectRoot = "";
	private commands: SlashCommandRegistry | null = null;

	/** Set the project root for file completions. */
	setProjectRoot(root: string): void {
		this.projectRoot = root;
	}

	/** Set the command registry for slash command completions. */
	setCommands(commands: SlashCommandRegistry): void {
		this.commands = commands;
	}

	/**
	 * Get completions for the current input at the given cursor position.
	 * Determines completion type from context and returns matching items.
	 */
	async getCompletions(text: string, cursorCol: number): Promise<CompletionItem[]> {
		const before = text.slice(0, cursorCol);

		// Check for /model completion: "/model <partial>"
		const modelMatch = before.match(/^\/model\s+(.*)$/);
		if (modelMatch) {
			return this.getModelCompletions(modelMatch[1]);
		}

		// Check for @ file path completion
		const atIdx = before.lastIndexOf("@");
		if (atIdx >= 0) {
			const afterAt = before.slice(atIdx + 1);
			// Only trigger if @ is at word boundary (start, after space, etc.)
			if (atIdx === 0 || /\s/.test(before[atIdx - 1])) {
				return this.getFileCompletions(afterAt);
			}
		}

		// Check for / slash command completion
		if (before.startsWith("/") && !before.includes(" ")) {
			return this.getSlashCompletions(before);
		}

		return [];
	}

	// ── File completions ──────────────────────────────────────────────────

	/**
	 * Get file path completions for the text after @.
	 * Supports directory listing (e.g. "src/") and fuzzy matching.
	 */
	async getFileCompletions(partial: string): Promise<CompletionItem[]> {
		if (!this.projectRoot) return [];

		try {
			// Determine directory to list and filter pattern
			let searchDir: string;
			let filterPrefix: string;

			if (partial.endsWith("/")) {
				// Listing directory contents: @src/
				// Strip trailing slash to avoid double-slash from join
				const dirPart = partial.slice(0, -1);
				searchDir = dirPart ? join(this.projectRoot, dirPart) : this.projectRoot;
				filterPrefix = "";
			} else if (partial.includes("/")) {
				// Partial in subdirectory: @src/app -> list src/, filter "app"
				searchDir = join(this.projectRoot, dirname(partial));
				filterPrefix = basename(partial).toLowerCase();
			} else {
				// Top-level fuzzy match: @app
				searchDir = this.projectRoot;
				filterPrefix = partial.toLowerCase();
			}

			const items = await this.listDirectory(searchDir, partial, filterPrefix);
			return items.slice(0, MAX_RESULTS);
		} catch {
			return [];
		}
	}

	/**
	 * List directory entries and build CompletionItems.
	 * Skips node_modules, .git, dist, etc.
	 */
	private async listDirectory(
		dir: string,
		pathPrefix: string,
		filter: string,
	): Promise<CompletionItem[]> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true }) as unknown as import("node:fs").Dirent[];
		} catch {
			return [];
		}

		const results: CompletionItem[] = [];
		const dirPrefix = pathPrefix.includes("/")
			? pathPrefix.slice(0, pathPrefix.lastIndexOf("/") + 1)
			: pathPrefix.endsWith("/")
				? pathPrefix
				: "";

		for (const entry of entries) {
			const name = String(entry.name);
			const isDir = entry.isDirectory();

			// Skip hidden/excluded directories
			if (SKIP_DIRS.has(name)) continue;

			// Apply filter (case-insensitive fuzzy containment)
			if (filter && !name.toLowerCase().includes(filter)) continue;

			const insertPath = dirPrefix
				? `${dirPrefix}${name}${isDir ? "/" : ""}`
				: `${name}${isDir ? "/" : ""}`;

			results.push({
				label: isDir ? `${name}/` : name,
				insertText: `@${insertPath}`,
				kind: "file",
				detail: isDir ? "directory" : undefined,
			});
		}

		// Sort: directories first, then alphabetical
		results.sort((a, b) => {
			const aIsDir = a.label.endsWith("/");
			const bIsDir = b.label.endsWith("/");
			if (aIsDir && !bIsDir) return -1;
			if (!aIsDir && bIsDir) return 1;
			return a.label.localeCompare(b.label);
		});

		return results;
	}

	// ── Slash command completions ─────────────────────────────────────────

	/**
	 * Get slash command completions for the given partial input (e.g. "/th").
	 */
	getSlashCompletions(partial: string): CompletionItem[] {
		if (!this.commands) return [];

		const cmds = this.commands.getCompletions(partial);
		return cmds.map((cmd) => ({
			label: cmd.name,
			insertText: cmd.name,
			kind: "command" as CompletionKind,
			detail: cmd.description,
		}));
	}

	// ── Model completions ─────────────────────────────────────────────────

	/**
	 * Get model name completions for the partial text after "/model ".
	 */
	getModelCompletions(partial: string): CompletionItem[] {
		const lower = partial.toLowerCase();
		return KNOWN_MODELS
			.filter((m) => m.toLowerCase().includes(lower))
			.map((m) => ({
				label: m,
				insertText: `/model ${m}`,
				kind: "model" as CompletionKind,
			}));
	}
}

// ── CompletionPopup ──────────────────────────────────────────────────────────

export class CompletionPopup {
	/** Current completion items. */
	readonly items: Signal<CompletionItem[]> = signal<CompletionItem[]>([]);
	/** Currently selected index (0-based). */
	readonly selectedIndex: Signal<number> = signal(0);
	/** Whether the popup is visible. */
	readonly isVisible: Signal<boolean> = signal(false);
	/** Scroll offset for long lists. */
	readonly scrollOffset: Signal<number> = signal(0);

	/** Show the popup with the given items. Selects the first item. */
	show(items: CompletionItem[]): void {
		if (items.length === 0) {
			this.hide();
			return;
		}
		this.items.value = items;
		this.selectedIndex.value = 0;
		this.scrollOffset.value = 0;
		this.isVisible.value = true;
	}

	/** Hide the popup and clear items. */
	hide(): void {
		this.isVisible.value = false;
		this.items.value = [];
		this.selectedIndex.value = 0;
		this.scrollOffset.value = 0;
	}

	/** Move selection to the next item. Wraps around. */
	selectNext(): void {
		const count = this.items.value.length;
		if (count === 0) return;
		this.selectedIndex.value = (this.selectedIndex.value + 1) % count;
		this.ensureVisible();
	}

	/** Move selection to the previous item. Wraps around. */
	selectPrev(): void {
		const count = this.items.value.length;
		if (count === 0) return;
		this.selectedIndex.value = (this.selectedIndex.value - 1 + count) % count;
		this.ensureVisible();
	}

	/**
	 * Confirm the current selection.
	 * Returns the selected CompletionItem, or null if nothing is selected.
	 * Hides the popup after confirmation.
	 */
	confirm(): CompletionItem | null {
		if (!this.isVisible.value || this.items.value.length === 0) return null;
		const item = this.items.value[this.selectedIndex.value] ?? null;
		this.hide();
		return item;
	}

	/**
	 * Handle a key event for the popup.
	 * Returns true if the event was consumed (the popup ate it).
	 */
	handleKey(event: KeyEvent): boolean {
		if (!this.isVisible.value) return false;

		// Navigate up/down
		if (event.raw === KEY_CODES.UP) {
			this.selectPrev();
			return true;
		}
		if (event.raw === KEY_CODES.DOWN) {
			this.selectNext();
			return true;
		}

		// Confirm with Enter or Tab
		if (event.raw === KEY_CODES.ENTER || event.raw === KEY_CODES.TAB) {
			// Confirmation is handled by the caller after checking handleKey
			return true;
		}

		// Dismiss with Escape
		if (event.raw === KEY_CODES.ESCAPE) {
			this.hide();
			return true;
		}

		return false;
	}

	/** Ensure the selected item is within the visible scroll window. */
	private ensureVisible(): void {
		const sel = this.selectedIndex.value;
		const offset = this.scrollOffset.value;

		if (sel < offset) {
			this.scrollOffset.value = sel;
		} else if (sel >= offset + MAX_VISIBLE_ITEMS) {
			this.scrollOffset.value = sel - MAX_VISIBLE_ITEMS + 1;
		}
	}
}
