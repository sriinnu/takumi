/**
 * Thinking block formatter — renders the assistant's chain-of-thought
 * in a collapsible, dimmed style.
 */

import { dim, fg, italic, reset, wrapText } from "@takumi/render";

export interface ThinkingFormatOptions {
	/** Maximum width in columns. */
	maxWidth?: number;

	/** Whether to show in collapsed (summary) mode. */
	collapsed?: boolean;

	/** Maximum lines when collapsed. */
	collapsedLines?: number;
}

/**
 * Format a thinking block for display.
 */
export function formatThinkingBlock(thinking: string, options?: ThinkingFormatOptions): string {
	const maxWidth = options?.maxWidth ?? 80;
	const collapsed = options?.collapsed ?? false;
	const collapsedLines = options?.collapsedLines ?? 3;

	const lines: string[] = [];

	// Header
	lines.push(`${dim(fg(8) + italic(`\u{1F4AD} Thinking...${reset()}`))}`);

	if (collapsed) {
		// Show summary
		const wrapped = wrapText(thinking, maxWidth - 4);
		const preview = wrapped.slice(0, collapsedLines);
		for (const line of preview) {
			lines.push(`${dim(`${fg(8)}  ${line}${reset()}`)}`);
		}
		if (wrapped.length > collapsedLines) {
			lines.push(`${dim(`${fg(8)}  ... (${wrapped.length - collapsedLines} more lines)${reset()}`)}`);
		}
	} else {
		// Show full thinking
		const wrapped = wrapText(thinking, maxWidth - 4);
		for (const line of wrapped) {
			lines.push(`${dim(fg(8) + italic(`  ${line}${reset()}`))}`);
		}
	}

	return lines.join("\n");
}

/**
 * Format a thinking summary (single line).
 */
export function formatThinkingSummary(thinking: string): string {
	const preview = thinking.replace(/\n/g, " ").slice(0, 60);
	const suffix = thinking.length > 60 ? "..." : "";
	return `${dim(fg(8) + italic(`\u{1F4AD} ${preview}${suffix}`) + reset())}`;
}
