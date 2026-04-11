import { describe, expect, it, vi } from "vitest";
import {
	buildHistoryCompactionPlan,
	calculateContextPressureFromTokens,
	estimateTurnHistoryTokens,
	maybeCompactHistory,
	optimizePromptWindow,
} from "../src/index.js";
import type { MessagePayload } from "../src/loop.js";

function textMessage(role: "user" | "assistant", text: string): MessagePayload {
	return { role, content: [{ type: "text", text }] };
}

describe("window optimizer", () => {
	it("packs pinned prompt sections before lower-priority sections", () => {
		const basePrompt = "You are Takumi.";
		const result = optimizePromptWindow({
			totalContextTokens: 16_000,
			historyTokens: 6_000,
			basePrompt,
			sections: [
				{
					id: "low-signal",
					content: `## Low Signal\n${"x".repeat(2_000)}`,
					referenceCount: 1,
					pinned: false,
				},
				{
					id: "critical",
					content: "## Critical\nKeep the current task plan and verification state visible.",
					referenceCount: 6,
					pinned: true,
					rippleDepth: 0,
				},
			],
			promptBudgetTokens: 120,
		});

		expect(result.prompt).toContain("## Critical");
		expect(result.includedSectionIds).toContain("critical");
		expect(result.excludedSectionIds).toContain("low-signal");
	});

	it("builds a history plan against the history slice rather than the full window", () => {
		const plan = buildHistoryCompactionPlan({
			totalContextTokens: 32_000,
			historyTokens: 18_000,
			threshold: 0.8,
		});

		expect(plan.hardLimitTokens).toBeLessThan(32_000);
		expect(plan.softLimitTokens).toBeLessThan(plan.hardLimitTokens);
		expect(plan.threshold).toBe(0.8);
	});

	it("estimates pending-turn history including the unsent user message", () => {
		const history = [textMessage("assistant", "Existing history.")];
		const estimate = estimateTurnHistoryTokens(history, "New user task here.");
		expect(estimate).toBeGreaterThan(estimateTurnHistoryTokens([], ""));
	});

	it("emits compaction lifecycle hooks and applies extension summary override", async () => {
		const messages: MessagePayload[] = [
			textMessage("user", "A".repeat(2_000)),
			textMessage("assistant", "B".repeat(2_000)),
			textMessage("user", "C".repeat(2_000)),
			textMessage("assistant", "D".repeat(2_000)),
		];
		const extensionRunner = {
			emitCancellable: vi.fn(async () => ({ summary: "Custom compact summary" })),
			emit: vi.fn(async () => undefined),
		} as never;

		const result = await maybeCompactHistory({
			messages,
			estimatedHistoryTokens: 2_000,
			totalContextTokens: 2_400,
			compactOptions: { preserveRecent: 1, threshold: 0.5 },
			extensionRunner,
		});

		expect(result).not.toBeNull();
		expect(result?.summary).toContain("Custom compact summary");
		expect(extensionRunner.emitCancellable).toHaveBeenCalledOnce();
		expect(extensionRunner.emit).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session_compact", summary: expect.stringContaining("Custom compact summary") }),
		);
		expect(Array.isArray(messages[0]?.content)).toBe(true);
		if (Array.isArray(messages[0]?.content) && messages[0]?.content[0]?.type === "text") {
			expect(messages[0].content[0].text).toContain("Custom compact summary");
		}
	});

	it("calculates pressure directly from provider token counts", () => {
		const pressure = calculateContextPressureFromTokens(7_800, 8_000);
		expect(pressure.pressure).toBe("near_limit");
		expect(Math.round(pressure.percent)).toBe(98);
	});
});
