/**
 * Tool call formatters — render tool invocations and results
 * into display-friendly strings.
 */

import type { ToolUseBlock, ToolResultBlock } from "@takumi/core";
import { bold, dim, fg, reset } from "@takumi/render";

/** Icons for tool categories. */
const TOOL_ICONS: Record<string, string> = {
	read: "\u{1F4D6}",
	write: "\u{270F}\u{FE0F}",
	edit: "\u{1F527}",
	bash: "\u{1F4BB}",
	glob: "\u{1F50D}",
	grep: "\u{1F50E}",
	ask: "\u{2753}",
};

/**
 * Format a tool_use block for display.
 */
export function formatToolCall(block: ToolUseBlock): string {
	const icon = TOOL_ICONS[block.name] ?? "\u{2699}\u{FE0F}";
	const lines: string[] = [];

	lines.push(`${fg(3)}${icon} ${bold(block.name)}${reset()}`);

	// Show key inputs (truncated)
	const input = block.input;
	for (const [key, value] of Object.entries(input)) {
		const strValue = typeof value === "string" ? value : JSON.stringify(value);
		const truncated = strValue.length > 80 ? strValue.slice(0, 77) + "..." : strValue;
		lines.push(`  ${dim(key + ":")} ${truncated}`);
	}

	return lines.join("\n");
}

/**
 * Format a tool_result block for display.
 */
export function formatToolResult(block: ToolResultBlock): string {
	const lines: string[] = [];

	if (block.isError) {
		lines.push(`${fg(1)}${bold("Error:")}${reset()}`);
	} else {
		lines.push(`${fg(2)}${bold("Result:")}${reset()}`);
	}

	// Show output (truncated)
	const output = block.content;
	const outputLines = output.split("\n");
	const maxLines = 20;

	for (let i = 0; i < Math.min(outputLines.length, maxLines); i++) {
		const line = outputLines[i];
		const color = block.isError ? fg(1) : fg(7);
		lines.push(`${color}${line}${reset()}`);
	}

	if (outputLines.length > maxLines) {
		lines.push(dim(`... ${outputLines.length - maxLines} more lines`));
	}

	return lines.join("\n");
}

/**
 * Format a tool execution summary (name + duration).
 */
export function formatToolSummary(
	name: string,
	durationMs: number,
	isError: boolean,
): string {
	const icon = TOOL_ICONS[name] ?? "\u{2699}\u{FE0F}";
	const status = isError
		? `${fg(1)}failed${reset()}`
		: `${fg(2)}done${reset()}`;
	const duration = durationMs < 1000
		? `${durationMs}ms`
		: `${(durationMs / 1000).toFixed(1)}s`;

	return `${icon} ${name} ${status} ${dim(`(${duration})`)}`;
}
