import type { AgentEvent } from "@takumi/core";
import { createLogger, JSON_MAX_FILE, JSON_MAX_SSE_CHUNK, safeJsonParse } from "@takumi/core";
import { SseFrameParser } from "./sse-frame-parser.js";

const log = createLogger("openai-provider");

/** Tracks an in-progress tool call during streaming. */
interface PendingToolCall {
	id: string;
	name: string;
	arguments: string;
}

/** Shape of a single OpenAI streaming chunk after JSON parsing. */
interface OpenAIStreamChunk {
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number };
	};
	choices?: Array<{
		finish_reason?: string | null;
		delta?: {
			content?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
	}>;
}

/** Parse an OpenAI SSE stream into AgentEvent objects. */
export async function* parseOpenAIStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	const parser = new SseFrameParser();

	const pendingToolCalls = new Map<number, PendingToolCall>();
	let lastFinishReason: string | null = null;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
				yield* processOpenAIFrame(frame.data, pendingToolCalls, lastFinishReason, (r) => {
					lastFinishReason = r;
				});
			}
		}

		// Flush any remaining partial frame at stream end
		for (const frame of parser.flush()) {
			yield* processOpenAIFrame(frame.data, pendingToolCalls, lastFinishReason, (r) => {
				lastFinishReason = r;
			});
		}

		if (pendingToolCalls.size > 0) {
			yield* emitPendingToolCalls(pendingToolCalls);
		}
	} finally {
		reader.releaseLock();
	}
}

function* processOpenAIFrame(
	data: string,
	pendingToolCalls: Map<number, PendingToolCall>,
	lastFinishReason: string | null,
	setFinishReason: (r: string) => void,
): Generator<AgentEvent> {
	if (data === "[DONE]") {
		yield* emitPendingToolCalls(pendingToolCalls);

		if (!lastFinishReason || lastFinishReason === "stop") {
			yield { type: "done", stopReason: "end_turn" };
		} else if (lastFinishReason === "tool_calls") {
			yield { type: "done", stopReason: "tool_use" };
		} else if (lastFinishReason === "length") {
			yield { type: "done", stopReason: "max_tokens" };
		}
		return;
	}

	let chunk: OpenAIStreamChunk;
	try {
		chunk = safeJsonParse<OpenAIStreamChunk>(data, JSON_MAX_SSE_CHUNK);
	} catch {
		log.debug("Failed to parse OpenAI SSE chunk", { data });
		return;
	}

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

	const choice = chunk.choices?.[0];
	if (!choice) return;

	if (choice.finish_reason) {
		setFinishReason(choice.finish_reason);
		if (choice.finish_reason === "tool_calls") {
			yield* emitPendingToolCalls(pendingToolCalls);
		}
	}

	const delta = choice.delta;
	if (!delta) return;

	if (delta.content != null && delta.content !== "") {
		yield { type: "text_delta", text: delta.content };
	}

	if (!delta.tool_calls) return;
	for (const tc of delta.tool_calls) {
		const index = tc.index ?? 0;
		let pending = pendingToolCalls.get(index);
		if (!pending) {
			pending = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
			pendingToolCalls.set(index, pending);
		}
		if (tc.id) pending.id = tc.id;
		if (tc.function?.name) pending.name = tc.function.name;
		if (tc.function?.arguments) pending.arguments += tc.function.arguments;
	}
}

function* emitPendingToolCalls(pendingToolCalls: Map<number, PendingToolCall>): Generator<AgentEvent> {
	const sorted = [...pendingToolCalls.entries()].sort((a, b) => a[0] - b[0]);
	for (const [, tc] of sorted) {
		let input: Record<string, unknown> = {};
		try {
			if (tc.arguments) input = safeJsonParse<Record<string, unknown>>(tc.arguments, JSON_MAX_FILE);
		} catch (err) {
			log.error("Failed to parse tool call arguments", {
				name: tc.name,
				args: tc.arguments,
				error: (err as Error).message,
			});
		}

		yield { type: "tool_use", id: tc.id, name: tc.name, input };
	}
	pendingToolCalls.clear();
}
