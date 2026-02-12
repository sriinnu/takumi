/**
 * SSE stream parser for the Anthropic Messages API.
 * Converts raw Server-Sent Events into structured AgentEvents.
 */

import type { AgentEvent, Usage } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";

const log = createLogger("sse-parser");

interface SSEData {
	type: string;
	index?: number;
	delta?: any;
	content_block?: any;
	message?: any;
	usage?: any;
	error?: any;
}

/**
 * Parse a ReadableStream of SSE bytes into an async iterable of AgentEvents.
 */
export async function* parseSSEStream(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AgentEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();

	let buffer = "";
	let currentEventType = "";
	let currentData = "";

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
					const events = processSSEEvent(currentEventType, currentData);
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
			const events = processSSEEvent(currentEventType, currentData);
			for (const event of events) {
				yield event;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function processSSEEvent(eventType: string, data: string): AgentEvent[] {
	const events: AgentEvent[] = [];

	try {
		const parsed: SSEData = JSON.parse(data);

		switch (eventType) {
			case "content_block_delta": {
				const delta = parsed.delta;
				if (!delta) break;

				if (delta.type === "text_delta") {
					events.push({ type: "text_delta", text: delta.text });
				} else if (delta.type === "thinking_delta") {
					events.push({ type: "thinking_delta", text: delta.thinking });
				} else if (delta.type === "input_json_delta") {
					// Part of tool_use — accumulated by content_block_stop
				}
				break;
			}

			case "content_block_start": {
				const block = parsed.content_block;
				if (!block) break;

				if (block.type === "tool_use") {
					// We'll emit tool_use when the block is complete
				}
				break;
			}

			case "content_block_stop": {
				// Tool use blocks are emitted fully formed
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
						stopReason: parsed.delta.stop_reason,
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
				const error = new AgentErrorClass(
					parsed.error?.message ?? "Unknown stream error",
					true,
				);
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
