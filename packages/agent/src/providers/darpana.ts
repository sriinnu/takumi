/**
 * DarpanaProvider — sends messages through the Darpana HTTP proxy.
 * Darpana handles API key management, caching, and rate limiting.
 *
 * Includes timeout handling and structured error reporting for
 * integration with the retry layer.
 */

import type { AgentEvent, TakumiConfig } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { ProviderUnavailableError } from "../errors.js";
import type { MessagePayload, SendMessageOptions } from "../loop.js";
import { RetryableError } from "../retry.js";
import { parseSSEStream } from "../stream.js";

const log = createLogger("darpana-provider");

/** Default timeout for non-streaming requests (ms). */
const DEFAULT_TIMEOUT = 30_000;

/** Default timeout for streaming requests (ms). */
const STREAMING_TIMEOUT = 120_000;

export class DarpanaProvider {
	private baseUrl: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;
	private timeout: number;
	private streamingTimeout: number;

	constructor(config: TakumiConfig) {
		this.baseUrl = config.proxyUrl || "http://localhost:3141";
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
		this.timeout = DEFAULT_TIMEOUT;
		this.streamingTimeout = STREAMING_TIMEOUT;
	}

	/**
	 * Send messages to Darpana and stream back events.
	 */
	async *sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: any[],
		signal?: AbortSignal,
		options?: SendMessageOptions,
	): AsyncGenerator<AgentEvent> {
		const url = `${this.baseUrl}/v1/messages`;

		const body: Record<string, unknown> = {
			model: options?.model ?? this.model,
			max_tokens: this.maxTokens,
			system,
			messages,
			stream: true,
		};

		if (tools && tools.length > 0) {
			body.tools = tools;
		}

		if (this.thinking) {
			body.thinking = {
				type: "enabled",
				budget_tokens: this.thinkingBudget,
			};
		}

		log.info("Sending message to Darpana", { url, model: options?.model ?? this.model });

		// Create a composite abort signal that combines user signal + timeout
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.streamingTimeout);

		const compositeSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream",
				},
				body: JSON.stringify(body),
				signal: compositeSignal,
			});

			if (!response.ok) {
				const errorBody = await response.text();
				const retryable = response.status >= 500 || response.status === 429 || response.status === 529;

				// Extract Retry-After header for 429 responses
				if (response.status === 429) {
					const retryAfterHeader = response.headers.get("retry-after");
					const retryAfterMs = retryAfterHeader
						? Number.isNaN(Number(retryAfterHeader))
							? undefined
							: Number(retryAfterHeader) * 1000
						: undefined;

					throw new RetryableError(`Darpana rate limited: ${errorBody}`, 429, retryAfterMs);
				}

				if (retryable) {
					throw new RetryableError(`Darpana error ${response.status}: ${errorBody}`, response.status);
				}

				throw new AgentErrorClass(`Darpana error ${response.status}: ${errorBody}`, false);
			}

			if (!response.body) {
				throw new AgentErrorClass("No response body from Darpana", true);
			}

			yield* parseSSEStream(response.body);
		} catch (err) {
			if (err instanceof RetryableError) throw err;
			if (err instanceof AgentErrorClass) throw err;

			// Handle timeout
			if (err instanceof Error && err.name === "AbortError") {
				if (signal?.aborted) {
					throw err; // User-initiated abort, let it propagate
				}
				throw new ProviderUnavailableError("darpana", `Darpana request timed out after ${this.streamingTimeout}ms`);
			}

			throw new ProviderUnavailableError(
				"darpana",
				`Darpana connection error: ${(err as Error).message}`,
				err as Error,
			);
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/** Check if the Darpana proxy is reachable. */
	async healthCheck(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/health`, {
				method: "GET",
				signal: AbortSignal.timeout(5000),
			});
			return response.ok;
		} catch {
			return false;
		}
	}
}
