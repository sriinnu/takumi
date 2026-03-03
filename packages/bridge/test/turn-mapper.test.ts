import type { ContentBlock, Message } from "@takumi/core";
import { describe, expect, it } from "vitest";
import type { Turn } from "../src/chitragupta-types.js";
import { messageToTurn, turnsToMessages, turnToMessage } from "../src/turn-mapper.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function textTurn(number: number, role: Turn["role"], text: string): Turn {
	return { number, role, content: text, timestamp: NOW };
}

function assistantTurnWithTokens(number: number, text: string): Turn {
	return {
		number,
		role: "assistant",
		content: text,
		timestamp: NOW,
		model: "claude-opus-4-0-20250514",
		tokens: { prompt: 100, completion: 200, total: 300 },
		costUsd: 0.005,
	};
}

function toolUseTurn(number: number): Turn {
	return {
		number,
		role: "assistant",
		content: "Let me search for that.",
		timestamp: NOW,
		toolCalls: [
			{ id: "tc-1", name: "file_search", input: { query: "*.ts" } },
			{ id: "tc-2", name: "grep_search", input: { pattern: "TODO" } },
		],
	};
}

function toolResultTurn(number: number): Turn {
	return {
		number,
		role: "assistant",
		content: "Here are the results.",
		timestamp: NOW,
		toolResults: [{ id: "tc-1", name: "file_search", output: "Found 3 files" }],
	};
}

function thinkingTurn(number: number): Turn {
	const blocks = [
		{ type: "thinking", thinking: "Analyzing the codebase..." },
		{ type: "text", text: "Here is what I found." },
	];
	return {
		number,
		role: "assistant",
		content: JSON.stringify(blocks),
		timestamp: NOW,
	};
}

function textMessage(id: string, role: Message["role"], text: string): Message {
	return {
		id,
		role,
		content: [{ type: "text", text }],
		timestamp: NOW,
	};
}

// ── turnToMessage ────────────────────────────────────────────────────────────

describe("turnToMessage", () => {
	it("converts a basic text user turn", () => {
		const turn = textTurn(1, "user", "Hello world");
		const msg = turnToMessage(turn);

		expect(msg.id).toBe("turn-1");
		expect(msg.role).toBe("user");
		expect(msg.content).toEqual([{ type: "text", text: "Hello world" }]);
		expect(msg.timestamp).toBe(NOW);
		expect(msg.usage).toBeUndefined();
	});

	it("converts a basic text assistant turn", () => {
		const turn = textTurn(2, "assistant", "Hi there!");
		const msg = turnToMessage(turn);

		expect(msg.id).toBe("turn-2");
		expect(msg.role).toBe("assistant");
		expect(msg.content).toEqual([{ type: "text", text: "Hi there!" }]);
	});

	it("maps system role to assistant", () => {
		const turn = textTurn(0, "system", "System message");
		const msg = turnToMessage(turn);

		expect(msg.role).toBe("assistant");
	});

	it("maps token counts to usage", () => {
		const turn = assistantTurnWithTokens(3, "Response");
		const msg = turnToMessage(turn);

		expect(msg.usage).toEqual({
			inputTokens: 100,
			outputTokens: 200,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	});

	it("converts turn with toolCalls into ToolUseBlocks", () => {
		const turn = toolUseTurn(4);
		const msg = turnToMessage(turn);

		// First block: text content
		expect(msg.content[0]).toEqual({ type: "text", text: "Let me search for that." });

		// Second & third: tool_use blocks from toolCalls array
		expect(msg.content[1]).toEqual({
			type: "tool_use",
			id: "tc-1",
			name: "file_search",
			input: { query: "*.ts" },
		});
		expect(msg.content[2]).toEqual({
			type: "tool_use",
			id: "tc-2",
			name: "grep_search",
			input: { pattern: "TODO" },
		});
	});

	it("converts turn with toolResults into ToolResultBlocks", () => {
		const turn = toolResultTurn(5);
		const msg = turnToMessage(turn);

		expect(msg.content).toHaveLength(2);
		expect(msg.content[1]).toEqual({
			type: "tool_result",
			toolUseId: "tc-1",
			content: "Found 3 files",
			isError: false,
		});
	});

	it("converts turn with JSON content blocks (thinking + text)", () => {
		const turn = thinkingTurn(6);
		const msg = turnToMessage(turn);

		expect(msg.content).toHaveLength(2);
		expect(msg.content[0]).toEqual({ type: "thinking", thinking: "Analyzing the codebase..." });
		expect(msg.content[1]).toEqual({ type: "text", text: "Here is what I found." });
	});

	it("handles JSON content with tool_use blocks inline", () => {
		const blocks = [
			{ type: "text", text: "Processing..." },
			{ type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } },
		];
		const turn: Turn = {
			number: 7,
			role: "assistant",
			content: JSON.stringify(blocks),
			timestamp: NOW,
		};
		const msg = turnToMessage(turn);

		expect(msg.content).toHaveLength(2);
		expect(msg.content[0]).toEqual({ type: "text", text: "Processing..." });
		expect(msg.content[1]).toEqual({ type: "tool_use", id: "t1", name: "bash", input: { command: "ls" } });
	});

	it("handles JSON content with tool_result blocks inline", () => {
		const blocks = [{ type: "tool_result", toolUseId: "t1", content: "file.ts", isError: false }];
		const turn: Turn = {
			number: 8,
			role: "assistant",
			content: JSON.stringify(blocks),
			timestamp: NOW,
		};
		const msg = turnToMessage(turn);

		expect(msg.content).toHaveLength(1);
		expect(msg.content[0]).toEqual({
			type: "tool_result",
			toolUseId: "t1",
			content: "file.ts",
			isError: false,
		});
	});

	it("produces an empty TextBlock for empty content", () => {
		const turn: Turn = { number: 9, role: "user", content: "", timestamp: NOW };
		const msg = turnToMessage(turn);

		expect(msg.content).toEqual([{ type: "text", text: "" }]);
	});

	it("uses Date.now() when turn has no timestamp", () => {
		const before = Date.now();
		const turn: Turn = { number: 10, role: "user", content: "No timestamp" };
		const msg = turnToMessage(turn);
		const after = Date.now();

		expect(msg.timestamp).toBeGreaterThanOrEqual(before);
		expect(msg.timestamp).toBeLessThanOrEqual(after);
	});

	it("skips malformed JSON array entries gracefully", () => {
		const blocks = ["not an object", { type: "text", text: "valid" }, { noType: true }, null];
		const turn: Turn = {
			number: 11,
			role: "assistant",
			content: JSON.stringify(blocks),
			timestamp: NOW,
		};
		const msg = turnToMessage(turn);

		// Only the valid text block should be produced
		expect(msg.content).toEqual([{ type: "text", text: "valid" }]);
	});

	it("handles unknown block types with text fallback", () => {
		const blocks = [
			{ type: "custom_widget", text: "fallback text" },
			{ type: "text", text: "normal" },
		];
		const turn: Turn = {
			number: 12,
			role: "assistant",
			content: JSON.stringify(blocks),
			timestamp: NOW,
		};
		const msg = turnToMessage(turn);

		expect(msg.content).toHaveLength(2);
		// Unknown type with text field falls back to TextBlock
		expect(msg.content[0]).toEqual({ type: "text", text: "fallback text" });
		expect(msg.content[1]).toEqual({ type: "text", text: "normal" });
	});

	it("ignores unknown block types without text field", () => {
		const blocks = [
			{ type: "unknown_no_text", data: 42 },
			{ type: "text", text: "kept" },
		];
		const turn: Turn = {
			number: 13,
			role: "assistant",
			content: JSON.stringify(blocks),
			timestamp: NOW,
		};
		const msg = turnToMessage(turn);

		expect(msg.content).toEqual([{ type: "text", text: "kept" }]);
	});
});

// ── messageToTurn ────────────────────────────────────────────────────────────

describe("messageToTurn", () => {
	it("converts a basic text message", () => {
		const msg = textMessage("turn-1", "user", "Hello");
		const turn = messageToTurn(msg, "sess-1", "/project");

		expect(turn.number).toBe(1);
		expect(turn.role).toBe("user");
		expect(turn.content).toBe("Hello");
		expect(turn.timestamp).toBe(NOW);
		expect(turn.toolCalls).toBeUndefined();
		expect(turn.toolResults).toBeUndefined();
	});

	it("extracts turn number from turn-N id pattern", () => {
		const msg = textMessage("turn-42", "assistant", "Answer");
		const turn = messageToTurn(msg, "s", "p");

		expect(turn.number).toBe(42);
	});

	it("defaults turn number to 0 for non-matching IDs", () => {
		const msg = textMessage("msg-abc-123", "user", "Hmm");
		const turn = messageToTurn(msg, "s", "p");

		expect(turn.number).toBe(0);
	});

	it("maps usage back to tokens", () => {
		const msg: Message = {
			id: "turn-5",
			role: "assistant",
			content: [{ type: "text", text: "Response" }],
			timestamp: NOW,
			usage: { inputTokens: 50, outputTokens: 150, cacheReadTokens: 10, cacheWriteTokens: 5 },
		};
		const turn = messageToTurn(msg, "s", "p");

		expect(turn.tokens).toEqual({
			prompt: 50,
			completion: 150,
			total: 200,
		});
	});

	it("extracts toolCalls from ToolUseBlocks", () => {
		const msg: Message = {
			id: "turn-6",
			role: "assistant",
			content: [
				{ type: "text", text: "Searching..." },
				{ type: "tool_use", id: "tc-1", name: "bash", input: { command: "ls" } },
			],
			timestamp: NOW,
		};
		const turn = messageToTurn(msg, "s", "p");

		expect(turn.toolCalls).toEqual([{ id: "tc-1", name: "bash", input: { command: "ls" } }]);
		// Content should be JSON (structured blocks present)
		expect(() => JSON.parse(turn.content)).not.toThrow();
	});

	it("extracts toolResults from ToolResultBlocks", () => {
		const msg: Message = {
			id: "turn-7",
			role: "user",
			content: [{ type: "tool_result", toolUseId: "tc-1", content: "output here", isError: false }],
			timestamp: NOW,
		};
		const turn = messageToTurn(msg, "s", "p");

		expect(turn.toolResults).toEqual([{ id: "tc-1", name: "", output: "output here" }]);
	});

	it("serializes structured content as JSON for round-trip fidelity", () => {
		const msg: Message = {
			id: "turn-8",
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Let me think..." },
				{ type: "text", text: "Done." },
			],
			timestamp: NOW,
		};
		const turn = messageToTurn(msg, "s", "p");

		const parsed = JSON.parse(turn.content) as ContentBlock[];
		expect(parsed).toHaveLength(2);
		expect(parsed[0]).toEqual({ type: "thinking", thinking: "Let me think..." });
		expect(parsed[1]).toEqual({ type: "text", text: "Done." });
	});

	it("joins multiple TextBlocks into plain content when no structured blocks", () => {
		const msg: Message = {
			id: "turn-9",
			role: "assistant",
			content: [
				{ type: "text", text: "Part 1. " },
				{ type: "text", text: "Part 2." },
			],
			timestamp: NOW,
		};
		const turn = messageToTurn(msg, "s", "p");

		expect(turn.content).toBe("Part 1. Part 2.");
	});
});

// ── turnsToMessages ──────────────────────────────────────────────────────────

describe("turnsToMessages", () => {
	it("converts and sorts by turn number ascending", () => {
		const turns: Turn[] = [
			textTurn(3, "assistant", "Third"),
			textTurn(1, "user", "First"),
			textTurn(2, "assistant", "Second"),
		];
		const messages = turnsToMessages(turns);

		expect(messages).toHaveLength(3);
		expect(messages[0].id).toBe("turn-1");
		expect(messages[1].id).toBe("turn-2");
		expect(messages[2].id).toBe("turn-3");

		expect(messages[0].content[0]).toEqual({ type: "text", text: "First" });
		expect(messages[1].content[0]).toEqual({ type: "text", text: "Second" });
		expect(messages[2].content[0]).toEqual({ type: "text", text: "Third" });
	});

	it("returns empty array for empty input", () => {
		expect(turnsToMessages([])).toEqual([]);
	});

	it("does not mutate the original array", () => {
		const turns: Turn[] = [textTurn(2, "assistant", "B"), textTurn(1, "user", "A")];
		const original = [...turns];
		turnsToMessages(turns);

		expect(turns[0].number).toBe(original[0].number);
		expect(turns[1].number).toBe(original[1].number);
	});
});

// ── Round-trip fidelity ──────────────────────────────────────────────────────

describe("round-trip fidelity", () => {
	it("turn → message → turn preserves key data (text)", () => {
		const original = textTurn(1, "user", "Hello roundtrip");
		const msg = turnToMessage(original);
		const restored = messageToTurn(msg, "sess", "/proj");

		expect(restored.number).toBe(original.number);
		expect(restored.role).toBe(original.role);
		expect(restored.content).toBe(original.content);
		expect(restored.timestamp).toBe(original.timestamp);
	});

	it("turn → message → turn preserves key data (assistant with tokens)", () => {
		const original = assistantTurnWithTokens(5, "Detailed response");
		const msg = turnToMessage(original);
		const restored = messageToTurn(msg, "sess", "/proj");

		expect(restored.number).toBe(original.number);
		expect(restored.role).toBe(original.role);
		expect(restored.content).toBe(original.content);
		expect(restored.tokens?.prompt).toBe(original.tokens?.prompt);
		expect(restored.tokens?.completion).toBe(original.tokens?.completion);
	});

	it("turn → message → turn preserves tool calls", () => {
		const original = toolUseTurn(10);
		const msg = turnToMessage(original);
		const restored = messageToTurn(msg, "sess", "/proj");

		expect(restored.toolCalls).toHaveLength(2);
		expect(restored.toolCalls?.[0].id).toBe("tc-1");
		expect(restored.toolCalls?.[0].name).toBe("file_search");
		expect(restored.toolCalls?.[1].id).toBe("tc-2");
		expect(restored.toolCalls?.[1].name).toBe("grep_search");
	});

	it("turn → message → turn preserves thinking content via JSON round-trip", () => {
		const original = thinkingTurn(20);
		const msg = turnToMessage(original);
		const restored = messageToTurn(msg, "sess", "/proj");

		// Content was JSON originally, should remain JSON after round-trip
		const parsedOriginal = JSON.parse(original.content) as ContentBlock[];
		const parsedRestored = JSON.parse(restored.content) as ContentBlock[];

		expect(parsedRestored).toHaveLength(parsedOriginal.length);
		expect(parsedRestored[0]).toEqual(parsedOriginal[0]);
		expect(parsedRestored[1]).toEqual(parsedOriginal[1]);
	});

	it("message → turn → message preserves content blocks", () => {
		const original: Message = {
			id: "turn-15",
			role: "assistant",
			content: [{ type: "text", text: "Here is the answer." }],
			timestamp: NOW,
			usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
		};

		const turn = messageToTurn(original, "sess", "/proj");
		const restored = turnToMessage(turn);

		expect(restored.id).toBe(original.id);
		expect(restored.role).toBe(original.role);
		expect(restored.content).toEqual(original.content);
		expect(restored.timestamp).toBe(original.timestamp);
		expect(restored.usage?.inputTokens).toBe(original.usage?.inputTokens);
		expect(restored.usage?.outputTokens).toBe(original.usage?.outputTokens);
	});
});
