/**
 * DirectProvider — sends messages directly to the Anthropic Messages API.
 * Used as a fallback when Darpana is not available.
 *
 * Includes timeout handling and structured error reporting for
 * integration with the retry layer.
 */

import type { AgentEvent, TakumiConfig } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { parseSSEStream } from "../stream.js";
import type { MessagePayload } from "../loop.js";
import { RetryableError } from "../retry.js";
import { ProviderUnavailableError } from "../errors.js";

const log = createLogger("direct-provider");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Default timeout for non-streaming requests (ms). */
const DEFAULT_TIMEOUT = 30_000;

/** Default timeout for streaming requests (ms). */
const STREAMING_TIMEOUT = 120_000;

export class DirectProvider {
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;
	private timeout: number;
	private streamingTimeout: number;

	constructor(config: TakumiConfig) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
		this.timeout = DEFAULT_TIMEOUT;
		this.streamingTimeout = STREAMING_TIMEOUT;
	}

	/**
	 * Send messages to the Anthropic API and stream back events.
	 */
	async *sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: any[],
		signal?: AbortSignal,
	): AsyncGenerator<AgentEvent> {
		if (!this.apiKey) {
			throw new AgentErrorClass(
				"No API key configured. Set ANTHROPIC_API_KEY or configure apiKey in takumi config.",
				false,
			);
		}

		const body: Record<string, unknown> = {
			model: this.model,
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

		log.info("Sending message to Anthropic API", { model: this.model });

		// Create a composite abort signal that combines user signal + timeout
		const timeoutController = new AbortController();
		const timeoutId = setTimeout(() => timeoutController.abort(), this.streamingTimeout);

		const compositeSignal = signal
			? AbortSignal.any([signal, timeoutController.signal])
			: timeoutController.signal;

		try {
			const response = await fetch(ANTHROPIC_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"anthropic-version": API_VERSION,
					"x-api-key": this.apiKey,
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
				const retryable = response.status >= 500 || response.status === 429 || response.status === 529;

				// Extract Retry-After header for 429 responses
				if (response.status === 429) {
					const retryAfterHeader = response.headers.get("retry-after");
					const retryAfterMs = retryAfterHeader
						? (Number.isNaN(Number(retryAfterHeader))
							? undefined
							: Number(retryAfterHeader) * 1000)
						: undefined;

					throw new RetryableError(
						`Anthropic API rate limited: ${message}`,
						429,
						retryAfterMs,
					);
				}

				if (retryable) {
					throw new RetryableError(
						`Anthropic API error: ${message}`,
						response.status,
					);
				}

				throw new AgentErrorClass(`Anthropic API error: ${message}`, false);
			}

			if (!response.body) {
				throw new AgentErrorClass("No response body from API", true);
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
				throw new ProviderUnavailableError(
					"anthropic",
					`Anthropic API request timed out after ${this.streamingTimeout}ms`,
				);
			}

			throw new ProviderUnavailableError(
				"anthropic",
				`API connection error: ${(err as Error).message}`,
				err as Error,
			);
		} finally {
			clearTimeout(timeoutId);
		}
	}
}
