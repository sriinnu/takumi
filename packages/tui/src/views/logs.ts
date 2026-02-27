/**
 * LogsView — scrollable log viewer for the TUI.
 *
 * Displays structured log entries from the application logger in real time.
 * Each entry shows timestamp, severity, source module, and message.
 *
 * Activated via the `/logs` slash command or a keybind.
 */

import type { KeyEvent, Rect } from "@takumi/core";
import { createLogger, KEY_CODES } from "@takumi/core";
import type { Screen, Signal } from "@takumi/render";
import { Component, signal } from "@takumi/render";

const _log = createLogger("logs-view");

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	/** ISO timestamp. */
	timestamp: string;
	/** Severity level. */
	level: LogLevel;
	/** Source module/component. */
	source: string;
	/** Log message. */
	message: string;
	/** Optional structured data. */
	data?: Record<string, unknown>;
}

export interface LogsViewProps {
	/** Maximum number of entries to retain in memory. Default: 2000. */
	maxEntries?: number;
	/** Initial log level filter. Default: "info". */
	minLevel?: LogLevel;
}

// ── Severity ordering ─────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const LEVEL_COLORS: Record<LogLevel, number> = {
	debug: 8, // gray
	info: 7, // white
	warn: 3, // yellow
	error: 1, // red
};

const LEVEL_LABELS: Record<LogLevel, string> = {
	debug: "DBG",
	info: "INF",
	warn: "WRN",
	error: "ERR",
};

// ── LogsView component ───────────────────────────────────────────────────────

export class LogsView extends Component {
	/** All retained log entries. */
	readonly entries: Signal<LogEntry[]> = signal<LogEntry[]>([]);
	/** Current minimum level filter. */
	readonly minLevel: Signal<LogLevel> = signal<LogLevel>("info");
	/** Scroll offset (from top of filtered list). */
	readonly scrollOffset: Signal<number> = signal(0);
	/** Whether auto-scroll is enabled (follows new entries). */
	readonly autoScroll: Signal<boolean> = signal(true);
	/** Text filter (case-insensitive substring match). */
	readonly filter: Signal<string> = signal("");

	private maxEntries: number;
	private viewportHeight = 20;

	constructor(props?: LogsViewProps) {
		super();
		this.maxEntries = props?.maxEntries ?? 2000;
		if (props?.minLevel) {
			this.minLevel.value = props.minLevel;
		}
	}

	/** Append a new log entry. */
	push(entry: LogEntry): void {
		const entries = this.entries.value;
		const next = [...entries, entry];

		// Evict oldest if over capacity
		if (next.length > this.maxEntries) {
			next.splice(0, next.length - this.maxEntries);
		}

		this.entries.value = next;

		if (this.autoScroll.value) {
			this.scrollToBottom();
		}

		this.markDirty();
	}

	/** Clear all entries. */
	clear(): void {
		this.entries.value = [];
		this.scrollOffset.value = 0;
		this.markDirty();
	}

	/** Get entries matching the current level + text filter. */
	filteredEntries(): LogEntry[] {
		const min = LEVEL_ORDER[this.minLevel.value];
		const text = this.filter.value.toLowerCase();

		return this.entries.value.filter((e) => {
			if (LEVEL_ORDER[e.level] < min) return false;
			if (text && !e.message.toLowerCase().includes(text) && !e.source.toLowerCase().includes(text)) {
				return false;
			}
			return true;
		});
	}

	/** Cycle through log levels: debug → info → warn → error → debug. */
	cycleLevel(): void {
		const levels: LogLevel[] = ["debug", "info", "warn", "error"];
		const idx = levels.indexOf(this.minLevel.value);
		this.minLevel.value = levels[(idx + 1) % levels.length];
		this.scrollOffset.value = 0;
		this.markDirty();
	}

	/** Handle keyboard input. */
	handleKey(event: KeyEvent): boolean {
		if (event.key === KEY_CODES.UP || (event.key === "k" && !event.ctrl)) {
			this.scrollOffset.value = Math.max(0, this.scrollOffset.value - 1);
			this.autoScroll.value = false;
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.DOWN || (event.key === "j" && !event.ctrl)) {
			const filtered = this.filteredEntries();
			const max = Math.max(0, filtered.length - this.viewportHeight);
			this.scrollOffset.value = Math.min(max, this.scrollOffset.value + 1);
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.PAGE_UP) {
			this.scrollOffset.value = Math.max(0, this.scrollOffset.value - this.viewportHeight);
			this.autoScroll.value = false;
			this.markDirty();
			return true;
		}

		if (event.key === KEY_CODES.PAGE_DOWN) {
			const filtered = this.filteredEntries();
			const max = Math.max(0, filtered.length - this.viewportHeight);
			this.scrollOffset.value = Math.min(max, this.scrollOffset.value + this.viewportHeight);
			this.markDirty();
			return true;
		}

		// "l" cycles log level
		if (event.key === "l" && !event.ctrl && !event.alt) {
			this.cycleLevel();
			return true;
		}

		// "g" — scroll to top
		if (event.key === "g" && !event.ctrl && !event.alt) {
			this.scrollOffset.value = 0;
			this.autoScroll.value = false;
			this.markDirty();
			return true;
		}

		// "G" (shift+g) — scroll to bottom + re-enable autoscroll
		if (event.key === "G" || (event.key === "g" && event.shift)) {
			this.scrollToBottom();
			this.autoScroll.value = true;
			this.markDirty();
			return true;
		}

		return false;
	}

	private scrollToBottom(): void {
		const filtered = this.filteredEntries();
		this.scrollOffset.value = Math.max(0, filtered.length - this.viewportHeight);
	}

	// ── Rendering ─────────────────────────────────────────────────────────

	render(screen: Screen, rect: Rect): void {
		if (rect.width < 20 || rect.height < 3) return;

		this.viewportHeight = rect.height - 1; // -1 for status line

		const filtered = this.filteredEntries();
		const total = this.entries.value.length;
		const shown = filtered.length;

		// ── Status line ──────────────────────────────────────────────
		const statusLeft = ` Logs (${shown}/${total})  Level: ${this.minLevel.value.toUpperCase()} `;
		const statusRight = this.autoScroll.value ? " [auto-scroll] " : "";
		const statusPad = rect.width - statusLeft.length - statusRight.length;
		const statusLine = statusLeft + " ".repeat(Math.max(0, statusPad)) + statusRight;
		screen.writeText(rect.y, rect.x, statusLine.slice(0, rect.width), { fg: 14 });

		// ── Log entries ──────────────────────────────────────────────
		const start = this.scrollOffset.value;
		const end = Math.min(filtered.length, start + this.viewportHeight);

		for (let i = start; i < end; i++) {
			const entry = filtered[i];
			const y = rect.y + 1 + (i - start);
			this.renderEntry(screen, rect.x, y, rect.width, entry);
		}

		// Fill empty rows
		for (let i = end - start; i < this.viewportHeight; i++) {
			const y = rect.y + 1 + i;
			screen.writeText(y, rect.x, " ".repeat(rect.width), { fg: 8 });
		}
	}

	private renderEntry(screen: Screen, x: number, y: number, width: number, entry: LogEntry): void {
		// Format: HH:MM:SS.mmm LVL [source] message
		const time = entry.timestamp.slice(11, 23) || entry.timestamp.slice(0, 12);
		const label = LEVEL_LABELS[entry.level];
		const prefix = `${time} ${label} `;
		const source = `[${entry.source}] `;
		const msgSpace = width - prefix.length - source.length;
		const msg = entry.message.length > msgSpace ? `${entry.message.slice(0, msgSpace - 1)}…` : entry.message;

		let cx = x;

		// Timestamp (dim)
		screen.writeText(y, cx, time, { fg: 8 });
		cx += time.length + 1;

		// Level (colored)
		screen.writeText(y, cx, label, { fg: LEVEL_COLORS[entry.level] });
		cx += label.length + 1;

		// Source (cyan)
		screen.writeText(y, cx, source, { fg: 6 });
		cx += source.length;

		// Message
		screen.writeText(y, cx, msg, { fg: 7 });
	}
}
