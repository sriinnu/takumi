import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import { generateToolCallId } from "./gemini-conversion.js";

const log = createLogger("gemini-provider");

/** Parsed Gemini SSE candidate. */
interface GeminiCandidate {
	content?: { parts?: GeminiResponsePart[]; role?: string };
	finishReason?: string;
}

/** Gemini response part. */
interface GeminiResponsePart {
	text?: string;
	thought?: boolean;
	functionCall?: { name: string; args: Record<string, unknown> };
}

/** Parsed Gemini SSE data. */
interface GeminiSSEData {
	candidates?: GeminiCandidate[];
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
	error?: { code?: number; message?: string; status?: string };
}

/** Parse a Gemini SSE chunk into AgentEvents. */
function parseGeminiChunk(data: GeminiSSEData): AgentEvent[] {
	const events: AgentEvent[] = [];
	if (data.error) {
		events.push({ type: "error", error: new AgentErrorClass(data.error.message ?? "Unknown Gemini error", false) });
		return events;
	}

	const candidate = data.candidates?.[0];
	if (!candidate) {
		if (data.usageMetadata) {
			events.push({
				type: "usage_update",
				usage: {
					inputTokens: data.usageMetadata.promptTokenCount ?? 0,
					outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		}
		return events;
	}

	const parts = candidate.content?.parts ?? [];
	let hasFunctionCalls = false;
	for (const part of parts) {
		if (part.functionCall) {
			hasFunctionCalls = true;
			events.push({
				type: "tool_use",
				id: generateToolCallId(),
				name: part.functionCall.name,
				input: part.functionCall.args ?? {},
			});
		} else if (part.thought && part.text !== undefined) {
			events.push({ type: "thinking_delta", text: part.text });
		} else if (part.text !== undefined) {
			events.push({ type: "text_delta", text: part.text });
		}
	}

	if (data.usageMetadata) {
		events.push({
			type: "usage_update",
			usage: {
				inputTokens: data.usageMetadata.promptTokenCount ?? 0,
				outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
	}

	if (candidate.finishReason) {
		let stopReason: "end_turn" | "max_tokens" | "tool_use" | "stop_sequence";
		if (hasFunctionCalls || (candidate.finishReason === "STOP" && parts.some((p) => p.functionCall != null))) {
			stopReason = "tool_use";
		} else {
			switch (candidate.finishReason) {
				case "MAX_TOKENS":
					stopReason = "max_tokens";
					break;
				default:
					stopReason = "end_turn";
			}
		}
		events.push({ type: "done", stopReason });
	}

	return events;
}

/** Parse Gemini SSE stream into AgentEvents. */
export async function* parseGeminiSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(":")) continue;
				if (!trimmed.startsWith("data: ")) continue;

				const jsonStr = trimmed.slice(6);
				if (jsonStr.trim() === "[DONE]") continue;

				try {
					const data: GeminiSSEData = JSON.parse(jsonStr);
					for (const event of parseGeminiChunk(data)) yield event;
				} catch (err) {
					log.error("Failed to parse Gemini SSE data", {
						data: jsonStr,
						error: (err as Error).message,
					});
					yield {
						type: "error",
						error: new AgentErrorClass(`Gemini SSE parse error: ${(err as Error).message}`, false),
					};
				}
			}
		}

		if (buffer.trim().startsWith("data: ")) {
			const jsonStr = buffer.trim().slice(6);
			if (jsonStr.trim() !== "[DONE]") {
				try {
					const data: GeminiSSEData = JSON.parse(jsonStr);
					for (const event of parseGeminiChunk(data)) yield event;
				} catch (err) {
					log.error("Failed to parse remaining Gemini SSE data", {
						data: jsonStr,
						error: (err as Error).message,
					});
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
