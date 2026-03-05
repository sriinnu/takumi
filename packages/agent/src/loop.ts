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
import type { MemoryHooks } from "./context/memory-hooks.js";
import type { PromptCache } from "./context/prompt-cache.js";
import type { BudgetGuard } from "./cost.js";
import { BudgetExceededError } from "./cost.js";
import type { ExtensionRunner } from "./extensions/extension-runner.js";
import { buildSystemPrompt, buildToolResult, buildUserMessage } from "./message.js";
import type { ObservationCollector } from "./observation-collector.js";
import { type RetryOptions, withRetry } from "./retry.js";
import type { SteeringQueue } from "./steering-queue.js";
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

	/** Optional prompt cache — deduplicates identical LLM requests (Phase 34). */
	promptCache?: PromptCache;

	/** Optional memory hooks — extracts lessons from tool patterns (Phase 33). */
	memoryHooks?: MemoryHooks;

	/** Model name (needed for prompt cache keying). */
	model?: string;

	/** Optional extension runner — emits lifecycle events to loaded extensions (Phase 45). */
	extensionRunner?: ExtensionRunner;

	/** Optional steering queue — priority directives injected between turns (Phase 48). */
	steeringQueue?: SteeringQueue;

	/** Optional observation collector — records tool usage for Chitragupta (Phase 49). */
	observationCollector?: ObservationCollector;
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

	// Merge extension-registered tools into the registry
	const ext = options.extensionRunner;
	if (ext) {
		for (const [name, { tool }] of ext.getAllTools()) {
			if (!tools.has(name)) {
				tools.register(
					{
						name: tool.name,
						description: tool.description,
						inputSchema: tool.inputSchema,
						requiresPermission: tool.requiresPermission,
						category: tool.category,
					},
					async (args, signal) => {
						const ctx = ext.createContext();
						return tool.execute(args, signal, ctx);
					},
				);
			}
		}
	}

	const toolDefs = tools.getDefinitions();
	const system = systemPrompt ?? buildSystemPrompt(toolDefs);

	// Phase 33 — inject recalled lessons into system prompt
	let enrichedSystem = system;
	if (options.memoryHooks) {
		const lessons = options.memoryHooks.recall("", 5);
		const lessonBlock = options.memoryHooks.formatForPrompt(lessons);
		if (lessonBlock) {
			enrichedSystem = `${system}\n\n${lessonBlock}`;
		}
	}
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

		// Phase 45 — emit turn_start
		if (ext) {
			void ext.emit({ type: "turn_start", turnIndex: turn, timestamp: Date.now() });
		}

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

		// Phase 45 — emit context transform (extensions can modify messages)
		// We skip this for the raw MessagePayload[] — extensions get Message[] in the
		// higher-level AgentRunner emit. Here we emit message_update events during streaming.

		// Phase 34 — Check prompt cache before LLM call (only for non-tool-result turns)
		const cacheKey =
			options.promptCache && turn === 1
				? options.promptCache.computeKey(
						options.model ?? "unknown",
						enrichedSystem,
						messages.map((m) => JSON.stringify(m.content)),
					)
				: null;

		if (cacheKey && options.promptCache) {
			const cached = options.promptCache.get(cacheKey);
			if (cached) {
				log.info("Prompt cache hit — skipping LLM call");
				fullText = cached;
				yield { type: "text_delta", text: cached };
				const assistantContent: any[] = [{ type: "text", text: cached }];
				messages.push({ role: "assistant", content: assistantContent });
				return;
			}
		}

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

				// Phase 45 — emit message_update for streaming events
				if (ext) {
					void ext.emit({ type: "message_update", event });
				}

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

		// Phase 34 — Store response in prompt cache
		if (cacheKey && options.promptCache && fullText && pendingToolCalls.length === 0) {
			const estTokens = Math.ceil(fullText.length / 4);
			options.promptCache.set(cacheKey, fullText, options.model ?? "unknown", estTokens);
		}

		// If no tool calls, we're done
		if (pendingToolCalls.length === 0) {
			return;
		}

		// Execute tool calls (may be parallel)
		const toolResults: Array<{ id: string; name: string; result: ToolResult }> = [];

		const executions = pendingToolCalls.map(async (tc) => {
			// Phase 45 — emit tool_call (blocking: can skip execution)
			if (ext) {
				const blocked = await ext.emitToolCall({
					type: "tool_call",
					toolCallId: tc.id,
					toolName: tc.name,
					args: tc.input,
				});
				if (blocked?.block) {
					const fallback: ToolResult = { output: blocked.reason ?? "Blocked by extension", isError: false };
					return { id: tc.id, name: tc.name, result: fallback };
				}
			}

			const t0 = Date.now();
			let result = await tools.execute(tc.name, tc.input, signal);
			const elapsed = Date.now() - t0;

			// Phase 45 — emit tool_result (can modify result)
			if (ext) {
				const modified = await ext.emitToolResult({
					type: "tool_result",
					toolCallId: tc.id,
					toolName: tc.name,
					result,
					isError: result.isError,
				});
				if (modified?.output !== undefined) {
					result = { output: modified.output, isError: modified.isError ?? result.isError };
				}
			}

			// Phase 49 — record tool usage observation
			options.observationCollector?.recordToolUsage(tc.name, tc.input ?? {}, elapsed, !result.isError);

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

			// Phase 33 — Extract lessons from tool error→success patterns
			if (options.memoryHooks && result.isError) {
				options.memoryHooks.extract({
					type: "tool_error_then_success",
					details: `tool "${name}" failed: ${typeof result.output === "string" ? result.output.slice(0, 120) : "error"}`,
				});
			}
		}

		// Add tool results to message history
		const toolResultContent = toolResults.map((tr) => buildToolResult(tr.id, tr.result));
		messages.push({ role: "user", content: toolResultContent });

		// Phase 45 — emit turn_end with usage
		if (ext && _usage) {
			void ext.emit({ type: "turn_end", turnIndex: turn, usage: _usage });
		}

		// Phase 48 — Drain steering queue between turns.
		// INTERRUPT items abort the current continuation; HIGH/NORMAL are injected as user messages.
		if (options.steeringQueue && !options.steeringQueue.isEmpty) {
			if (options.steeringQueue.hasInterrupt()) {
				const interrupts = options.steeringQueue.drain();
				const combined = interrupts.map((i) => i.text).join("\n\n");
				log.info(`Steering: ${interrupts.length} interrupt(s), aborting continuation`);
				messages.push({ role: "user", content: buildUserMessage(combined) });
				// Don't return — let the loop continue with the interrupt message
				continue;
			}
			const items = options.steeringQueue.drain();
			if (items.length > 0) {
				const combined = items.map((i) => `[Steering directive] ${i.text}`).join("\n\n");
				log.info(`Steering: injecting ${items.length} directive(s) between turns`);
				messages.push({ role: "user", content: buildUserMessage(combined) });
				continue;
			}
		}

		// If the stop reason was not tool_use, we're done
		if (stopReason !== "tool_use") {
			return;
		}
	}

	yield { type: "stop", reason: "max_turns" };
}
