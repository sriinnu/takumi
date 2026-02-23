/**
 * GeminiProvider — sends messages to the Google Gemini API.
 * Converts Anthropic-format messages to Gemini format and streams
 * back AgentEvents matching the existing provider interface.
 *
 * Includes timeout handling and structured error reporting for
 * integration with the retry layer.
 */

import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { ProviderUnavailableError } from "../errors.js";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { RetryableError } from "../retry.js";

const log = createLogger("gemini-provider");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Default timeout for streaming requests (ms). */
const STREAMING_TIMEOUT = 120_000;

// ── Schema cleaning ──────────────────────────────────────────────────────────

/**
 * JSON Schema `format` values that Gemini does NOT support.
 * Gemini only supports a limited subset; we strip anything unsupported.
 */
const UNSUPPORTED_FORMATS = new Set([
	"uri",
	"uri-reference",
	"uri-template",
	"iri",
	"iri-reference",
	"json-pointer",
	"relative-json-pointer",
	"regex",
	"idn-email",
	"idn-hostname",
	"hostname",
	"ipv4",
	"ipv6",
	"password",
	"binary",
]);

/**
 * Recursively clean a JSON Schema for Gemini compatibility.
 *
 * - Removes `additionalProperties` (Gemini rejects it)
 * - Strips unsupported `format` values
 * - Deep-clones to avoid mutating the original
 */
export function cleanSchema(schema: any): any {
	if (schema == null || typeof schema !== "object") return schema;

	if (Array.isArray(schema)) {
		return schema.map((item) => cleanSchema(item));
	}

	const cleaned: Record<string, any> = {};

	for (const [key, value] of Object.entries(schema)) {
		// Strip additionalProperties entirely
		if (key === "additionalProperties") continue;

		// Strip unsupported format values
		if (key === "format" && typeof value === "string" && UNSUPPORTED_FORMATS.has(value)) {
			continue;
		}

		// Recurse into nested objects
		cleaned[key] = cleanSchema(value);
	}

	return cleaned;
}

// ── Message conversion ───────────────────────────────────────────────────────

/** A single Gemini content part. */
interface GeminiPart {
	text?: string;
	thought?: boolean;
	functionCall?: { name: string; args: Record<string, unknown> };
	functionResponse?: { name: string; response: { content: any } };
}

/** A Gemini content message. */
interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

/**
 * Convert Anthropic-format messages to Gemini `contents[]` array.
 *
 * Anthropic uses:
 *   - role: "user" | "assistant"
 *   - content: string | ContentBlock[]
 *
 * Gemini uses:
 *   - role: "user" | "model"
 *   - parts: Part[]
 */
export function convertMessages(messages: MessagePayload[]): GeminiContent[] {
	const contents: GeminiContent[] = [];

	for (const msg of messages) {
		const role: "user" | "model" = msg.role === "assistant" ? "model" : "user";

		// Simple string content
		if (typeof msg.content === "string") {
			contents.push({ role, parts: [{ text: msg.content }] });
			continue;
		}

		// Array of content blocks
		if (Array.isArray(msg.content)) {
			const parts: GeminiPart[] = [];

			for (const block of msg.content) {
				switch (block.type) {
					case "text":
						parts.push({ text: block.text });
						break;

					case "thinking":
						// Gemini thinking blocks use `thought: true`
						parts.push({ text: block.thinking, thought: true });
						break;

					case "tool_use":
						parts.push({
							functionCall: {
								name: block.name,
								args: block.input ?? {},
							},
						});
						break;

					case "tool_result":
						parts.push({
							functionResponse: {
								name: block.name ?? block.tool_use_id ?? block.toolUseId ?? "unknown",
								response: {
									content: block.content ?? block.output ?? "",
								},
							},
						});
						break;

					default:
						// Unknown block type — include as text if possible
						if (block.text) {
							parts.push({ text: block.text });
						}
						break;
				}
			}

			if (parts.length > 0) {
				contents.push({ role, parts });
			}
		}
	}

	return contents;
}

/**
 * Convert Anthropic-format tool definitions to Gemini `tools[]` format.
 *
 * Anthropic: { name, description, input_schema: {...} }
 * Gemini:    { functionDeclarations: [{ name, description, parameters: {...} }] }
 */
export function convertTools(tools: any[]): any[] {
	if (!tools || tools.length === 0) return [];

	const declarations = tools.map((tool) => {
		const decl: Record<string, any> = {
			name: tool.name,
			description: tool.description || "",
		};

		// Anthropic uses input_schema or inputSchema
		const schema = tool.input_schema ?? tool.inputSchema;
		if (schema) {
			decl.parameters = cleanSchema(schema);
		}

		return decl;
	});

	return [{ functionDeclarations: declarations }];
}

// ── Tool call ID generation ──────────────────────────────────────────────────

/**
 * Generate a unique tool call ID.
 * Gemini does not provide tool call IDs like Anthropic/OpenAI.
 */
export function generateToolCallId(): string {
	const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
	return `call_${hex}`;
}

// ── SSE parsing ──────────────────────────────────────────────────────────────

/** Parsed Gemini SSE candidate. */
interface GeminiCandidate {
	content?: {
		parts?: GeminiResponsePart[];
		role?: string;
	};
	finishReason?: string;
}

/** Gemini response part. */
interface GeminiResponsePart {
	text?: string;
	thought?: boolean;
	functionCall?: { name: string; args: Record<string, unknown> };
}

/** Parsed Gemini SSE data. */
interface GeminiSSEData {
	candidates?: GeminiCandidate[];
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
	error?: {
		code?: number;
		message?: string;
		status?: string;
	};
}

/**
 * Parse a Gemini SSE chunk into AgentEvents.
 */
function parseGeminiChunk(data: GeminiSSEData): AgentEvent[] {
	const events: AgentEvent[] = [];

	// Check for API-level error
	if (data.error) {
		events.push({
			type: "error",
			error: new AgentErrorClass(data.error.message ?? "Unknown Gemini error", false),
		});
		return events;
	}

	const candidate = data.candidates?.[0];
	if (!candidate) {
		// Usage-only chunk (no candidates)
		if (data.usageMetadata) {
			events.push({
				type: "usage_update",
				usage: {
					inputTokens: data.usageMetadata.promptTokenCount ?? 0,
					outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		return events;
	}

	const parts = candidate.content?.parts ?? [];
	let hasFunctionCalls = false;

	for (const part of parts) {
		if (part.functionCall) {
			hasFunctionCalls = true;
			events.push({
				type: "tool_use",
				id: generateToolCallId(),
				name: part.functionCall.name,
				input: part.functionCall.args ?? {},
			});
		} else if (part.thought && part.text !== undefined) {
			events.push({
				type: "thinking_delta",
				text: part.text,
			});
		} else if (part.text !== undefined) {
			events.push({
				type: "text_delta",
				text: part.text,
			});
		}
	}

	// Usage metadata
	if (data.usageMetadata) {
		events.push({
			type: "usage_update",
			usage: {
				inputTokens: data.usageMetadata.promptTokenCount ?? 0,
				outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
	}

	// Finish reason
	if (candidate.finishReason) {
		let stopReason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence";

		if (hasFunctionCalls || (candidate.finishReason === "STOP" && hasFunctionCallsInParts(parts))) {
			stopReason = "tool_use";
		} else {
			switch (candidate.finishReason) {
				case "STOP":
					stopReason = "end_turn";
					break;
				case "MAX_TOKENS":
					stopReason = "max_tokens";
					break;
				case "SAFETY":
				case "RECITATION":
				case "OTHER":
					stopReason = "end_turn";
					break;
				default:
					stopReason = "end_turn";
			}
		}

		events.push({ type: "done", stopReason });
	}

	return events;
}

function hasFunctionCallsInParts(parts: GeminiResponsePart[]): boolean {
	return parts.some((p) => p.functionCall != null);
}

// ── GeminiProvider ───────────────────────────────────────────────────────────

export interface GeminiProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	thinking: boolean;
	thinkingBudget: number;
}

export class GeminiProvider {
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;
	private streamingTimeout: number;

	constructor(config: GeminiProviderConfig) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
		this.streamingTimeout = STREAMING_TIMEOUT;
	}

	/**
	 * Send messages to the Gemini API and stream back AgentEvents.
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
				"No API key configured. Set GEMINI_API_KEY or configure apiKey in takumi config.",
				false,
			);
		}

		const model = options?.model ?? this.model;
		const url = `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

		// Build the request body
		const body: Record<string, unknown> = {
			contents: convertMessages(messages),
			systemInstruction: { parts: [{ text: system }] },
			generationConfig: {
				maxOutputTokens: this.maxTokens,
				temperature: 1.0,
			},
		};

		// Add thinking config for Gemini 2.5+ models
		if (this.thinking) {
			(body.generationConfig as Record<string, unknown>).thinkingConfig = {
				thinkingBudget: this.thinkingBudget,
			};
		}

		// Add tools
		if (tools && tools.length > 0) {
			body.tools = convertTools(tools);
		}

		log.info("Sending message to Gemini API", { model });

		// Create a composite abort signal that combines user signal + timeout
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.streamingTimeout);

		const compositeSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
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

					throw new RetryableError(`Gemini API rate limited: ${message}`, 429, retryAfterMs);
				}

				if (retryable) {
					throw new RetryableError(`Gemini API error: ${message}`, response.status);
				}

				throw new AgentErrorClass(`Gemini API error: ${message}`, false);
			}

			if (!response.body) {
				throw new AgentErrorClass("No response body from Gemini API", true);
			}

			// Parse Gemini SSE stream
			yield* parseGeminiSSEStream(response.body);
		} catch (err) {
			if (err instanceof RetryableError) throw err;
			if (err instanceof AgentErrorClass) throw err;

			// Handle timeout
			if (err instanceof Error && err.name === "AbortError") {
				if (signal?.aborted) {
					throw err; // User-initiated abort, let it propagate
				}
				throw new ProviderUnavailableError("gemini", `Gemini API request timed out after ${this.streamingTimeout}ms`);
			}

			throw new ProviderUnavailableError(
				"gemini",
				`Gemini API connection error: ${(err as Error).message}`,
				err as Error,
			);
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

// ── Gemini SSE stream parser ─────────────────────────────────────────────────

/**
 * Parse a Gemini SSE stream into AgentEvents.
 *
 * Gemini SSE format: `data: { "candidates": [...], "usageMetadata": {...} }`
 * Each `data:` line contains a complete JSON object.
 */
export async function* parseGeminiSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();

	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Process complete lines
			const lines = buffer.split("\n");
			// Keep the last incomplete line in the buffer
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();

				// Skip empty lines and SSE comments
				if (!trimmed || trimmed.startsWith(":")) continue;

				// Extract data from "data: " prefix
				if (trimmed.startsWith("data: ")) {
					const jsonStr = trimmed.slice(6);

					// Skip [DONE] marker if present
					if (jsonStr.trim() === "[DONE]") continue;

					try {
						const data: GeminiSSEData = JSON.parse(jsonStr);
						const events = parseGeminiChunk(data);
						for (const event of events) {
							yield event;
						}
					} catch (err) {
						log.error("Failed to parse Gemini SSE data", {
							data: jsonStr,
							error: (err as Error).message,
						});
						yield {
							type: "error",
							error: new AgentErrorClass(`Gemini SSE parse error: ${(err as Error).message}`, false),
						};
					}
				}
			}
		}

		// Process any remaining data in the buffer
		if (buffer.trim()) {
			const trimmed = buffer.trim();
			if (trimmed.startsWith("data: ")) {
				const jsonStr = trimmed.slice(6);
				if (jsonStr.trim() !== "[DONE]") {
					try {
						const data: GeminiSSEData = JSON.parse(jsonStr);
						const events = parseGeminiChunk(data);
						for (const event of events) {
							yield event;
						}
					} catch (err) {
						log.error("Failed to parse remaining Gemini SSE data", {
							data: jsonStr,
							error: (err as Error).message,
						});
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
