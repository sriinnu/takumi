/**
 * Telemetry v2 helpers for context pressure calculation and token estimation.
 * Phase 20.1: Schema Alignment
 */

import type { TelemetryContext } from "@takumi/bridge";
import { TELEMETRY_CLOSE_PERCENT, TELEMETRY_NEAR_PERCENT } from "@takumi/core";

/**
 * Message type for token estimation.
 * Mirrors the structure used in agent loop.
 */
interface Message {
	role: string;
	content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

/**
 * Calculate context pressure based on token usage.
 * Returns pressure level ("normal" | "approaching_limit" | "near_limit" | "at_limit").
 *
 * @param messages - Array of conversation messages
 * @param contextWindow - Model's context window size in tokens
 * @returns TelemetryContext object with pressure metrics
 */
export function calculateContextPressure(messages: Message[], contextWindow: number): TelemetryContext {
	const tokens = estimateMessagesTokens(messages);
	return calculateContextPressureFromTokens(tokens, contextWindow);
}

/**
 * Calculate context pressure from an exact or provider-reported token count.
 */
export function calculateContextPressureFromTokens(tokens: number, contextWindow: number): TelemetryContext {
	const remainingTokens = Math.max(0, contextWindow - tokens);
	const percent = (tokens / contextWindow) * 100;

	let pressure: TelemetryContext["pressure"];
	if (percent >= 100) pressure = "at_limit";
	else if (percent >= TELEMETRY_NEAR_PERCENT) pressure = "near_limit";
	else if (percent >= TELEMETRY_CLOSE_PERCENT) pressure = "approaching_limit";
	else pressure = "normal";

	return {
		tokens,
		contextWindow,
		remainingTokens,
		percent,
		pressure,
		closeToLimit: percent >= TELEMETRY_CLOSE_PERCENT,
		nearLimit: percent >= TELEMETRY_NEAR_PERCENT,
	};
}

/**
 * Estimate token count for a list of messages.
 * Uses rough heuristic: 4 characters per token.
 *
 * This is intentionally simple for performance. Real tokenization
 * would require model-specific tokenizers.
 *
 * @param messages - Array of conversation messages
 * @returns Estimated token count
 */
export function estimateMessagesTokens(messages: Message[]): number {
	const totalChars = messages.reduce((sum, msg) => {
		if (typeof msg.content === "string") return sum + msg.content.length;
		if (Array.isArray(msg.content)) {
			return (
				sum +
				msg.content.reduce((innerSum, part) => {
					if (part.type === "text" && part.text) return innerSum + part.text.length;
					return innerSum;
				}, 0)
			);
		}
		return sum;
	}, 0);

	return Math.ceil(totalChars / 4);
}

/**
 * Convert markdown content to safe HTML for telemetry display.
 * Basic escaping + line break conversion for now.
 * TODO: Use proper markdown library when needed.
 *
 * @param content - Markdown text content
 * @returns HTML-safe string
 */
export function renderLastAssistantHtml(content: string): string {
	return content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}
