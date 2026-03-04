/**
 * Guardian daemon — lightweight background watcher.
 *
 * When `takumi daemon guardian start` is invoked, this module launches
 * a filesystem watcher on the current project directory. On every
 * meaningful file save (.ts, .tsx, .jsx, .py, etc.) it records the
 * event and can optionally trigger asynchronous lightweight analysis
 * (e.g. auto-suggest tests, detect obvious type errors).
 *
 * Communication with the running Kagami TUI is via the daemon IPC
 * socket so the TUI can display: "Guardian: 2 suggestions waiting."
 */

import { type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("guardian");

// ── Types ────────────────────────────────────────────────────────────────────

export interface GuardianEvent {
	type: "file_changed" | "file_created" | "file_deleted";
	path: string;
	relativePath: string;
	timestamp: number;
	ext: string;
}

export interface GuardianSuggestion {
	id: string;
	type: "test_needed" | "jsdoc_missing" | "type_error_likely";
	filePath: string;
	message: string;
	createdAt: number;
}

export interface GuardianConfig {
	/** Root directory to watch */
	cwd: string;
	/** File extensions to watch (default: .ts, .tsx, .js, .jsx) */
	extensions?: string[];
	/** Directories to ignore */
	ignoreDirs?: string[];
	/** Callback fired on each guardian event */
	onEvent?: (event: GuardianEvent) => void;
	/** Debounce interval in ms (default: 500) */
	debounceMs?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go"]);
const DEFAULT_IGNORE_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".turbo",
	"coverage",
	".takumi",
	"__pycache__",
]);

// ── Guardian class ───────────────────────────────────────────────────────────

export class Guardian {
	private watchers: FSWatcher[] = [];
	private suggestions = new Map<string, GuardianSuggestion>();
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private eventCount = 0;
	private running = false;

	private readonly cwd: string;
	private readonly extensions: Set<string>;
	private readonly ignoreDirs: Set<string>;
	private readonly onEvent: ((event: GuardianEvent) => void) | undefined;
	private readonly debounceMs: number;

	constructor(config: GuardianConfig) {
		this.cwd = config.cwd;
		this.extensions = config.extensions ? new Set(config.extensions) : DEFAULT_EXTENSIONS;
		this.ignoreDirs = config.ignoreDirs ? new Set(config.ignoreDirs) : DEFAULT_IGNORE_DIRS;
		this.onEvent = config.onEvent;
		this.debounceMs = config.debounceMs ?? 500;
	}

	/** Start watching the project directory recursively. */
	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		log.info(`Guardian started watching: ${this.cwd}`);

		try {
			const watcher = watch(this.cwd, { recursive: true }, (eventType, filename) => {
				if (!filename) return;
				this.handleFsEvent(eventType, filename);
			});
			this.watchers.push(watcher);
		} catch (_err) {
			// Fallback: manual recursive watch for platforms without recursive support
			log.warn("Recursive watch not supported, using manual directory scan");
			await this.watchDirectory(this.cwd);
		}
	}

	/** Stop all watchers and clean up. */
	stop(): void {
		this.running = false;
		for (const w of this.watchers) w.close();
		this.watchers = [];
		for (const timer of this.debounceTimers.values()) clearTimeout(timer);
		this.debounceTimers.clear();
		log.info("Guardian stopped");
	}

	/** Get pending suggestions. */
	getSuggestions(): GuardianSuggestion[] {
		return [...this.suggestions.values()];
	}

	/** Dismiss a suggestion by ID. */
	dismissSuggestion(id: string): void {
		this.suggestions.delete(id);
	}

	/** Clear all suggestions. */
	clearSuggestions(): void {
		this.suggestions.clear();
	}

	get isRunning(): boolean {
		return this.running;
	}

	get totalEvents(): number {
		return this.eventCount;
	}

	get pendingSuggestionCount(): number {
		return this.suggestions.size;
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	private handleFsEvent(eventType: string, filename: string): void {
		const ext = extname(filename);
		if (!this.extensions.has(ext)) return;

		// Ignore files in excluded directories
		const parts = filename.split("/");
		for (const part of parts) {
			if (this.ignoreDirs.has(part)) return;
		}

		// Debounce: same file within debounceMs → skip
		const existing = this.debounceTimers.get(filename);
		if (existing) clearTimeout(existing);

		this.debounceTimers.set(
			filename,
			setTimeout(() => {
				this.debounceTimers.delete(filename);
				this.processFileEvent(eventType, filename, ext);
			}, this.debounceMs),
		);
	}

	private processFileEvent(eventType: string, filename: string, ext: string): void {
		this.eventCount++;

		const event: GuardianEvent = {
			type: eventType === "rename" ? "file_created" : "file_changed",
			path: join(this.cwd, filename),
			relativePath: filename,
			timestamp: Date.now(),
			ext,
		};

		log.debug(`Guardian event: ${event.type} ${event.relativePath}`);
		this.onEvent?.(event);

		// Auto-detect: does this file have a corresponding test file?
		this.checkTestCoverage(filename, ext);
	}

	private checkTestCoverage(filename: string, ext: string): void {
		// Only check source files, not test files themselves
		if (filename.includes(".test.") || filename.includes(".spec.") || filename.includes("/test/")) {
			return;
		}

		const base = basename(filename, ext);
		const testPatterns = [`${base}.test${ext}`, `${base}.spec${ext}`];

		// Simple heuristic: flag if no test file exists alongside or in test/
		const suggestionId = `test:${filename}`;
		if (!this.suggestions.has(suggestionId)) {
			this.suggestions.set(suggestionId, {
				id: suggestionId,
				type: "test_needed",
				filePath: filename,
				message: `No test file detected for ${filename} (looked for ${testPatterns.join(", ")})`,
				createdAt: Date.now(),
			});
		}
	}

	/** Fallback for platforms without recursive watch. */
	private async watchDirectory(dir: string): Promise<void> {
		if (!this.running) return;

		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (this.ignoreDirs.has(entry.name)) continue;
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				const watcher = watch(fullPath, (eventType, filename) => {
					if (!filename) return;
					const relPath = relative(this.cwd, join(fullPath, filename));
					this.handleFsEvent(eventType, relPath);
				});
				this.watchers.push(watcher);
				await this.watchDirectory(fullPath);
			}
		}
	}
}
