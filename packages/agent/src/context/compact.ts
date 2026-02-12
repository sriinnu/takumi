/**
 * History compaction — summarizes old conversation turns to stay
 * within context window limits.
 */

import type { Message, ContentBlock, Usage } from "@takumi/core";
import { createLogger } from "@takumi/core";

const log = createLogger("compact");

export interface CompactOptions {
	/** Maximum number of recent turns to keep in full. */
	keepRecent?: number;

	/** Maximum total estimated tokens before triggering compaction. */
	maxTokens?: number;
}

export interface CompactResult {
	/** The compacted message history. */
	messages: Message[];

	/** Summary of compacted turns. */
	summary: string;

	/** Number of turns that were compacted. */
	compactedTurns: number;
}

/**
 * Estimate token count for a message (rough: 1 token per 4 chars).
 */
function estimateTokens(message: Message): number {
	let chars = 0;
	for (const block of message.content) {
		switch (block.type) {
			case "text":
				chars += block.text.length;
				break;
			case "thinking":
				chars += block.thinking.length;
				break;
			case "tool_use":
				chars += JSON.stringify(block.input).length;
				break;
			case "tool_result":
				chars += block.content.length;
				break;
		}
	}
	return Math.ceil(chars / 4);
}

/**
 * Compact conversation history by summarizing older turns.
 */
export function compactHistory(
	messages: Message[],
	options?: CompactOptions,
): CompactResult {
	const keepRecent = options?.keepRecent ?? 10;
	const maxTokens = options?.maxTokens ?? 100_000;

	// Calculate total tokens
	let totalTokens = 0;
	for (const msg of messages) {
		totalTokens += estimateTokens(msg);
	}

	// No compaction needed
	if (totalTokens <= maxTokens || messages.length <= keepRecent) {
		return {
			messages,
			summary: "",
			compactedTurns: 0,
		};
	}

	log.info(`Compacting: ${messages.length} messages, ~${totalTokens} tokens`);

	// Split: older turns to compact, recent turns to keep
	const splitIndex = messages.length - keepRecent;
	const toCompact = messages.slice(0, splitIndex);
	const toKeep = messages.slice(splitIndex);

	// Build summary of compacted turns
	const summaryParts: string[] = [
		`[Conversation summary — ${toCompact.length} earlier turns compacted]`,
		"",
	];

	for (const msg of toCompact) {
		const role = msg.role === "user" ? "User" : "Assistant";
		const preview = summarizeMessage(msg);
		if (preview) {
			summaryParts.push(`${role}: ${preview}`);
		}
	}

	const summary = summaryParts.join("\n");

	// Create a synthetic summary message
	const summaryMessage: Message = {
		id: "compact-summary",
		role: "user",
		content: [{ type: "text", text: summary }],
		timestamp: toCompact[0]?.timestamp ?? Date.now(),
	};

	const compactedMessages = [summaryMessage, ...toKeep];

	log.info(`Compacted: ${toCompact.length} turns -> summary, keeping ${toKeep.length} recent turns`);

	return {
		messages: compactedMessages,
		summary,
		compactedTurns: toCompact.length,
	};
}

/** Create a brief summary of a message for compaction. */
function summarizeMessage(message: Message): string {
	const parts: string[] = [];

	for (const block of message.content) {
		switch (block.type) {
			case "text": {
				// First 100 chars of text
				const text = block.text.trim();
				if (text) {
					parts.push(text.length > 100 ? text.slice(0, 100) + "..." : text);
				}
				break;
			}
			case "tool_use":
				parts.push(`[Used tool: ${block.name}]`);
				break;
			case "tool_result":
				parts.push(`[Tool result: ${block.isError ? "error" : "success"}]`);
				break;
			case "thinking":
				parts.push("[thinking]");
				break;
		}
	}

	return parts.join(" ");
}
