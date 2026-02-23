/**
 * Error formatter — renders errors in a user-friendly way
 * with context and suggestions.
 */

import { ConfigError, PermissionError, TakumiError, ToolError } from "@takumi/core";
import { bold, dim, fg, reset, wrapText } from "@takumi/render";

/**
 * Format an error for display in the TUI.
 */
export function formatError(error: Error, maxWidth = 80): string {
	const lines: string[] = [];

	// Error header
	lines.push(`${fg(1)}${bold("Error")}${reset()}`);

	if (error instanceof TakumiError) {
		return formatTakumiError(error, maxWidth);
	}

	// Generic error
	lines.push("");
	const wrapped = wrapText(error.message, maxWidth - 2);
	for (const line of wrapped) {
		lines.push(`  ${fg(1)}${line}${reset()}`);
	}

	if (error.stack) {
		lines.push("");
		lines.push(`${dim(`${fg(8)}Stack trace:${reset()}`)}`);
		const stackLines = error.stack.split("\n").slice(1, 5);
		for (const line of stackLines) {
			lines.push(`${dim(`${fg(8)}  ${line.trim()}${reset()}`)}`);
		}
	}

	return lines.join("\n");
}

function formatTakumiError(error: TakumiError, maxWidth: number): string {
	const lines: string[] = [];

	if (error instanceof ConfigError) {
		lines.push(`${fg(1)}${bold("Configuration Error")}${reset()}`);
		lines.push("");
		for (const line of wrapText(error.message, maxWidth - 2)) {
			lines.push(`  ${fg(1)}${line}${reset()}`);
		}
		lines.push("");
		lines.push(`${dim("Tip: Check your config file or environment variables.")}`);
		lines.push(`${dim("  Config locations:")}`);
		lines.push(`${dim("    .takumi/config.json")}`);
		lines.push(`${dim("    ~/.takumi/config.json")}`);
	} else if (error instanceof ToolError) {
		lines.push(`${fg(1)}${bold(`Tool Error: ${error.toolName}`)}${reset()}`);
		lines.push("");
		for (const line of wrapText(error.message, maxWidth - 2)) {
			lines.push(`  ${fg(1)}${line}${reset()}`);
		}
	} else if (error instanceof PermissionError) {
		lines.push(`${fg(3)}${bold("Permission Denied")}${reset()}`);
		lines.push("");
		lines.push(`  Tool: ${fg(3)}${error.tool}${reset()}`);
		lines.push(`  Action: ${error.action}`);
		if (error.message) {
			lines.push("");
			for (const line of wrapText(error.message, maxWidth - 2)) {
				lines.push(`  ${line}`);
			}
		}
	} else {
		lines.push(`${fg(1)}${bold(error.name)}${reset()} [${error.code}]`);
		lines.push("");
		for (const line of wrapText(error.message, maxWidth - 2)) {
			lines.push(`  ${fg(1)}${line}${reset()}`);
		}
	}

	// Cause chain
	if (error.cause instanceof Error) {
		lines.push("");
		lines.push(`${dim(`Caused by: ${error.cause.message}`)}`);
	}

	return lines.join("\n");
}

/**
 * Format a brief error message (single line).
 */
export function formatErrorBrief(error: Error): string {
	if (error instanceof ToolError) {
		return `${fg(1)}[${error.toolName}] ${error.message}${reset()}`;
	}
	return `${fg(1)}${error.message}${reset()}`;
}
