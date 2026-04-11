import { type MessagePayload, ToolRegistry } from "@takumi/agent";
import type { AgentEvent, ToolDefinition } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRunner } from "../src/agent/agent-runner.js";
import { AppState } from "../src/state.js";

function createDoneStream(): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield { type: "done" } as AgentEvent;
	})();
}

function createTextStream(text: string): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield { type: "text_delta", text } as AgentEvent;
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

function createErrorStream(message: string): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield { type: "error", error: new Error(message) } as AgentEvent;
	})();
}

function createUsageStream(): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield {
			type: "usage_update",
			usage: {
				inputTokens: 1000,
				outputTokens: 500,
				cacheReadTokens: 500,
				cacheWriteTokens: 0,
			},
		} as AgentEvent;
		yield { type: "done" } as AgentEvent;
	})();
}

function createOverBudgetUsageStream(): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield {
			type: "usage_update",
			usage: {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
				cacheReadTokens: 250_000,
				cacheWriteTokens: 0,
			},
		} as AgentEvent;
		yield { type: "done" } as AgentEvent;
	})();
}

function createToolUseStream(toolName: string, input: Record<string, unknown>): AsyncIterable<AgentEvent> {
	return (async function* () {
		yield { type: "tool_use", id: `${toolName}-1`, name: toolName, input } as AgentEvent;
		yield { type: "done", stopReason: "tool_use" } as AgentEvent;
	})();
}

function createRoutingDecision(overrides: Record<string, unknown> = {}) {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-turn",
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
		reason: "Selected a concrete chat route",
		fallbackChain: [],
		policyTrace: ["selected:llm.anthropic.claude-sonnet-4-20250514"],
		degraded: false,
		...overrides,
	};
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

	it("surfaces runtime errors as assistant messages instead of logging only", async () => {
		const sendMessageFn = vi.fn(() => createErrorStream("sidecar crashed"));
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			sendMessageFn,
			tools,
		);

		await runner.submit("trigger failure");

		const assistantText = state.messages.value
			.flatMap((message) => message.content)
			.find((block) => block.type === "text" && block.text.includes("Run failed."));
		expect(assistantText).toMatchObject({ type: "text" });
	});

	it("tracks cost snapshots from usage_update events", async () => {
		const sendMessageFn = vi.fn(() => createUsageStream());
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi.", maxCostUsd: 1 } as never,
			sendMessageFn,
			tools,
		);

		await runner.submit("measure spend");

		const expected = (1000 * 3) / 1_000_000 + (500 * 15) / 1_000_000 - (500 * 2.7) / 1_000_000;
		expect(state.totalInputTokens.value).toBe(1000);
		expect(state.totalOutputTokens.value).toBe(500);
		expect(state.totalCost.value).toBeCloseTo(expected, 10);
		expect(state.costSnapshot.value?.totalUsd).toBeCloseTo(expected, 10);
		expect(state.costTelemetryText.value).toContain("1,500t");
	});

	it("surfaces budget overruns when a configured spend limit is crossed", async () => {
		const sendMessageFn = vi.fn(() => createOverBudgetUsageStream());
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi.", maxCostUsd: 0.000001 } as never,
			sendMessageFn,
			tools,
		);

		await runner.submit("burn the tiny budget");

		const assistantText = state.messages.value
			.flatMap((message) => message.content)
			.find((block) => block.type === "text" && block.text.includes("Budget exceeded"));
		expect(assistantText).toMatchObject({ type: "text" });
	});

	it("updates live budget telemetry when the spend limit changes", () => {
		state.totalInputTokens.value = 1_000;
		state.totalOutputTokens.value = 500;
		state.totalCost.value = 0.5;

		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			createSendMessageFn(),
			tools,
		);

		runner.setBudgetLimit(1);

		expect(state.costSnapshot.value?.budgetFraction).toBeCloseTo(0.5, 10);
		expect(state.costAlertLevel.value).toBe("info");
	});

	it("tracks successful file reads and writes from runtime tool events", async () => {
		const trackedFile = `${process.cwd()}/packages/tui/src/state.ts`;
		const generatedFile = `${process.cwd()}/tmp/runtime-file-tracking.txt`;
		const sendMessageFn = vi
			.fn<
				(
					_messages: MessagePayload[],
					_system: string,
					_tools?: ToolDefinition[],
					_signal?: AbortSignal,
					_options?: { model?: string },
				) => AsyncIterable<AgentEvent>
			>()
			.mockImplementationOnce(() => createToolUseStream("read", { file_path: trackedFile }))
			.mockImplementationOnce(() => createDoneStream())
			.mockImplementationOnce(() =>
				createToolUseStream("write", {
					file_path: generatedFile,
					content: "runtime tracking\n",
				}),
			)
			.mockImplementationOnce(() => createDoneStream());

		const tools = new ToolRegistry();
		tools.register(
			{
				name: "read",
				description: "read file",
				inputSchema: {},
				requiresPermission: false,
				category: "read",
			},
			async () => ({ output: "1\ttracked\n", isError: false }),
		);
		tools.register(
			{
				name: "write",
				description: "write file",
				inputSchema: {},
				requiresPermission: false,
				category: "write",
			},
			async (input) => ({ output: `Created file: ${String(input.file_path)} (1 lines)`, isError: false }),
		);

		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi.", workingDirectory: process.cwd() } as never,
			sendMessageFn,
			tools,
		);

		await runner.submit("inspect runtime state");
		await runner.submit("write tracking file");

		expect(state.readFiles.value).toEqual(["packages/tui/src/state.ts"]);
		expect(state.fileChanges.value).toEqual([{ path: "tmp/runtime-file-tracking.txt", status: "added" }]);
		expect(state.modifiedFiles.value).toEqual(["tmp/runtime-file-tracking.txt"]);
	});

	it("rehydrates only relevant archived experience into the system prompt", async () => {
		const sendMessageFn = createSendMessageFn();
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			sendMessageFn,
			tools,
		);

		const memory = (runner as any).experienceMemory;
		memory.archiveCompaction(
			"Investigated src/config.ts and patched config loading.",
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "cfg-1", name: "write_file", input: { path: "src/config.ts" } }],
				},
			],
			[],
		);
		memory.archiveCompaction(
			"Cleaned up docs/reference.md copy for the CLI guide.",
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "docs-1", name: "write_file", input: { path: "docs/reference.md" } }],
				},
			],
			[],
		);

		await runner.submit("fix the config loader in src/config.ts");

		expect(sendMessageFn).toHaveBeenCalledTimes(1);
		const systemPrompt = sendMessageFn.mock.calls[0]?.[1] ?? "";
		expect(systemPrompt).toContain("Relevant Archived Experience");
		expect(systemPrompt).toContain("src/config.ts");
		expect(systemPrompt).not.toContain("docs/reference.md");
	});

	it("uses the engine-selected model for ordinary interactive turns", async () => {
		const sendMessageFn = vi.fn(() => createTextStream("route applied"));
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			sendMessageFn,
			tools,
		);

		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-live";
		state.chitraguptaConnected.value = true;
		state.chitraguptaBridge.value = {
			isConnected: true,
			isSocketMode: true,
			sessionCreate: vi.fn(async () => ({ id: "canon-turn" })),
		} as never;
		state.chitraguptaObserver.value = {
			routeResolve: vi.fn(async () => createRoutingDecision()),
		} as never;

		await runner.submit("patch the bug");

		expect(sendMessageFn).toHaveBeenCalledTimes(1);
		expect(sendMessageFn.mock.calls[0]?.[4]).toEqual({ model: "claude-sonnet-4-20250514" });
		expect(state.routingDecisions.value[0]?.selected?.id).toBe("llm.anthropic.claude-sonnet-4-20250514");
	});

	it("uses a routed provider send function when Chitragupta selects a different provider", async () => {
		const primarySendMessageFn = vi.fn(() => createDoneStream());
		const routedSendMessageFn = vi.fn(() => createTextStream("gpt routed"));
		const tools = new ToolRegistry();
		const runner = new AgentRunner(
			state,
			{ maxTurns: 4, systemPrompt: "You are Takumi." } as never,
			primarySendMessageFn,
			tools,
			undefined,
			undefined,
			undefined,
			{
				resolveProviderSendMessage: vi.fn(async (providerName) =>
					providerName === "openai" ? routedSendMessageFn : null,
				),
			},
		);

		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-live";
		state.chitraguptaConnected.value = true;
		state.chitraguptaBridge.value = {
			isConnected: true,
			isSocketMode: true,
			sessionCreate: vi.fn(async () => ({ id: "canon-turn" })),
		} as never;
		state.chitraguptaObserver.value = {
			routeResolve: vi.fn(async () =>
				createRoutingDecision({
					selected: {
						...createRoutingDecision().selected,
						id: "llm.openai.gpt-4.1",
						label: "GPT-4.1",
						providerFamily: "openai-compat",
						metadata: { model: "gpt-4.1" },
					},
					reason: "Selected GPT-4.1 for this turn",
				}),
			),
		} as never;

		await runner.submit("reason through the refactor");

		expect(primarySendMessageFn).not.toHaveBeenCalled();
		expect(routedSendMessageFn).toHaveBeenCalledTimes(1);
		expect(routedSendMessageFn.mock.calls[0]?.[4]).toEqual({ model: "gpt-4.1" });
		expect(state.routingDecisions.value[0]?.selected?.id).toBe("llm.openai.gpt-4.1");
	});
});
