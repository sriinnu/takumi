/**
 * Enhanced Conversation Compaction Engine (Phase 36)
 *
 * MemGPT-style virtual context management that continuously tracks
 * token budget and provides tiered compaction strategies:
 *
 *   - **Gentle** (≥80% context): summarize oldest N turns, keep recent 10
 *   - **Aggressive** (≥95% context): also truncate tool results + strip thinking blocks
 *
 * Emits a `context_compact` event description when compaction fires.
 *
 * This is a higher-level engine that sits above the basic `compactMessages()`
 * utility in compact.ts.
 */

import { createLogger } from "@takumi/core";
import type { MessagePayload } from "../loop.js";
import { estimateTotalPayloadTokens } from "./compact.js";

const log = createLogger("compactor");

// ── Configuration ────────────────────────────────────────────────────────────

export interface CompactorConfig {
	/** Maximum context window size in tokens. */
	maxContextTokens: number;
	/** Fraction of maxContextTokens that triggers gentle compaction (default 0.8). */
	compactThreshold: number;
	/** Number of most-recent turns to keep uncompacted (default 10). */
	keepRecentTurns: number;
	/** Max lines kept from a single tool result before truncation (default 200). */
	toolResultMaxLines: number;
	/** Fraction of maxContextTokens that triggers aggressive compaction (default 0.95). */
	aggressiveThreshold: number;
}

const DEFAULT_CONFIG: CompactorConfig = {
	maxContextTokens: 200_000,
	compactThreshold: 0.8,
	keepRecentTurns: 10,
	toolResultMaxLines: 200,
	aggressiveThreshold: 0.95,
};

// ── Result type ──────────────────────────────────────────────────────────────

export interface CompactionResult {
	/** Whether any compaction was performed. */
	compacted: boolean;
	/** Which strategy was used. */
	strategy: "none" | "gentle" | "aggressive";
	/** Number of turns removed/summarized. */
	removedTurns: number;
	/** Estimated tokens saved. */
	savedTokens: number;
	/** Human-readable summary of the compacted turns. */
	summary: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract plain text from a content block (best-effort). */
function blockText(block: unknown): string {
	if (typeof block === "string") return block;
	if (!block || typeof block !== "object") return "";
	const b = block as Record<string, unknown>;
	if (typeof b.text === "string") return b.text;
	if (typeof b.thinking === "string") return b.thinking;
	if (typeof b.content === "string") return b.content;
	if (b.input !== undefined) return JSON.stringify(b.input);
	return "";
}

/** Get the `type` field of a content block, if any. */
function blockType(block: unknown): string | undefined {
	if (!block || typeof block !== "object") return undefined;
	const b = block as Record<string, unknown>;
	return typeof b.type === "string" ? b.type : undefined;
}

/** Get the tool name from a tool_use block. */
function blockToolName(block: unknown): string {
	if (!block || typeof block !== "object") return "unknown";
	const b = block as Record<string, unknown>;
	return typeof b.name === "string" ? b.name : "unknown";
}

/** Check if a tool_result block is an error. */
function blockIsError(block: unknown): boolean {
	if (!block || typeof block !== "object") return false;
	const b = block as Record<string, unknown>;
	return b.is_error === true || b.isError === true;
}

/**
 * Count the number of newlines in a string (line count = newlines + 1 for
 * non-empty strings).
 */
function lineCount(text: string): number {
	if (text.length === 0) return 0;
	let count = 1;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) count++;
	}
	return count;
}

/**
 * Keep only the first N/2 and last N/2 lines of a string, inserting an
 * ellipsis marker in between.
 */
function truncateLines(text: string, maxLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;

	const half = Math.floor(maxLines / 2);
	const head = lines.slice(0, half);
	const tail = lines.slice(-half);
	const omitted = lines.length - half * 2;

	return [...head, `\n... (${omitted} lines omitted) ...\n`, ...tail].join("\n");
}

/** Produce a one-line preview of a message for summary text. */
function previewMessage(msg: MessagePayload): string {
	const parts: string[] = [];
	const content = msg.content;

	if (typeof content === "string") {
		const t = content.trim();
		if (t) parts.push(t.length > 80 ? `${t.slice(0, 80)}…` : t);
		return parts.join(" ");
	}

	if (!Array.isArray(content)) return "";

	for (const block of content) {
		const type = blockType(block);
		switch (type) {
			case "text": {
				const t = blockText(block).trim();
				if (t) parts.push(t.length > 80 ? `${t.slice(0, 80)}…` : t);
				break;
			}
			case "tool_use":
				parts.push(`[tool: ${blockToolName(block)}]`);
				break;
			case "tool_result":
				parts.push(`[result: ${blockIsError(block) ? "error" : "ok"}]`);
				break;
			case "thinking":
				parts.push("[thinking]");
				break;
			default: {
				// Fallback for plain string blocks
				if (typeof block === "string") {
					const t = block.trim();
					if (t) parts.push(t.length > 80 ? `${t.slice(0, 80)}…` : t);
				}
				break;
			}
		}
	}
	return parts.join(" ");
}

// ── ConversationCompactor ────────────────────────────────────────────────────

export class ConversationCompactor {
	readonly config: CompactorConfig;

	constructor(config?: Partial<CompactorConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ── Public API ───────────────────────────────────────────────────────────

	/**
	 * Main entry point. Decides whether to compact, picks a strategy,
	 * mutates the `messages` array in-place, and returns a result
	 * describing what happened.
	 */
	compact(messages: MessagePayload[], currentTokens: number): CompactionResult {
		const { maxContextTokens, compactThreshold, aggressiveThreshold, keepRecentTurns } = this.config;
		const ratio = currentTokens / maxContextTokens;

		// No compaction needed
		if (ratio < compactThreshold || messages.length <= keepRecentTurns) {
			return { compacted: false, strategy: "none", removedTurns: 0, savedTokens: 0, summary: "" };
		}

		const strategy: "gentle" | "aggressive" = ratio >= aggressiveThreshold ? "aggressive" : "gentle";
		log.info(`Compaction triggered (${(ratio * 100).toFixed(1)}% full) — strategy: ${strategy}`);

		const tokensBefore = estimateTotalPayloadTokens(messages);

		// Step 1: Aggressive-only — truncate tool results & strip thinking blocks
		if (strategy === "aggressive") {
			this.truncateToolResults(messages);
			this.stripThinkingBlocks(messages);
		}

		// Step 2: Summarize oldest turns
		const splitIndex = messages.length - keepRecentTurns;
		if (splitIndex <= 0) {
			// Nothing to summarize — only truncation was possible
			const tokensAfter = estimateTotalPayloadTokens(messages);
			const saved = tokensBefore - tokensAfter;
			return {
				compacted: saved > 0,
				strategy: saved > 0 ? strategy : "none",
				removedTurns: 0,
				savedTokens: Math.max(0, saved),
				summary: "",
			};
		}

		const toCompact = messages.slice(0, splitIndex);
		const summary = this.summarizeTurns(messages, 0, splitIndex - 1);

		const summaryMessage: MessagePayload = {
			role: "user",
			content: [{ type: "text", text: summary }],
		};

		// Replace messages in-place
		const kept = messages.slice(splitIndex);
		messages.length = 0;
		messages.push(summaryMessage, ...kept);

		const tokensAfter = estimateTotalPayloadTokens(messages);
		const savedTokens = Math.max(0, tokensBefore - tokensAfter);

		log.info(
			`Compacted ${toCompact.length} turns → summary ` +
				`(${tokensBefore} → ${tokensAfter} tokens, saved ${savedTokens})`,
		);

		return {
			compacted: true,
			strategy,
			removedTurns: toCompact.length,
			savedTokens,
			summary,
		};
	}

	/**
	 * Truncate oversized tool results in the message array.
	 *
	 * Tool result blocks whose text content exceeds `toolResultMaxLines` are
	 * replaced with a head/tail excerpt. Operates in-place.
	 *
	 * @returns estimated tokens saved.
	 */
	truncateToolResults(messages: MessagePayload[]): number {
		const { toolResultMaxLines } = this.config;
		let saved = 0;

		for (const msg of messages) {
			if (!Array.isArray(msg.content)) continue;

			for (let i = 0; i < msg.content.length; i++) {
				const block = msg.content[i];
				const type = blockType(block);
				if (type !== "tool_result") continue;

				const text = blockText(block);
				if (lineCount(text) <= toolResultMaxLines) continue;

				const charsBefore = text.length;
				const truncated = truncateLines(text, toolResultMaxLines);

				// Mutate block in-place
				if (typeof block === "object" && block !== null) {
					(block as Record<string, unknown>).content = truncated;
				}

				const charsSaved = charsBefore - truncated.length;
				saved += Math.ceil(charsSaved / 4); // same heuristic as estimatePayloadTokens
			}
		}

		if (saved > 0) {
			log.info(`Truncated tool results, saved ~${saved} tokens`);
		}
		return saved;
	}

	/**
	 * Build a human-readable summary of turns from `startIdx` to `endIdx`
	 * (inclusive) within the `messages` array.
	 */
	summarizeTurns(messages: MessagePayload[], startIdx: number, endIdx: number): string {
		const clamped = {
			start: Math.max(0, startIdx),
			end: Math.min(messages.length - 1, endIdx),
		};
		const count = clamped.end - clamped.start + 1;
		if (count <= 0) return "";

		const lines: string[] = [`[Conversation summary — ${count} earlier turn${count === 1 ? "" : "s"} compacted]`, ""];

		for (let i = clamped.start; i <= clamped.end; i++) {
			const msg = messages[i];
			const role = msg.role === "user" ? "User" : "Assistant";
			const preview = previewMessage(msg);
			if (preview) {
				lines.push(`- ${role}: ${preview}`);
			}
		}

		return lines.join("\n");
	}

	// ── Internal helpers ─────────────────────────────────────────────────────

	/**
	 * Strip thinking blocks from all messages (aggressive strategy only).
	 * Operates in-place.
	 */
	private stripThinkingBlocks(messages: MessagePayload[]): void {
		for (const msg of messages) {
			if (!Array.isArray(msg.content)) continue;
			msg.content = msg.content.filter((b) => blockType(b) !== "thinking");
		}
	}
}
