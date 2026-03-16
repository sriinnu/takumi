import { type MessagePayload, ToolRegistry } from "@takumi/agent";
import type { AgentEvent, ToolDefinition } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/agent-runner.js";
import { AppState } from "../src/state.js";

function createDoneStream(): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield { type: "done" } as AgentEvent;
	})();
}

function createSendMessageFn() {
	return vi.fn(
		(
			_messages: MessagePayload[],
			_system: string,
			_tools?: ToolDefinition[],
			_signal?: AbortSignal,
			_options?: { model?: string },
		) => createDoneStream(),
	);
}

describe("AgentRunner", () => {
	let state: AppState;

	beforeEach(() => {
		state = new AppState();
	});

	it("passes the current state model into each submission", async () => {
		const sendMessageFn = createSendMessageFn();
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			sendMessageFn,
			tools,
		);

		state.model.value = "claude-sonnet-live";
		await runner.submit("first prompt");

		state.model.value = "gpt-live-switch";
		await runner.submit("second prompt");

		expect(sendMessageFn).toHaveBeenCalledTimes(2);
		expect(sendMessageFn.mock.calls[0][4]).toEqual({ model: "claude-sonnet-live" });
		expect(sendMessageFn.mock.calls[1][4]).toEqual({ model: "gpt-live-switch" });
	});

	it("uses the hot-swapped provider send function for later submissions", async () => {
		const firstSendMessageFn = createSendMessageFn();
		const secondSendMessageFn = createSendMessageFn();
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			firstSendMessageFn,
			tools,
		);

		await runner.submit("before switch");
		runner.setSendMessageFn(secondSendMessageFn);
		await runner.submit("after switch");

		expect(firstSendMessageFn).toHaveBeenCalledTimes(1);
		expect(secondSendMessageFn).toHaveBeenCalledTimes(1);
		expect(firstSendMessageFn.mock.calls[0][4]).toEqual({ model: state.model.value });
		expect(secondSendMessageFn.mock.calls[0][4]).toEqual({ model: state.model.value });
	});

	it("hydrates prediction and pattern cognition before the turn", async () => {
		const uniqueAction = `edit router ${Date.now()}`;
		const sendMessageFn = createSendMessageFn();
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			sendMessageFn,
			tools,
		);

		state.sessionId.value = "session-123";
		state.chitraguptaConnected.value = true;
		state.chitraguptaObserver.value = {
			predictNext: vi.fn(async () => ({
				predictions: [
					{
						type: "failure_warning",
						action: uniqueAction,
						confidence: 0.88,
						risk: 0.9,
						suggestion: "inspect degraded routes first",
					},
				],
			})),
			patternQuery: vi.fn(async () => ({
				patterns: [
					{
						id: 7,
						type: "router_drift",
						pattern: {},
						confidence: 0.92,
						occurrences: 4,
						firstSeen: Date.now() - 1000,
						lastSeen: Date.now(),
					},
				],
			})),
		} as never;

		await runner.submit("stabilize routing");

		expect(state.chitraguptaPredictions.value[0]).toMatchObject({
			type: "failure_warning",
			action: uniqueAction,
			suggestion: "inspect degraded routes first",
		});
		expect(state.chitraguptaPatternMatches.value[0]).toMatchObject({
			id: 7,
			type: "router_drift",
			occurrences: 4,
		});
		expect(state.cognitiveState.value.workspace.mode).toBe("stabilize");
		expect(state.cognitiveState.value.workspace.recommendedDirectives.length).toBeGreaterThan(0);
	});

	it("rehydrates persisted session messages into runner history for the next submission", async () => {
		const sendMessageFn = createSendMessageFn();
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			sendMessageFn,
			tools,
		);

		runner.hydrateHistory([
			{
				id: "msg-user",
				role: "user",
				content: [{ type: "text", text: "previous user request" }],
				timestamp: Date.now(),
			},
			{
				id: "msg-assistant",
				role: "assistant",
				content: [
					{ type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "/tmp/a" } },
					{ type: "text", text: "looking now" },
				],
				timestamp: Date.now(),
			},
			{
				id: "msg-tool",
				role: "user",
				content: [{ type: "tool_result", toolUseId: "toolu_1", content: "file contents", isError: false }],
				timestamp: Date.now(),
			},
		]);

		await runner.submit("continue from there");

		const firstCallMessages = sendMessageFn.mock.calls[0]?.[0];
		expect(firstCallMessages).toBeDefined();
		expect(firstCallMessages[0]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "previous user request" }],
		});
		expect(firstCallMessages[1]).toMatchObject({
			role: "assistant",
			content: expect.arrayContaining([
				expect.objectContaining({ type: "tool_use", id: "toolu_1", name: "read_file" }),
			]),
		});
		expect(firstCallMessages[2]).toMatchObject({
			role: "user",
			content: [expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1", is_error: false })],
		});
		expect(firstCallMessages[3]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "continue from there" }],
		});
	});
});
