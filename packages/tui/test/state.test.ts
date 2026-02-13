import { describe, it, expect } from "vitest";
import { AppState } from "../src/state.js";
import type { Message, Usage } from "@takumi/core";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeMessage(overrides?: Partial<Message>): Message {
	return {
		id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
		role: "user",
		content: [{ type: "text", text: "hello" }],
		timestamp: Date.now(),
		...overrides,
	};
}

function makeUsage(overrides?: Partial<Usage>): Usage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		...overrides,
	};
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("AppState", () => {
	/* ---- initial values -------------------------------------------------- */

	describe("initial values", () => {
		it("has empty messages array", () => {
			const state = new AppState();
			expect(state.messages.value).toEqual([]);
		});

		it("has isStreaming false", () => {
			const state = new AppState();
			expect(state.isStreaming.value).toBe(false);
		});

		it("has empty streamingText", () => {
			const state = new AppState();
			expect(state.streamingText.value).toBe("");
		});

		it("has empty thinkingText", () => {
			const state = new AppState();
			expect(state.thinkingText.value).toBe("");
		});

		it("has zero totalInputTokens", () => {
			const state = new AppState();
			expect(state.totalInputTokens.value).toBe(0);
		});

		it("has zero totalOutputTokens", () => {
			const state = new AppState();
			expect(state.totalOutputTokens.value).toBe(0);
		});

		it("has zero totalCost", () => {
			const state = new AppState();
			expect(state.totalCost.value).toBe(0);
		});

		it("has zero turnCount", () => {
			const state = new AppState();
			expect(state.turnCount.value).toBe(0);
		});

		it("has empty sessionId", () => {
			const state = new AppState();
			expect(state.sessionId.value).toBe("");
		});

		it("defaults model to claude-sonnet-4-20250514", () => {
			const state = new AppState();
			expect(state.model.value).toBe("claude-sonnet-4-20250514");
		});

		it("has default theme", () => {
			const state = new AppState();
			expect(state.theme.value).toBe("default");
		});

		it("has focusedPanel set to input", () => {
			const state = new AppState();
			expect(state.focusedPanel.value).toBe("input");
		});

		it("has sidebarVisible false", () => {
			const state = new AppState();
			expect(state.sidebarVisible.value).toBe(false);
		});

		it("has terminalSize 80x24", () => {
			const state = new AppState();
			expect(state.terminalSize.value).toEqual({ width: 80, height: 24 });
		});

		it("has showThinking true", () => {
			const state = new AppState();
			expect(state.showThinking.value).toBe(true);
		});

		it("has null activeDialog", () => {
			const state = new AppState();
			expect(state.activeDialog.value).toBeNull();
		});

		it("has null activeTool", () => {
			const state = new AppState();
			expect(state.activeTool.value).toBeNull();
		});

		it("has empty toolOutput", () => {
			const state = new AppState();
			expect(state.toolOutput.value).toBe("");
		});
	});

	/* ---- addMessage ------------------------------------------------------- */

	describe("addMessage", () => {
		it("adds a message to the messages array", () => {
			const state = new AppState();
			const msg = makeMessage();

			state.addMessage(msg);

			expect(state.messages.value).toHaveLength(1);
			expect(state.messages.value[0]).toBe(msg);
		});

		it("appends to existing messages", () => {
			const state = new AppState();
			const msg1 = makeMessage({ id: "msg-1" });
			const msg2 = makeMessage({ id: "msg-2" });
			const msg3 = makeMessage({ id: "msg-3" });

			state.addMessage(msg1);
			state.addMessage(msg2);
			state.addMessage(msg3);

			expect(state.messages.value).toHaveLength(3);
			expect(state.messages.value[0].id).toBe("msg-1");
			expect(state.messages.value[1].id).toBe("msg-2");
			expect(state.messages.value[2].id).toBe("msg-3");
		});

		it("does not mutate the previous messages array", () => {
			const state = new AppState();
			const msg1 = makeMessage();
			state.addMessage(msg1);
			const firstArray = state.messages.value;

			const msg2 = makeMessage();
			state.addMessage(msg2);

			// Original array should not have been mutated
			expect(firstArray).toHaveLength(1);
			expect(state.messages.value).toHaveLength(2);
		});
	});

	/* ---- messageCount computed ------------------------------------------- */

	describe("messageCount", () => {
		it("is 0 initially", () => {
			const state = new AppState();
			expect(state.messageCount.value).toBe(0);
		});

		it("updates when messages are added", () => {
			const state = new AppState();
			state.addMessage(makeMessage());
			expect(state.messageCount.value).toBe(1);

			state.addMessage(makeMessage());
			expect(state.messageCount.value).toBe(2);
		});

		it("resets to 0 when state is reset", () => {
			const state = new AppState();
			state.addMessage(makeMessage());
			state.addMessage(makeMessage());
			expect(state.messageCount.value).toBe(2);

			state.reset();
			expect(state.messageCount.value).toBe(0);
		});
	});

	/* ---- updateUsage ----------------------------------------------------- */

	describe("updateUsage", () => {
		it("accumulates input tokens", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ inputTokens: 100 }));
			expect(state.totalInputTokens.value).toBe(100);

			state.updateUsage(makeUsage({ inputTokens: 200 }));
			expect(state.totalInputTokens.value).toBe(300);
		});

		it("accumulates output tokens", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ outputTokens: 50 }));
			expect(state.totalOutputTokens.value).toBe(50);

			state.updateUsage(makeUsage({ outputTokens: 75 }));
			expect(state.totalOutputTokens.value).toBe(125);
		});

		it("calculates cost using Sonnet pricing: $3/M input, $15/M output", () => {
			const state = new AppState();
			// 1000 input tokens = 1000 * 3 / 1_000_000 = $0.003
			// 1000 output tokens = 1000 * 15 / 1_000_000 = $0.015
			state.updateUsage(makeUsage({ inputTokens: 1000, outputTokens: 1000 }));

			const expectedCost = (1000 * 3) / 1_000_000 + (1000 * 15) / 1_000_000;
			expect(state.totalCost.value).toBeCloseTo(expectedCost, 10);
		});

		it("applies cache read discount (90% — $2.7/M subtracted)", () => {
			const state = new AppState();
			state.updateUsage(
				makeUsage({
					inputTokens: 1000,
					outputTokens: 0,
					cacheReadTokens: 500,
				}),
			);

			// inputCost = 1000 * 3 / 1M = 0.003
			// cacheReadDiscount = 500 * 2.7 / 1M = 0.00135
			// totalCost = 0.003 - 0.00135 = 0.00165
			const expected = (1000 * 3) / 1_000_000 - (500 * 2.7) / 1_000_000;
			expect(state.totalCost.value).toBeCloseTo(expected, 10);
		});

		it("accumulates cost across multiple usage updates", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ inputTokens: 1000, outputTokens: 500 }));
			state.updateUsage(makeUsage({ inputTokens: 2000, outputTokens: 1000 }));

			const expected =
				(1000 * 3) / 1_000_000 +
				(500 * 15) / 1_000_000 +
				(2000 * 3) / 1_000_000 +
				(1000 * 15) / 1_000_000;
			expect(state.totalCost.value).toBeCloseTo(expected, 10);
		});
	});

	/* ---- totalTokens computed -------------------------------------------- */

	describe("totalTokens", () => {
		it("is 0 initially", () => {
			const state = new AppState();
			expect(state.totalTokens.value).toBe(0);
		});

		it("is the sum of input and output tokens", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ inputTokens: 100, outputTokens: 200 }));
			expect(state.totalTokens.value).toBe(300);
		});

		it("accumulates across multiple updates", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ inputTokens: 100, outputTokens: 50 }));
			state.updateUsage(makeUsage({ inputTokens: 200, outputTokens: 100 }));
			expect(state.totalTokens.value).toBe(450);
		});
	});

	/* ---- formattedCost computed ------------------------------------------ */

	describe("formattedCost", () => {
		it("shows $0.0000 when cost is zero", () => {
			const state = new AppState();
			expect(state.formattedCost.value).toBe("$0.0000");
		});

		it("shows 4 decimal places for small costs (< $0.01)", () => {
			const state = new AppState();
			// 1000 input tokens = $0.003
			state.updateUsage(makeUsage({ inputTokens: 1000 }));
			expect(state.formattedCost.value).toBe("$0.0030");
		});

		it("shows 2 decimal places for larger costs (>= $0.01)", () => {
			const state = new AppState();
			// Need $0.01+ cost. 10000 output tokens = $0.15
			state.updateUsage(makeUsage({ outputTokens: 10000 }));
			expect(state.formattedCost.value).toBe("$0.15");
		});

		it("shows $x.xx for costs over $1", () => {
			const state = new AppState();
			// 100000 output tokens = $1.50
			state.updateUsage(makeUsage({ outputTokens: 100000 }));
			expect(state.formattedCost.value).toBe("$1.50");
		});
	});

	/* ---- statusText computed --------------------------------------------- */

	describe("statusText", () => {
		it("shows turns/tokens/cost when not streaming", () => {
			const state = new AppState();
			state.turnCount.value = 3;
			state.updateUsage(makeUsage({ inputTokens: 100, outputTokens: 200 }));

			const text = state.statusText.value;
			expect(text).toContain("3 turns");
			expect(text).toContain("300 tokens");
			expect(text).toContain("$");
		});

		it("shows 'Thinking...' when streaming with no active tool", () => {
			const state = new AppState();
			state.isStreaming.value = true;
			expect(state.statusText.value).toBe("Thinking...");
		});

		it("shows 'Running: toolname' when streaming with active tool", () => {
			const state = new AppState();
			state.isStreaming.value = true;
			state.activeTool.value = "read_file";
			expect(state.statusText.value).toBe("Running: read_file");
		});

		it("shows 'Running: bash' for bash tool", () => {
			const state = new AppState();
			state.isStreaming.value = true;
			state.activeTool.value = "bash";
			expect(state.statusText.value).toBe("Running: bash");
		});

		it("reverts to summary text when streaming stops", () => {
			const state = new AppState();
			state.isStreaming.value = true;
			state.activeTool.value = "grep";
			expect(state.statusText.value).toBe("Running: grep");

			state.isStreaming.value = false;
			expect(state.statusText.value).toContain("turns");
			expect(state.statusText.value).toContain("tokens");
		});

		it("formats with zero values on fresh state", () => {
			const state = new AppState();
			expect(state.statusText.value).toBe("0 turns | 0 tokens | $0.0000");
		});
	});

	/* ---- reset ----------------------------------------------------------- */

	describe("reset", () => {
		it("clears messages", () => {
			const state = new AppState();
			state.addMessage(makeMessage());
			state.addMessage(makeMessage());
			state.reset();
			expect(state.messages.value).toEqual([]);
		});

		it("clears isStreaming", () => {
			const state = new AppState();
			state.isStreaming.value = true;
			state.reset();
			expect(state.isStreaming.value).toBe(false);
		});

		it("clears streamingText", () => {
			const state = new AppState();
			state.streamingText.value = "some text";
			state.reset();
			expect(state.streamingText.value).toBe("");
		});

		it("clears thinkingText", () => {
			const state = new AppState();
			state.thinkingText.value = "thinking...";
			state.reset();
			expect(state.thinkingText.value).toBe("");
		});

		it("clears token counters", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ inputTokens: 1000, outputTokens: 500 }));
			state.reset();
			expect(state.totalInputTokens.value).toBe(0);
			expect(state.totalOutputTokens.value).toBe(0);
		});

		it("clears totalCost", () => {
			const state = new AppState();
			state.updateUsage(makeUsage({ inputTokens: 1000, outputTokens: 500 }));
			state.reset();
			expect(state.totalCost.value).toBe(0);
		});

		it("clears turnCount", () => {
			const state = new AppState();
			state.turnCount.value = 5;
			state.reset();
			expect(state.turnCount.value).toBe(0);
		});

		it("clears activeTool", () => {
			const state = new AppState();
			state.activeTool.value = "bash";
			state.reset();
			expect(state.activeTool.value).toBeNull();
		});

		it("clears toolOutput", () => {
			const state = new AppState();
			state.toolOutput.value = "some output";
			state.reset();
			expect(state.toolOutput.value).toBe("");
		});

		it("resets computed values", () => {
			const state = new AppState();
			state.addMessage(makeMessage());
			state.updateUsage(makeUsage({ inputTokens: 100, outputTokens: 200 }));
			state.reset();

			expect(state.messageCount.value).toBe(0);
			expect(state.totalTokens.value).toBe(0);
			expect(state.formattedCost.value).toBe("$0.0000");
		});

		it("does not clear sessionId", () => {
			const state = new AppState();
			state.sessionId.value = "session-123";
			state.reset();
			// reset() does not explicitly clear sessionId — verify it persists
			expect(state.sessionId.value).toBe("session-123");
		});

		it("does not clear model", () => {
			const state = new AppState();
			state.model.value = "claude-opus-4-20250514";
			state.reset();
			expect(state.model.value).toBe("claude-opus-4-20250514");
		});
	});

	/* ---- signal reactivity ----------------------------------------------- */

	describe("signal reactivity", () => {
		it("computed values auto-update when dependencies change", () => {
			const state = new AppState();

			// Initially 0
			expect(state.totalTokens.value).toBe(0);

			// After direct signal update, computed reflects the change
			state.totalInputTokens.value = 500;
			state.totalOutputTokens.value = 300;
			expect(state.totalTokens.value).toBe(800);
		});

		it("messageCount tracks messages array length", () => {
			const state = new AppState();
			expect(state.messageCount.value).toBe(0);

			state.messages.value = [makeMessage(), makeMessage()];
			expect(state.messageCount.value).toBe(2);

			state.messages.value = [];
			expect(state.messageCount.value).toBe(0);
		});
	});
});
