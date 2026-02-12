/**
 * Message formatters — convert Message objects into display-ready strings.
 */

import type { Message, ContentBlock } from "@takumi/core";
import { bold, dim, fg, reset } from "@takumi/render";

/**
 * Format a user message for display.
 */
export function formatUserMessage(message: Message): string {
	const lines: string[] = [];
	lines.push(`${bold(fg(14) + "You" + reset())}`);

	for (const block of message.content) {
		if (block.type === "text") {
			lines.push(block.text);
		}
	}

	return lines.join("\n");
}

/**
 * Format an assistant message for display.
 */
export function formatAssistantMessage(message: Message): string {
	const lines: string[] = [];
	lines.push(`${bold(fg(12) + "Takumi" + reset())}`);

	for (const block of message.content) {
		switch (block.type) {
			case "text":
				lines.push(block.text);
				break;
			case "thinking":
				lines.push(`${dim(fg(8) + "[thinking] " + block.thinking.slice(0, 100) + "..." + reset())}`);
				break;
			case "tool_use":
				lines.push(`${fg(3)}[tool: ${block.name}]${reset()}`);
				break;
			case "tool_result":
				if (block.isError) {
					lines.push(`${fg(1)}[error] ${block.content.slice(0, 200)}${reset()}`);
				} else {
					lines.push(`${fg(2)}[result] ${block.content.slice(0, 200)}${reset()}`);
				}
				break;
		}
	}

	// Usage info
	if (message.usage) {
		const u = message.usage;
		lines.push(
			dim(`${fg(8)}(${u.inputTokens} in, ${u.outputTokens} out)${reset()}`),
		);
	}

	return lines.join("\n");
}

/**
 * Format a message (auto-detect role).
 */
export function formatMessage(message: Message): string {
	if (message.role === "user") return formatUserMessage(message);
	return formatAssistantMessage(message);
}
