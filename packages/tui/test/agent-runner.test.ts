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
});
