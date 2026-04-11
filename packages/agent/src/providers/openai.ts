/**
 * OpenAIProvider -- sends messages to any OpenAI-compatible chat completions API.
 *
 * Streaming and conversion logic are split into helper modules to keep this
 * provider focused on request lifecycle and error handling.
 */

import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { ProviderUnavailableError } from "../errors.js";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { RetryableError } from "../retry.js";
import {
	convertMessages,
	convertTools,
	type OpenAIMessage,
	type OpenAITool,
	type OpenAIToolCall,
} from "./openai-conversion.js";
import { parseOpenAIStream } from "./openai-stream.js";

const log = createLogger("openai-provider");

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
/** Default timeout for streaming requests (ms). */
const STREAMING_TIMEOUT = 120_000;

function allowsKeylessLocalEndpoint(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
	} catch {
		return false;
	}
}

export interface OpenAIProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	thinking: boolean;
	thinkingBudget: number;
	endpoint?: string;
}

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
		if (!this.apiKey && !allowsKeylessLocalEndpoint(this.endpoint)) {
			throw new AgentErrorClass(
				"No API key configured. Set the appropriate API key for your OpenAI-compatible provider.",
				false,
			);
		}

		const openaiMessages: OpenAIMessage[] = [];
		if (system) openaiMessages.push({ role: "system", content: system });
		openaiMessages.push(...convertMessages(messages));

		const model = options?.model ?? this.model;
		const body: Record<string, unknown> = {
			model,
			messages: openaiMessages,
			stream: true,
			max_tokens: this.maxTokens,
			stream_options: { include_usage: true },
		};
		if (tools && tools.length > 0) {
			body.tools = convertTools(tools);
		}

		log.info("Sending message to OpenAI-compatible API", {
			model,
			endpoint: this.endpoint,
		});

		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.streamingTimeout);
		const compositeSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			};
			if (this.apiKey) {
				headers.Authorization = `Bearer ${this.apiKey}`;
			}

			const response = await fetch(this.endpoint, {
				method: "POST",
				headers,
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

			if (err instanceof Error && err.name === "AbortError") {
				if (signal?.aborted) throw err;
				throw new ProviderUnavailableError("openai", `OpenAI API request timed out after ${this.streamingTimeout}ms`);
			}

			throw new ProviderUnavailableError("openai", `API connection error: ${(err as Error).message}`, err as Error);
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

export { convertMessages, convertTools, parseOpenAIStream };
export type { OpenAIMessage, OpenAITool, OpenAIToolCall };
