import { describe, expect, it } from "vitest";
import { MessageListPanel } from "../src/panels/message-list.js";
import { AppState } from "../src/state.js";

function makeRoutingDecision() {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-9",
			capability: "coding.patch-cheap",
		},
		selected: {
			id: "llm.anthropic.claude-sonnet-4-20250514",
			kind: "llm",
			label: "Claude Sonnet 4",
			capabilities: ["coding.patch-cheap"],
			costClass: "medium",
			trust: "cloud",
			health: "healthy",
			invocation: {
				id: "anthropic-chat",
				transport: "http",
				entrypoint: "https://example.invalid/anthropic",
				requestShape: "ChatRequest",
				responseShape: "ChatResponse",
				timeoutMs: 30_000,
				streaming: true,
			},
			tags: ["coding"],
			providerFamily: "anthropic",
			metadata: { model: "claude-sonnet-4-20250514" },
		},
		reason: "Selected Claude for coding.patch-cheap",
		fallbackChain: [],
		policyTrace: ["selected:llm.anthropic.claude-sonnet-4-20250514"],
		degraded: false,
	} as const;
}

function getLines(panel: MessageListPanel): string[] {
	return Array.from({ length: panel.getRenderedLineCount() }, (_, index) => panel.getRenderedLine(index)?.text ?? "");
}

describe("transcript hierarchy refresh", () => {
	it("shows provider, model, authority, and usage badges on the latest assistant header", () => {
		const state = new AppState();
		const panel = new MessageListPanel({ state });

		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-4-20250514";
		state.routingDecisions.value = [makeRoutingDecision() as never];
		state.messages.value = [
			{
				id: "assistant-1",
				role: "assistant",
				content: [{ type: "text", text: "Ready." }],
				timestamp: 1,
				usage: {
					inputTokens: 120,
					outputTokens: 48,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			},
		];

		panel.buildLines(200);
		const lines = getLines(panel);
		const header = lines.find((line) => line.includes("* Takumi"));

		expect(header).toContain("[anthropic]");
		expect(header).toContain("[claude-sonnet-4-20250514]");
		expect(header).toContain("[✦ engine]");
		expect(header).toContain("[120 in · 48 out]");
	});

	it("summarizes diff-heavy tool results in collapsed tool rows", () => {
		const state = new AppState();
		const panel = new MessageListPanel({ state });

		state.messages.value = [
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "write",
						input: { path: "src/app.ts" },
					},
				],
				timestamp: 1,
			},
			{
				id: "assistant-2",
				role: "assistant",
				content: [
					{
						type: "tool_result",
						toolUseId: "tool-1",
						content: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new",
						isError: false,
					},
				],
				timestamp: 2,
			},
		];

		panel.buildLines(200);
		const lines = getLines(panel);
		const toolLine = lines.find((line) => line.includes("write") && line.includes("[✓ ok]"));

		expect(toolLine).toContain("1 file • +1 -1");
	});

	it("shows a short result summary before raw tool output in expanded blocks", () => {
		const state = new AppState();
		const panel = new MessageListPanel({ state });

		state.messages.value = [
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "read",
						input: { path: "src/state.ts" },
					},
				],
				timestamp: 1,
			},
			{
				id: "assistant-2",
				role: "assistant",
				content: [
					{
						type: "tool_result",
						toolUseId: "tool-1",
						content: "alpha\nbeta",
						isError: false,
					},
				],
				timestamp: 2,
			},
		];
		state.toggleToolCollapse("tool-1");

		panel.buildLines(200);
		const lines = getLines(panel);
		const resultSummaryIndex = lines.findIndex((line) => line.includes("│ result: 2 lines • 10 chars"));
		const previewSummaryIndex = lines.findIndex((line) => line.includes("│ preview: alpha"));
		const rawOutputIndex = lines.indexOf("│ alpha");

		expect(resultSummaryIndex).toBeGreaterThan(-1);
		expect(previewSummaryIndex).toBeGreaterThan(resultSummaryIndex);
		expect(rawOutputIndex).toBeGreaterThan(previewSummaryIndex);
	});

	it("lists touched files before raw diff output in expanded diff blocks", () => {
		const state = new AppState();
		const panel = new MessageListPanel({ state });

		state.messages.value = [
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-1",
						name: "edit",
						input: { path: "src/app.ts" },
					},
				],
				timestamp: 1,
			},
			{
				id: "assistant-2",
				role: "assistant",
				content: [
					{
						type: "tool_result",
						toolUseId: "tool-1",
						content:
							"--- a/src/app.ts\n+++ b/src/app.ts\n@@ -10,2 +10,2 @@\n-const oldValue = true;\n+const newValue = true;",
						isError: false,
					},
				],
				timestamp: 2,
			},
		];
		state.toggleToolCollapse("tool-1");

		panel.buildLines(220);
		const lines = getLines(panel);
		const diffSummaryIndex = lines.findIndex((line) => line.includes("│ diff: 1 file • +1 -1"));
		const fileSummaryIndex = lines.findIndex((line) => line.includes("│ file: src/app.ts (+1 -1)"));
		const rawDiffIndex = lines.indexOf("│ -const oldValue = true;");

		expect(diffSummaryIndex).toBeGreaterThan(-1);
		expect(fileSummaryIndex).toBeGreaterThan(diffSummaryIndex);
		expect(rawDiffIndex).toBeGreaterThan(fileSummaryIndex);
	});
});
