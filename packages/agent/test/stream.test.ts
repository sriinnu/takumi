import { describe, it, expect } from "vitest";
import { parseSSEStream } from "../src/stream.js";
import type { AgentEvent } from "@takumi/core";

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

/** Collect all events from a parseSSEStream call. */
async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of parseSSEStream(stream)) {
		events.push(event);
	}
	return events;
}

/** Build one SSE event frame (event + data + blank line). */
function sseFrame(eventType: string, data: unknown): string {
	return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseSSEStream", () => {
	// ── 1. Simple text streaming ─────────────────────────────────────────────

	describe("text_delta events", () => {
		it("emits a single text_delta event", async () => {
			const sse = sseFrame("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "Hello" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "text_delta", text: "Hello" });
		});

		it("emits multiple text_delta events in sequence", async () => {
			const sse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello" },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: " world" },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "!" },
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(3);
			expect(events[0]).toEqual({ type: "text_delta", text: "Hello" });
			expect(events[1]).toEqual({ type: "text_delta", text: " world" });
			expect(events[2]).toEqual({ type: "text_delta", text: "!" });
		});

		it("handles text_delta with empty string", async () => {
			const sse = sseFrame("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "text_delta", text: "" });
		});

		it("handles text_delta with unicode characters", async () => {
			const sse = sseFrame("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "चि 匠 🎨" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "text_delta", text: "चि 匠 🎨" });
		});
	});

	// ── 2. Thinking delta streaming ──────────────────────────────────────────

	describe("thinking_delta events", () => {
		it("emits a thinking_delta event", async () => {
			const sse = sseFrame("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "thinking_delta", thinking: "Let me think about this..." },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "thinking_delta",
				text: "Let me think about this...",
			});
		});

		it("emits multiple thinking_delta events", async () => {
			const sse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "thinking_delta", thinking: "First, " },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "thinking_delta", thinking: "I need to consider..." },
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: "thinking_delta", text: "First, " });
			expect(events[1]).toEqual({ type: "thinking_delta", text: "I need to consider..." });
		});
	});

	// ── 3. Complete tool_use flow ────────────────────────────────────────────

	describe("tool_use accumulation", () => {
		it("accumulates tool_use from start + json deltas + stop", async () => {
			const sse =
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_123",
						name: "read_file",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"path":' },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: ' "/src/m' },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: 'ain.ts"}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 1,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_123",
				name: "read_file",
				input: { path: "/src/main.ts" },
			});
		});

		it("handles tool_use with complex nested input", async () => {
			const inputJson = JSON.stringify({
				command: "grep",
				args: ["-r", "import"],
				options: { cwd: "/project", maxDepth: 3 },
			});

			const sse =
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_456",
						name: "bash",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: inputJson },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 0,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_456",
				name: "bash",
				input: {
					command: "grep",
					args: ["-r", "import"],
					options: { cwd: "/project", maxDepth: 3 },
				},
			});
		});
	});

	// ── 4. Multiple tool_use blocks ──────────────────────────────────────────

	describe("multiple tool_use blocks", () => {
		it("handles two tool_use blocks at different indices", async () => {
			const sse =
				// First tool_use at index 0
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_aaa",
						name: "read_file",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 0,
				}) +
				// Second tool_use at index 1
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_bbb",
						name: "read_file",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"path":"b.ts"}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 1,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_aaa",
				name: "read_file",
				input: { path: "a.ts" },
			});
			expect(events[1]).toEqual({
				type: "tool_use",
				id: "toolu_bbb",
				name: "read_file",
				input: { path: "b.ts" },
			});
		});

		it("handles interleaved tool_use blocks at different indices", async () => {
			const sse =
				// Start both tools
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_x",
						name: "tool_a",
						input: {},
					},
				}) +
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_y",
						name: "tool_b",
						input: {},
					},
				}) +
				// Interleaved deltas
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"a":' },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"b":' },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: "1}" },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: "2}" },
				}) +
				// Stop both
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 0,
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 1,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_x",
				name: "tool_a",
				input: { a: 1 },
			});
			expect(events[1]).toEqual({
				type: "tool_use",
				id: "toolu_y",
				name: "tool_b",
				input: { b: 2 },
			});
		});
	});

	// ── 5. Mixed text + tool_use ─────────────────────────────────────────────

	describe("mixed text and tool_use", () => {
		it("emits text deltas then tool_use in order", async () => {
			const sse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Let me read that file." },
				}) +
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_mix",
						name: "read_file",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"path":"file.ts"}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 1,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				type: "text_delta",
				text: "Let me read that file.",
			});
			expect(events[1]).toEqual({
				type: "tool_use",
				id: "toolu_mix",
				name: "read_file",
				input: { path: "file.ts" },
			});
		});

		it("handles thinking + text + tool_use in same message", async () => {
			const sse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "thinking_delta", thinking: "I should check the file." },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "text_delta", text: "Checking..." },
				}) +
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 2,
					content_block: {
						type: "tool_use",
						id: "toolu_ttt",
						name: "bash",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 2,
					delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 2,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(3);
			expect(events[0]).toEqual({ type: "thinking_delta", text: "I should check the file." });
			expect(events[1]).toEqual({ type: "text_delta", text: "Checking..." });
			expect(events[2]).toEqual({
				type: "tool_use",
				id: "toolu_ttt",
				name: "bash",
				input: { command: "ls" },
			});
		});
	});

	// ── 6. Usage updates from message_start ──────────────────────────────────

	describe("usage_update from message_start", () => {
		it("emits usage_update with all token fields", async () => {
			const sse = sseFrame("message_start", {
				type: "message_start",
				message: {
					id: "msg_001",
					model: "claude-opus-4-6",
					usage: {
						input_tokens: 100,
						output_tokens: 0,
						cache_read_input_tokens: 50,
						cache_creation_input_tokens: 25,
					},
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 100,
					outputTokens: 0,
					cacheReadTokens: 50,
					cacheWriteTokens: 25,
				},
			});
		});

		it("defaults missing token fields to 0", async () => {
			const sse = sseFrame("message_start", {
				type: "message_start",
				message: {
					id: "msg_002",
					model: "claude-opus-4-6",
					usage: {
						input_tokens: 42,
					},
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 42,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});

		it("emits nothing when message_start has no usage", async () => {
			const sse = sseFrame("message_start", {
				type: "message_start",
				message: {
					id: "msg_003",
					model: "claude-opus-4-6",
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});
	});

	// ── 7. Usage updates from message_delta ──────────────────────────────────

	describe("usage_update from message_delta", () => {
		it("emits usage_update from top-level usage field", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: {},
				usage: {
					input_tokens: 0,
					output_tokens: 200,
					cache_read_input_tokens: 0,
					cache_creation_input_tokens: 0,
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 0,
					outputTokens: 200,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});

		it("emits both done and usage_update when message_delta has stop_reason and usage", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: {
					input_tokens: 10,
					output_tokens: 150,
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				type: "done",
				stopReason: "end_turn",
			});
			expect(events[1]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 10,
					outputTokens: 150,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});
	});

	// ── 8. Done event with stop_reason ───────────────────────────────────────

	describe("done event", () => {
		it("emits done with end_turn stop reason", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "done",
				stopReason: "end_turn",
			});
		});

		it("emits done with max_tokens stop reason", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "max_tokens" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "done",
				stopReason: "max_tokens",
			});
		});

		it("emits done with tool_use stop reason", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "tool_use" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "done",
				stopReason: "tool_use",
			});
		});

		it("emits done with stop_sequence stop reason", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "stop_sequence" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "done",
				stopReason: "stop_sequence",
			});
		});

		it("does not emit done when message_delta has no stop_reason", async () => {
			const sse = sseFrame("message_delta", {
				type: "message_delta",
				delta: {},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});
	});

	// ── 9. Error event handling ──────────────────────────────────────────────

	describe("error events", () => {
		it("emits error event with message from SSE error", async () => {
			const sse = sseFrame("error", {
				type: "error",
				error: {
					type: "overloaded_error",
					message: "The server is temporarily overloaded.",
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
			const errorEvent = events[0] as { type: "error"; error: Error };
			expect(errorEvent.error.message).toBe("The server is temporarily overloaded.");
		});

		it("uses default message when error has no message", async () => {
			const sse = sseFrame("error", {
				type: "error",
				error: { type: "unknown_error" },
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
			const errorEvent = events[0] as { type: "error"; error: Error };
			expect(errorEvent.error.message).toBe("Unknown stream error");
		});

		it("uses default message when error field is missing", async () => {
			const sse = sseFrame("error", {
				type: "error",
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
			const errorEvent = events[0] as { type: "error"; error: Error };
			expect(errorEvent.error.message).toBe("Unknown stream error");
		});
	});

	// ── 10. Ping events ignored ──────────────────────────────────────────────

	describe("ping events", () => {
		it("ignores ping events and emits nothing", async () => {
			const sse = sseFrame("ping", { type: "ping" });

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});

		it("skips pings but processes surrounding events", async () => {
			const sse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Before" },
				}) +
				sseFrame("ping", { type: "ping" }) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "After" },
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: "text_delta", text: "Before" });
			expect(events[1]).toEqual({ type: "text_delta", text: "After" });
		});
	});

	// ── 11. Chunked delivery ─────────────────────────────────────────────────

	describe("chunked delivery", () => {
		it("handles SSE event split across multiple ReadableStream chunks", async () => {
			// Split a single SSE event in the middle of the data line
			const chunks = [
				"event: content_block_delta\n",
				'data: {"type":"content_block_delta","index":0,',
				'"delta":{"type":"text_delta","text":"Hello"}}\n',
				"\n",
			];

			const events = await collectEvents(createChunkedSSEStream(chunks));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "text_delta", text: "Hello" });
		});

		it("handles multiple events delivered one byte at a time", async () => {
			const fullSse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "A" },
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "B" },
				});

			// Split into individual characters (simulates byte-by-byte delivery)
			const chunks = fullSse.split("").map((ch) => ch);

			const events = await collectEvents(createChunkedSSEStream(chunks));

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: "text_delta", text: "A" });
			expect(events[1]).toEqual({ type: "text_delta", text: "B" });
		});

		it("handles event type and data in same chunk, blank line in next", async () => {
			const chunks = [
				'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"split"}}\n',
				"\n",
			];

			const events = await collectEvents(createChunkedSSEStream(chunks));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "text_delta", text: "split" });
		});

		it("handles tool_use flow split across many small chunks", async () => {
			const chunks = [
				'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_c","name":"grep","input":{}}}\n\n',
				'event: content_block_delta\ndata: {"type":"content_block_',
				'delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"pattern',
				'\\":\\"foo\\"}"}}\n\n',
				'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			];

			const events = await collectEvents(createChunkedSSEStream(chunks));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_c",
				name: "grep",
				input: { pattern: "foo" },
			});
		});
	});

	// ── 12. Empty input JSON for tool_use ────────────────────────────────────

	describe("empty tool input", () => {
		it("emits tool_use with empty object when no input_json_delta received", async () => {
			const sse =
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_empty",
						name: "get_status",
						input: {},
					},
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 0,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_empty",
				name: "get_status",
				input: {},
			});
		});

		it("emits tool_use with empty object when input_json_delta has empty braces", async () => {
			const sse =
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_braces",
						name: "get_status",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: "{}" },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 0,
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_braces",
				name: "get_status",
				input: {},
			});
		});
	});

	// ── 13. Malformed JSON in SSE data ───────────────────────────────────────

	describe("malformed JSON", () => {
		it("emits error event for invalid JSON in data field (does not crash)", async () => {
			const sse = "event: content_block_delta\ndata: {not valid json!!\n\n";

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
			const errorEvent = events[0] as { type: "error"; error: Error };
			expect(errorEvent.error.message).toContain("SSE parse error");
		});

		it("recovers and processes subsequent valid events after malformed one", async () => {
			const sse =
				"event: content_block_delta\ndata: INVALID\n\n" +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "recovered" },
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe("error");
			expect(events[1]).toEqual({ type: "text_delta", text: "recovered" });
		});

		it("handles truncated JSON gracefully", async () => {
			const sse = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{\n\n';

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("error");
		});
	});

	// ── 14. message_stop event ───────────────────────────────────────────────

	describe("message_stop event", () => {
		it("does not emit any event for message_stop", async () => {
			const sse = sseFrame("message_stop", {
				type: "message_stop",
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});

		it("message_stop between other events does not interfere", async () => {
			const sse =
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello" },
				}) +
				sseFrame("message_stop", { type: "message_stop" }) +
				sseFrame("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
				});

			const events = await collectEvents(createSSEStream(sse));

			// text_delta + done, message_stop produces nothing
			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({ type: "text_delta", text: "Hello" });
			expect(events[1]).toEqual({ type: "done", stopReason: "end_turn" });
		});
	});

	// ── Full realistic message flow ──────────────────────────────────────────

	describe("full message flow", () => {
		it("processes a complete realistic API response", async () => {
			const sse =
				// 1. message_start with usage
				sseFrame("message_start", {
					type: "message_start",
					message: {
						id: "msg_full",
						model: "claude-opus-4-6",
						usage: {
							input_tokens: 500,
							output_tokens: 0,
							cache_read_input_tokens: 200,
							cache_creation_input_tokens: 100,
						},
					},
				}) +
				// 2. ping
				sseFrame("ping", { type: "ping" }) +
				// 3. text content
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "I'll read the file." },
				}) +
				// 4. tool_use
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "tool_use",
						id: "toolu_real",
						name: "read_file",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: '{"path":"/src/index.ts"}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 1,
				}) +
				// 5. message_delta with stop_reason and usage
				sseFrame("message_delta", {
					type: "message_delta",
					delta: { stop_reason: "tool_use" },
					usage: {
						input_tokens: 0,
						output_tokens: 75,
					},
				}) +
				// 6. message_stop
				sseFrame("message_stop", { type: "message_stop" });

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(5);

			// usage from message_start
			expect(events[0]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 500,
					outputTokens: 0,
					cacheReadTokens: 200,
					cacheWriteTokens: 100,
				},
			});

			// text_delta
			expect(events[1]).toEqual({
				type: "text_delta",
				text: "I'll read the file.",
			});

			// tool_use
			expect(events[2]).toEqual({
				type: "tool_use",
				id: "toolu_real",
				name: "read_file",
				input: { path: "/src/index.ts" },
			});

			// done from message_delta
			expect(events[3]).toEqual({
				type: "done",
				stopReason: "tool_use",
			});

			// usage from message_delta
			expect(events[4]).toEqual({
				type: "usage_update",
				usage: {
					inputTokens: 0,
					outputTokens: 75,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles empty stream with no data", async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.close();
				},
			});

			const events = await collectEvents(stream);

			expect(events).toHaveLength(0);
		});

		it("ignores unknown event types without crashing", async () => {
			const sse = sseFrame("some_new_event_type", {
				type: "some_new_event_type",
				data: "whatever",
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});

		it("handles content_block_start for non-tool_use type (e.g., text)", async () => {
			const sse = sseFrame("content_block_start", {
				type: "content_block_start",
				index: 0,
				content_block: {
					type: "text",
					text: "",
				},
			});

			const events = await collectEvents(createSSEStream(sse));

			// text-type content_block_start is not tracked as pending tool
			expect(events).toHaveLength(0);
		});

		it("handles content_block_stop for non-tool index (no pending tool)", async () => {
			// If content_block_stop arrives for an index with no pending tool,
			// it should simply be a no-op.
			const sse = sseFrame("content_block_stop", {
				type: "content_block_stop",
				index: 99,
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});

		it("handles content_block_delta with no delta field", async () => {
			const sse = sseFrame("content_block_delta", {
				type: "content_block_delta",
				index: 0,
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});

		it("handles content_block_start with missing content_block field", async () => {
			const sse = sseFrame("content_block_start", {
				type: "content_block_start",
				index: 0,
			});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(0);
		});

		it("handles tool_use with malformed accumulated JSON (emits tool_use with empty input)", async () => {
			// If the accumulated input_json is not valid JSON, the tool_use
			// should still be emitted with an empty input object.
			const sse =
				sseFrame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_bad_json",
						name: "read_file",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"path": unclosed' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
					index: 0,
				});

			const events = await collectEvents(createSSEStream(sse));

			// The tool_use event is still emitted but with empty input
			// because the malformed JSON parse fails silently (logs error)
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_bad_json",
				name: "read_file",
				input: {},
			});
		});

		it("handles currentData remaining when stream ends (no trailing blank line)", async () => {
			// When the stream closes with data accumulated in currentData
			// (event + data lines parsed, but no blank line to flush), the
			// post-loop code processes the remaining currentData.
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					// Include newlines after event and data so they are parsed,
					// but omit the final blank line that normally triggers flush.
					controller.enqueue(
						encoder.encode(
							'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"trailing"}}\n',
						),
					);
					controller.close();
				},
			});

			const events = await collectEvents(stream);

			// The post-loop `if (currentData)` block processes the remaining data
			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "text_delta", text: "trailing" });
		});

		it("drops incomplete data when stream ends without newline after data line", async () => {
			// If the stream ends mid-line (no trailing \n), the data remains
			// in `buffer` and never gets extracted to `currentData`, so nothing
			// is emitted. This is correct: incomplete SSE frames are discarded.
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						encoder.encode(
							'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lost"}}',
						),
					);
					controller.close();
				},
			});

			const events = await collectEvents(stream);

			expect(events).toHaveLength(0);
		});

		it("handles index defaulting to 0 when not specified", async () => {
			const sse =
				sseFrame("content_block_start", {
					type: "content_block_start",
					content_block: {
						type: "tool_use",
						id: "toolu_noindex",
						name: "list_files",
						input: {},
					},
				}) +
				sseFrame("content_block_delta", {
					type: "content_block_delta",
					delta: { type: "input_json_delta", partial_json: '{"dir":"."}' },
				}) +
				sseFrame("content_block_stop", {
					type: "content_block_stop",
				});

			const events = await collectEvents(createSSEStream(sse));

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				type: "tool_use",
				id: "toolu_noindex",
				name: "list_files",
				input: { dir: "." },
			});
		});
	});
});
