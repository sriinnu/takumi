/**
 * OpenAIProvider -- sends messages to any OpenAI-compatible chat completions API.
 *
 * Converts Anthropic-format messages to OpenAI format and streams back AgentEvents.
 * Works with OpenAI, Groq, DeepSeek, Mistral, Together, OpenRouter, Ollama,
 * vLLM, LM Studio, and any other OpenAI-compatible endpoint.
 */

import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { ProviderUnavailableError } from "../errors.js";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { RetryableError } from "../retry.js";

const log = createLogger("openai-provider");

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** Default timeout for streaming requests (ms). */
const STREAMING_TIMEOUT = 120_000;

// ── OpenAI-format types (internal) ─────────────────────────────────────────

interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | null;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
}

interface OpenAIToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

interface OpenAITool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

// ── Config ─────────────────────────────────────────────────────────────────

export interface OpenAIProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	thinking: boolean;
	thinkingBudget: number;
	endpoint?: string;
}

// ── Conversion: Anthropic messages -> OpenAI messages ──────────────────────

/**
 * Convert an array of Anthropic-format MessagePayload objects to OpenAI messages.
 */
export function convertMessages(messages: MessagePayload[]): OpenAIMessage[] {
	const result: OpenAIMessage[] = [];

	for (const msg of messages) {
		// String content (simple case)
		if (typeof msg.content === "string") {
			result.push({ role: msg.role, content: msg.content });
			continue;
		}

		// Array content -- may contain text, tool_use, tool_result blocks
		if (!Array.isArray(msg.content)) {
			result.push({ role: msg.role, content: String(msg.content ?? "") });
			continue;
		}

		const blocks = msg.content as any[];

		// Check what types of blocks we have
		const hasToolUse = blocks.some((b) => b.type === "tool_use");
		const hasToolResult = blocks.some((b) => b.type === "tool_result");

		if (hasToolResult) {
			// Each tool_result becomes a separate "tool" role message
			for (const block of blocks) {
				if (block.type === "tool_result") {
					const content =
						typeof block.content === "string"
							? block.content
							: Array.isArray(block.content)
								? block.content.map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n")
								: JSON.stringify(block.content ?? "");
					result.push({
						role: "tool",
						tool_call_id: block.tool_use_id,
						content,
					});
				} else if (block.type === "text") {
					// Text blocks alongside tool_results -- emit as user message
					result.push({ role: "user", content: block.text });
				}
			}
		} else if (hasToolUse) {
			// Assistant message with tool calls (may also contain text)
			const textParts: string[] = [];
			const toolCalls: OpenAIToolCall[] = [];

			for (const block of blocks) {
				if (block.type === "text") {
					textParts.push(block.text);
				} else if (block.type === "tool_use") {
					toolCalls.push({
						id: block.id,
						type: "function",
						function: {
							name: block.name,
							arguments: JSON.stringify(block.input ?? {}),
						},
					});
				}
			}

			const openaiMsg: OpenAIMessage = {
				role: "assistant",
				content: textParts.length > 0 ? textParts.join("\n") : null,
				tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
			};
			result.push(openaiMsg);
		} else {
			// Plain text blocks -- combine into a single message
			const texts: string[] = [];
			for (const block of blocks) {
				if (block.type === "text") {
					texts.push(block.text);
				} else if (block.type === "thinking") {
					// Thinking blocks are Anthropic-specific; skip for OpenAI
				} else {
					texts.push(JSON.stringify(block));
				}
			}
			result.push({
				role: msg.role,
				content: texts.join("\n"),
			});
		}
	}

	return result;
}

/**
 * Convert Anthropic tool definitions to OpenAI function-calling format.
 */
export function convertTools(tools: any[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description ?? "",
			parameters: tool.input_schema ?? tool.inputSchema ?? {},
		},
	}));
}

// ── SSE stream parsing ─────────────────────────────────────────────────────

/** Tracks an in-progress tool call during streaming. */
interface PendingToolCall {
	id: string;
	name: string;
	arguments: string;
}

/**
 * Parse an OpenAI SSE stream into AgentEvent objects.
 */
export async function* parseOpenAIStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();

	let buffer = "";
	const pendingToolCalls = new Map<number, PendingToolCall>();
	let lastFinishReason: string | null = null;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Process complete lines
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();

				// Empty line or comment
				if (!trimmed || trimmed.startsWith(":")) continue;

				// Must start with "data: "
				if (!trimmed.startsWith("data: ")) continue;

				const data = trimmed.slice(6);

				// Stream termination
				if (data === "[DONE]") {
					// Emit any remaining pending tool calls
					yield* emitPendingToolCalls(pendingToolCalls);

					if (!lastFinishReason || lastFinishReason === "stop") {
						yield { type: "done", stopReason: "end_turn" };
					} else if (lastFinishReason === "tool_calls") {
						yield { type: "done", stopReason: "tool_use" };
					} else if (lastFinishReason === "length") {
						yield { type: "done", stopReason: "max_tokens" };
					}
					continue;
				}

				// Parse JSON chunk
				let chunk: any;
				try {
					chunk = JSON.parse(data);
				} catch {
					log.debug("Failed to parse OpenAI SSE chunk", { data });
					continue;
				}

				// Extract usage from final chunk (OpenAI includes it in the last chunk)
				if (chunk.usage) {
					yield {
						type: "usage_update",
						usage: {
							inputTokens: chunk.usage.prompt_tokens ?? 0,
							outputTokens: chunk.usage.completion_tokens ?? 0,
							cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
							cacheWriteTokens: 0,
						},
					};
				}

				// Process choices
				const choice = chunk.choices?.[0];
				if (!choice) continue;

				// Track finish reason
				if (choice.finish_reason) {
					lastFinishReason = choice.finish_reason;

					// If finish_reason is tool_calls, emit accumulated tool calls
					if (choice.finish_reason === "tool_calls") {
						yield* emitPendingToolCalls(pendingToolCalls);
					}
				}

				const delta = choice.delta;
				if (!delta) continue;

				// Text content
				if (delta.content != null && delta.content !== "") {
					yield { type: "text_delta", text: delta.content };
				}

				// Tool call deltas
				if (delta.tool_calls) {
					for (const tc of delta.tool_calls) {
						const index = tc.index ?? 0;
						let pending = pendingToolCalls.get(index);

						if (!pending) {
							pending = {
								id: tc.id ?? "",
								name: tc.function?.name ?? "",
								arguments: "",
							};
							pendingToolCalls.set(index, pending);
						}

						// Accumulate id and name (sent in first chunk)
						if (tc.id) pending.id = tc.id;
						if (tc.function?.name) pending.name = tc.function.name;

						// Accumulate argument chunks
						if (tc.function?.arguments) {
							pending.arguments += tc.function.arguments;
						}
					}
				}
			}
		}

		// If the stream ended without [DONE], emit any remaining tool calls and done event
		if (pendingToolCalls.size > 0) {
			yield* emitPendingToolCalls(pendingToolCalls);
		}
	} finally {
		reader.releaseLock();
	}
}

function* emitPendingToolCalls(pendingToolCalls: Map<number, PendingToolCall>): Generator<AgentEvent> {
	// Emit in index order
	const sorted = [...pendingToolCalls.entries()].sort((a, b) => a[0] - b[0]);
	for (const [, tc] of sorted) {
		let input: Record<string, unknown> = {};
		try {
			if (tc.arguments) {
				input = JSON.parse(tc.arguments);
			}
		} catch (err) {
			log.error("Failed to parse tool call arguments", {
				name: tc.name,
				args: tc.arguments,
				error: (err as Error).message,
			});
		}

		yield {
			type: "tool_use",
			id: tc.id,
			name: tc.name,
			input,
		};
	}
	pendingToolCalls.clear();
}

// ── Provider class ─────────────────────────────────────────────────────────

export class OpenAIProvider {
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;
	private endpoint: string;
	private streamingTimeout: number;

	constructor(config: OpenAIProviderConfig) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
		this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
		this.streamingTimeout = STREAMING_TIMEOUT;
	}

	/**
	 * Send messages to an OpenAI-compatible API and stream back events.
	 */
	async *sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: any[],
		signal?: AbortSignal,
		options?: SendMessageOptions,
	): AsyncGenerator<AgentEvent> {
		if (!this.apiKey) {
			throw new AgentErrorClass(
				"No API key configured. Set the appropriate API key for your OpenAI-compatible provider.",
				false,
			);
		}

		// Build OpenAI messages with system as first message
		const openaiMessages: OpenAIMessage[] = [];
		if (system) {
			openaiMessages.push({ role: "system", content: system });
		}
		openaiMessages.push(...convertMessages(messages));

		const model = options?.model ?? this.model;
		const body: Record<string, unknown> = {
			model,
			messages: openaiMessages,
			stream: true,
			max_tokens: this.maxTokens,
			// Request usage in streaming mode (supported by OpenAI and most compatible APIs)
			stream_options: { include_usage: true },
		};

		if (tools && tools.length > 0) {
			body.tools = convertTools(tools);
		}

		log.info("Sending message to OpenAI-compatible API", {
			model,
			endpoint: this.endpoint,
		});

		// Create a composite abort signal that combines user signal + timeout
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.streamingTimeout);

		const compositeSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

		try {
			const response = await fetch(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
					Accept: "text/event-stream",
				},
				body: JSON.stringify(body),
				signal: compositeSignal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				let parsed: any;
				try {
					parsed = JSON.parse(errorBody);
				} catch {
					parsed = { error: { message: errorBody } };
				}

				const message = parsed.error?.message ?? `HTTP ${response.status}`;
				const retryable = response.status >= 500 || response.status === 429;

				// Extract Retry-After header for 429 responses
				if (response.status === 429) {
					const retryAfterHeader = response.headers.get("retry-after");
					const retryAfterMs = retryAfterHeader
						? Number.isNaN(Number(retryAfterHeader))
							? undefined
							: Number(retryAfterHeader) * 1000
						: undefined;

					throw new RetryableError(`OpenAI API rate limited: ${message}`, 429, retryAfterMs);
				}

				if (retryable) {
					throw new RetryableError(`OpenAI API error: ${message}`, response.status);
				}

				throw new AgentErrorClass(`OpenAI API error: ${message}`, false);
			}

			if (!response.body) {
				throw new AgentErrorClass("No response body from API", true);
			}

			yield* parseOpenAIStream(response.body);
		} catch (err) {
			if (err instanceof RetryableError) throw err;
			if (err instanceof AgentErrorClass) throw err;

			// Handle timeout
			if (err instanceof Error && err.name === "AbortError") {
				if (signal?.aborted) {
					throw err; // User-initiated abort, let it propagate
				}
				throw new ProviderUnavailableError("openai", `OpenAI API request timed out after ${this.streamingTimeout}ms`);
			}

			throw new ProviderUnavailableError("openai", `API connection error: ${(err as Error).message}`, err as Error);
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
