import { describe, it, expect } from "vitest";
import { compactHistory } from "../src/context/compact.js";
import type { Message, ContentBlock } from "@takumi/core";

// ── Helpers ──────────────────────────────────────────────────────────────────

let nextId = 0;

function makeMessage(
	role: "user" | "assistant",
	content: ContentBlock[],
	timestamp?: number,
): Message {
	return {
		id: `msg-${++nextId}`,
		role,
		content,
		timestamp: timestamp ?? Date.now(),
	};
}

function textMsg(role: "user" | "assistant", text: string): Message {
	return makeMessage(role, [{ type: "text", text }]);
}

/**
 * Generate N filler messages alternating user/assistant roles.
 * Each message body is `filler` chars long (default 100).
 */
function generateMessages(count: number, filler = 100): Message[] {
	const msgs: Message[] = [];
	for (let i = 0; i < count; i++) {
		const role: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
		const text = `Message ${i}: ${"x".repeat(filler)}`;
		msgs.push(textMsg(role, text));
	}
	return msgs;
}

/**
 * Estimate tokens the same way the source does: ceil(chars / 4).
 */
function estimateTokens(msg: Message): number {
	let chars = 0;
	for (const block of msg.content) {
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

function totalTokens(messages: Message[]): number {
	return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

// ── No compaction scenarios ──────────────────────────────────────────────────

describe("compactHistory — no compaction needed", () => {
	it("returns original messages when total tokens are under maxTokens", () => {
		const msgs = generateMessages(5, 20); // very small messages
		const result = compactHistory(msgs, { maxTokens: 100_000 });

		expect(result.messages).toBe(msgs); // same reference
		expect(result.summary).toBe("");
		expect(result.compactedTurns).toBe(0);
	});

	it("returns original messages when message count <= keepRecent", () => {
		// Even if tokens are high, if count <= keepRecent, no compaction
		const msgs = generateMessages(5, 2000);
		const result = compactHistory(msgs, { keepRecent: 10, maxTokens: 1 });

		expect(result.messages).toBe(msgs);
		expect(result.compactedTurns).toBe(0);
	});

	it("returns original messages when message count equals keepRecent exactly", () => {
		const msgs = generateMessages(10, 20);
		const result = compactHistory(msgs, { keepRecent: 10, maxTokens: 1 });

		expect(result.messages).toBe(msgs);
		expect(result.compactedTurns).toBe(0);
	});

	it("uses default keepRecent=10 and maxTokens=100000 when no options provided", () => {
		const msgs = generateMessages(5, 20); // under both defaults
		const result = compactHistory(msgs);

		expect(result.messages).toBe(msgs);
		expect(result.compactedTurns).toBe(0);
	});
});

// ── Compaction triggers ──────────────────────────────────────────────────────

describe("compactHistory — compaction", () => {
	it("compacts older messages into a summary when over maxTokens and count > keepRecent", () => {
		const msgs = generateMessages(15, 200); // 15 messages, each ~200 chars
		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.compactedTurns).toBe(10); // 15 - 5
		expect(result.summary).not.toBe("");
		// compacted result: 1 summary message + 5 kept messages = 6
		expect(result.messages).toHaveLength(6);
	});

	it("keeps the right number of recent messages", () => {
		const msgs = generateMessages(20, 200);
		const keepRecent = 7;
		const result = compactHistory(msgs, { keepRecent, maxTokens: 1 });

		// Last 7 messages should be preserved exactly
		const keptMessages = result.messages.slice(1); // skip summary message
		const originalLast7 = msgs.slice(msgs.length - keepRecent);

		expect(keptMessages).toHaveLength(keepRecent);
		for (let i = 0; i < keepRecent; i++) {
			expect(keptMessages[i]).toBe(originalLast7[i]); // same reference
		}
	});

	it("creates a synthetic summary message as the first message", () => {
		const msgs = generateMessages(12, 200);
		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		const summaryMsg = result.messages[0];
		expect(summaryMsg.id).toBe("compact-summary");
		expect(summaryMsg.role).toBe("user");
		expect(summaryMsg.content).toHaveLength(1);
		expect(summaryMsg.content[0].type).toBe("text");
	});

	it("uses timestamp from first compacted message for summary", () => {
		const ts = 1700000000000;
		const msgs = generateMessages(15, 200);
		msgs[0] = { ...msgs[0], timestamp: ts };
		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.messages[0].timestamp).toBe(ts);
	});

	it("compactedTurns count equals number of messages that were summarized", () => {
		const msgs = generateMessages(20, 200);
		const keepRecent = 8;
		const result = compactHistory(msgs, { keepRecent, maxTokens: 1 });

		expect(result.compactedTurns).toBe(20 - keepRecent);
	});
});

// ── Summary content ──────────────────────────────────────────────────────────

describe("compactHistory — summary content", () => {
	it("summary includes role labels User/Assistant", () => {
		const msgs = [
			textMsg("user", "Hello there"),
			textMsg("assistant", "Hi! How can I help?"),
			textMsg("user", "Write some code"),
			textMsg("assistant", "Sure thing"),
			// keep these 2 recent
			textMsg("user", "Thanks"),
			textMsg("assistant", "You're welcome"),
		];

		const result = compactHistory(msgs, { keepRecent: 2, maxTokens: 1 });

		expect(result.summary).toContain("User:");
		expect(result.summary).toContain("Assistant:");
	});

	it("summary includes conversation summary header with turn count", () => {
		const msgs = generateMessages(12, 100);
		const result = compactHistory(msgs, { keepRecent: 4, maxTokens: 1 });

		expect(result.summary).toContain("[Conversation summary");
		expect(result.summary).toContain("8 earlier turns compacted");
	});

	it("summary truncates long text to 100 chars + '...'", () => {
		const longText = "A".repeat(200);
		const msgs = [
			textMsg("user", longText),
			// need enough messages to trigger compaction
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		// The summary should contain the first 100 chars followed by "..."
		expect(result.summary).toContain("A".repeat(100) + "...");
		expect(result.summary).not.toContain("A".repeat(101));
	});

	it("summary keeps short text without truncation", () => {
		const shortText = "Fix the bug please";
		const msgs = [
			textMsg("user", shortText),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.summary).toContain(shortText);
		// Should NOT have "..." after the short text
		expect(result.summary).toContain(`User: ${shortText}`);
	});

	it("summary shows [Used tool: name] for tool_use blocks", () => {
		const msgs = [
			makeMessage("assistant", [
				{ type: "tool_use", id: "tu_1", name: "read_file", input: { path: "/foo" } },
			]),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.summary).toContain("[Used tool: read_file]");
	});

	it("summary shows [Tool result: success] for successful tool_result blocks", () => {
		const msgs = [
			makeMessage("user", [
				{ type: "tool_result", toolUseId: "tu_1", content: "file contents", isError: false },
			]),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.summary).toContain("[Tool result: success]");
	});

	it("summary shows [Tool result: error] for error tool_result blocks", () => {
		const msgs = [
			makeMessage("user", [
				{ type: "tool_result", toolUseId: "tu_1", content: "ENOENT", isError: true },
			]),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.summary).toContain("[Tool result: error]");
	});

	it("summary shows [thinking] for thinking blocks", () => {
		const msgs = [
			makeMessage("assistant", [
				{ type: "thinking", thinking: "Let me think about this..." },
			]),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.summary).toContain("[thinking]");
	});

	it("summary combines multiple block types in a single message", () => {
		const msgs = [
			makeMessage("assistant", [
				{ type: "thinking", thinking: "Planning..." },
				{ type: "text", text: "I'll read the file now." },
				{ type: "tool_use", id: "tu_1", name: "read_file", input: { path: "/a" } },
			]),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		expect(result.summary).toContain("[thinking]");
		expect(result.summary).toContain("I'll read the file now.");
		expect(result.summary).toContain("[Used tool: read_file]");
	});
});

// ── Custom options ───────────────────────────────────────────────────────────

describe("compactHistory — custom options", () => {
	it("respects custom keepRecent option", () => {
		const msgs = generateMessages(20, 200);
		const result = compactHistory(msgs, { keepRecent: 3, maxTokens: 1 });

		// 1 summary + 3 kept = 4 messages
		expect(result.messages).toHaveLength(4);
		expect(result.compactedTurns).toBe(17);
	});

	it("respects custom maxTokens option", () => {
		// Generate small messages that fit within a higher maxTokens
		const msgs = generateMessages(15, 20);
		const tokens = totalTokens(msgs);

		// Set maxTokens higher than total — no compaction
		const noCompact = compactHistory(msgs, { keepRecent: 5, maxTokens: tokens + 100 });
		expect(noCompact.compactedTurns).toBe(0);

		// Set maxTokens lower than total — triggers compaction
		const compact = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });
		expect(compact.compactedTurns).toBe(10);
	});

	it("keepRecent=1 keeps only the last message plus summary", () => {
		const msgs = generateMessages(10, 200);
		const result = compactHistory(msgs, { keepRecent: 1, maxTokens: 1 });

		expect(result.messages).toHaveLength(2); // summary + 1
		expect(result.messages[1]).toBe(msgs[msgs.length - 1]);
		expect(result.compactedTurns).toBe(9);
	});

	it("keepRecent=0 compacts everything (summary only)", () => {
		const msgs = generateMessages(10, 200);
		const result = compactHistory(msgs, { keepRecent: 0, maxTokens: 1 });

		expect(result.messages).toHaveLength(1); // only the summary
		expect(result.messages[0].id).toBe("compact-summary");
		expect(result.compactedTurns).toBe(10);
	});
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("compactHistory — edge cases", () => {
	it("handles empty message array", () => {
		const result = compactHistory([]);

		expect(result.messages).toEqual([]);
		expect(result.summary).toBe("");
		expect(result.compactedTurns).toBe(0);
	});

	it("handles single message", () => {
		const msgs = [textMsg("user", "Hello")];
		const result = compactHistory(msgs, { keepRecent: 0, maxTokens: 1 });

		// 1 message <= keepRecent=0? No, 1 > 0, but tokens must also exceed.
		// With maxTokens=1, tokens > maxTokens and messages.length (1) > keepRecent (0)
		// so it compacts
		expect(result.compactedTurns).toBe(1);
	});

	it("handles messages with empty text content", () => {
		const msgs = [
			textMsg("user", ""),
			textMsg("assistant", ""),
			...generateMessages(12, 100),
		];

		const result = compactHistory(msgs, { keepRecent: 5, maxTokens: 1 });

		// Should not crash even with empty messages
		expect(result.compactedTurns).toBeGreaterThan(0);
	});

	it("token estimation: 1 token per 4 chars, rounded up", () => {
		// 12 chars -> ceil(12/4) = 3 tokens
		const msg = textMsg("user", "123456789012");
		expect(estimateTokens(msg)).toBe(3);

		// 13 chars -> ceil(13/4) = 4 tokens
		const msg2 = textMsg("user", "1234567890123");
		expect(estimateTokens(msg2)).toBe(4);

		// 1 char -> ceil(1/4) = 1 token
		const msg3 = textMsg("user", "x");
		expect(estimateTokens(msg3)).toBe(1);
	});
});
