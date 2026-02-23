/**
 * Retry logic — wraps async functions with exponential backoff and jitter.
 * Retries only on transient HTTP errors (429, 500, 502, 503, 529).
 */

import { createLogger } from "@takumi/core";

const log = createLogger("retry");

export interface RetryOptions {
	/** Maximum number of retry attempts (default: 2). */
	maxRetries: number;

	/** Base delay in milliseconds for exponential backoff (default: 1000). */
	baseDelayMs: number;

	/** Maximum delay in milliseconds (default: 10000). */
	maxDelayMs: number;

	/** HTTP status codes that are retryable (default: [429, 500, 502, 503, 529]). */
	retryableStatuses: number[];
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
	maxRetries: 2,
	baseDelayMs: 1000,
	maxDelayMs: 10000,
	retryableStatuses: [429, 500, 502, 503, 529],
};

/**
 * Compute the delay for a retry attempt using exponential backoff with jitter.
 *
 * delay = min(baseDelayMs * 2^attempt + random jitter, maxDelayMs)
 */
export function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
	const exponentialDelay = baseDelayMs * 2 ** attempt;
	// Add jitter: 0-50% of the exponential delay
	const jitter = Math.random() * exponentialDelay * 0.5;
	const delay = exponentialDelay + jitter;
	return Math.min(delay, maxDelayMs);
}

/**
 * Check whether an error represents a retryable condition.
 * Looks at status codes, retryable flags, and network error patterns.
 */
export function isRetryableError(error: unknown, retryableStatuses: number[]): boolean {
	if (error == null) return false;

	// Check for RetryableError with explicit status
	if (error instanceof RetryableError) {
		return retryableStatuses.includes(error.status);
	}

	// Check for any error with a status property
	if (typeof error === "object" && "status" in error) {
		const status = (error as { status: number }).status;
		return retryableStatuses.includes(status);
	}

	// Check for errors with a retryable flag (like AgentError)
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
			msg.includes("network") ||
			msg.includes("connection error")
		) {
			return true;
		}
	}

	return false;
}

/**
 * Extract the Retry-After delay from a RetryableError, if present.
 * Returns the delay in milliseconds, or undefined if not set.
 */
export function getRetryAfterMs(error: unknown): number | undefined {
	if (error instanceof RetryableError && error.retryAfterMs !== undefined) {
		return error.retryAfterMs;
	}
	return undefined;
}

/**
 * Execute a function with automatic retry on transient failures.
 *
 * Uses exponential backoff with jitter. Respects Retry-After headers
 * when available via RetryableError. Throws the original error after
 * all retries are exhausted.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options?: Partial<RetryOptions>,
	/** Optional sleep function for testing. */
	sleepFn?: (ms: number) => Promise<void>,
): Promise<T> {
	const opts: RetryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
	const sleep = sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

	let lastError: unknown;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// If this was the last attempt, throw immediately
			if (attempt >= opts.maxRetries) {
				break;
			}

			// If the error is not retryable, throw immediately
			if (!isRetryableError(error, opts.retryableStatuses)) {
				throw error;
			}

			// Compute delay — prefer Retry-After if available
			const retryAfter = getRetryAfterMs(error);
			const computedDelay = computeDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
			const delay = retryAfter !== undefined ? Math.min(retryAfter, opts.maxDelayMs) : computedDelay;

			log.warn(`Retry attempt ${attempt + 1}/${opts.maxRetries} after ${Math.round(delay)}ms`, {
				error: error instanceof Error ? error.message : String(error),
				attempt: attempt + 1,
				maxRetries: opts.maxRetries,
				delayMs: Math.round(delay),
			});

			await sleep(delay);
		}
	}

	throw lastError;
}

/**
 * An error that carries HTTP status information for retry logic.
 * Providers should throw this (or set status on their errors) to enable
 * smart retry behavior.
 */
export class RetryableError extends Error {
	readonly status: number;
	readonly retryAfterMs?: number;

	constructor(message: string, status: number, retryAfterMs?: number) {
		super(message);
		this.name = "RetryableError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
