/**
 * ToolSpinner — animated progress spinners for tool execution.
 * Shows Braille-pattern spinner while tools are running,
 * with success/error indicators on completion.
 */

// ── Spinner frames ───────────────────────────────────────────────────────────

const BRAILLE_FRAMES = [
	"\u280B",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283C",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280F",
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface ToolSpinnerEntry {
	toolId: string;
	toolName: string;
	args: string;
	startTime: number;
	endTime?: number;
	success?: boolean;
	durationMs?: number;
}

export interface SpinnerLine {
	text: string;
	fg: number;
	dim: boolean;
}

// ── ToolSpinner class ────────────────────────────────────────────────────────

/**
 * Manages animated spinners for concurrent tool executions.
 * Call tick() every ~80ms to advance animation frames.
 */
export class ToolSpinner {
	private tools = new Map<string, ToolSpinnerEntry>();
	private frameIndex = 0;
	private completedTools = new Map<string, ToolSpinnerEntry>();

	/**
	 * Start spinner for a tool call.
	 */
	start(toolId: string, toolName: string, args: string): void {
		this.tools.set(toolId, {
			toolId,
			toolName,
			args,
			startTime: Date.now(),
		});
	}

	/**
	 * Mark tool as complete.
	 */
	complete(toolId: string, success: boolean, durationMs: number): void {
		const entry = this.tools.get(toolId);
		if (!entry) return;

		entry.endTime = Date.now();
		entry.success = success;
		entry.durationMs = durationMs;

		// Move from active to completed
		this.tools.delete(toolId);
		this.completedTools.set(toolId, entry);
	}

	/**
	 * Get current display line for a tool (with animated spinner or status icon).
	 */
	getLine(toolId: string): SpinnerLine {
		// Check active tools
		const active = this.tools.get(toolId);
		if (active) {
			const frame = BRAILLE_FRAMES[this.frameIndex % BRAILLE_FRAMES.length];
			const argSummary = truncateArgs(active.args, 40);
			const elapsed = formatDuration(Date.now() - active.startTime);
			const text = `${frame} ${active.toolName}  ${argSummary}${elapsed ? `  ${elapsed}` : ""}`;
			return { text, fg: 3, dim: false }; // yellow
		}

		// Check completed tools
		const completed = this.completedTools.get(toolId);
		if (completed) {
			if (completed.success) {
				const duration = formatDuration(completed.durationMs ?? 0);
				const argSummary = truncateArgs(completed.args, 40);
				const text = `\u2713 ${completed.toolName}  ${argSummary}  (${duration})`;
				return { text, fg: 2, dim: false }; // green
			}
			const duration = formatDuration(completed.durationMs ?? 0);
			const argSummary = truncateArgs(completed.args, 40);
			const text = `\u2717 ${completed.toolName}  ${argSummary}  (${duration})`;
			return { text, fg: 1, dim: false }; // red
		}

		// Unknown tool
		return { text: "", fg: 7, dim: true };
	}

	/**
	 * Advance animation frame. Call every ~80ms.
	 */
	tick(): void {
		this.frameIndex = (this.frameIndex + 1) % BRAILLE_FRAMES.length;
	}

	/**
	 * Get all active (running) tool IDs.
	 */
	get activeTools(): string[] {
		return [...this.tools.keys()];
	}

	/**
	 * Check if any tools are running.
	 */
	get isRunning(): boolean {
		return this.tools.size > 0;
	}

	/**
	 * Get the current frame index (for testing).
	 */
	get currentFrame(): number {
		return this.frameIndex;
	}

	/**
	 * Get a completed tool entry (for testing/inspection).
	 */
	getCompleted(toolId: string): ToolSpinnerEntry | undefined {
		return this.completedTools.get(toolId);
	}

	/**
	 * Get an active tool entry (for testing/inspection).
	 */
	getActive(toolId: string): ToolSpinnerEntry | undefined {
		return this.tools.get(toolId);
	}

	/**
	 * Clear all completed entries.
	 */
	clearCompleted(): void {
		this.completedTools.clear();
	}

	/**
	 * Reset all state.
	 */
	reset(): void {
		this.tools.clear();
		this.completedTools.clear();
		this.frameIndex = 0;
	}

	/**
	 * Get count of active tools.
	 */
	get activeCount(): number {
		return this.tools.size;
	}

	/**
	 * Get count of completed tools.
	 */
	get completedCount(): number {
		return this.completedTools.size;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
	if (ms <= 0) return "";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Truncate tool argument string for display.
 */
function truncateArgs(args: string, maxLen: number): string {
	if (!args) return "";
	const clean = args.replace(/\n/g, " ").trim();
	if (clean.length <= maxLen) return clean;
	return `${clean.slice(0, maxLen - 3)}...`;
}

/**
 * Get the Braille frames array (for testing or external use).
 */
export const TOOL_SPINNER_FRAMES = BRAILLE_FRAMES;
