import type { AgentEvent, ToolDefinition } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { type AgentLoopOptions, agentLoop, type MessagePayload } from "../src/loop.js";
import { ToolRegistry } from "../src/tools/registry.js";

function bigMessage(role: "user" | "assistant", seed: string): MessagePayload {
	return { role, content: [{ type: "text", text: `${seed} ${"x".repeat(2_000)}` }] };
}

async function collectEvents(
	userMessage: string,
	history: MessagePayload[],
	options: AgentLoopOptions,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of agentLoop(userMessage, history, options)) {
		events.push(event);
	}
	return events;
}

function mockSendMessage(callResponses: AgentEvent[][]): AgentLoopOptions["sendMessage"] {
	let callIndex = 0;
	return async function* (_messages: MessagePayload[], _system: string, _tools?: ToolDefinition[]) {
		const events = callResponses[callIndex] ?? [];
		callIndex++;
		for (const event of events) {
			yield event;
		}
	};
}

describe("agentLoop compaction integration", () => {
	it("fires compaction hooks before the provider call when history breaches its budget", async () => {
		const extensionRunner = {
			getAllTools: vi.fn(() => new Map()),
			emit: vi.fn(async () => undefined),
			emitCancellable: vi.fn(async () => ({ summary: "Loop compact summary" })),
			hasHandlers: vi.fn(() => false),
			emitContext: vi.fn(async (msgs: unknown[]) => msgs),
			emitToolCall: vi.fn(async () => undefined),
			emitToolResult: vi.fn(async () => undefined),
		} as never;
		const events = await collectEvents(
			"finish this turn",
			[bigMessage("user", "u1"), bigMessage("assistant", "a1"), bigMessage("user", "u2")],
			{
				sendMessage: mockSendMessage([[{ type: "done", stopReason: "end_turn" }]]),
				tools: new ToolRegistry(),
				extensionRunner,
				maxContextTokens: 3_000,
				compactOptions: { preserveRecent: 1, threshold: 0.5 },
			},
		);

		expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
		expect(extensionRunner.emitCancellable).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session_before_compact" }),
		);
		expect(extensionRunner.emit).toHaveBeenCalledWith(
			expect.objectContaining({ type: "session_compact", summary: expect.stringContaining("Loop compact summary") }),
		);
	});
});
