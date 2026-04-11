import type { TakumiConfig } from "@takumi/core";
import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { MessageListPanel } from "../src/panels/message-list.js";
import { StatusBarPanel } from "../src/panels/status-bar.js";
import { AppState } from "../src/state.js";

function getLineText(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		text += screen.get(row, col).char;
	}
	return text;
}

function buildStatusBarConfig(): TakumiConfig {
	return {
		sessionFile: "",
		projectRoot: "",
		model: "claude-sonnet-4-20250514",
		provider: "anthropic",
		theme: "default",
		statusBar: {
			left: ["model"],
			center: [],
			right: ["authority"],
		},
	} as TakumiConfig;
}

function makeRoutingDecision() {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-7",
			capability: "coding.patch-cheap",
		},
		selected: {
			id: "llm.gemini.gemini-2.5-pro",
			kind: "llm",
			label: "Gemini 2.5 Pro",
			capabilities: ["coding.patch-cheap"],
			costClass: "medium",
			trust: "cloud",
			health: "healthy",
			invocation: {
				id: "gemini-chat",
				transport: "http",
				entrypoint: "https://example.invalid/gemini",
				requestShape: "ChatRequest",
				responseShape: "ChatResponse",
				timeoutMs: 30_000,
				streaming: true,
			},
			tags: ["coding"],
			providerFamily: "gemini",
			metadata: { model: "gemini-2.5-pro" },
		},
		reason: "Selected Gemini for coding.patch-cheap",
		fallbackChain: [],
		policyTrace: ["selected:llm.gemini.gemini-2.5-pro"],
		degraded: false,
	} as const;
}

describe("operator authority surfaces", () => {
	it("shows route and replay telemetry inline on the latest assistant turn", () => {
		const state = new AppState();
		const panel = new MessageListPanel({ state });

		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-4-20250514";
		state.routingDecisions.value = [makeRoutingDecision() as never];
		state.canonicalSessionId.value = "canon-7";
		state.chitraguptaSync.value = {
			status: "syncing",
			lastAttemptedMessageId: "assistant-1",
		};
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Please patch this." }],
				timestamp: 1,
				sessionTurn: true,
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: [{ type: "text", text: "On it." }],
				timestamp: 2,
				sessionTurn: true,
			},
		];

		panel.buildLines(160);
		const lines = Array.from(
			{ length: panel.getRenderedLineCount() },
			(_, index) => panel.getRenderedLine(index)?.text ?? "",
		);

		expect(lines.some((line) => line.includes("↳ route:") && line.includes("✦ engine"))).toBe(true);
		expect(lines.some((line) => line.includes("Gemini 2.5 Pro"))).toBe(true);
		expect(lines.some((line) => line.includes("↳ session: canon-7") && line.includes("syncing"))).toBe(true);
		expect(lines.some((line) => line.includes("replaying assistant-1"))).toBe(true);
	});

	it("surfaces compact authority state in the status bar widget", () => {
		const state = new AppState();
		const panel = new StatusBarPanel({ state, config: buildStatusBarConfig() });

		state.routingDecisions.value = [makeRoutingDecision() as never];
		state.canonicalSessionId.value = "canon-7";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Patch" }],
				timestamp: 1,
				sessionTurn: true,
			},
		];
		state.chitraguptaSync.value = {
			status: "syncing",
			lastAttemptedMessageId: "user-1",
		};

		const screen = new Screen(100, 1);
		panel.render(screen, { x: 0, y: 0, width: 100, height: 1 });

		const text = getLineText(screen, 0);
		expect(text).toContain("engine");
		expect(text).toContain("↺1");
	});

	it("downgrades the authority widget to a stalled warning when replay fails", () => {
		const state = new AppState();
		const panel = new StatusBarPanel({ state, config: buildStatusBarConfig() });

		state.routingDecisions.value = [
			{
				...makeRoutingDecision(),
				selected: null,
				degraded: true,
			} as never,
		];
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Patch" }],
				timestamp: 1,
				sessionTurn: true,
			},
		];
		state.chitraguptaSync.value = {
			status: "failed",
			lastFailedMessageId: "user-1",
			lastError: "daemon write failed",
		};

		const screen = new Screen(100, 1);
		panel.render(screen, { x: 0, y: 0, width: 100, height: 1 });

		const text = getLineText(screen, 0);
		expect(text).toContain("fallback");
		expect(text).toContain("stall");
	});
});
