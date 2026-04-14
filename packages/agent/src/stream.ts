/**
 * SSE stream parser for the Anthropic Messages API.
 * Converts raw Server-Sent Events into structured AgentEvents.
 *
 * Handles: text_delta, thinking_delta, tool_use (accumulated from
 * content_block_start + input_json_delta chunks + content_block_stop),
 * usage_update, message_start/delta/stop, error, and ping.
 */

import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger, JSON_MAX_SSE_CHUNK, safeJsonParse } from "@takumi/core";

const log = createLogger("sse-parser");

interface SSEData {
	type: string;
	index?: number;
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		partial_json?: string;
		stop_reason?: string;
	};
	content_block?: {
		type: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	};
	message?: {
		id?: string;
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	};
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
	error?: {
		type?: string;
		message?: string;
	};
}

/** Tracks an in-progress tool_use block during streaming. */
interface PendingToolUse {
	id: string;
	name: string;
	inputJson: string;
}

/**
 * Parse a ReadableStream of SSE bytes into an async iterable of AgentEvents.
 */
export async function* parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();

	let buffer = "";
	let currentEventType = "";
	let currentData = "";

	// Track pending tool_use blocks being built from streaming chunks
	const pendingTools = new Map<number, PendingToolUse>();

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
				// Event type
				if (line.startsWith("event: ")) {
					currentEventType = line.slice(7).trim();
					continue;
				}

				// Data line
				if (line.startsWith("data: ")) {
					currentData += line.slice(6);
					continue;
				}

				// Empty line = end of event
				if (line.trim() === "" && currentData) {
					const events = processSSEEvent(currentEventType, currentData, pendingTools);
					for (const event of events) {
						yield event;
					}
					currentEventType = "";
					currentData = "";
				}
			}
		}

		// Process any remaining data
		if (currentData) {
			const events = processSSEEvent(currentEventType, currentData, pendingTools);
			for (const event of events) {
				yield event;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function processSSEEvent(eventType: string, data: string, pendingTools: Map<number, PendingToolUse>): AgentEvent[] {
	const events: AgentEvent[] = [];

	try {
		const parsed: SSEData = safeJsonParse<SSEData>(data, JSON_MAX_SSE_CHUNK);

		switch (eventType) {
			case "content_block_start": {
				const block = parsed.content_block;
				if (!block) break;

				if (block.type === "tool_use" && block.id && block.name) {
					// Begin tracking this tool_use block — accumulate input JSON deltas
					const index = parsed.index ?? 0;
					pendingTools.set(index, {
						id: block.id,
						name: block.name,
						inputJson: "",
					});
				}
				break;
			}

			case "content_block_delta": {
				const delta = parsed.delta;
				if (!delta) break;

				if (delta.type === "text_delta" && delta.text !== undefined) {
					events.push({ type: "text_delta", text: delta.text });
				} else if (delta.type === "thinking_delta" && delta.thinking !== undefined) {
					events.push({ type: "thinking_delta", text: delta.thinking });
				} else if (delta.type === "input_json_delta" && delta.partial_json !== undefined) {
					// Accumulate JSON chunks for the tool_use input
					const index = parsed.index ?? 0;
					const pending = pendingTools.get(index);
					if (pending) {
						pending.inputJson += delta.partial_json;
					}
				}
				break;
			}

			case "content_block_stop": {
				// Emit the complete tool_use event
				const index = parsed.index ?? 0;
				const pending = pendingTools.get(index);
				if (pending) {
					let input: Record<string, unknown> = {};
					try {
						if (pending.inputJson) {
							input = JSON.parse(pending.inputJson);
						}
					} catch (err) {
						log.error("Failed to parse tool input JSON", {
							name: pending.name,
							json: pending.inputJson,
							error: (err as Error).message,
						});
					}

					events.push({
						type: "tool_use",
						id: pending.id,
						name: pending.name,
						input,
					});
					pendingTools.delete(index);
				}
				break;
			}

			case "message_start": {
				if (parsed.message?.usage) {
					const u = parsed.message.usage;
					events.push({
						type: "usage_update",
						usage: {
							inputTokens: u.input_tokens ?? 0,
							outputTokens: u.output_tokens ?? 0,
							cacheReadTokens: u.cache_read_input_tokens ?? 0,
							cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
						},
					});
				}
				break;
			}

			case "message_delta": {
				if (parsed.delta?.stop_reason) {
					events.push({
						type: "done",
						stopReason: parsed.delta.stop_reason as "end_turn" | "max_tokens" | "tool_use" | "stop_sequence",
					});
				}
				if (parsed.usage) {
					events.push({
						type: "usage_update",
						usage: {
							inputTokens: parsed.usage.input_tokens ?? 0,
							outputTokens: parsed.usage.output_tokens ?? 0,
							cacheReadTokens: parsed.usage.cache_read_input_tokens ?? 0,
							cacheWriteTokens: parsed.usage.cache_creation_input_tokens ?? 0,
						},
					});
				}
				break;
			}

			case "message_stop": {
				// Final event — no action needed
				break;
			}

			case "error": {
				const error = new AgentErrorClass(parsed.error?.message ?? "Unknown stream error", true);
				events.push({ type: "error", error });
				break;
			}

			case "ping": {
				// Heartbeat — ignore
				break;
			}

			default:
				log.debug(`Unknown SSE event type: ${eventType}`);
		}
	} catch (err) {
		log.error("Failed to parse SSE data", { data, error: (err as Error).message });
		events.push({
			type: "error",
			error: new AgentErrorClass(`SSE parse error: ${(err as Error).message}`, false),
		});
	}

	return events;
}
