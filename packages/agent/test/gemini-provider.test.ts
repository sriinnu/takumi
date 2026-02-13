import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentEvent } from "@takumi/core";
import {
	GeminiProvider,
	cleanSchema,
	convertMessages,
	convertTools,
	generateToolCallId,
	parseGeminiSSEStream,
} from "../src/providers/gemini.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a ReadableStream from a single SSE text blob. */
function createSSEStream(sseText: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(sseText));
			controller.close();
		},
	});
}

/** Build one Gemini SSE data line (data + newlines). */
function geminiFrame(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

/** Collect all events from a parseGeminiSSEStream call. */
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of parseGeminiSSEStream(stream)) {
		events.push(event);
	}
	return events;
}

/** Create a mock Response with SSE body. */
function createMockResponse(sseText: string, status = 200): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(sseText));
			controller.close();
		},
	});

	return new Response(body, {
		status,
		headers: { "Content-Type": "text/event-stream" },
	});
}

/** Create a mock error Response. */
function createErrorResponse(body: any, status: number, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("cleanSchema", () => {
	it("removes additionalProperties from top level", () => {
		const schema = {
			type: "object",
			properties: { name: { type: "string" } },
			additionalProperties: false,
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned).toEqual({
			type: "object",
			properties: { name: { type: "string" } },
		});
		expect(cleaned).not.toHaveProperty("additionalProperties");
	});

	it("removes additionalProperties recursively from nested objects", () => {
		const schema = {
			type: "object",
			properties: {
				nested: {
					type: "object",
					properties: { age: { type: "number" } },
					additionalProperties: false,
				},
			},
			additionalProperties: false,
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned.properties.nested).not.toHaveProperty("additionalProperties");
		expect(cleaned).not.toHaveProperty("additionalProperties");
	});

	it("removes additionalProperties when set to true", () => {
		const schema = {
			type: "object",
			additionalProperties: true,
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned).not.toHaveProperty("additionalProperties");
	});

	it("removes unsupported format values", () => {
		const schema = {
			type: "string",
			format: "uri",
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned).toEqual({ type: "string" });
		expect(cleaned).not.toHaveProperty("format");
	});

	it("keeps supported format values", () => {
		const schema = {
			type: "string",
			format: "date-time",
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned).toEqual({ type: "string", format: "date-time" });
	});

	it("removes unsupported formats in nested properties", () => {
		const schema = {
			type: "object",
			properties: {
				url: { type: "string", format: "uri" },
				email: { type: "string", format: "idn-email" },
				date: { type: "string", format: "date-time" },
			},
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned.properties.url).toEqual({ type: "string" });
		expect(cleaned.properties.email).toEqual({ type: "string" });
		expect(cleaned.properties.date).toEqual({ type: "string", format: "date-time" });
	});

	it("handles arrays in schemas", () => {
		const schema = {
			type: "object",
			properties: {
				items: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: { id: { type: "string", format: "uri" } },
					},
				},
			},
		};
		const cleaned = cleanSchema(schema);
		expect(cleaned.properties.items.items).not.toHaveProperty("additionalProperties");
		expect(cleaned.properties.items.items.properties.id).toEqual({ type: "string" });
	});

	it("does not mutate the original schema", () => {
		const original = {
			type: "object",
			additionalProperties: false,
			properties: { name: { type: "string" } },
		};
		const frozen = JSON.parse(JSON.stringify(original));
		cleanSchema(original);
		expect(original).toEqual(frozen);
	});

	it("returns null/undefined as-is", () => {
		expect(cleanSchema(null)).toBeNull();
		expect(cleanSchema(undefined)).toBeUndefined();
	});

	it("returns primitives as-is", () => {
		expect(cleanSchema(42)).toBe(42);
		expect(cleanSchema("hello")).toBe("hello");
		expect(cleanSchema(true)).toBe(true);
	});
});

describe("convertMessages", () => {
	it("converts user text messages", () => {
		const messages = [{ role: "user" as const, content: "Hello" }];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "user", parts: [{ text: "Hello" }] }]);
	});

	it("converts assistant to model role", () => {
		const messages = [{ role: "assistant" as const, content: "Hi there" }];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "model", parts: [{ text: "Hi there" }] }]);
	});

	it("converts array content blocks with text", () => {
		const messages = [
			{ role: "user" as const, content: [{ type: "text", text: "What is 2+2?" }] },
		];
		const result = convertMessages(messages);
		expect(result).toEqual([{ role: "user", parts: [{ text: "What is 2+2?" }] }]);
	});

	it("converts tool_use blocks to functionCall", () => {
		const messages = [
			{
				role: "assistant" as const,
				content: [
					{ type: "tool_use", id: "toolu_123", name: "read_file", input: { path: "/src/main.ts" } },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{
				role: "model",
				parts: [
					{ functionCall: { name: "read_file", args: { path: "/src/main.ts" } } },
				],
			},
		]);
	});

	it("converts tool_result blocks to functionResponse", () => {
		const messages = [
			{
				role: "user" as const,
				content: [
					{ type: "tool_result", name: "read_file", content: "file contents here", toolUseId: "toolu_123", isError: false },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{
				role: "user",
				parts: [
					{ functionResponse: { name: "read_file", response: { content: "file contents here" } } },
				],
			},
		]);
	});

	it("converts thinking blocks with thought flag", () => {
		const messages = [
			{
				role: "assistant" as const,
				content: [{ type: "thinking", thinking: "Let me analyze..." }],
			},
		];
		const result = convertMessages(messages);
		expect(result).toEqual([
			{ role: "model", parts: [{ text: "Let me analyze...", thought: true }] },
		]);
	});

	it("handles mixed content blocks", () => {
		const messages = [
			{
				role: "assistant" as const,
				content: [
					{ type: "thinking", thinking: "Thinking..." },
					{ type: "text", text: "Here's the answer." },
					{ type: "tool_use", id: "tc_1", name: "bash", input: { command: "ls" } },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result).toHaveLength(1);
		expect(result[0].role).toBe("model");
		expect(result[0].parts).toHaveLength(3);
		expect(result[0].parts[0]).toEqual({ text: "Thinking...", thought: true });
		expect(result[0].parts[1]).toEqual({ text: "Here's the answer." });
		expect(result[0].parts[2]).toEqual({
			functionCall: { name: "bash", args: { command: "ls" } },
		});
	});

	it("handles multiple messages in sequence", () => {
		const messages = [
			{ role: "user" as const, content: "Hello" },
			{ role: "assistant" as const, content: "Hi" },
			{ role: "user" as const, content: "How are you?" },
		];
		const result = convertMessages(messages);
		expect(result).toHaveLength(3);
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("model");
		expect(result[2].role).toBe("user");
	});

	it("skips empty content arrays", () => {
		const messages = [
			{ role: "user" as const, content: [] },
		];
		const result = convertMessages(messages);
		expect(result).toHaveLength(0);
	});

	it("uses toolUseId as fallback name for tool_result", () => {
		const messages = [
			{
				role: "user" as const,
				content: [
					{ type: "tool_result", toolUseId: "toolu_abc", content: "result" },
				],
			},
		];
		const result = convertMessages(messages);
		expect(result[0].parts[0]).toEqual({
			functionResponse: { name: "toolu_abc", response: { content: "result" } },
		});
	});
});

describe("convertTools", () => {
	it("converts Anthropic tool format to Gemini functionDeclarations", () => {
		const tools = [
			{
				name: "read_file",
				description: "Read a file",
				input_schema: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
					additionalProperties: false,
				},
			},
		];
		const result = convertTools(tools);
		expect(result).toEqual([
			{
				functionDeclarations: [
					{
						name: "read_file",
						description: "Read a file",
						parameters: {
							type: "object",
							properties: { path: { type: "string" } },
							required: ["path"],
						},
					},
				],
			},
		]);
	});

	it("handles inputSchema (camelCase variant)", () => {
		const tools = [
			{
				name: "bash",
				description: "Run a command",
				inputSchema: {
					type: "object",
					properties: { command: { type: "string" } },
				},
			},
		];
		const result = convertTools(tools);
		expect(result[0].functionDeclarations[0].parameters).toEqual({
			type: "object",
			properties: { command: { type: "string" } },
		});
	});

	it("returns empty array for empty/null tools", () => {
		expect(convertTools([])).toEqual([]);
		expect(convertTools(null as any)).toEqual([]);
		expect(convertTools(undefined as any)).toEqual([]);
	});

	it("cleans schemas in tool parameters", () => {
		const tools = [
			{
				name: "test",
				description: "Test tool",
				input_schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						url: { type: "string", format: "uri" },
					},
				},
			},
		];
		const result = convertTools(tools);
		const params = result[0].functionDeclarations[0].parameters;
		expect(params).not.toHaveProperty("additionalProperties");
		expect(params.properties.url).toEqual({ type: "string" });
	});

	it("handles tools without schemas", () => {
		const tools = [{ name: "get_status", description: "Get status" }];
		const result = convertTools(tools);
		expect(result[0].functionDeclarations[0]).toEqual({
			name: "get_status",
			description: "Get status",
		});
		expect(result[0].functionDeclarations[0]).not.toHaveProperty("parameters");
	});
});

describe("generateToolCallId", () => {
	it("generates IDs with call_ prefix", () => {
		const id = generateToolCallId();
		expect(id).toMatch(/^call_[0-9a-f]{8}$/);
	});

	it("generates unique IDs", () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateToolCallId()));
		expect(ids.size).toBe(100);
	});
});

describe("parseGeminiSSEStream", () => {
	describe("text responses", () => {
		it("parses a text response", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "Hello world" }], role: "model" },
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Hello world" });
		});

		it("parses multiple streaming text chunks", async () => {
			const sse =
				geminiFrame({
					candidates: [{ content: { parts: [{ text: "Hello" }], role: "model" } }],
				}) +
				geminiFrame({
					candidates: [{ content: { parts: [{ text: " world" }], role: "model" } }],
				});
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(2);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Hello" });
			expect(textEvents[1]).toEqual({ type: "text_delta", text: " world" });
		});

		it("handles empty text parts", async () => {
			const sse = geminiFrame({
				candidates: [{ content: { parts: [{ text: "" }], role: "model" } }],
			});
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "" });
		});
	});

	describe("function call responses", () => {
		it("parses a function call", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: "read_file", args: { path: "/src/main.ts" } } }],
							role: "model",
						},
						finishReason: "STOP",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(1);
			expect(toolEvents[0]).toMatchObject({
				type: "tool_use",
				name: "read_file",
				input: { path: "/src/main.ts" },
			});
			// Should have a generated ID
			expect((toolEvents[0] as any).id).toMatch(/^call_[0-9a-f]{8}$/);
		});

		it("parses multiple function calls in one response", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: {
							parts: [
								{ functionCall: { name: "read_file", args: { path: "a.ts" } } },
								{ functionCall: { name: "read_file", args: { path: "b.ts" } } },
							],
							role: "model",
						},
						finishReason: "STOP",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(2);
			expect((toolEvents[0] as any).name).toBe("read_file");
			expect((toolEvents[1] as any).name).toBe("read_file");
			// IDs should be different
			expect((toolEvents[0] as any).id).not.toBe((toolEvents[1] as any).id);
		});

		it("sets stop reason to tool_use when function calls present", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: "bash", args: { command: "ls" } } }],
							role: "model",
						},
						finishReason: "STOP",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "tool_use" });
		});

		it("handles function calls with empty args", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: {
							parts: [{ functionCall: { name: "get_status", args: {} } }],
							role: "model",
						},
						finishReason: "STOP",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const toolEvents = events.filter((e) => e.type === "tool_use");
			expect(toolEvents).toHaveLength(1);
			expect((toolEvents[0] as any).input).toEqual({});
		});
	});

	describe("thinking responses", () => {
		it("parses thinking parts with thought flag", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: {
							parts: [{ text: "Let me think about this...", thought: true }],
							role: "model",
						},
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const thinkingEvents = events.filter((e) => e.type === "thinking_delta");
			expect(thinkingEvents).toHaveLength(1);
			expect(thinkingEvents[0]).toEqual({
				type: "thinking_delta",
				text: "Let me think about this...",
			});
		});

		it("handles mixed thinking and text parts", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: {
							parts: [
								{ text: "Let me analyze...", thought: true },
								{ text: "The answer is 42." },
							],
							role: "model",
						},
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const thinkingEvents = events.filter((e) => e.type === "thinking_delta");
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(thinkingEvents).toHaveLength(1);
			expect(textEvents).toHaveLength(1);
			expect(thinkingEvents[0]).toEqual({ type: "thinking_delta", text: "Let me analyze..." });
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "The answer is 42." });
		});
	});

	describe("finish reasons", () => {
		it("maps STOP to end_turn", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "Done" }], role: "model" },
						finishReason: "STOP",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "end_turn" });
		});

		it("maps MAX_TOKENS to max_tokens", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "Truncated..." }], role: "model" },
						finishReason: "MAX_TOKENS",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "max_tokens" });
		});

		it("maps SAFETY to end_turn", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "..." }], role: "model" },
						finishReason: "SAFETY",
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "end_turn" });
		});

		it("does not emit done when no finishReason", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "streaming..." }], role: "model" },
					},
				],
			});
			const events = await collectEvents(createSSEStream(sse));
			const doneEvents = events.filter((e) => e.type === "done");
			expect(doneEvents).toHaveLength(0);
		});
	});

	describe("usage metadata", () => {
		it("emits usage_update from usageMetadata", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "Hi" }], role: "model" },
						finishReason: "STOP",
					},
				],
				usageMetadata: {
					promptTokenCount: 100,
					candidatesTokenCount: 50,
					totalTokenCount: 150,
				},
			});
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

		it("handles usage-only chunk (no candidates)", async () => {
			const sse = geminiFrame({
				usageMetadata: {
					promptTokenCount: 200,
					candidatesTokenCount: 100,
				},
			});
			const events = await collectEvents(createSSEStream(sse));
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 200,
					outputTokens: 100,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});

		it("defaults missing token counts to 0", async () => {
			const sse = geminiFrame({
				candidates: [
					{
						content: { parts: [{ text: "Test" }], role: "model" },
						finishReason: "STOP",
					},
				],
				usageMetadata: {},
			});
			const events = await collectEvents(createSSEStream(sse));
			const usageEvents = events.filter((e) => e.type === "usage_update");
			expect(usageEvents).toHaveLength(1);
			expect(usageEvents[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});
	});

	describe("error handling in stream", () => {
		it("emits error event for API error in stream", async () => {
			const sse = geminiFrame({
				error: { code: 400, message: "Invalid request", status: "INVALID_ARGUMENT" },
			});
			const events = await collectEvents(createSSEStream(sse));
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
			expect((events[0] as any).error.message).toBe("Invalid request");
		});

		it("handles malformed JSON in SSE data", async () => {
			const sse = "data: {not valid json}\n\n";
			const events = await collectEvents(createSSEStream(sse));
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
			expect((events[0] as any).error.message).toContain("Gemini SSE parse error");
		});

		it("skips [DONE] marker", async () => {
			const sse =
				geminiFrame({
					candidates: [{ content: { parts: [{ text: "Hi" }], role: "model" } }],
				}) +
				"data: [DONE]\n\n";
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			// No error events
			const errorEvents = events.filter((e) => e.type === "error");
			expect(errorEvents).toHaveLength(0);
		});

		it("skips SSE comment lines", async () => {
			const sse =
				": this is a comment\n" +
				geminiFrame({
					candidates: [{ content: { parts: [{ text: "after comment" }], role: "model" } }],
				});
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "after comment" });
		});
	});

	describe("system instruction", () => {
		it("is placed correctly in request body", () => {
			// We test this indirectly through the provider constructor
			// The actual request building is validated via mock fetch in GeminiProvider tests
			const provider = new GeminiProvider({
				apiKey: "test-key",
				model: "gemini-2.5-pro",
				maxTokens: 8192,
				thinking: false,
				thinkingBudget: 0,
			});
			expect(provider).toBeDefined();
		});
	});

	describe("full realistic flow", () => {
		it("processes a complete text response with usage", async () => {
			const sse =
				geminiFrame({
					candidates: [{ content: { parts: [{ text: "Hello" }], role: "model" } }],
				}) +
				geminiFrame({
					candidates: [{ content: { parts: [{ text: " world!" }], role: "model" } }],
				}) +
				geminiFrame({
					candidates: [
						{
							content: { parts: [{ text: "" }], role: "model" },
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 50,
						candidatesTokenCount: 10,
					},
				});
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			const doneEvents = events.filter((e) => e.type === "done");
			const usageEvents = events.filter((e) => e.type === "usage_update");

			expect(textEvents).toHaveLength(3);
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "end_turn" });
			expect(usageEvents).toHaveLength(1);
			expect((usageEvents[0] as any).usage.inputTokens).toBe(50);
		});

		it("processes a tool call response with text preamble", async () => {
			const sse =
				geminiFrame({
					candidates: [
						{
							content: { parts: [{ text: "Let me read that file." }], role: "model" },
						},
					],
				}) +
				geminiFrame({
					candidates: [
						{
							content: {
								parts: [{ functionCall: { name: "read_file", args: { path: "/src/main.ts" } } }],
								role: "model",
							},
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 100,
						candidatesTokenCount: 30,
					},
				});
			const events = await collectEvents(createSSEStream(sse));
			const textEvents = events.filter((e) => e.type === "text_delta");
			const toolEvents = events.filter((e) => e.type === "tool_use");
			const doneEvents = events.filter((e) => e.type === "done");

			expect(textEvents).toHaveLength(1);
			expect(textEvents[0]).toEqual({ type: "text_delta", text: "Let me read that file." });
			expect(toolEvents).toHaveLength(1);
			expect((toolEvents[0] as any).name).toBe("read_file");
			expect(doneEvents).toHaveLength(1);
			expect(doneEvents[0]).toEqual({ type: "done", stopReason: "tool_use" });
		});
	});
});

describe("GeminiProvider", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	function createProvider(overrides?: Partial<ConstructorParameters<typeof GeminiProvider>[0]>) {
		return new GeminiProvider({
			apiKey: "test-api-key",
			model: "gemini-2.5-pro",
			maxTokens: 8192,
			thinking: false,
			thinkingBudget: 0,
			...overrides,
		});
	}

	it("throws when no API key configured", async () => {
		const provider = createProvider({ apiKey: "" });
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system prompt");
		await expect(gen.next()).rejects.toThrow("No API key configured");
	});

	it("sends correct request format to Gemini API", async () => {
		let capturedUrl = "";
		let capturedBody: any = null;

		globalThis.fetch = vi.fn(async (url: any, init: any) => {
			capturedUrl = url;
			capturedBody = JSON.parse(init.body);
			return createMockResponse(
				geminiFrame({
					candidates: [
						{
							content: { parts: [{ text: "Response" }], role: "model" },
							finishReason: "STOP",
						},
					],
				}),
			);
		}) as any;

		const provider = createProvider();
		const events: AgentEvent[] = [];
		for await (const event of provider.sendMessage(
			[{ role: "user", content: "Hello" }],
			"You are a helpful assistant",
		)) {
			events.push(event);
		}

		expect(capturedUrl).toContain("gemini-2.5-pro:streamGenerateContent");
		expect(capturedUrl).toContain("alt=sse");
		expect(capturedUrl).toContain("key=test-api-key");
		expect(capturedBody.systemInstruction).toEqual({
			parts: [{ text: "You are a helpful assistant" }],
		});
		expect(capturedBody.contents).toEqual([
			{ role: "user", parts: [{ text: "Hello" }] },
		]);
		expect(capturedBody.generationConfig).toEqual({
			maxOutputTokens: 8192,
			temperature: 1.0,
		});
	});

	it("includes thinking config when thinking is enabled", async () => {
		let capturedBody: any = null;

		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			capturedBody = JSON.parse(init.body);
			return createMockResponse(
				geminiFrame({
					candidates: [
						{
							content: { parts: [{ text: "OK" }], role: "model" },
							finishReason: "STOP",
						},
					],
				}),
			);
		}) as any;

		const provider = createProvider({ thinking: true, thinkingBudget: 10000 });
		const events: AgentEvent[] = [];
		for await (const event of provider.sendMessage(
			[{ role: "user", content: "Think" }],
			"system",
		)) {
			events.push(event);
		}

		expect(capturedBody.generationConfig.thinkingConfig).toEqual({
			thinkingBudget: 10000,
		});
	});

	it("includes tools when provided", async () => {
		let capturedBody: any = null;

		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			capturedBody = JSON.parse(init.body);
			return createMockResponse(
				geminiFrame({
					candidates: [
						{
							content: { parts: [{ text: "OK" }], role: "model" },
							finishReason: "STOP",
						},
					],
				}),
			);
		}) as any;

		const tools = [
			{
				name: "read_file",
				description: "Read a file",
				input_schema: {
					type: "object",
					properties: { path: { type: "string" } },
					additionalProperties: false,
				},
			},
		];

		const provider = createProvider();
		const events: AgentEvent[] = [];
		for await (const event of provider.sendMessage(
			[{ role: "user", content: "Read a file" }],
			"system",
			tools,
		)) {
			events.push(event);
		}

		expect(capturedBody.tools).toEqual([
			{
				functionDeclarations: [
					{
						name: "read_file",
						description: "Read a file",
						parameters: {
							type: "object",
							properties: { path: { type: "string" } },
						},
					},
				],
			},
		]);
	});

	it("throws RetryableError on 429 status", async () => {
		globalThis.fetch = vi.fn(async () =>
			createErrorResponse(
				{ error: { code: 429, message: "Rate limited", status: "RESOURCE_EXHAUSTED" } },
				429,
				{ "retry-after": "5" },
			),
		) as any;

		const provider = createProvider();
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system");
		await expect(gen.next()).rejects.toThrow("Gemini API rate limited");
	});

	it("throws RetryableError on 500 status", async () => {
		globalThis.fetch = vi.fn(async () =>
			createErrorResponse(
				{ error: { code: 500, message: "Internal error" } },
				500,
			),
		) as any;

		const provider = createProvider();
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system");
		await expect(gen.next()).rejects.toThrow("Gemini API error");
	});

	it("throws non-retryable AgentErrorClass on 400 status", async () => {
		globalThis.fetch = vi.fn(async () =>
			createErrorResponse(
				{ error: { code: 400, message: "Invalid argument" } },
				400,
			),
		) as any;

		const provider = createProvider();
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system");
		await expect(gen.next()).rejects.toThrow("Gemini API error: Invalid argument");
	});

	it("throws ProviderUnavailableError on connection error", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("fetch failed: ECONNREFUSED");
		}) as any;

		const provider = createProvider();
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system");
		await expect(gen.next()).rejects.toThrow("Gemini API connection error");
	});

	it("throws AgentErrorClass when response has no body", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(null, { status: 200 });
		}) as any;

		const provider = createProvider();
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system");
		// Response with null body should throw
		await expect(gen.next()).rejects.toThrow("No response body from Gemini API");
	});

	it("propagates user abort signal", async () => {
		const abortController = new AbortController();
		abortController.abort();

		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			// Throw abort error just like real fetch would
			if (init.signal?.aborted) {
				const err = new DOMException("The operation was aborted", "AbortError");
				throw err;
			}
			return createMockResponse("");
		}) as any;

		const provider = createProvider();
		const gen = provider.sendMessage(
			[{ role: "user", content: "Hello" }],
			"system",
			undefined,
			abortController.signal,
		);
		await expect(gen.next()).rejects.toThrow();
	});

	it("parses retry-after header on 429", async () => {
		globalThis.fetch = vi.fn(async () =>
			createErrorResponse(
				{ error: { code: 429, message: "Rate limited" } },
				429,
				{ "retry-after": "10" },
			),
		) as any;

		const provider = createProvider();
		const gen = provider.sendMessage([{ role: "user", content: "Hello" }], "system");

		try {
			await gen.next();
			expect.unreachable("Should have thrown");
		} catch (err: any) {
			expect(err.status).toBe(429);
			expect(err.retryAfterMs).toBe(10000);
		}
	});

	it("does not include tools in body when tools array is empty", async () => {
		let capturedBody: any = null;

		globalThis.fetch = vi.fn(async (_url: any, init: any) => {
			capturedBody = JSON.parse(init.body);
			return createMockResponse(
				geminiFrame({
					candidates: [
						{
							content: { parts: [{ text: "OK" }], role: "model" },
							finishReason: "STOP",
						},
					],
				}),
			);
		}) as any;

		const provider = createProvider();
		for await (const _ of provider.sendMessage(
			[{ role: "user", content: "Hello" }],
			"system",
			[],
		)) {}

		expect(capturedBody.tools).toBeUndefined();
	});
});
