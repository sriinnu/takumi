/**
 * The agent loop — the core execution engine.
 *
 * An async generator that yields AgentEvents as it processes messages,
 * calls tools, and streams responses from the LLM provider.
 */

import type {
	AgentEvent,
	Message,
	ToolDefinition,
	ToolResult,
	Usage,
} from "@takumi/core";
import { LIMITS, createLogger } from "@takumi/core";
import type { ToolRegistry } from "./tools/registry.js";
import { buildSystemPrompt, buildUserMessage, buildToolResult } from "./message.js";

const log = createLogger("agent-loop");

export interface AgentLoopOptions {
	/** Function that sends messages to the LLM and returns a stream of events. */
	sendMessage: (messages: MessagePayload[], system: string) => AsyncIterable<AgentEvent>;

	/** Tool registry for executing tool calls. */
	tools: ToolRegistry;

	/** System prompt override. */
	systemPrompt?: string;

	/** Maximum turns (each tool_use response + tool_result = 1 turn). */
	maxTurns?: number;

	/** Abort signal for cancellation. */
	signal?: AbortSignal;
}

export interface MessagePayload {
	role: "user" | "assistant";
	content: any;
}

/**
 * Run the agent loop as an async generator.
 *
 * Yields AgentEvents as they occur (text deltas, tool calls, etc).
 * Automatically executes tool calls and feeds results back to the LLM.
 */
export async function* agentLoop(
	userMessage: string,
	history: MessagePayload[],
	options: AgentLoopOptions,
): AsyncGenerator<AgentEvent> {
	const {
		sendMessage,
		tools,
		systemPrompt,
		maxTurns = LIMITS.MAX_TURNS,
		signal,
	} = options;

	const system = systemPrompt ?? buildSystemPrompt(tools.getDefinitions());
	const messages: MessagePayload[] = [
		...history,
		{ role: "user", content: buildUserMessage(userMessage) },
	];

	let turn = 0;

	while (turn < maxTurns) {
		if (signal?.aborted) {
			yield { type: "stop", reason: "user_cancel" };
			return;
		}

		turn++;
		log.info(`Starting turn ${turn}`);

		// Accumulate the full assistant response
		let fullText = "";
		let fullThinking = "";
		const pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
		let stopReason: string | undefined;
		let usage: Usage | undefined;

		// Stream events from the LLM
		try {
			for await (const event of sendMessage(messages, system)) {
				yield event;

				switch (event.type) {
					case "text_delta":
						fullText += event.text;
						break;
					case "thinking_delta":
						fullThinking += event.text;
						break;
					case "tool_use":
						pendingToolCalls.push({
							id: event.id,
							name: event.name,
							input: event.input,
						});
						break;
					case "done":
						stopReason = event.stopReason;
						break;
					case "usage_update":
						usage = event.usage;
						break;
					case "error":
						yield { type: "stop", reason: "error" };
						return;
				}

				if (signal?.aborted) {
					yield { type: "stop", reason: "user_cancel" };
					return;
				}
			}
		} catch (err) {
			log.error("Stream error", err);
			yield { type: "error", error: err as Error };
			yield { type: "stop", reason: "error" };
			return;
		}

		// Build assistant message for history
		const assistantContent: any[] = [];
		if (fullThinking) {
			assistantContent.push({ type: "thinking", thinking: fullThinking });
		}
		if (fullText) {
			assistantContent.push({ type: "text", text: fullText });
		}
		for (const tc of pendingToolCalls) {
			assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
		}
		messages.push({ role: "assistant", content: assistantContent });

		// If no tool calls, we're done
		if (pendingToolCalls.length === 0) {
			return;
		}

		// Execute tool calls (may be parallel)
		const toolResults: Array<{ id: string; name: string; result: ToolResult }> = [];

		const executions = pendingToolCalls.map(async (tc) => {
			const result = await tools.execute(tc.name, tc.input, signal);
			return { id: tc.id, name: tc.name, result };
		});

		const results = await Promise.all(executions);

		for (const { id, name, result } of results) {
			toolResults.push({ id, name, result });
			yield {
				type: "tool_result",
				id,
				name,
				output: result.output,
				isError: result.isError,
			};
		}

		// Add tool results to message history
		const toolResultContent = toolResults.map((tr) => buildToolResult(tr.id, tr.result));
		messages.push({ role: "user", content: toolResultContent });

		// If the stop reason was not tool_use, we're done
		if (stopReason !== "tool_use") {
			return;
		}
	}

	yield { type: "stop", reason: "max_turns" };
}
