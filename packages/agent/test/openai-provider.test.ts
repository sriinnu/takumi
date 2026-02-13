import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	OpenAIProvider,
	convertMessages,
	convertTools,
	parseOpenAIStream,
} from "../src/providers/openai.js";
import type { AgentEvent } from "@takumi/core";
import { RetryableError } from "../src/retry.js";
import { ProviderUnavailableError } from "../src/errors.js";
import type { MessagePayload } from "../src/loop.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a ReadableStream from SSE text. */
function createSSEStream(sseText: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(sseText));
			controller.close();
		},
	});
}

/** Create a ReadableStream that delivers data in multiple chunks. */
function createChunkedSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

/** Collect all events from a parseOpenAIStream call. */
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of parseOpenAIStream(stream)) {
		events.push(event);
	}
	return events;
}

/** Build an OpenAI SSE data line. */
function sseData(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

/** Build a typical OpenAI streaming chunk. */
function chunk(
	delta: Record<string, any>,
	finishReason: string | null = null,
	usage?: Record<string, any>,
): string {
	const obj: any = {
		id: "chatcmpl-test",
		object: "chat.completion.chunk",
		created: 1700000000,
		model: "gpt-4.1",
		choices: [
			{
				index: 0,
				delta,
				finish_reason: finishReason,
			},
		],
	};
	if (usage) obj.usage = usage;
	return sseData(obj);
}

/** Build a mock Response for fetch. */
function mockResponse(
	body: string,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(body));
			controller.close();
		},
	});

	return new Response(stream, {
		status,
		statusText: status === 200 ? "OK" : "Error",
		headers: {
			"Content-Type": "text/event-stream",
			...headers,
		},
	});
}

/** Build an error Response (non-streaming JSON body). */
function mockErrorResponse(
	status: number,
	message: string,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify({ error: { message } }), {
		status,
		statusText: "Error",
		headers: { "Content-Type": "application/json", ...headers },
	});
}

// ── Tests ────────────────────────────────────────────────────────────────────

/* ===================================================================
   1. Message Conversion (Anthropic -> OpenAI)
   =================================================================== */

describe("convertMessages", () => {
	it("converts simple user text message", () => {
		const messages: MessagePayload[] = [
			{ role: "user", content: "Hello" },
		];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "user", content: "Hello" }]);
	});

	it("converts simple assistant text message", () => {
		const messages: MessagePayload[] = [
			{ role: "assistant", content: "Hi there!" },
		];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "assistant", content: "Hi there!" }]);
	});

	it("converts user message with text content block array", () => {
		const messages: MessagePayload[] = [
			{
				role: "user",
				content: [{ type: "text", text: "What is 2+2?" }],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "user", content: "What is 2+2?" }]);
	});

	it("converts assistant message with text content block array", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: "The answer is 4." }],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "assistant", content: "The answer is 4." }]);
	});

	it("converts assistant message with tool_use block", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_123",
						name: "read_file",
						input: { path: "/src/main.ts" },
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "toolu_123",
						type: "function",
						function: {
							name: "read_file",
							arguments: '{"path":"/src/main.ts"}',
						},
					},
				],
			},
		]);
	});

	it("converts user message with tool_result block", () => {
		const messages: MessagePayload[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_123",
						content: "File contents here",
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{
				role: "tool",
				tool_call_id: "toolu_123",
				content: "File contents here",
			},
		]);
	});

	it("converts mixed text + tool_use in same assistant message", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Let me read that file." },
					{
						type: "tool_use",
						id: "toolu_abc",
						name: "read_file",
						input: { path: "/foo.ts" },
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{
				role: "assistant",
				content: "Let me read that file.",
				tool_calls: [
					{
						id: "toolu_abc",
						type: "function",
						function: {
							name: "read_file",
							arguments: '{"path":"/foo.ts"}',
						},
					},
				],
			},
		]);
	});

	it("converts multiple tool_use blocks in same message", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "/a.ts" },
					},
					{
						type: "tool_use",
						id: "toolu_2",
						name: "read_file",
						input: { path: "/b.ts" },
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toHaveLength(1);
		expect(result[0].tool_calls).toHaveLength(2);
		expect(result[0].tool_calls![0].id).toBe("toolu_1");
		expect(result[0].tool_calls![1].id).toBe("toolu_2");
	});

	it("converts multiple tool_result blocks in same user message", () => {
		const messages: MessagePayload[] = [
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_1", content: "Result 1" },
					{ type: "tool_result", tool_use_id: "toolu_2", content: "Result 2" },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ role: "tool", tool_call_id: "toolu_1", content: "Result 1" });
		expect(result[1]).toEqual({ role: "tool", tool_call_id: "toolu_2", content: "Result 2" });
	});

	it("strips thinking blocks from content", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "I need to think about this..." },
					{ type: "text", text: "Here is my answer." },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "assistant", content: "Here is my answer." }]);
	});

	it("handles empty content array", () => {
		const messages: MessagePayload[] = [{ role: "user", content: [] }];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "user", content: "" }]);
	});

	it("handles tool_use with empty input", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "toolu_x", name: "get_status", input: {} },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result[0].tool_calls![0].function.arguments).toBe("{}");
	});

	it("handles multi-turn conversation", () => {
		const messages: MessagePayload[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: [{ type: "text", text: "Hi!" }] },
			{ role: "user", content: [{ type: "text", text: "Read this file" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "t1", name: "read_file", input: { path: "/x.ts" } },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t1", content: "file contents" },
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "Here is the file." }] },
		];
		const result = convertMessages(messages);
		expect(result).toHaveLength(6);
		expect(result[0]).toEqual({ role: "user", content: "Hello" });
		expect(result[1]).toEqual({ role: "assistant", content: "Hi!" });
		expect(result[2]).toEqual({ role: "user", content: "Read this file" });
		expect(result[3].role).toBe("assistant");
		expect(result[3].tool_calls).toHaveLength(1);
		expect(result[4]).toEqual({ role: "tool", tool_call_id: "t1", content: "file contents" });
		expect(result[5]).toEqual({ role: "assistant", content: "Here is the file." });
	});

	it("handles tool_result with array content blocks", () => {
		const messages: MessagePayload[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_arr",
						content: [
							{ type: "text", text: "First part" },
							{ type: "text", text: "Second part" },
						],
					},
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{ role: "tool", tool_call_id: "toolu_arr", content: "First part\nSecond part" },
		]);
	});
});

/* ===================================================================
   2. Tool Definition Conversion
   =================================================================== */

describe("convertTools", () => {
	it("converts Anthropic tool format to OpenAI function format", () => {
		const tools = [
			{
				name: "read_file",
				description: "Read a file from disk",
				input_schema: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
		];
		const result = convertTools(tools);
		expect(result).toEqual([
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file from disk",
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
				},
			},
		]);
	});

	it("converts multiple tools", () => {
		const tools = [
			{ name: "read_file", description: "Read", input_schema: {} },
			{ name: "write_file", description: "Write", input_schema: {} },
			{ name: "bash", description: "Run command", input_schema: {} },
		];
		const result = convertTools(tools);
		expect(result).toHaveLength(3);
		expect(result[0].function.name).toBe("read_file");
		expect(result[1].function.name).toBe("write_file");
		expect(result[2].function.name).toBe("bash");
	});

	it("handles tool with inputSchema (camelCase) fallback", () => {
		const tools = [
			{
				name: "grep",
				description: "Search files",
				inputSchema: { type: "object", properties: { pattern: { type: "string" } } },
			},
		];
		const result = convertTools(tools);
		expect(result[0].function.parameters).toEqual({
			type: "object",
			properties: { pattern: { type: "string" } },
		});
	});

	it("handles tool with missing description", () => {
		const tools = [{ name: "noop", input_schema: {} }];
		const result = convertTools(tools);
		expect(result[0].function.description).toBe("");
	});

	it("handles tool with missing schema", () => {
		const tools = [{ name: "noop", description: "No-op" }];
		const result = convertTools(tools);
		expect(result[0].function.parameters).toEqual({});
	});
});

/* ===================================================================
   3. SSE Stream Parsing (OpenAI -> AgentEvent)
   =================================================================== */

describe("parseOpenAIStream", () => {
	describe("text deltas", () => {
		it("emits text_delta for content in delta", async () => {
			const sse =
				chunk({ role: "assistant" }) +
				chunk({ content: "Hello" }) +
				chunk({ content: " world" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(2);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Hello" });
			expect(textEvents[1]).toEqual({ type: "text_delta", text: " world" });
		});

		it("ignores delta with empty content string", async () => {
			const sse =
				chunk({ content: "" }) +
				chunk({ content: "real" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "real" });
		});

		it("handles unicode in text content", async () => {
			const sse = chunk({ content: "Hello 匠 🎨" }) + "data: [DONE]\n\n";
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Hello 匠 🎨" });
		});
	});

	describe("tool call accumulation", () => {
		it("accumulates tool call from multiple chunks", async () => {
			const sse =
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_123",
							type: "function",
							function: { name: "read_file", arguments: "" },
						},
					],
				}) +
				chunk({
					tool_calls: [
						{ index: 0, function: { arguments: '{"path":' } },
					],
				}) +
				chunk({
					tool_calls: [
						{ index: 0, function: { arguments: '"/src/main.ts"}' } },
					],
				}) +
				chunk({}, "tool_calls") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(1);
			expect(toolEvents[0]).toEqual({
				type: "tool_use",
				id: "call_123",
				name: "read_file",
				input: { path: "/src/main.ts" },
			});
		});

		it("accumulates multiple parallel tool calls", async () => {
			const sse =
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_a",
							type: "function",
							function: { name: "read_file", arguments: "" },
						},
						{
							index: 1,
							id: "call_b",
							type: "function",
							function: { name: "bash", arguments: "" },
						},
					],
				}) +
				chunk({
					tool_calls: [
						{ index: 0, function: { arguments: '{"path":"a.ts"}' } },
					],
				}) +
				chunk({
					tool_calls: [
						{ index: 1, function: { arguments: '{"command":"ls"}' } },
					],
				}) +
				chunk({}, "tool_calls") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(2);
			expect(toolEvents[0]).toEqual({
				type: "tool_use",
				id: "call_a",
				name: "read_file",
				input: { path: "a.ts" },
			});
			expect(toolEvents[1]).toEqual({
				type: "tool_use",
				id: "call_b",
				name: "bash",
				input: { command: "ls" },
			});
		});

		it("handles tool call with empty arguments", async () => {
			const sse =
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_empty",
							type: "function",
							function: { name: "get_status", arguments: "{}" },
						},
					],
				}) +
				chunk({}, "tool_calls") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(1);
			expect(toolEvents[0]).toEqual({
				type: "tool_use",
				id: "call_empty",
				name: "get_status",
				input: {},
			});
		});

		it("handles malformed tool call arguments gracefully", async () => {
			const sse =
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_bad",
							type: "function",
							function: { name: "broken", arguments: "{invalid json" },
						},
					],
				}) +
				chunk({}, "tool_calls") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(1);
			expect(toolEvents[0]).toEqual({
				type: "tool_use",
				id: "call_bad",
				name: "broken",
				input: {},
			});
		});
	});

	describe("finish reasons", () => {
		it("emits done with end_turn for stop finish_reason", async () => {
			const sse =
				chunk({ content: "Hello" }) +
				chunk({}, "stop") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "end_turn" });
		});

		it("emits done with tool_use for tool_calls finish_reason", async () => {
			const sse =
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_x",
							type: "function",
							function: { name: "bash", arguments: '{"command":"ls"}' },
						},
					],
				}) +
				chunk({}, "tool_calls") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "tool_use" });
		});

		it("emits done with max_tokens for length finish_reason", async () => {
			const sse =
				chunk({ content: "Truncated output" }) +
				chunk({}, "length") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "max_tokens" });
		});

		it("emits end_turn when [DONE] received without finish_reason", async () => {
			const sse =
				chunk({ content: "Hello" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "end_turn" });
		});
	});

	describe("usage updates", () => {
		it("emits usage_update from final chunk with usage", async () => {
			const sse =
				chunk({ content: "Hi" }) +
				chunk({}, "stop", {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				}) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const usageEvents = events.filter((e) => e.type === "usage_update");
			expect(usageEvents).toHaveLength(1);
			expect(usageEvents[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 100,
					outputTokens: 50,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});

		it("extracts cached_tokens from prompt_tokens_details", async () => {
			const sse =
				chunk({}, "stop", {
					prompt_tokens: 200,
					completion_tokens: 100,
					prompt_tokens_details: { cached_tokens: 50 },
				}) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const usageEvents = events.filter((e) => e.type === "usage_update");
			expect(usageEvents).toHaveLength(1);
			expect((usageEvents[0] as any).usage.cacheReadTokens).toBe(50);
		});

		it("handles missing usage gracefully", async () => {
			const sse =
				chunk({ content: "No usage" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const usageEvents = events.filter((e) => e.type === "usage_update");
			expect(usageEvents).toHaveLength(0);
		});
	});

	describe("chunked delivery", () => {
		it("handles SSE data split across multiple chunks", async () => {
			const chunks = [
				'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"gpt-4.1","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
				"data: [DONE]\n\n",
			];
			const events = await collectEvents(createChunkedSSEStream(chunks));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Hello" });
		});

		it("handles data line split mid-JSON across chunks", async () => {
			const full = JSON.stringify({
				id: "c",
				object: "chat.completion.chunk",
				created: 1,
				model: "gpt-4.1",
				choices: [{ index: 0, delta: { content: "Split" }, finish_reason: null }],
			});
			// Split the JSON in the middle
			const mid = Math.floor(full.length / 2);
			const chunks = [
				`data: ${full.slice(0, mid)}`,
				`${full.slice(mid)}\n\n`,
				"data: [DONE]\n\n",
			];
			const events = await collectEvents(createChunkedSSEStream(chunks));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Split" });
		});
	});

	describe("edge cases", () => {
		it("handles empty stream", async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close();
				},
			});
			const events = await collectEvents(stream);
			expect(events).toHaveLength(0);
		});

		it("ignores SSE comments (lines starting with :)", async () => {
			const sse =
				": this is a comment\n" +
				chunk({ content: "Hi" }) +
				": another comment\n" +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
		});

		it("skips malformed JSON chunks without crashing", async () => {
			const sse =
				"data: {not valid json}\n\n" +
				chunk({ content: "recovered" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "recovered" });
		});

		it("ignores chunks with no choices", async () => {
			const sse =
				sseData({ id: "c", object: "chat.completion.chunk", choices: [] }) +
				chunk({ content: "ok" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
		});

		it("ignores delta with only role field", async () => {
			const sse =
				chunk({ role: "assistant" }) +
				chunk({ content: "Text" }) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Text" });
		});

		it("handles tool call then text in same stream", async () => {
			// Some providers might do text + tool in one response
			const sse =
				chunk({ content: "I will read the file." }) +
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_mix",
							type: "function",
							function: { name: "read_file", arguments: '{"path":"f.ts"}' },
						},
					],
				}) +
				chunk({}, "tool_calls") +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(textEvents).toHaveLength(1);
			expect(toolEvents).toHaveLength(1);
		});
	});

	describe("full realistic message flow", () => {
		it("processes a complete text response", async () => {
			const sse =
				chunk({ role: "assistant" }) +
				chunk({ content: "I'll " }) +
				chunk({ content: "help " }) +
				chunk({ content: "you." }) +
				chunk({}, "stop", {
					prompt_tokens: 50,
					completion_tokens: 10,
				}) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));
			const types = events.map((e) => e.type);
			expect(types).toEqual([
				"text_delta",
				"text_delta",
				"text_delta",
				"usage_update",
				"done",
			]);

			// Verify text content
			const text = events
				.filter((e) => e.type === "text_delta")
				.map((e) => (e as any).text)
				.join("");
			expect(text).toBe("I'll help you.");
		});

		it("processes a complete tool call response", async () => {
			const sse =
				chunk({ role: "assistant" }) +
				chunk({ content: "Let me read that file." }) +
				chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_real",
							type: "function",
							function: { name: "read_file", arguments: "" },
						},
					],
				}) +
				chunk({
					tool_calls: [{ index: 0, function: { arguments: '{"path":"/src/index.ts"}' } }],
				}) +
				chunk({}, "tool_calls", {
					prompt_tokens: 200,
					completion_tokens: 30,
				}) +
				"data: [DONE]\n\n";

			const events = await collectEvents(createSSEStream(sse));

			// Text delta
			expect(events[0]).toEqual({ type: "text_delta", text: "Let me read that file." });
			// Usage
			expect(events[1]).toEqual({
				type: "usage_update",
				usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
			});
			// Tool use (emitted on finish_reason=tool_calls)
			expect(events[2]).toEqual({
				type: "tool_use",
				id: "call_real",
				name: "read_file",
				input: { path: "/src/index.ts" },
			});
			// Done
			expect(events[3]).toEqual({ type: "done", stopReason: "tool_use" });
		});
	});
});

/* ===================================================================
   4. OpenAIProvider (integration with mock fetch)
   =================================================================== */

describe("OpenAIProvider", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function createProvider(overrides?: Partial<{
		apiKey: string;
		model: string;
		maxTokens: number;
		thinking: boolean;
		thinkingBudget: number;
		endpoint: string;
	}>) {
		return new OpenAIProvider({
			apiKey: "test-key",
			model: "gpt-4.1",
			maxTokens: 16384,
			thinking: false,
			thinkingBudget: 0,
			...overrides,
		});
	}

	async function collectProviderEvents(
		provider: OpenAIProvider,
		messages: MessagePayload[],
		system: string,
		tools?: any[],
	): Promise<AgentEvent[]> {
		const events: AgentEvent[] = [];
		for await (const event of provider.sendMessage(messages, system, tools)) {
			events.push(event);
		}
		return events;
	}

	it("places system message as the first message", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "Hi" }) + chunk({}, "stop") + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		await collectProviderEvents(
			provider,
			[{ role: "user", content: "Hello" }],
			"You are a helpful assistant.",
		);

		expect(capturedBody.messages[0]).toEqual({
			role: "system",
			content: "You are a helpful assistant.",
		});
		expect(capturedBody.messages[1]).toEqual({
			role: "user",
			content: "Hello",
		});
		vi.unstubAllGlobals();
	});

	it("sends correct Authorization header", async () => {
		let capturedHeaders: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedHeaders = init.headers;
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider({ apiKey: "sk-test-123" });
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedHeaders.Authorization).toBe("Bearer sk-test-123");
		vi.unstubAllGlobals();
	});

	it("sends request to custom endpoint", async () => {
		let capturedUrl: string = "";
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedUrl = url;
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider({
			endpoint: "http://localhost:11434/v1/chat/completions",
		});
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedUrl).toBe("http://localhost:11434/v1/chat/completions");
		vi.unstubAllGlobals();
	});

	it("includes tools in request when provided", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		const tools = [
			{
				name: "read_file",
				description: "Read a file",
				input_schema: { type: "object", properties: { path: { type: "string" } } },
			},
		];
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys", tools);

		expect(capturedBody.tools).toEqual([
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file",
					parameters: { type: "object", properties: { path: { type: "string" } } },
				},
			},
		]);
		vi.unstubAllGlobals();
	});

	it("does not include tools key when no tools provided", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedBody.tools).toBeUndefined();
		vi.unstubAllGlobals();
	});

	it("throws AgentErrorClass when no API key", async () => {
		const provider = createProvider({ apiKey: "" });
		await expect(async () => {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {
				// consume
			}
		}).rejects.toThrow(/No API key/);
	});

	it("throws RetryableError on 429 with retry-after header", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => mockErrorResponse(429, "Rate limited", { "retry-after": "5" })),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(RetryableError);
			expect((err as RetryableError).status).toBe(429);
			expect((err as RetryableError).retryAfterMs).toBe(5000);
		}
		vi.unstubAllGlobals();
	});

	it("throws RetryableError on 500", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => mockErrorResponse(500, "Internal Server Error")),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(RetryableError);
			expect((err as RetryableError).status).toBe(500);
		}
		vi.unstubAllGlobals();
	});

	it("throws RetryableError on 502", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => mockErrorResponse(502, "Bad Gateway")),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(RetryableError);
			expect((err as RetryableError).status).toBe(502);
		}
		vi.unstubAllGlobals();
	});

	it("throws non-retryable AgentErrorClass on 401", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => mockErrorResponse(401, "Invalid API Key")),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).not.toBeInstanceOf(RetryableError);
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toContain("Invalid API Key");
		}
		vi.unstubAllGlobals();
	});

	it("throws ProviderUnavailableError on network error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
			}),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ProviderUnavailableError);
			expect((err as ProviderUnavailableError).provider).toBe("openai");
		}
		vi.unstubAllGlobals();
	});

	it("propagates user abort signal", async () => {
		const controller = new AbortController();

		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				// Simulate the abort happening during fetch
				controller.abort();
				throw new DOMException("The operation was aborted.", "AbortError");
			}),
		);

		const provider = createProvider();
		await expect(async () => {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
				undefined,
				controller.signal,
			)) {}
		}).rejects.toThrow();
		vi.unstubAllGlobals();
	});

	it("sends correct model in request body", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider({ model: "deepseek-chat" });
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedBody.model).toBe("deepseek-chat");
		vi.unstubAllGlobals();
	});

	it("sends correct max_tokens in request body", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider({ maxTokens: 4096 });
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedBody.max_tokens).toBe(4096);
		vi.unstubAllGlobals();
	});

	it("streams text events correctly through full provider", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const sse =
					chunk({ role: "assistant" }) +
					chunk({ content: "Hello" }) +
					chunk({ content: " world!" }) +
					chunk({}, "stop", { prompt_tokens: 10, completion_tokens: 5 }) +
					"data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		const events = await collectProviderEvents(
			provider,
			[{ role: "user", content: "Hi" }],
			"You are helpful.",
		);

		const textEvents = events.filter((e) => e.type === "text_delta");
		expect(textEvents).toHaveLength(2);
		expect((textEvents[0] as any).text).toBe("Hello");
		expect((textEvents[1] as any).text).toBe(" world!");

		const usageEvents = events.filter((e) => e.type === "usage_update");
		expect(usageEvents).toHaveLength(1);

		const doneEvents = events.filter((e) => e.type === "done");
		expect(doneEvents).toHaveLength(1);
		expect((doneEvents[0] as any).stopReason).toBe("end_turn");
		vi.unstubAllGlobals();
	});

	it("does not include system message when system string is empty", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "");

		expect(capturedBody.messages[0]).toEqual({ role: "user", content: "Hi" });
		vi.unstubAllGlobals();
	});

	it("handles error response with non-JSON body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response("Bad Gateway", {
					status: 502,
					statusText: "Bad Gateway",
				});
			}),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(RetryableError);
			expect((err as RetryableError).status).toBe(502);
		}
		vi.unstubAllGlobals();
	});

	it("sets stream: true in request body", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedBody.stream).toBe(true);
		vi.unstubAllGlobals();
	});

	it("includes stream_options for usage in streaming mode", async () => {
		let capturedBody: any;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string);
				const sse = chunk({ content: "ok" }) + "data: [DONE]\n\n";
				return mockResponse(sse);
			}),
		);

		const provider = createProvider();
		await collectProviderEvents(provider, [{ role: "user", content: "Hi" }], "sys");

		expect(capturedBody.stream_options).toEqual({ include_usage: true });
		vi.unstubAllGlobals();
	});

	it("throws AgentErrorClass when response has no body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				// Create a response with null body
				return {
					ok: true,
					body: null,
					status: 200,
					headers: new Headers(),
					text: async () => "",
				};
			}),
		);

		const provider = createProvider();
		try {
			for await (const _ of provider.sendMessage(
				[{ role: "user", content: "Hi" }],
				"sys",
			)) {}
			expect.fail("Should have thrown");
		} catch (err) {
			expect((err as Error).message).toContain("No response body");
		}
		vi.unstubAllGlobals();
	});
});
