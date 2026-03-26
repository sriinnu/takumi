/**
 * @file sdk.ts
 * @module sdk
 *
 * Headless SDK for embedding Takumi as a library.
 *
 * ```ts
 * import { createSession } from "@takumi/agent";
 *
 * const session = createSession({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 *
 * for await (const event of session.send("Explain this codebase")) {
 *   if (event.type === "text") process.stdout.write(event.text);
 * }
 * ```
 */

import type { AgentEvent, TakumiConfig, ToolDefinition } from "@takumi/core";
import type { AgentLoopOptions, MessagePayload } from "./loop.js";
import { agentLoop } from "./loop.js";
import { DirectProvider } from "./providers/direct.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";
import { ToolRegistry } from "./tools/registry.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionOptions {
	provider: "anthropic" | "openai" | "google";
	model: string;
	apiKey: string;
	systemPrompt?: string;
	maxTurns?: number;
	tools?: ToolDefinition[];
	maxTokens?: number;
	thinking?: boolean;
	thinkingBudget?: number;
}

export interface TakumiSession {
	/** Send a user message and iterate over agent events. */
	send(message: string): AsyncIterable<AgentEvent>;
	/** Full conversation history so far. */
	readonly history: ReadonlyArray<MessagePayload>;
	/** Reset conversation state. */
	reset(): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

function buildSendMessage(opts: SessionOptions) {
	const base = {
		apiKey: opts.apiKey,
		model: opts.model,
		maxTokens: opts.maxTokens ?? 16384,
		thinking: opts.thinking ?? false,
		thinkingBudget: opts.thinkingBudget ?? 10000,
	};

	let cachedProvider: DirectProvider | OpenAIProvider | GeminiProvider | null = null;

	const getProvider = () => {
		if (cachedProvider) return cachedProvider;
		if (opts.provider === "anthropic") {
			cachedProvider = new DirectProvider(base as unknown as TakumiConfig);
			return cachedProvider;
		}
		if (opts.provider === "openai") {
			cachedProvider = new OpenAIProvider(base);
			return cachedProvider;
		}
		if (opts.provider === "google") {
			cachedProvider = new GeminiProvider(base);
			return cachedProvider;
		}
		throw new Error(`Unsupported provider: ${opts.provider}`);
	};

	return (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => getProvider().sendMessage(messages, system, tools, signal, options);
}

/**
 * Create a headless Takumi session for programmatic use.
 *
 * The returned session exposes a `send()` async iterable that yields
 * the same {@link AgentEvent} stream as the TUI agent runner.
 */
export function createSession(opts: SessionOptions): TakumiSession {
	const sendMessage = buildSendMessage(opts);
	const toolRegistry = new ToolRegistry();
	const history: MessagePayload[] = [];

	return {
		send(message: string): AsyncIterable<AgentEvent> {
			const loopOpts: AgentLoopOptions = {
				sendMessage,
				tools: toolRegistry,
				systemPrompt: opts.systemPrompt,
				maxTurns: opts.maxTurns,
				model: opts.model,
			};
			const gen = agentLoop(message, [...history], loopOpts);

			// Wrap generator to capture assistant responses into history
			const self = history;
			return {
				[Symbol.asyncIterator]() {
					const lastAssistantContent: unknown[] = [];
					return {
						async next() {
							const result = await gen.next();
							if (result.done) {
								if (lastAssistantContent.length > 0) {
									self.push({ role: "user", content: message });
									self.push({ role: "assistant", content: lastAssistantContent });
								}
								return result;
							}
							const evt = result.value;
							if (evt.type === "text_delta") {
								lastAssistantContent.push({ type: "text", text: evt.text });
							}
							return result;
						},
					};
				},
			};
		},
		get history() {
			return history;
		},
		reset() {
			history.length = 0;
		},
	};
}
