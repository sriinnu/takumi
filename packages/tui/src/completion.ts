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
import { basename, dirname, join } from "node:path";
import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";
import type { SlashCommand, SlashCommandRegistry } from "./commands/commands.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type CompletionKind = "file" | "command" | "model" | "variable";

export interface CompletionItem {
	/** Display text shown in the popup. */
	label: string;
	/** Text to insert when the completion is confirmed. */
	insertText: string;
	/** Grapheme column where the replacement starts. */
	replaceStart: number;
	/** Grapheme column where the replacement ends. */
	replaceEnd: number;
	/** Category of completion. */
	kind: CompletionKind;
	/** Secondary description shown alongside the label. */
	detail?: string;
}

export type ProviderModelCatalog = Record<string, string[]>;

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

/** Models grouped by provider — used for /model and /provider completions. */
export const PROVIDER_MODELS: Record<string, string[]> = {
	anthropic: ["claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-haiku-3-20250307"],
	openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
	gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
	groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
	xai: ["grok-4", "grok-3", "grok-3-mini"],
	grok: ["grok-4", "grok-3", "grok-3-mini"],
	deepseek: ["deepseek-chat", "deepseek-reasoner"],
	mistral: ["mistral-large-latest", "mistral-small-latest"],
	together: ["meta-llama/Llama-3-70b-chat-hf", "mistralai/Mixtral-8x7B-v0.1"],
	openrouter: ["openai/gpt-4.1-mini", "openai/gpt-4.1", "google/gemini-2.0-flash-001", "anthropic/claude-sonnet-4"],
	alibaba: ["qwen-max", "qwen-plus", "qwen-turbo"],
	bedrock: ["anthropic.claude-3-7-sonnet-20250219-v1:0", "amazon.nova-pro-v1:0", "meta.llama3-1-70b-instruct-v1:0"],
	zai: ["glm-4.5-flash", "glm-4.5-air", "glm-4.5", "glm-4.7-flash", "glm-4.7", "glm-5"],
	moonshot: ["kimi-k2.5", "kimi-k2", "kimi-k2-thinking"],
	minimax: [
		"MiniMax-M2.7",
		"MiniMax-M2.7-highspeed",
		"MiniMax-M2.5",
		"MiniMax-M2.5-highspeed",
		"MiniMax-M2",
		"MiniMax-M2-Stable",
	],
	ollama: ["llama3", "codellama", "mistral", "phi3"],
};

export function cloneProviderModelCatalog(catalog: ProviderModelCatalog): ProviderModelCatalog {
	return Object.fromEntries(Object.entries(catalog).map(([provider, models]) => [provider, [...models]]));
}

/** All supported provider names. */
export const KNOWN_PROVIDERS = Object.keys(PROVIDER_MODELS);

export interface AppliedCompletionEdit {
	text: string;
	cursorCol: number;
}

export function applyCompletionEdit(text: string, item: CompletionItem): AppliedCompletionEdit {
	const nextText = text.slice(0, item.replaceStart) + item.insertText + text.slice(item.replaceEnd);
	return {
		text: nextText,
		cursorCol: item.replaceStart + item.insertText.length,
	};
}

export class CompletionEngine {
	private projectRoot = "";
	private commands: SlashCommandRegistry | null = null;
	private providerCatalogProvider: () => ProviderModelCatalog = () => PROVIDER_MODELS;
	private currentProviderProvider: () => string | undefined = () => undefined;

	/** Set the project root for file completions. */
	setProjectRoot(root: string): void {
		this.projectRoot = root;
	}

	/** Set the command registry for slash command completions. */
	setCommands(commands: SlashCommandRegistry): void {
		this.commands = commands;
	}

	/** Look up a registered slash command by name. */
	getCommandByName(name: string): SlashCommand | undefined {
		return this.commands?.get(name);
	}

	/** Set the provider/model catalog source for /provider and /model completions. */
	setProviderCatalog(provider: () => ProviderModelCatalog): void {
		this.providerCatalogProvider = provider;
	}

	/** Set the current provider source so /model can prioritize active-provider models. */
	setCurrentProvider(provider: () => string | undefined): void {
		this.currentProviderProvider = provider;
	}

	/** Get completions for the current input at the given cursor position. */
	async getCompletions(text: string, cursorCol: number): Promise<CompletionItem[]> {
		const syncResult = this.getCompletionsSync(text, cursorCol);
		if (syncResult !== null) return syncResult;

		const before = text.slice(0, cursorCol);
		if (this.commands && before.startsWith("/") && before.includes(" ")) {
			const spaceIndex = before.indexOf(" ");
			const cmd = this.commands.get(before.slice(0, spaceIndex));
			if (cmd?.getArgumentCompletions) {
				try {
					return (await cmd.getArgumentCompletions(before.slice(spaceIndex + 1)))
						.slice(0, MAX_RESULTS)
						.map((label) => ({
							label,
							insertText: label,
							replaceStart: spaceIndex + 1,
							replaceEnd: cursorCol,
							kind: "command" as CompletionKind,
							detail: cmd.description,
						}));
				} catch {}
			}
		}

		const atIdx = before.lastIndexOf("@");
		if (atIdx >= 0) {
			const afterAt = before.slice(atIdx + 1);
			if (atIdx === 0 || /\s/.test(before[atIdx - 1])) {
				return this.getFileCompletions(afterAt, atIdx, cursorCol);
			}
		}

		return [];
	}

	/** Synchronous completion for slash commands, /model, and /provider. */
	getCompletionsSync(text: string, cursorCol: number): CompletionItem[] | null {
		const before = text.slice(0, cursorCol);
		const modelPrefix = "/model ";
		const providerPrefix = "/provider ";

		// /model <partial> — model name completion
		if (before.startsWith(modelPrefix))
			return this.getModelCompletions(before.slice(modelPrefix.length), undefined, modelPrefix.length, cursorCol);

		// /provider <partial> — provider name completion
		if (before.startsWith(providerPrefix))
			return this.getProviderCompletions(before.slice(providerPrefix.length), providerPrefix.length, cursorCol);

		// /command — slash command completion (no space yet)
		if (before.startsWith("/") && !before.includes(" ")) {
			return this.getSlashCompletions(before, 0, cursorCol);
		}

		// Needs async file I/O
		return null;
	}

	/**
	 * Get file path completions for the text after @.
	 * Supports directory listing (e.g. "src/") and fuzzy matching.
	 */
	async getFileCompletions(partial: string, replaceStart: number, replaceEnd: number): Promise<CompletionItem[]> {
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
			return items.slice(0, MAX_RESULTS).map((item) => ({ ...item, replaceStart, replaceEnd }));
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
	): Promise<Array<Omit<CompletionItem, "replaceStart" | "replaceEnd">>> {
		let entries: import("node:fs").Dirent[];
		try {
			entries = (await readdir(dir, { withFileTypes: true })) as unknown as import("node:fs").Dirent[];
		} catch {
			return [];
		}

		const results: Array<Omit<CompletionItem, "replaceStart" | "replaceEnd">> = [];
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

			const insertPath = dirPrefix ? `${dirPrefix}${name}${isDir ? "/" : ""}` : `${name}${isDir ? "/" : ""}`;

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

	/**
	 * Get slash command completions for the given partial input (e.g. "/th").
	 */
	getSlashCompletions(partial: string, replaceStart: number, replaceEnd: number): CompletionItem[] {
		if (!this.commands) return [];

		const cmds = this.commands.getCompletions(partial);
		return cmds.slice(0, MAX_RESULTS).map((cmd) => ({
			label: cmd.name,
			insertText: cmd.name,
			replaceStart,
			replaceEnd,
			kind: "command" as CompletionKind,
			detail: cmd.description,
		}));
	}

	/**
	 * Get model name completions for the partial text after "/model ".
	 * When a provider is specified, only that provider's models are returned.
	 */
	getModelCompletions(
		partial: string,
		provider?: string,
		replaceStart = 0,
		replaceEnd = partial.length,
	): CompletionItem[] {
		const providerModels = this.providerCatalogProvider();
		const knownModels = [...new Set(Object.values(providerModels).flat())];
		const lower = partial.toLowerCase();
		const activeProvider = provider ?? this.currentProviderProvider();
		const models = activeProvider ? (providerModels[activeProvider] ?? knownModels) : knownModels;
		return models
			.filter((m) => m.toLowerCase().includes(lower))
			.map((m) => ({
				label: m,
				insertText: m,
				replaceStart,
				replaceEnd,
				kind: "model" as CompletionKind,
			}));
	}

	/**
	 * Get provider name completions for the partial text after "/provider ".
	 */
	getProviderCompletions(partial: string, replaceStart = 0, replaceEnd = partial.length): CompletionItem[] {
		const providerModels = this.providerCatalogProvider();
		const knownProviders = Object.keys(providerModels);
		const lower = partial.toLowerCase();
		return knownProviders
			.filter((p) => p.includes(lower))
			.map((p) => ({
				label: p,
				insertText: p,
				replaceStart,
				replaceEnd,
				kind: "command" as CompletionKind,
				detail: `${providerModels[p]?.length ?? 0} models`,
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
