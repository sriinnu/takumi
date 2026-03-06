/**
 * History compaction — summarizes old conversation turns to stay
 * within context window limits.
 *
 * Two APIs:
 *   1. compactHistory()  — works with core Message[] (high-level)
 *   2. shouldCompact() / compactMessages() — works with MessagePayload[]
 *      (used directly in the agent loop)
 */

import type { Message } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { MessagePayload } from "../loop.js";

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
export function compactHistory(messages: Message[], options?: CompactOptions): CompactResult {
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
	const summaryParts: string[] = [`[Conversation summary — ${toCompact.length} earlier turns compacted]`, ""];

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

// ── MessagePayload-based compaction (for agent loop) ─────────────────────────

export interface PayloadCompactOptions {
	/** Context window size in tokens. */
	maxTokens: number;

	/** Compact when estimated tokens exceed this fraction of maxTokens (default: 0.8). */
	threshold: number;

	/** Number of recent messages to keep intact (default: 6). */
	preserveRecent: number;

	/** Always keep the system message (default: true). */
	preserveSystem: boolean;
}

export interface PayloadCompactionResult {
	messages: MessagePayload[];
	summary: string;
	compactedMessages: MessagePayload[];
	preservedMessages: MessagePayload[];
	keptMessages: MessagePayload[];
}

export const DEFAULT_COMPACT_OPTIONS: PayloadCompactOptions = {
	maxTokens: 200_000,
	threshold: 0.8,
	preserveRecent: 6,
	preserveSystem: true,
};

/**
 * Estimate the token count for a MessagePayload.
 * Uses the rough heuristic of ~4 chars per token.
 */
export function estimatePayloadTokens(message: MessagePayload): number {
	const content = message.content;
	let chars = 0;

	if (typeof content === "string") {
		chars = content.length;
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (typeof block === "string") {
				chars += block.length;
			} else if (block && typeof block === "object") {
				if ("text" in block && typeof block.text === "string") {
					chars += block.text.length;
				}
				if ("thinking" in block && typeof block.thinking === "string") {
					chars += block.thinking.length;
				}
				if ("input" in block && block.input !== undefined) {
					chars += JSON.stringify(block.input).length;
				}
				if ("content" in block && typeof block.content === "string") {
					chars += block.content.length;
				}
				if ("partial_json" in block && typeof block.partial_json === "string") {
					chars += block.partial_json.length;
				}
			}
		}
	} else if (content && typeof content === "object") {
		chars = JSON.stringify(content).length;
	}

	return Math.ceil(chars / 4);
}

/**
 * Estimate total tokens for an array of MessagePayload.
 */
export function estimateTotalPayloadTokens(messages: MessagePayload[]): number {
	let total = 0;
	for (const msg of messages) {
		total += estimatePayloadTokens(msg);
	}
	return total;
}

/**
 * Determine whether context compaction is needed.
 *
 * Returns true when estimated tokens exceed maxTokens * threshold.
 */
export function shouldCompact(
	_messages: MessagePayload[],
	estimatedTokens: number,
	maxTokens: number,
	threshold?: number,
): boolean {
	const t = threshold ?? DEFAULT_COMPACT_OPTIONS.threshold;
	return estimatedTokens > maxTokens * t;
}

/**
 * Compact an array of MessagePayload by summarizing older messages.
 *
 * - Keeps the last `preserveRecent` messages intact.
 * - Preserves tool_result messages referenced by recent tool_use blocks.
 * - Summarizes everything else into a single "Previous conversation summary" message.
 */
export function compactMessages(
	messages: MessagePayload[],
	options: Partial<PayloadCompactOptions> = {},
): MessagePayload[] {
	return compactMessagesDetailed(messages, options).messages;
}

export function compactMessagesDetailed(
	messages: MessagePayload[],
	options: Partial<PayloadCompactOptions> = {},
): PayloadCompactionResult {
	const opts: PayloadCompactOptions = { ...DEFAULT_COMPACT_OPTIONS, ...options };

	if (messages.length <= opts.preserveRecent) {
		return {
			messages,
			summary: "",
			compactedMessages: [],
			preservedMessages: [],
			keptMessages: messages,
		};
	}

	const splitIndex = messages.length - opts.preserveRecent;
	const toCompact = messages.slice(0, splitIndex);
	const toKeep = messages.slice(splitIndex);

	log.info(`Compacting payload: ${toCompact.length} older messages, keeping ${toKeep.length} recent`);

	// Collect tool_use IDs from recent messages that may reference older tool_results
	const recentToolUseIds = new Set<string>();
	for (const msg of toKeep) {
		if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block && typeof block === "object" && "type" in block) {
					if (block.type === "tool_use" && "id" in block) {
						recentToolUseIds.add(block.id as string);
					}
				}
			}
		}
	}

	// Build summary from older messages, preserving referenced tool_results
	const summaryParts: string[] = ["Previous conversation summary:", ""];

	const preservedMessages: MessagePayload[] = [];

	for (const msg of toCompact) {
		const preview = summarizePayloadMessage(msg);
		if (preview) {
			const role = msg.role === "user" ? "User" : "Assistant";
			summaryParts.push(`- ${role}: ${preview}`);
		}

		// Preserve tool_result messages referenced by recent tool_use blocks
		if (Array.isArray(msg.content)) {
			let isReferenced = false;
			for (const block of msg.content) {
				if (
					block &&
					typeof block === "object" &&
					"type" in block &&
					block.type === "tool_result" &&
					"tool_use_id" in block &&
					recentToolUseIds.has(block.tool_use_id as string)
				) {
					isReferenced = true;
					break;
				}
			}
			if (isReferenced) {
				preservedMessages.push(msg);
			}
		}
	}

	const summaryText = summaryParts.join("\n");
	const summaryMessage: MessagePayload = {
		role: "user",
		content: [{ type: "text", text: summaryText }],
	};

	const result = [summaryMessage, ...preservedMessages, ...toKeep];

	log.info(`Compaction complete: ${messages.length} -> ${result.length} messages`);

	return {
		messages: result,
		summary: summaryText,
		compactedMessages: toCompact,
		preservedMessages,
		keptMessages: toKeep,
	};
}

/** Create a brief summary of a MessagePayload. */
function summarizePayloadMessage(msg: MessagePayload): string {
	const parts: string[] = [];
	const content = msg.content;

	if (typeof content === "string") {
		const text = content.trim();
		if (text) {
			parts.push(text.length > 80 ? `${text.slice(0, 80)}...` : text);
		}
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (typeof block === "string") {
				const text = block.trim();
				if (text) {
					parts.push(text.length > 80 ? `${text.slice(0, 80)}...` : text);
				}
			} else if (block && typeof block === "object" && "type" in block) {
				switch (block.type) {
					case "text": {
						const text = ("text" in block ? (block.text as string) : "").trim();
						if (text) {
							parts.push(text.length > 80 ? `${text.slice(0, 80)}...` : text);
						}
						break;
					}
					case "tool_use":
						parts.push(`[tool: ${(block as any).name ?? "unknown"}]`);
						break;
					case "tool_result":
						parts.push(`[result: ${(block as any).is_error ? "error" : "ok"}]`);
						break;
					case "thinking":
						parts.push("[thinking]");
						break;
				}
			}
		}
	}

	return parts.join(" ");
}

/** Create a brief summary of a core Message for compaction. */
function summarizeMessage(message: Message): string {
	const parts: string[] = [];

	for (const block of message.content) {
		switch (block.type) {
			case "text": {
				// First 100 chars of text
				const text = block.text.trim();
				if (text) {
					parts.push(text.length > 100 ? `${text.slice(0, 100)}...` : text);
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
