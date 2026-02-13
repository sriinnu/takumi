/**
 * DirectProvider — sends messages directly to the Anthropic Messages API.
 * Used as a fallback when Darpana is not available.
 */

import type { AgentEvent, TakumiConfig } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { parseSSEStream } from "../stream.js";
import type { MessagePayload } from "../loop.js";

const log = createLogger("direct-provider");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export class DirectProvider {
	private apiKey: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;

	constructor(config: TakumiConfig) {
		this.apiKey = config.apiKey;
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
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
				signal,
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

				throw new AgentErrorClass(`Anthropic API error: ${message}`, retryable);
			}

			if (!response.body) {
				throw new AgentErrorClass("No response body from API", true);
			}

			yield* parseSSEStream(response.body);
		} catch (err) {
			if (err instanceof AgentErrorClass) throw err;
			throw new AgentErrorClass(
				`API connection error: ${(err as Error).message}`,
				true,
			);
		}
	}
}
