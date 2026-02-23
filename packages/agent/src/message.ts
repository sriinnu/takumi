/**
 * Message construction utilities for the agent loop.
 * Builds system prompts, user messages, and tool result blocks.
 */

import type { ToolDefinition, ToolResult } from "@takumi/core";

/**
 * Build the system prompt including available tool descriptions.
 */
export function buildSystemPrompt(tools: ToolDefinition[]): string {
	const lines: string[] = [
		"You are Takumi, an AI coding assistant running in a terminal.",
		"You help users with software development tasks by reading, writing, and editing code.",
		"",
		"## Guidelines",
		"- Be concise and direct in your responses.",
		"- Use tools to accomplish tasks rather than just describing what to do.",
		"- When editing files, prefer making targeted edits over rewriting entire files.",
		"- Always verify your changes work by reading the result.",
		"- When searching for code, start broad and narrow down.",
		"- For file operations, always use absolute paths.",
		"",
		"## Available Tools",
		"",
	];

	for (const tool of tools) {
		lines.push(`### ${tool.name}`);
		lines.push(tool.description);
		lines.push(`Category: ${tool.category}`);
		if (tool.requiresPermission) {
			lines.push("Requires user permission.");
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Build the content array for a user message.
 */
export function buildUserMessage(text: string): any[] {
	return [{ type: "text", text }];
}

/**
 * Build a tool_result content block for the message history.
 */
export function buildToolResult(toolUseId: string, result: ToolResult): any {
	return {
		type: "tool_result",
		tool_use_id: toolUseId,
		content: result.output,
		is_error: result.isError,
	};
}
