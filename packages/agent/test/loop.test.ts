import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, ToolDefinition, Usage } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { MemoryHooks } from "../src/context/memory-hooks.js";
import { PrincipleMemory } from "../src/context/principles.js";
import { type AgentLoopOptions, agentLoop, type MessagePayload } from "../src/loop.js";
import { ToolRegistry } from "../src/tools/registry.js";

const TEST_DIR = join(tmpdir(), "takumi-loop-principles-test");

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeDef(name: string, overrides?: Partial<ToolDefinition>): ToolDefinition {
	return {
		name,
		description: `Description for ${name}`,
		inputSchema: { type: "object", properties: {} },
		requiresPermission: false,
		category: "read",
		...overrides,
	};
}

function okHandler(output = "ok") {
	return async () => ({ output, isError: false });
}

/** Collect all events from the agent loop into an array. */
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

/**
 * Create a mock sendMessage that yields predefined events for each call.
 * Each element in `callResponses` is an array of AgentEvents for that call.
 */
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

/** Create a simple tool registry with optional tools. */
function createRegistry(
	tools?: Array<{
		name: string;
		handler?: (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>;
	}>,
): ToolRegistry {
	const reg = new ToolRegistry();
	if (tools) {
		for (const t of tools) {
			reg.register(makeDef(t.name), t.handler ?? (async () => ({ output: "ok", isError: false })));
		}
	}
	return reg;
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("agentLoop", () => {
	/* ---- Simple text response -------------------------------------------- */

	describe("simple text response", () => {
		it("yields text_delta events followed by done", async () => {
			const sendMessage = mockSendMessage([
				[
					{ type: "text_delta", text: "Hello " },
					{ type: "text_delta", text: "world!" },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			expect(events).toHaveLength(3);
			expect(events[0]).toEqual({ type: "text_delta", text: "Hello " });
			expect(events[1]).toEqual({ type: "text_delta", text: "world!" });
			expect(events[2]).toEqual({ type: "done", stopReason: "end_turn" });
		});

		it("terminates after a text-only response with no tool calls", async () => {
			const sendMessage = mockSendMessage([
				[
					{ type: "text_delta", text: "Just text." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("say something", [], {
				sendMessage,
				tools: createRegistry(),
			});

			// Should NOT loop again — no tool calls means the loop exits
			const textDeltas = events.filter((e) => e.type === "text_delta");
			expect(textDeltas).toHaveLength(1);
		});
	});

	/* ---- Tool use flow --------------------------------------------------- */

	describe("tool use flow", () => {
		it("executes a tool call and feeds result back to LLM for a second response", async () => {
			const toolHandler = vi.fn(async (input: Record<string, unknown>) => ({
				output: `contents of ${input.path}`,
				isError: false,
			}));

			const registry = createRegistry([{ name: "read_file", handler: toolHandler }]);

			const sendMessage = mockSendMessage([
				// First call: text + tool_use + done with tool_use stop reason
				[
					{ type: "text_delta", text: "Let me read that." },
					{ type: "tool_use", id: "toolu_001", name: "read_file", input: { path: "/src/main.ts" } },
					{ type: "done", stopReason: "tool_use" },
				],
				// Second call: LLM responds with text after seeing tool result
				[
					{ type: "text_delta", text: "Here is the file." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("read main.ts", [], {
				sendMessage,
				tools: registry,
			});

			// Verify tool was called
			expect(toolHandler).toHaveBeenCalledOnce();
			expect(toolHandler).toHaveBeenCalledWith({ path: "/src/main.ts" }, undefined);

			// Check event sequence
			const types = events.map((e) => e.type);
			expect(types).toEqual([
				"text_delta", // "Let me read that."
				"tool_use", // read_file call
				"done", // tool_use stop
				"tool_result", // result of read_file
				"text_delta", // "Here is the file."
				"done", // end_turn
			]);

			// Check tool_result content
			const toolResult = events.find((e) => e.type === "tool_result");
			expect(toolResult).toBeDefined();
			if (toolResult?.type === "tool_result") {
				expect(toolResult.output).toBe("contents of /src/main.ts");
				expect(toolResult.isError).toBe(false);
				expect(toolResult.id).toBe("toolu_001");
				expect(toolResult.name).toBe("read_file");
			}
		});

		it("handles unknown tool gracefully by returning an error result", async () => {
			const registry = createRegistry();

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_bad", name: "nonexistent_tool", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{ type: "text_delta", text: "That tool does not exist." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("do something", [], {
				sendMessage,
				tools: registry,
			});

			const toolResult = events.find((e) => e.type === "tool_result");
			expect(toolResult).toBeDefined();
			if (toolResult?.type === "tool_result") {
				expect(toolResult.isError).toBe(true);
				expect(toolResult.output).toContain("Unknown tool");
			}
		});
	});

	/* ---- Max turns exceeded --------------------------------------------- */

	describe("max turns", () => {
		it("yields stop with max_turns when turn limit is exceeded", async () => {
			const registry = createRegistry([{ name: "tool_a" }]);

			// Every call returns a tool_use, forcing the loop to keep going
			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_1", name: "tool_a", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{ type: "tool_use", id: "toolu_2", name: "tool_a", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{ type: "tool_use", id: "toolu_3", name: "tool_a", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
			]);

			const events = await collectEvents("go", [], {
				sendMessage,
				tools: registry,
				maxTurns: 2,
			});

			const lastEvent = events[events.length - 1];
			expect(lastEvent).toEqual({ type: "stop", reason: "max_turns" });
		});

		it("does not exceed the specified maxTurns", async () => {
			const callCount = vi.fn();
			const registry = createRegistry([{ name: "tool_a" }]);

			let callIndex = 0;
			const sendMessage: AgentLoopOptions["sendMessage"] = async function* () {
				callCount();
				callIndex++;
				yield { type: "tool_use" as const, id: `toolu_${callIndex}`, name: "tool_a", input: {} };
				yield { type: "done" as const, stopReason: "tool_use" as const };
			};

			await collectEvents("go", [], {
				sendMessage,
				tools: registry,
				maxTurns: 3,
			});

			expect(callCount).toHaveBeenCalledTimes(3);
		});
	});

	/* ---- Abort signal ---------------------------------------------------- */

	describe("abort signal", () => {
		it("yields stop with user_cancel when signal is already aborted", async () => {
			const controller = new AbortController();
			controller.abort();

			const sendMessage = mockSendMessage([[{ type: "text_delta", text: "should not appear" }]]);

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
				signal: controller.signal,
			});

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "stop", reason: "user_cancel" });
		});

		it("yields stop with user_cancel when aborted mid-stream", async () => {
			const controller = new AbortController();

			// sendMessage that aborts after the first event
			const sendMessage: AgentLoopOptions["sendMessage"] = async function* () {
				yield { type: "text_delta" as const, text: "Hello" };
				controller.abort();
				yield { type: "text_delta" as const, text: " world" };
				yield { type: "done" as const, stopReason: "end_turn" as const };
			};

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
				signal: controller.signal,
			});

			// Should get the first text_delta, then the second (which triggers abort check),
			// then stop with user_cancel
			const types = events.map((e) => e.type);
			expect(types).toContain("text_delta");
			expect(types).toContain("stop");

			const stop = events.find((e) => e.type === "stop");
			if (stop?.type === "stop") {
				expect(stop.reason).toBe("user_cancel");
			}
		});

		it("yields stop with user_cancel when aborted between tool execution turns", async () => {
			const controller = new AbortController();
			const registry = createRegistry([{ name: "tool_a" }]);

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_1", name: "tool_a", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				// Second call should not happen because we abort
				[
					{ type: "text_delta", text: "Should not reach here" },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			// Abort after first tool execution is done
			const origExecute = registry.execute.bind(registry);
			vi.spyOn(registry, "execute").mockImplementation(async (...args) => {
				const result = await origExecute(...args);
				controller.abort();
				return result;
			});

			const events = await collectEvents("go", [], {
				sendMessage,
				tools: registry,
				signal: controller.signal,
			});

			const types = events.map((e) => e.type);
			expect(types).toContain("stop");

			const stop = events.find((e) => e.type === "stop");
			if (stop?.type === "stop") {
				expect(stop.reason).toBe("user_cancel");
			}
		});
	});

	/* ---- Error event from provider -------------------------------------- */

	describe("error event from provider", () => {
		it("yields stop with error when provider emits an error event", async () => {
			const sendMessage = mockSendMessage([
				[
					{ type: "text_delta", text: "Starting..." },
					{ type: "error", error: new Error("API overloaded") },
				],
			]);

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			const types = events.map((e) => e.type);
			expect(types).toContain("text_delta");
			expect(types).toContain("error");
			expect(types).toContain("stop");

			const stop = events.find((e) => e.type === "stop");
			if (stop?.type === "stop") {
				expect(stop.reason).toBe("error");
			}
		});

		it("stops the loop immediately after an error event", async () => {
			const sendMessage = mockSendMessage([
				[
					{ type: "error", error: new Error("fail") },
					// These events should still be yielded by the stream,
					// but the error handler returns, so they are not processed
				],
			]);

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			// The error + stop should be the only events
			const types = events.map((e) => e.type);
			expect(types).toEqual(["error", "stop"]);
		});
	});

	/* ---- Stream error (sendMessage throws) ------------------------------ */

	describe("stream error (sendMessage throws)", () => {
		it("yields error + stop when sendMessage throws synchronously", async () => {
			// biome-ignore lint/correctness/useYield: Test helper intentionally has no yield
			const sendMessage: AgentLoopOptions["sendMessage"] = async function* () {
				throw new Error("Connection refused");
			};

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			const types = events.map((e) => e.type);
			expect(types).toEqual(["error", "stop"]);

			const errorEvent = events.find((e) => e.type === "error");
			if (errorEvent?.type === "error") {
				expect(errorEvent.error.message).toBe("Connection refused");
			}

			const stop = events.find((e) => e.type === "stop");
			if (stop?.type === "stop") {
				expect(stop.reason).toBe("error");
			}
		});

		it("yields error + stop when stream throws mid-iteration", async () => {
			const sendMessage: AgentLoopOptions["sendMessage"] = async function* () {
				yield { type: "text_delta" as const, text: "partial" };
				throw new Error("Stream interrupted");
			};

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			const types = events.map((e) => e.type);
			expect(types).toEqual(["text_delta", "error", "stop"]);
		});
	});

	/* ---- Usage events passed through ------------------------------------ */

	describe("usage events", () => {
		it("passes through usage_update events", async () => {
			const usage: Usage = {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 25,
				cacheWriteTokens: 10,
			};

			const sendMessage = mockSendMessage([
				[
					{ type: "usage_update", usage },
					{ type: "text_delta", text: "Hi." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			const usageEvents = events.filter((e) => e.type === "usage_update");
			expect(usageEvents).toHaveLength(1);
			if (usageEvents[0]?.type === "usage_update") {
				expect(usageEvents[0].usage).toEqual(usage);
			}
		});

		it("passes through multiple usage_update events across turns", async () => {
			const registry = createRegistry([{ name: "tool_a" }]);

			const sendMessage = mockSendMessage([
				[
					{
						type: "usage_update",
						usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
					},
					{ type: "tool_use", id: "toolu_1", name: "tool_a", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{
						type: "usage_update",
						usage: { inputTokens: 20, outputTokens: 15, cacheReadTokens: 0, cacheWriteTokens: 0 },
					},
					{ type: "text_delta", text: "Done." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("go", [], {
				sendMessage,
				tools: registry,
			});

			const usageEvents = events.filter((e) => e.type === "usage_update");
			expect(usageEvents).toHaveLength(2);
		});
	});

	/* ---- Multiple tool calls in parallel -------------------------------- */

	describe("parallel tool calls", () => {
		it("executes multiple tool calls from the same response", async () => {
			const handlerA = vi.fn(async () => ({ output: "result_a", isError: false }));
			const handlerB = vi.fn(async () => ({ output: "result_b", isError: false }));

			const registry = new ToolRegistry();
			registry.register(makeDef("tool_a"), handlerA);
			registry.register(makeDef("tool_b"), handlerB);

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_a", name: "tool_a", input: { key: "a" } },
					{ type: "tool_use", id: "toolu_b", name: "tool_b", input: { key: "b" } },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{ type: "text_delta", text: "Both done." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("do both", [], {
				sendMessage,
				tools: registry,
			});

			// Both handlers should have been called
			expect(handlerA).toHaveBeenCalledOnce();
			expect(handlerB).toHaveBeenCalledOnce();

			// Both tool_result events should be present
			const results = events.filter((e) => e.type === "tool_result");
			expect(results).toHaveLength(2);

			const resultOutputs = results.map((e) => {
				if (e.type === "tool_result") return e.output;
				return "";
			});
			expect(resultOutputs).toContain("result_a");
			expect(resultOutputs).toContain("result_b");
		});

		it("executes parallel tool calls concurrently (not sequentially)", async () => {
			const order: string[] = [];

			const slowHandler = async () => {
				order.push("slow_start");
				await new Promise((r) => setTimeout(r, 50));
				order.push("slow_end");
				return { output: "slow", isError: false };
			};

			const fastHandler = async () => {
				order.push("fast_start");
				await new Promise((r) => setTimeout(r, 10));
				order.push("fast_end");
				return { output: "fast", isError: false };
			};

			const registry = new ToolRegistry();
			registry.register(makeDef("slow_tool"), slowHandler);
			registry.register(makeDef("fast_tool"), fastHandler);

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_s", name: "slow_tool", input: {} },
					{ type: "tool_use", id: "toolu_f", name: "fast_tool", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{ type: "text_delta", text: "Both done." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			await collectEvents("go", [], {
				sendMessage,
				tools: registry,
			});

			// Both should start before either finishes (concurrent execution)
			expect(order[0]).toBe("slow_start");
			expect(order[1]).toBe("fast_start");
		});
	});

	/* ---- Tool execution error ------------------------------------------- */

	describe("tool execution error", () => {
		it("handles tool handler throwing an error gracefully", async () => {
			const registry = createRegistry([
				{
					name: "failing_tool",
					handler: async () => {
						throw new Error("disk full");
					},
				},
			]);

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_fail", name: "failing_tool", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[
					{ type: "text_delta", text: "Tool failed." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("go", [], {
				sendMessage,
				tools: registry,
			});

			// The tool_result should show the error
			const toolResult = events.find((e) => e.type === "tool_result");
			expect(toolResult).toBeDefined();
			if (toolResult?.type === "tool_result") {
				expect(toolResult.isError).toBe(true);
				expect(toolResult.output).toContain("disk full");
			}

			// The loop should continue and yield the second text response
			const textDeltas = events.filter((e) => e.type === "text_delta");
			expect(textDeltas).toHaveLength(1);
		});

		it("includes the error message in the tool_result output", async () => {
			const registry = createRegistry([
				{
					name: "bad_tool",
					handler: async () => {
						throw new Error("permission denied");
					},
				},
			]);

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_bad", name: "bad_tool", input: {} },
					{ type: "done", stopReason: "tool_use" },
				],
				[{ type: "done", stopReason: "end_turn" }],
			]);

			const events = await collectEvents("go", [], {
				sendMessage,
				tools: registry,
			});

			const toolResult = events.find((e) => e.type === "tool_result");
			if (toolResult?.type === "tool_result") {
				expect(toolResult.output).toContain("permission denied");
				expect(toolResult.output).toContain("Tool execution error");
			}
		});
	});

	/* ---- Thinking events ------------------------------------------------ */

	describe("thinking events", () => {
		it("passes through thinking_delta events", async () => {
			const sendMessage = mockSendMessage([
				[
					{ type: "thinking_delta", text: "Let me think..." },
					{ type: "text_delta", text: "Here is my answer." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("think about it", [], {
				sendMessage,
				tools: createRegistry(),
			});

			const thinking = events.filter((e) => e.type === "thinking_delta");
			expect(thinking).toHaveLength(1);
			if (thinking[0]?.type === "thinking_delta") {
				expect(thinking[0].text).toBe("Let me think...");
			}
		});
	});

	/* ---- History is passed through -------------------------------------- */

	describe("history", () => {
		it("includes history messages in the messages sent to the LLM", async () => {
			const capturedMessages: MessagePayload[][] = [];

			const sendMessage: AgentLoopOptions["sendMessage"] = async function* (messages) {
				capturedMessages.push([...messages]);
				yield { type: "text_delta" as const, text: "ok" };
				yield { type: "done" as const, stopReason: "end_turn" as const };
			};

			const history: MessagePayload[] = [
				{ role: "user", content: [{ type: "text", text: "previous question" }] },
				{ role: "assistant", content: [{ type: "text", text: "previous answer" }] },
			];

			await collectEvents("new question", history, {
				sendMessage,
				tools: createRegistry(),
			});

			expect(capturedMessages).toHaveLength(1);
			// History + new user message
			expect(capturedMessages[0]).toHaveLength(3);
			expect(capturedMessages[0][0]).toEqual(history[0]);
			expect(capturedMessages[0][1]).toEqual(history[1]);
			expect(capturedMessages[0][2].role).toBe("user");
		});
	});

	/* ---- System prompt -------------------------------------------------- */

	describe("system prompt", () => {
		it("passes custom systemPrompt to sendMessage", async () => {
			let capturedSystem = "";

			const sendMessage: AgentLoopOptions["sendMessage"] = async function* (_messages, system) {
				capturedSystem = system;
				yield { type: "text_delta" as const, text: "ok" };
				yield { type: "done" as const, stopReason: "end_turn" as const };
			};

			await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
				systemPrompt: "You are a custom assistant.",
			});

			expect(capturedSystem).toBe("You are a custom assistant.");
		});

		it("builds a default system prompt when none is provided", async () => {
			let capturedSystem = "";

			const sendMessage: AgentLoopOptions["sendMessage"] = async function* (_messages, system) {
				capturedSystem = system;
				yield { type: "text_delta" as const, text: "ok" };
				yield { type: "done" as const, stopReason: "end_turn" as const };
			};

			await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			// Default prompt includes "Takumi"
			expect(capturedSystem).toContain("Takumi");
		});

		it("injects recalled lessons and principles into the system prompt", async () => {
			mkdirSync(TEST_DIR, { recursive: true });
			const hooks = new MemoryHooks({ cwd: TEST_DIR, projectId: "loop-test" });
			hooks.load();
			hooks.extract({ type: "config_discovery", details: "use vitest for verification" });

			const principles = new PrincipleMemory(TEST_DIR);
			principles.load();
			principles.observeTurn({
				request: "run tests after editing",
				toolNames: ["read_file", "edit_file", "bash"],
				toolCategories: ["read", "write", "execute"],
				hadError: false,
				finalResponse: "Tests passed.",
			});

			let capturedSystem = "";
			const sendMessage: AgentLoopOptions["sendMessage"] = async function* (_messages, system) {
				capturedSystem = system;
				yield { type: "done" as const, stopReason: "end_turn" as const };
			};

			await collectEvents("verify the edit", [], {
				sendMessage,
				tools: createRegistry(),
				memoryHooks: hooks,
				principleMemory: principles,
			});

			expect(capturedSystem).toContain("## Lessons from previous sessions");
			expect(capturedSystem).toContain("## Self-Evolving Principles");
			rmSync(TEST_DIR, { recursive: true, force: true });
		});
	});

	describe("dynamic tool selection", () => {
		it("passes query-relevant tools to the provider", async () => {
			const registry = new ToolRegistry();
			for (const tool of [
				makeDef("ask", { category: "read" }),
				makeDef("read_file", { category: "read", description: "Read file content" }),
				makeDef("grep", { category: "read", description: "Search the repo" }),
				makeDef("edit_file", { category: "write", description: "Edit files" }),
				makeDef("write_file", { category: "write", description: "Write files" }),
				makeDef("bash", { category: "execute", description: "Run tests" }),
				makeDef("lint", { category: "execute", description: "Lint the repo" }),
				makeDef("docs", { category: "read", description: "Read docs" }),
				makeDef("mcp", { category: "read", description: "External tool" }),
			]) {
				registry.register(tool, okHandler());
			}

			let capturedTools: ToolDefinition[] = [];
			const sendMessage: AgentLoopOptions["sendMessage"] = async function* (_messages, _system, tools) {
				capturedTools = tools ?? [];
				yield { type: "done" as const, stopReason: "end_turn" as const };
			};

			await collectEvents("search the code, edit the file, then run tests", [], {
				sendMessage,
				tools: registry,
			});

			const names = capturedTools.map((tool) => tool.name);
			expect(names).toContain("ask");
			expect(names).toContain("grep");
			expect(names).toContain("edit_file");
			expect(names).toContain("bash");
		});
	});

	/* ---- Stop reason not tool_use ends loop ----------------------------- */

	describe("stop reason handling", () => {
		it("stops the loop when stopReason is end_turn even with pending tool calls evaluated", async () => {
			// If done event says "end_turn" but there were tool calls,
			// the loop runs tools but then checks stopReason !== "tool_use" and exits
			const handler = vi.fn(async () => ({ output: "done", isError: false }));
			const registry = createRegistry([{ name: "tool_a", handler }]);

			const sendMessage = mockSendMessage([
				[
					{ type: "tool_use", id: "toolu_1", name: "tool_a", input: {} },
					{ type: "done", stopReason: "end_turn" },
				],
				// This second response should NOT be called since stopReason was "end_turn"
				[
					{ type: "text_delta", text: "Should not reach." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("go", [], {
				sendMessage,
				tools: registry,
			});

			// Tool is executed, but loop terminates after processing tool results
			expect(handler).toHaveBeenCalledOnce();

			// No text_delta from the second response
			const textDeltas = events.filter((e) => e.type === "text_delta");
			expect(textDeltas).toHaveLength(0);
		});
	});

	/* ---- Empty messages ------------------------------------------------- */

	describe("edge cases", () => {
		it("handles empty text from LLM (no text_delta, just done)", async () => {
			const sendMessage = mockSendMessage([[{ type: "done", stopReason: "end_turn" }]]);

			const events = await collectEvents("hi", [], {
				sendMessage,
				tools: createRegistry(),
			});

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({ type: "done", stopReason: "end_turn" });
		});

		it("handles empty user message", async () => {
			const sendMessage = mockSendMessage([
				[
					{ type: "text_delta", text: "You said nothing." },
					{ type: "done", stopReason: "end_turn" },
				],
			]);

			const events = await collectEvents("", [], {
				sendMessage,
				tools: createRegistry(),
			});

			expect(events).toHaveLength(2);
		});
	});
});
