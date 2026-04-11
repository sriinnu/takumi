/**
 * GeminiProvider — sends messages to the Google Gemini API.
 *
 * Message conversion, schema cleaning, and SSE parsing are delegated to
 * helper modules so this provider can focus on request lifecycle handling.
 */

import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { ProviderUnavailableError } from "../errors.js";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { RetryableError } from "../retry.js";
import {
	cleanSchema,
	convertMessages,
	convertTools,
	type GeminiContent,
	type GeminiPart,
	generateToolCallId,
} from "./gemini-conversion.js";
import { parseGeminiSSEStream } from "./gemini-stream.js";

const log = createLogger("gemini-provider");
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Default timeout for streaming requests (ms). */
const STREAMING_TIMEOUT = 120_000;

export interface GeminiProviderConfig {
	apiKey: string;
	model: string;
	maxTokens: number;
	thinking: boolean;
	thinkingBudget: number;
	/** Optional base endpoint override (defaults to Gemini REST API). */
	endpoint?: string;
}

export class GeminiProvider {
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;
	private endpoint: string;
	private streamingTimeout: number;

	constructor(config: GeminiProviderConfig) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
		this.endpoint = config.endpoint ?? GEMINI_API_BASE;
		this.streamingTimeout = STREAMING_TIMEOUT;
	}

	/** Send messages to Gemini and stream back AgentEvents. */
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
		// Keep the API key out of the URL (where it could appear in logs and
		// error messages) and send it via the x-goog-api-key header instead.
		const url = `${this.endpoint.replace(/\/+$/, "")}/${model}:streamGenerateContent?alt=sse`;

		const body: Record<string, unknown> = {
			contents: convertMessages(messages),
			systemInstruction: { parts: [{ text: system }] },
			generationConfig: {
				maxOutputTokens: this.maxTokens,
				temperature: 1.0,
			},
		};

		if (this.thinking) {
			(body.generationConfig as Record<string, unknown>).thinkingConfig = {
				thinkingBudget: this.thinkingBudget,
			};
		}
		if (tools && tools.length > 0) {
			body.tools = convertTools(tools);
		}

		log.info("Sending message to Gemini API", { model });

		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.streamingTimeout);
		const compositeSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": this.apiKey,
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

			yield* parseGeminiSSEStream(response.body);
		} catch (err) {
			if (err instanceof RetryableError) throw err;
			if (err instanceof AgentErrorClass) throw err;

			if (err instanceof Error && err.name === "AbortError") {
				if (signal?.aborted) throw err;
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

export { cleanSchema, convertMessages, convertTools, generateToolCallId, parseGeminiSSEStream };
export type { GeminiContent, GeminiPart };
