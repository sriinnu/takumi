/**
 * Turn ↔ Message mapper for Phase 19 (Session Recovery & Replay).
 *
 * Converts between the Chitragupta daemon Turn schema and the @takumi/core
 * Message type used by the TUI for conversation display.
 */

import type {
	ContentBlock,
	Message,
	TextBlock,
	ThinkingBlock,
	ToolResultBlock,
	ToolUseBlock,
	Usage,
} from "@takumi/core";
import type { Turn } from "./chitragupta-types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;

/** Generate a deterministic message ID from a turn number. */
function turnId(turnNumber: number): string {
	return `turn-${turnNumber}`;
}

/** Generate a unique message ID (fallback when no turn number is available). */
function _uniqueId(): string {
	return `msg-${Date.now()}-${++_idCounter}`;
}

/**
 * Try to parse a JSON string.  Returns `undefined` on failure.
 */
function tryParseJson(raw: string): unknown | undefined {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * Extract the turn number from a message ID.
 * Returns `NaN` if the ID doesn't follow the `turn-<number>` pattern.
 */
function extractTurnNumber(id: string): number {
	const match = /^turn-(\d+)$/.exec(id);
	return match ? Number(match[1]) : Number.NaN;
}

// ── Turn → Message ───────────────────────────────────────────────────────────

/**
 * Build content blocks from a Turn's fields.
 *
 * Strategy:
 *   1. If `turn.content` is a JSON array of content blocks, use them directly.
 *   2. Otherwise treat `turn.content` as plain text → single TextBlock.
 *   3. Append ToolUseBlock entries from `turn.toolCalls` (if any).
 *   4. Append ToolResultBlock entries from `turn.toolResults` (if any).
 */
function buildContentBlocks(turn: Turn): ContentBlock[] {
	const blocks: ContentBlock[] = [];

	// Attempt to parse content as a JSON array of serialized content blocks
	const parsed = turn.content ? tryParseJson(turn.content) : undefined;

	if (Array.isArray(parsed)) {
		for (const raw of parsed) {
			if (typeof raw !== "object" || raw === null || !("type" in raw)) continue;
			const block = raw as Record<string, unknown>;

			switch (block.type) {
				case "text":
					if (typeof block.text === "string") {
						blocks.push({ type: "text", text: block.text } satisfies TextBlock);
					}
					break;
				case "thinking":
					if (typeof block.thinking === "string") {
						blocks.push({ type: "thinking", thinking: block.thinking } satisfies ThinkingBlock);
					}
					break;
				case "tool_use":
					blocks.push({
						type: "tool_use",
						id: String(block.id ?? ""),
						name: String(block.name ?? ""),
						input: (block.input as Record<string, unknown>) ?? {},
					} satisfies ToolUseBlock);
					break;
				case "tool_result":
					blocks.push({
						type: "tool_result",
						toolUseId: String(block.toolUseId ?? block.tool_use_id ?? ""),
						content: String(block.content ?? ""),
						isError: Boolean(block.isError ?? block.is_error ?? false),
					} satisfies ToolResultBlock);
					break;
				default:
					// Unknown block type — preserve as text if it has any text-like field
					if (typeof block.text === "string") {
						blocks.push({ type: "text", text: block.text } satisfies TextBlock);
					}
					break;
			}
		}
	} else if (turn.content) {
		blocks.push({ type: "text", text: turn.content } satisfies TextBlock);
	}

	// Append separate toolCalls / toolResults arrays (Chitragupta schema)
	if (turn.toolCalls) {
		for (const tc of turn.toolCalls) {
			blocks.push({
				type: "tool_use",
				id: tc.id,
				name: tc.name,
				input: tc.input,
			} satisfies ToolUseBlock);
		}
	}

	if (turn.toolResults) {
		for (const tr of turn.toolResults) {
			blocks.push({
				type: "tool_result",
				toolUseId: tr.id,
				content: tr.output,
				isError: false,
			} satisfies ToolResultBlock);
		}
	}

	return blocks;
}

/**
 * Map Turn token counts → Usage.
 */
function turnTokensToUsage(tokens?: Turn["tokens"]): Usage | undefined {
	if (!tokens) return undefined;
	return {
		inputTokens: tokens.prompt ?? 0,
		outputTokens: tokens.completion ?? 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
}

/**
 * Convert a Chitragupta Turn to a displayable @takumi/core Message.
 *
 * Notes:
 *   - Turn role `"system"` is mapped to `"assistant"` (Message only supports user | assistant).
 *   - If the turn has no content, a placeholder empty TextBlock is produced.
 */
export function turnToMessage(turn: Turn): Message {
	const role: Message["role"] = turn.role === "user" ? "user" : "assistant";
	const blocks = buildContentBlocks(turn);

	// Guarantee at least one content block
	const content: ContentBlock[] = blocks.length > 0 ? blocks : [{ type: "text", text: "" }];

	return {
		id: turnId(turn.number),
		role,
		content,
		timestamp: turn.timestamp ?? Date.now(),
		usage: turnTokensToUsage(turn.tokens),
	};
}

// ── Message → Turn ───────────────────────────────────────────────────────────

/**
 * Extract the primary text content from a Message's content blocks.
 * If the message contains structured blocks (tool_use, thinking, etc.) we
 * serialize the entire array as JSON to preserve round-trip fidelity.
 */
function extractContent(blocks: ContentBlock[]): {
	content: string;
	toolCalls: Turn["toolCalls"];
	toolResults: Turn["toolResults"];
} {
	const textParts: string[] = [];
	const toolCalls: NonNullable<Turn["toolCalls"]> = [];
	const toolResults: NonNullable<Turn["toolResults"]> = [];
	let hasStructured = false;

	for (const block of blocks) {
		switch (block.type) {
			case "text":
				textParts.push(block.text);
				break;
			case "thinking":
				hasStructured = true;
				break;
			case "tool_use":
				hasStructured = true;
				toolCalls.push({ id: block.id, name: block.name, input: block.input });
				break;
			case "tool_result":
				hasStructured = true;
				toolResults.push({ id: block.toolUseId, name: "", output: block.content });
				break;
			case "image":
				hasStructured = true;
				break;
		}
	}

	// When there are structured blocks beyond plain text, serialize the entire
	// array as JSON so that turnToMessage can reconstruct it faithfully.
	const content = hasStructured ? JSON.stringify(blocks) : textParts.join("");

	return {
		content,
		toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
		toolResults: toolResults.length > 0 ? toolResults : undefined,
	};
}

/**
 * Convert a @takumi/core Message back to a Chitragupta Turn.
 *
 * `sessionId` and `project` are required by the Chitragupta schema but are not
 * present on Message, so they must be supplied by the caller.
 */
export function messageToTurn(message: Message, _sessionId: string, _project: string): Turn {
	const turnNumber = extractTurnNumber(message.id);
	const { content, toolCalls, toolResults } = extractContent(message.content);

	const turn: Turn = {
		number: Number.isNaN(turnNumber) ? 0 : turnNumber,
		role: message.role,
		content,
		timestamp: message.timestamp,
	};

	if (message.usage) {
		turn.tokens = {
			prompt: message.usage.inputTokens,
			completion: message.usage.outputTokens,
			total: message.usage.inputTokens + message.usage.outputTokens,
		};
	}

	if (toolCalls) turn.toolCalls = toolCalls;
	if (toolResults) turn.toolResults = toolResults;

	return turn;
}

// ── Batch conversion ─────────────────────────────────────────────────────────

/**
 * Convert an array of Turns to Messages, sorted ascending by turn number.
 */
export function turnsToMessages(turns: Turn[]): Message[] {
	const sorted = [...turns].sort((a, b) => a.number - b.number);
	return sorted.map(turnToMessage);
}
