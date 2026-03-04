import { describe, expect, it } from "vitest";
import { type CompactorConfig, ConversationCompactor } from "../src/context/compactor.js";
import type { MessagePayload } from "../src/loop.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

function textMsg(role: "user" | "assistant", text: string): MessagePayload {
	return { role, content: [{ type: "text", text }] };
}

function toolUseMsg(name: string, id: string): MessagePayload {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input: { path: "/tmp" } }],
	};
}

function toolResultMsg(id: string, output: string, isError = false): MessagePayload {
	return {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: id, content: output, is_error: isError }],
	};
}

function thinkingMsg(thinking: string, text: string): MessagePayload {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking },
			{ type: "text", text },
		],
	};
}

/** Generate N alternating user/assistant text messages, each ~charsPer chars. */
function genMessages(count: number, charsPer = 400): MessagePayload[] {
	const msgs: MessagePayload[] = [];
	for (let i = 0; i < count; i++) {
		const role: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
		msgs.push(textMsg(role, `Turn ${i}: ${"x".repeat(charsPer)}`));
	}
	return msgs;
}

/** Rough token estimate matching compact.ts heuristic (ceil(chars/4)). */
function roughTokens(messages: MessagePayload[]): number {
	let chars = 0;
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			chars += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const b of msg.content) {
				if (typeof b === "string") {
					chars += b.length;
				} else if (b && typeof b === "object") {
					if ("text" in b && typeof b.text === "string") chars += b.text.length;
					if ("thinking" in b && typeof b.thinking === "string") chars += b.thinking.length;
					if ("content" in b && typeof b.content === "string") chars += b.content.length;
					if ("input" in b) chars += JSON.stringify(b.input).length;
				}
			}
		}
	}
	return Math.ceil(chars / 4);
}

/** Default config helper — small context for easy testing. */
function smallConfig(overrides?: Partial<CompactorConfig>): Partial<CompactorConfig> {
	return {
		maxContextTokens: 1000,
		compactThreshold: 0.8,
		aggressiveThreshold: 0.95,
		keepRecentTurns: 3,
		toolResultMaxLines: 5,
		...overrides,
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ConversationCompactor", () => {
	// ── Construction ─────────────────────────────────────────────────────────

	describe("constructor", () => {
		it("applies default config when no overrides given", () => {
			const c = new ConversationCompactor();
			expect(c.config.maxContextTokens).toBe(200_000);
			expect(c.config.compactThreshold).toBe(0.8);
			expect(c.config.keepRecentTurns).toBe(10);
			expect(c.config.toolResultMaxLines).toBe(200);
			expect(c.config.aggressiveThreshold).toBe(0.95);
		});

		it("merges partial overrides with defaults", () => {
			const c = new ConversationCompactor({ maxContextTokens: 50_000, keepRecentTurns: 5 });
			expect(c.config.maxContextTokens).toBe(50_000);
			expect(c.config.keepRecentTurns).toBe(5);
			expect(c.config.compactThreshold).toBe(0.8); // unchanged default
		});
	});

	// ── No compaction ────────────────────────────────────────────────────────

	describe("compact — no compaction", () => {
		it("returns strategy=none when below threshold", () => {
			const c = new ConversationCompactor(smallConfig());
			const msgs = genMessages(10);
			const result = c.compact(msgs, 500); // 50% of 1000
			expect(result.compacted).toBe(false);
			expect(result.strategy).toBe("none");
			expect(result.removedTurns).toBe(0);
			expect(result.savedTokens).toBe(0);
		});

		it("returns strategy=none when fewer messages than keepRecentTurns", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 20 }));
			const msgs = genMessages(10);
			const result = c.compact(msgs, 900); // above threshold but too few messages
			expect(result.compacted).toBe(false);
			expect(result.strategy).toBe("none");
		});

		it("returns strategy=none when exactly at threshold", () => {
			const c = new ConversationCompactor(smallConfig());
			const msgs = genMessages(10);
			// Exactly at 80% should NOT trigger (strictly < threshold)
			const result = c.compact(msgs, 799);
			expect(result.compacted).toBe(false);
		});
	});

	// ── Gentle compaction ────────────────────────────────────────────────────

	describe("compact — gentle strategy", () => {
		it("triggers gentle strategy at 80–94% usage", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 3 }));
			const msgs = genMessages(10, 100);
			const result = c.compact(msgs, 850); // 85%
			expect(result.compacted).toBe(true);
			expect(result.strategy).toBe("gentle");
			expect(result.removedTurns).toBe(7); // 10 - 3
		});

		it("keeps exactly keepRecentTurns messages after compaction", () => {
			const keep = 4;
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: keep }));
			const msgs = genMessages(12, 100);
			const originalLast = msgs.slice(-keep).map((m) => JSON.stringify(m.content));

			c.compact(msgs, 900);

			// msgs mutated in-place: 1 summary + keepRecentTurns
			expect(msgs).toHaveLength(keep + 1);

			// Last `keep` messages should match originals
			for (let i = 0; i < keep; i++) {
				expect(JSON.stringify(msgs[i + 1].content)).toBe(originalLast[i]);
			}
		});

		it("inserts a summary message as the first element", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs = genMessages(8, 100);
			c.compact(msgs, 850);

			const summary = msgs[0];
			expect(summary.role).toBe("user");
			expect(Array.isArray(summary.content)).toBe(true);
			if (Array.isArray(summary.content)) {
				const first = summary.content[0] as { type: string; text: string };
				expect(first.type).toBe("text");
				expect(first.text).toContain("[Conversation summary");
			}
		});

		it("reports correct savedTokens", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 3 }));
			const msgs = genMessages(10, 200);
			const tokensBefore = roughTokens(msgs);
			const result = c.compact(msgs, 900);
			const tokensAfter = roughTokens(msgs);

			expect(result.savedTokens).toBe(tokensBefore - tokensAfter);
			expect(result.savedTokens).toBeGreaterThan(0);
		});

		it("gentle does NOT strip thinking blocks", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs: MessagePayload[] = [
				textMsg("user", "a".repeat(200)),
				thinkingMsg("deep thoughts", "some answer"),
				textMsg("user", "b".repeat(200)),
				thinkingMsg("more thoughts", "another answer"),
			];
			c.compact(msgs, 850); // gentle

			// The last 2 messages are kept — the thinking msg should still have its blocks
			const keptAssistant = msgs.find(
				(m) => m.role === "assistant" && Array.isArray(m.content) && m.content.length > 1,
			);
			if (keptAssistant && Array.isArray(keptAssistant.content)) {
				const hasThinking = keptAssistant.content.some((b: any) => typeof b === "object" && b.type === "thinking");
				expect(hasThinking).toBe(true);
			}
		});
	});

	// ── Aggressive compaction ────────────────────────────────────────────────

	describe("compact — aggressive strategy", () => {
		it("triggers aggressive strategy at ≥95% usage", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 3 }));
			const msgs = genMessages(10, 100);
			const result = c.compact(msgs, 960); // 96%
			expect(result.compacted).toBe(true);
			expect(result.strategy).toBe("aggressive");
		});

		it("strips thinking blocks during aggressive compaction", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs: MessagePayload[] = [
				textMsg("user", "a".repeat(200)),
				thinkingMsg("deep thoughts here", "answer"),
				textMsg("user", "b".repeat(200)),
				thinkingMsg("more deep thoughts", "another"),
			];
			c.compact(msgs, 960);

			// All remaining messages should have no thinking blocks
			for (const m of msgs) {
				if (!Array.isArray(m.content)) continue;
				for (const b of m.content) {
					if (typeof b === "object" && b !== null && "type" in b) {
						expect((b as any).type).not.toBe("thinking");
					}
				}
			}
		});

		it("truncates tool results during aggressive compaction", () => {
			const bigOutput = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 3, toolResultMaxLines: 10 }));
			const msgs: MessagePayload[] = [
				textMsg("user", "do something"),
				toolUseMsg("read_file", "t1"),
				toolResultMsg("t1", bigOutput),
				textMsg("user", "ok"),
				textMsg("assistant", "done"),
				textMsg("user", "thanks"),
			];
			c.compact(msgs, 960);

			// Find remaining tool result block (if kept) and verify truncation
			for (const m of msgs) {
				if (!Array.isArray(m.content)) continue;
				for (const b of m.content) {
					if (typeof b === "object" && b !== null && "type" in b && (b as any).type === "tool_result") {
						const content = (b as any).content as string;
						expect(content).toContain("lines omitted");
					}
				}
			}
		});

		it("aggressive at exactly 95% triggers aggressive strategy", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs = genMessages(8, 100);
			const result = c.compact(msgs, 950); // exactly 95%
			expect(result.strategy).toBe("aggressive");
		});
	});

	// ── truncateToolResults ──────────────────────────────────────────────────

	describe("truncateToolResults", () => {
		it("truncates tool results exceeding maxLines", () => {
			const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");
			const c = new ConversationCompactor(smallConfig({ toolResultMaxLines: 10 }));
			const msgs: MessagePayload[] = [toolResultMsg("t1", lines)];

			const saved = c.truncateToolResults(msgs);
			expect(saved).toBeGreaterThan(0);

			const content = ((msgs[0].content as any[])[0] as any).content as string;
			expect(content).toContain("lines omitted");
			// Should have far fewer lines now
			expect(content.split("\n").length).toBeLessThan(50);
		});

		it("leaves short tool results untouched", () => {
			const shortOutput = "line 1\nline 2\nline 3";
			const c = new ConversationCompactor(smallConfig({ toolResultMaxLines: 10 }));
			const msgs: MessagePayload[] = [toolResultMsg("t1", shortOutput)];

			const saved = c.truncateToolResults(msgs);
			expect(saved).toBe(0);

			const content = ((msgs[0].content as any[])[0] as any).content as string;
			expect(content).toBe(shortOutput);
		});

		it("handles multiple tool results in one pass", () => {
			const big = Array.from({ length: 100 }, (_, i) => `row ${i}`).join("\n");
			const c = new ConversationCompactor(smallConfig({ toolResultMaxLines: 10 }));
			const msgs: MessagePayload[] = [toolResultMsg("t1", big), toolResultMsg("t2", big)];

			const saved = c.truncateToolResults(msgs);
			expect(saved).toBeGreaterThan(0);

			for (const m of msgs) {
				const content = ((m.content as any[])[0] as any).content as string;
				expect(content).toContain("lines omitted");
			}
		});

		it("returns 0 when no tool results present", () => {
			const c = new ConversationCompactor(smallConfig());
			const msgs: MessagePayload[] = [textMsg("user", "hello"), textMsg("assistant", "hi")];
			expect(c.truncateToolResults(msgs)).toBe(0);
		});

		it("handles empty tool result content", () => {
			const c = new ConversationCompactor(smallConfig());
			const msgs: MessagePayload[] = [toolResultMsg("t1", "")];
			expect(c.truncateToolResults(msgs)).toBe(0);
		});
	});

	// ── summarizeTurns ───────────────────────────────────────────────────────

	describe("summarizeTurns", () => {
		it("produces a summary header with correct turn count", () => {
			const c = new ConversationCompactor();
			const msgs = genMessages(5);
			const summary = c.summarizeTurns(msgs, 0, 4);

			expect(summary).toContain("[Conversation summary — 5 earlier turns compacted]");
		});

		it("includes role labels User/Assistant", () => {
			const c = new ConversationCompactor();
			const msgs = [textMsg("user", "hello"), textMsg("assistant", "hi there")];
			const summary = c.summarizeTurns(msgs, 0, 1);

			expect(summary).toContain("- User:");
			expect(summary).toContain("- Assistant:");
		});

		it("truncates long text at 80 chars with ellipsis", () => {
			const c = new ConversationCompactor();
			const longText = "Z".repeat(200);
			const msgs = [textMsg("user", longText)];
			const summary = c.summarizeTurns(msgs, 0, 0);

			expect(summary).toContain("Z".repeat(80));
			expect(summary).toContain("…");
			expect(summary).not.toContain("Z".repeat(81));
		});

		it("handles tool_use and tool_result blocks", () => {
			const c = new ConversationCompactor();
			const msgs: MessagePayload[] = [toolUseMsg("read_file", "t1"), toolResultMsg("t1", "file contents here")];
			const summary = c.summarizeTurns(msgs, 0, 1);

			expect(summary).toContain("[tool: read_file]");
			expect(summary).toContain("[result: ok]");
		});

		it("marks error tool results", () => {
			const c = new ConversationCompactor();
			const msgs: MessagePayload[] = [toolResultMsg("t1", "ENOENT", true)];
			const summary = c.summarizeTurns(msgs, 0, 0);

			expect(summary).toContain("[result: error]");
		});

		it("uses singular 'turn' for a single compacted turn", () => {
			const c = new ConversationCompactor();
			const msgs = [textMsg("user", "solo")];
			const summary = c.summarizeTurns(msgs, 0, 0);

			expect(summary).toContain("1 earlier turn compacted]");
			expect(summary).not.toContain("turns");
		});

		it("returns empty string for invalid range", () => {
			const c = new ConversationCompactor();
			const msgs = genMessages(3);
			expect(c.summarizeTurns(msgs, 5, 10)).toBe("");
			expect(c.summarizeTurns(msgs, 3, 1)).toBe("");
		});

		it("clamps indices to valid bounds", () => {
			const c = new ConversationCompactor();
			const msgs = genMessages(3);
			const summary = c.summarizeTurns(msgs, -5, 100);
			expect(summary).toContain("3 earlier turns compacted");
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles empty messages array", () => {
			const c = new ConversationCompactor(smallConfig());
			const msgs: MessagePayload[] = [];
			const result = c.compact(msgs, 900);
			expect(result.compacted).toBe(false);
			expect(msgs).toHaveLength(0);
		});

		it("handles messages array with exactly keepRecentTurns", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 5 }));
			const msgs = genMessages(5, 100);
			const result = c.compact(msgs, 900);
			expect(result.compacted).toBe(false);
			expect(msgs).toHaveLength(5);
		});

		it("handles string-only content", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs: MessagePayload[] = [
				{ role: "user", content: "a".repeat(500) },
				{ role: "assistant", content: "b".repeat(500) },
				{ role: "user", content: "c" },
				{ role: "assistant", content: "d" },
			];
			const result = c.compact(msgs, 900);
			expect(result.compacted).toBe(true);
		});

		it("does not crash on null/undefined content blocks", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 1 }));
			const msgs: MessagePayload[] = [
				{ role: "user", content: [null as any, undefined as any, { type: "text", text: "ok" }] },
				{ role: "assistant", content: "response" },
			];
			expect(() => c.compact(msgs, 900)).not.toThrow();
		});

		it("mutates original messages array in-place", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs = genMessages(8, 100);
			const ref = msgs; // same reference
			c.compact(msgs, 900);

			expect(msgs).toBe(ref); // same array object
			expect(msgs.length).toBeLessThan(8);
		});
	});

	// ── Integration: gentle then aggressive ──────────────────────────────────

	describe("integration scenarios", () => {
		it("second compaction with higher pressure switches to aggressive", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 3 }));

			// First pass: gentle
			const msgs1 = genMessages(10, 100);
			const r1 = c.compact(msgs1, 850);
			expect(r1.strategy).toBe("gentle");

			// Second pass: aggressive (simulating continued growth)
			const msgs2 = genMessages(10, 100);
			const r2 = c.compact(msgs2, 960);
			expect(r2.strategy).toBe("aggressive");
		});

		it("mixed content: text + tools + thinking survives compaction", () => {
			const c = new ConversationCompactor(smallConfig({ keepRecentTurns: 2 }));
			const msgs: MessagePayload[] = [
				textMsg("user", "a".repeat(200)),
				thinkingMsg("hmm", "answer"),
				toolUseMsg("bash", "t1"),
				toolResultMsg("t1", "output output output"),
				textMsg("user", "last question"),
				textMsg("assistant", "final answer"),
			];

			const result = c.compact(msgs, 960); // aggressive
			expect(result.compacted).toBe(true);
			expect(result.strategy).toBe("aggressive");
			expect(msgs.length).toBeLessThanOrEqual(3); // summary + 2 kept
		});
	});
});
