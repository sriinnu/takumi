import type { TakumiConfig } from "@takumi/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";
import { ChatView } from "../src/views/chat.js";

/**
 * Build the minimum config shape ChatView needs in tests.
 */
function makeConfig(): TakumiConfig {
	return {
		provider: "anthropic",
		model: "claude-sonnet-4",
		theme: "default",
		thinking: false,
		thinkingBudget: 0,
	} as TakumiConfig;
}

describe("ChatView", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("adds a real user message and submits it while idle", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-27T10:00:00Z"));
		const state = new AppState();
		const view = new ChatView({ state, config: makeConfig() });
		const submit = vi.fn(async () => undefined);
		view.agentRunner = { submit } as never;

		const accepted = (view as any).handleSubmit("hello takumi");

		expect(accepted).toBe(true);
		expect(submit).toHaveBeenCalledWith("hello takumi");
		expect(state.turnCount.value).toBe(1);
		expect(state.messages.value).toHaveLength(1);
		expect(state.messages.value[0]?.role).toBe("user");
		expect(state.messages.value[0]?.sessionTurn).toBe(true);
		expect(state.messages.value[0]?.content).toEqual([{ type: "text", text: "hello takumi" }]);
	});

	it("queues steering instead of appending a fake user turn while streaming", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-27T10:00:01Z"));
		const state = new AppState();
		state.isStreaming.value = true;
		const view = new ChatView({ state, config: makeConfig() });

		const accepted = (view as any).handleSubmit("change direction");

		expect(accepted).toBe(true);
		expect(state.turnCount.value).toBe(0);
		expect(state.steeringQueue.size).toBe(1);
		expect(state.steeringQueue.peek()?.text).toBe("change direction");
		expect(state.messages.value).toHaveLength(1);
		expect(state.messages.value[0]?.role).toBe("assistant");
		expect((state.messages.value[0]?.content[0] as { text: string }).text).toContain("Queued your message");
	});

	it("keeps the draft when the steering queue is full", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-27T10:00:02Z"));
		const state = new AppState();
		state.isStreaming.value = true;
		for (let index = 0; index < 100; index++) {
			state.steeringQueue.enqueue(`existing ${index}`);
		}
		const view = new ChatView({ state, config: makeConfig() });

		const accepted = (view as any).handleSubmit("do not drop me");

		expect(accepted).toBe(false);
		expect(state.steeringQueue.size).toBe(100);
		expect(state.messages.value).toHaveLength(1);
		expect((state.messages.value[0]?.content[0] as { text: string }).text).toContain("queue is full");
	});

	it("treats slash commands as accepted without appending chat turns", async () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const handler = vi.fn();
		commands.register("/ping", "Ping", handler);
		const view = new ChatView({ state, config: makeConfig(), commands });

		const accepted = (view as any).handleSubmit("/ping now");
		await Promise.resolve();

		expect(accepted).toBe(true);
		expect(handler).toHaveBeenCalledWith("now");
		expect(state.messages.value).toHaveLength(0);
	});
});
