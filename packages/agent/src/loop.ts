/**
 * The agent loop — the core execution engine.
 *
 * An async generator that yields AgentEvents as it processes messages,
 * calls tools, and streams responses from the LLM provider.
 *
 * Includes:
 * - Automatic retry on transient API failures
 * - Context compaction when approaching token limits
 * - Cumulative token tracking from usage_update events
 */

import type { AgentEvent, ToolDefinition, ToolResult, Usage } from "@takumi/core";
import { createLogger, LIMITS } from "@takumi/core";
import {
	compactMessages,
	estimateTotalPayloadTokens,
	type PayloadCompactOptions,
	shouldCompact,
} from "./context/compact.js";
import type { BudgetGuard } from "./cost.js";
import { BudgetExceededError } from "./cost.js";
import { buildSystemPrompt, buildToolResult, buildUserMessage } from "./message.js";
import { type RetryOptions, withRetry } from "./retry.js";
import type { ToolRegistry } from "./tools/registry.js";

const log = createLogger("agent-loop");

export interface AgentLoopOptions {
	/** Function that sends messages to the LLM and returns a stream of events. */
	sendMessage: (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: SendMessageOptions,
	) => AsyncIterable<AgentEvent>;

	/** Tool registry for executing tool calls. */
	tools: ToolRegistry;

	/** System prompt override. */
	systemPrompt?: string;

	/** Maximum turns (each tool_use response + tool_result = 1 turn). */
	maxTurns?: number;

	/** Abort signal for cancellation. */
	signal?: AbortSignal;

	/** Retry options for API calls (set to false to disable retries). */
	retryOptions?: Partial<RetryOptions> | false;

	/** Context compaction options (set to false to disable compaction). */
	compactOptions?: Partial<PayloadCompactOptions> | false;

	/** Maximum context window size in tokens (for compaction). */
	maxContextTokens?: number;

	/** Optional spend-limit enforcer. Throws BudgetExceededError when the limit is crossed. */
	budget?: BudgetGuard;
}

export interface MessagePayload {
	role: "user" | "assistant";
	content: any;
}

/** Optional per-call overrides for LLM requests. */
export interface SendMessageOptions {
	/** Override the model used for this call (if provider supports it). */
	model?: string;
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
		retryOptions,
		compactOptions,
		maxContextTokens = 200_000,
	} = options;

	const toolDefs = tools.getDefinitions();
	const system = systemPrompt ?? buildSystemPrompt(toolDefs);
	// Push the new user message directly onto the caller's history array.
	// This ensures that after agentLoop returns, `history` contains the full
	// turn including all intermediate tool-call / tool-result pairs — not just
	// the final assistant text. Subsequent turns therefore have complete context.
	history.push({ role: "user", content: buildUserMessage(userMessage) });
	// messages is an alias for history — all .push() calls below mutate history.
	const messages: MessagePayload[] = history;

	// Cumulative token tracking from usage_update events
	let cumulativeTokens = 0;

	let turn = 0;

	while (turn < maxTurns) {
		if (signal?.aborted) {
			yield { type: "stop", reason: "user_cancel" };
			return;
		}

		turn++;
		log.info(`Starting turn ${turn}`);

		// Context compaction check before each turn
		if (compactOptions !== false) {
			const estimatedTokens = cumulativeTokens > 0 ? cumulativeTokens : estimateTotalPayloadTokens(messages);

			if (shouldCompact(messages, estimatedTokens, maxContextTokens)) {
				log.info(`Context compaction triggered: ~${estimatedTokens} tokens`);
				const compacted = compactMessages(messages, {
					maxTokens: maxContextTokens,
					...(typeof compactOptions === "object" ? compactOptions : {}),
				});
				// Replace contents in-place so the `history` alias stays in sync.
				messages.splice(0, messages.length, ...compacted);
				// Re-estimate after compaction
				cumulativeTokens = estimateTotalPayloadTokens(messages);
			}
		}

		// Accumulate the full assistant response
		let fullText = "";
		let fullThinking = "";
		const pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
		let stopReason: string | undefined;
		let _usage: Usage | undefined;

		// Stream events from the LLM (with retry wrapper)
		try {
			/**
			 * We wrap the stream consumption in a retry-aware pattern.
			 * For streaming APIs, we retry the initial connection/request.
			 * Once streaming has started, we do not retry mid-stream.
			 */
			const stream =
				retryOptions !== false
					? await withRetry(
							async () => {
								// Materialize the async iterable; the retry applies
								// to the initial call (HTTP request). Once we get
								// the iterable back, we consume it outside the retry.
								const iterable = sendMessage(messages, system, toolDefs);
								return iterable;
							},
							typeof retryOptions === "object" ? retryOptions : undefined,
						)
					: sendMessage(messages, system, toolDefs);

			for await (const event of stream) {
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
						_usage = event.usage;
						// Track cumulative tokens for compaction decisions
						cumulativeTokens = event.usage.inputTokens + event.usage.outputTokens;
						// Budget enforcement — throws BudgetExceededError if limit exceeded
						if (options.budget) {
							try {
								options.budget.record(event.usage.inputTokens, event.usage.outputTokens);
							} catch (budgetErr) {
								if (budgetErr instanceof BudgetExceededError) {
									yield { type: "error", error: budgetErr };
									yield { type: "stop", reason: "error" };
									return;
								}
								throw budgetErr;
							}
						}
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
