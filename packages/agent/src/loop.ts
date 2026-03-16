/** The agent loop — core execution engine with retry, compaction, and token tracking. */

import type { AgentEvent, PermissionDecision, ToolDefinition, ToolResult, Usage } from "@takumi/core";
import { createLogger, LIMITS } from "@takumi/core";
import {
	compactMessagesDetailed,
	estimateTotalPayloadTokens,
	type PayloadCompactOptions,
	shouldCompact,
} from "./context/compact.js";
import type { ExperienceMemory } from "./context/experience-memory.js";
import type { CodebaseIndex } from "./context/indexer.js";
import type { MemoryHooks } from "./context/memory-hooks.js";
import type { PrincipleMemory } from "./context/principles.js";
import type { PromptCache } from "./context/prompt-cache.js";
import { formatRagContext, queryIndex } from "./context/rag.js";
import type { BudgetGuard } from "./cost.js";
import { BudgetExceededError } from "./cost.js";
import type { ExtensionRunner } from "./extensions/extension-runner.js";
import {
	buildEnrichedSystemPrompt,
	coreToPayload,
	mergeExtensionTools,
	payloadToCore,
	selectTurnTools,
} from "./loop-support.js";
import { buildToolResult, buildUserMessage } from "./message.js";
import type { ObservationCollector } from "./observation-collector.js";
import { type RetryOptions, withRetry } from "./retry.js";
import type { SteeringQueue } from "./steering-queue.js";
import type { ToolRegistry } from "./tools/registry.js";

const log = createLogger("agent-loop");

export interface AgentLoopOptions {
	sendMessage: (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: SendMessageOptions,
	) => AsyncIterable<AgentEvent>;
	tools: ToolRegistry;
	systemPrompt?: string;
	maxTurns?: number;
	signal?: AbortSignal;
	retryOptions?: Partial<RetryOptions> | false;
	compactOptions?: Partial<PayloadCompactOptions> | false;
	maxContextTokens?: number;
	budget?: BudgetGuard;
	promptCache?: PromptCache;
	memoryHooks?: MemoryHooks;
	model?: string;
	extensionRunner?: ExtensionRunner;
	steeringQueue?: SteeringQueue;
	observationCollector?: ObservationCollector;
	experienceMemory?: ExperienceMemory;
	principleMemory?: PrincipleMemory;
	codebaseIndex?: CodebaseIndex;
	checkToolPermission?: (
		tool: string,
		args: Record<string, unknown>,
		definition: ToolDefinition,
	) => Promise<PermissionDecision>;
}

export interface MessagePayload {
	role: "user" | "assistant";
	/** Flexible content — accommodates varying LLM provider response formats. Validated via blockToCore(). */
	content: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Optional per-call overrides for LLM requests. */
export interface SendMessageOptions {
	model?: string;
}

export interface UserTurnInput {
	text: string;
	images?: Array<{ mediaType: string; data: string }>;
}

/** Run the agent loop as an async generator. */
export async function* agentLoop(
	userMessage: string | UserTurnInput,
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

	const ext = options.extensionRunner;
	mergeExtensionTools(tools, ext);
	const userTurn = typeof userMessage === "string" ? { text: userMessage } : userMessage;
	const userText = userTurn.text;

	const toolDefs = tools.getDefinitions();
	const ragContext = options.codebaseIndex ? formatRagContext(queryIndex(options.codebaseIndex, userText)) : undefined;
	const enrichedSystem = buildEnrichedSystemPrompt({
		toolDefs,
		userMessage: userText,
		basePrompt: systemPrompt,
		memoryHooks: options.memoryHooks,
		principleMemory: options.principleMemory,
		ragContext,
	});
	// Push onto caller history so subsequent turns retain the full tool/result context.
	history.push({ role: "user", content: buildUserMessage(userText, userTurn.images) });
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

		const selectedToolDefs = selectTurnTools(tools, userText, messages, options.experienceMemory);

		// Context compaction check before each turn
		if (compactOptions !== false) {
			const estimatedTokens = cumulativeTokens > 0 ? cumulativeTokens : estimateTotalPayloadTokens(messages);

			if (shouldCompact(messages, estimatedTokens, maxContextTokens)) {
				log.info(`Context compaction triggered: ~${estimatedTokens} tokens`);
				const compacted = compactMessagesDetailed(messages, {
					maxTokens: maxContextTokens,
					...(typeof compactOptions === "object" ? compactOptions : {}),
				});
				options.experienceMemory?.archiveCompaction(
					compacted.summary,
					compacted.compactedMessages,
					compacted.preservedMessages,
				);
				// Inject file awareness from ExperienceMemory into the compacted summary
				const fileAwareness = options.experienceMemory?.buildFileAwarenessSummary();
				if (fileAwareness && compacted.messages.length > 0) {
					const first = compacted.messages[0];
					if (Array.isArray(first.content) && first.content[0]?.type === "text") {
						first.content[0].text = `${first.content[0].text}\n\n${fileAwareness}`;
					}
				}
				messages.splice(0, messages.length, ...compacted.messages);
				cumulativeTokens = estimateTotalPayloadTokens(messages);
			}
		}

		// Accumulate the full assistant response
		let fullText = "";
		let fullThinking = "";
		const pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
		let stopReason: string | undefined;
		let _usage: Usage | undefined;

		// Phase 45 — allow extensions to transform messages before LLM call
		if (ext?.hasHandlers("context")) {
			try {
				const coreMessages = payloadToCore(messages);
				const transformed = await ext.emitContext(coreMessages);
				if (transformed !== coreMessages) {
					messages.splice(0, messages.length, ...transformed.map(coreToPayload));
				}
			} catch (extErr) {
				log.error("Extension context handler failed, continuing without transformation", extErr);
				const raw = extErr instanceof Error ? extErr.message : String(extErr);
				const msg = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
				yield { type: "error" as const, error: new Error(`Extension context error: ${msg}`) };
			}
		}

		// Phase 34 — prompt cache (first turn only)
		const cacheKey =
			options.promptCache && turn === 1
				? options.promptCache.computeKey(options.model ?? "unknown", enrichedSystem, [
						...messages.map((m) => JSON.stringify(m.content)),
						`tools:${selectedToolDefs.map((tool) => tool.name).join(",")}`,
					])
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
								const iterable = sendMessage(messages, enrichedSystem, selectedToolDefs, signal, {
									model: options.model,
								});
								return iterable;
							},
							typeof retryOptions === "object" ? retryOptions : undefined,
						)
					: sendMessage(messages, enrichedSystem, selectedToolDefs, signal, { model: options.model });

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
			const definition = tools.getDefinition(tc.name);
			if (definition?.requiresPermission) {
				const decision = options.checkToolPermission
					? await options.checkToolPermission(tc.name, tc.input, definition)
					: { allowed: false, reason: `Permission required for tool: ${tc.name}` };
				if (!decision.allowed) {
					const fallback: ToolResult = {
						output: decision.reason ?? `Permission denied for tool: ${tc.name}`,
						isError: true,
					};
					return { id: tc.id, name: tc.name, result: fallback };
				}
			}

			// Phase 45 — emit tool_call (blocking: can skip execution)
			if (ext) {
				const blocked = await ext.emitToolCall({
					type: "tool_call",
					toolCallId: tc.id,
					toolName: tc.name,
					args: tc.input,
				});
				if (blocked?.block) {
					const fallback: ToolResult = { output: blocked.reason ?? "Blocked by extension", isError: true };
					return { id: tc.id, name: tc.name, result: fallback };
				}
			}

			const t0 = Date.now();
			let result = await tools.execute(tc.name, tc.input, signal, { permissionChecked: true });
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
			options.experienceMemory?.recordToolUse(tc.name, tc.input ?? {}, result);

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

		if (options.memoryHooks && toolResults.every((entry) => !entry.result.isError)) {
			options.memoryHooks.observeSuccess(
				userText,
				toolResults.map((entry) => entry.name),
			);
		}
		if (options.principleMemory) {
			const toolCategories = toolResults
				.map((entry) => tools.getDefinition(entry.name)?.category)
				.filter((value): value is NonNullable<ToolDefinition["category"]> => value !== undefined);
			options.principleMemory.observeTurn({
				request: userText,
				toolNames: toolResults.map((entry) => entry.name),
				toolCategories,
				hadError: toolResults.some((entry) => entry.result.isError),
				finalResponse: fullText,
			});
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
