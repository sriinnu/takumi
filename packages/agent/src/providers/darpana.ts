/**
 * DarpanaProvider — sends messages through the Darpana HTTP proxy.
 * Darpana handles API key management, caching, and rate limiting.
 */

import type { AgentEvent, TakumiConfig } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { parseSSEStream } from "../stream.js";
import type { MessagePayload } from "../loop.js";

const log = createLogger("darpana-provider");

export class DarpanaProvider {
	private baseUrl: string;
	private model: string;
	private maxTokens: number;
	private thinking: boolean;
	private thinkingBudget: number;

	constructor(config: TakumiConfig) {
		this.baseUrl = config.proxyUrl || "http://localhost:3141";
		this.model = config.model;
		this.maxTokens = config.maxTokens;
		this.thinking = config.thinking;
		this.thinkingBudget = config.thinkingBudget;
	}

	/**
	 * Send messages to Darpana and stream back events.
	 */
	async *sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: any[],
	): AsyncGenerator<AgentEvent> {
		const url = `${this.baseUrl}/v1/messages`;

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

		log.info("Sending message to Darpana", { url, model: this.model });

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream",
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new AgentErrorClass(
					`Darpana error ${response.status}: ${errorBody}`,
					response.status >= 500 || response.status === 429,
				);
			}

			if (!response.body) {
				throw new AgentErrorClass("No response body from Darpana", true);
			}

			yield* parseSSEStream(response.body);
		} catch (err) {
			if (err instanceof AgentErrorClass) throw err;
			throw new AgentErrorClass(`Darpana connection error: ${(err as Error).message}`, true);
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
