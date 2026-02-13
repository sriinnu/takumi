/**
 * Agent-specific error types and error categorization.
 *
 * These extend the base TakumiError hierarchy and add context-specific
 * error classes for retry logic, context overflow, and provider failures.
 */

import { TakumiError, AgentErrorClass } from "@takumi/core";
import { RetryableError } from "./retry.js";

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * Thrown when the conversation context exceeds the model's context window.
 */
export class ContextOverflowError extends TakumiError {
	readonly estimatedTokens: number;
	readonly maxTokens: number;

	constructor(estimatedTokens: number, maxTokens: number) {
		super(
			`Context overflow: estimated ${estimatedTokens} tokens exceeds limit of ${maxTokens}`,
			"CONTEXT_OVERFLOW",
		);
		this.name = "ContextOverflowError";
		this.estimatedTokens = estimatedTokens;
		this.maxTokens = maxTokens;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/**
 * Thrown when a provider is unreachable or returns unexpected responses.
 */
export class ProviderUnavailableError extends TakumiError {
	readonly provider: string;

	constructor(provider: string, message?: string, cause?: Error) {
		super(
			message ?? `Provider "${provider}" is unavailable`,
			"PROVIDER_UNAVAILABLE",
			cause,
		);
		this.name = "ProviderUnavailableError";
		this.provider = provider;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

// ── Error categorization ──────────────────────────────────────────────────────

export type ErrorCategory =
	| "retryable"
	| "context_overflow"
	| "auth"
	| "rate_limit"
	| "provider_down"
	| "unknown";

/**
 * Check whether an error is retryable based on its type and properties.
 */
export function isRetryable(error: unknown): boolean {
	if (error == null) return false;

	// Explicit RetryableError
	if (error instanceof RetryableError) return true;

	// AgentErrorClass with retryable flag
	if (error instanceof AgentErrorClass && error.retryable) return true;

	// Check for retryable status codes
	if (typeof error === "object" && "status" in error) {
		const status = (error as { status: number }).status;
		return [429, 500, 502, 503, 529].includes(status);
	}

	// Check retryable flag on any error object
	if (typeof error === "object" && "retryable" in error) {
		return (error as { retryable: boolean }).retryable === true;
	}

	// Network-level errors are retryable
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (
			msg.includes("econnrefused") ||
			msg.includes("econnreset") ||
			msg.includes("etimedout") ||
			msg.includes("fetch failed") ||
			msg.includes("connection error")
		) {
			return true;
		}
	}

	return false;
}

/**
 * Categorize an error for user-friendly messaging and retry decisions.
 */
export function categorizeError(error: unknown): ErrorCategory {
	if (error == null) return "unknown";

	// Context overflow
	if (error instanceof ContextOverflowError) return "context_overflow";

	// Provider unavailable
	if (error instanceof ProviderUnavailableError) return "provider_down";

	// Check for status codes
	if (typeof error === "object" && "status" in error) {
		const status = (error as { status: number }).status;

		// Auth errors
		if (status === 401 || status === 403) return "auth";

		// Rate limiting
		if (status === 429) return "rate_limit";

		// Server errors are retryable
		if (status >= 500 || status === 529) return "retryable";
	}

	// Check error message patterns
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();

		// Auth patterns
		if (
			msg.includes("api key") ||
			msg.includes("unauthorized") ||
			msg.includes("forbidden") ||
			msg.includes("authentication")
		) {
			return "auth";
		}

		// Rate limit patterns
		if (msg.includes("rate limit") || msg.includes("too many requests")) {
			return "rate_limit";
		}

		// Context overflow patterns
		if (
			msg.includes("context") &&
			(msg.includes("overflow") || msg.includes("too long") || msg.includes("exceeded"))
		) {
			return "context_overflow";
		}

		// Provider down patterns
		if (
			msg.includes("econnrefused") ||
			msg.includes("unavailable") ||
			msg.includes("provider")
		) {
			return "provider_down";
		}

		// Network / connection errors are retryable
		if (
			msg.includes("econnreset") ||
			msg.includes("etimedout") ||
			msg.includes("fetch failed") ||
			msg.includes("connection error")
		) {
			return "retryable";
		}
	}

	// Check retryable flag
	if (typeof error === "object" && "retryable" in error) {
		if ((error as { retryable: boolean }).retryable) return "retryable";
	}

	return "unknown";
}

/**
 * Generate a user-friendly error message based on the error category.
 */
export function friendlyErrorMessage(error: unknown): string {
	const category = categorizeError(error);

	switch (category) {
		case "auth":
			return "Authentication failed. Please check your API key configuration.";
		case "rate_limit":
			return "Rate limited by the API. Please wait a moment and try again.";
		case "context_overflow":
			return "Conversation is too long. Try starting a new conversation or using /compact.";
		case "provider_down":
			return "The AI provider is currently unavailable. Please try again later.";
		case "retryable":
			return "A temporary error occurred. Retrying...";
		default:
			return error instanceof Error
				? error.message
				: "An unexpected error occurred.";
	}
}
