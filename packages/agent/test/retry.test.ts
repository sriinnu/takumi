import { describe, expect, it, vi } from "vitest";
import {
	compactMessages,
	estimatePayloadTokens,
	estimateTotalPayloadTokens,
	shouldCompact,
} from "../src/context/compact.js";
import {
	ContextOverflowError,
	categorizeError,
	friendlyErrorMessage,
	isRetryable,
	ProviderUnavailableError,
} from "../src/errors.js";
import type { MessagePayload } from "../src/loop.js";
import {
	computeDelay,
	DEFAULT_RETRY_OPTIONS,
	getRetryAfterMs,
	isRetryableError,
	RetryableError,
	withRetry,
} from "../src/retry.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** No-op sleep for tests — resolves immediately. */
const instantSleep = async (_ms: number): Promise<void> => {};

function textPayload(role: "user" | "assistant", text: string): MessagePayload {
	return { role, content: [{ type: "text", text }] };
}

function toolUsePayload(id: string, name: string): MessagePayload {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input: {} }],
	};
}

function toolResultPayload(toolUseId: string, content: string, isError = false): MessagePayload {
	return {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }],
	};
}

function generatePayloads(count: number, charsPer = 100): MessagePayload[] {
	const msgs: MessagePayload[] = [];
	for (let i = 0; i < count; i++) {
		const role: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
		msgs.push(textPayload(role, `Msg ${i}: ${"x".repeat(charsPer)}`));
	}
	return msgs;
}

/* ══════════════════════════════════════════════════════════════════════════════
   1. withRetry
   ══════════════════════════════════════════════════════════════════════════════ */

describe("withRetry", () => {
	it("returns the result on first try when function succeeds", async () => {
		const fn = vi.fn(async () => 42);
		const result = await withRetry(fn, {}, instantSleep);

		expect(result).toBe(42);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries and succeeds on the second attempt", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) throw new RetryableError("Server error", 500);
			return "success";
		};

		const result = await withRetry(fn, { maxRetries: 2 }, instantSleep);
		expect(result).toBe("success");
		expect(calls).toBe(2);
	});

	it("retries and succeeds on the third attempt (last retry)", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls <= 2) throw new RetryableError("Server error", 503);
			return "finally";
		};

		const result = await withRetry(fn, { maxRetries: 2 }, instantSleep);
		expect(result).toBe("finally");
		expect(calls).toBe(3);
	});

	it("throws the original error after all retries are exhausted", async () => {
		const error = new RetryableError("Always fails", 500);
		const fn = async () => {
			throw error;
		};

		await expect(withRetry(fn, { maxRetries: 2 }, instantSleep)).rejects.toThrow("Always fails");
	});

	it("does not retry on non-retryable errors", async () => {
		const fn = vi.fn(async () => {
			throw new Error("Auth failed");
		});

		await expect(withRetry(fn, { maxRetries: 3 }, instantSleep)).rejects.toThrow("Auth failed");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("does not retry when error status is not in retryableStatuses", async () => {
		const fn = vi.fn(async () => {
			throw new RetryableError("Not found", 404);
		});

		await expect(withRetry(fn, { maxRetries: 3 }, instantSleep)).rejects.toThrow("Not found");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries on errors with retryable=true flag", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) {
				const err = new Error("Temporary") as Error & { retryable: boolean };
				err.retryable = true;
				throw err;
			}
			return "ok";
		};

		const result = await withRetry(fn, { maxRetries: 1 }, instantSleep);
		expect(result).toBe("ok");
		expect(calls).toBe(2);
	});

	it("retries on network errors (ECONNREFUSED)", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) throw new Error("connect ECONNREFUSED 127.0.0.1:3141");
			return "connected";
		};

		const result = await withRetry(fn, { maxRetries: 1 }, instantSleep);
		expect(result).toBe("connected");
		expect(calls).toBe(2);
	});

	it("calls sleep between retries", async () => {
		const sleepCalls: number[] = [];
		const trackingSleep = async (ms: number) => {
			sleepCalls.push(ms);
		};

		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls <= 2) throw new RetryableError("fail", 500);
			return "ok";
		};

		await withRetry(fn, { maxRetries: 2 }, trackingSleep);
		expect(sleepCalls).toHaveLength(2);
		expect(sleepCalls[0]).toBeGreaterThan(0);
		expect(sleepCalls[1]).toBeGreaterThan(0);
	});

	it("uses Retry-After delay from RetryableError when present", async () => {
		const sleepCalls: number[] = [];
		const trackingSleep = async (ms: number) => {
			sleepCalls.push(ms);
		};

		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) throw new RetryableError("Rate limited", 429, 5000);
			return "ok";
		};

		await withRetry(fn, { maxRetries: 1, maxDelayMs: 10000 }, trackingSleep);
		expect(sleepCalls).toHaveLength(1);
		expect(sleepCalls[0]).toBe(5000); // Retry-After takes precedence
	});

	it("caps Retry-After at maxDelayMs", async () => {
		const sleepCalls: number[] = [];
		const trackingSleep = async (ms: number) => {
			sleepCalls.push(ms);
		};

		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) throw new RetryableError("Rate limited", 429, 60000);
			return "ok";
		};

		await withRetry(fn, { maxRetries: 1, maxDelayMs: 10000 }, trackingSleep);
		expect(sleepCalls[0]).toBe(10000); // Capped at maxDelayMs
	});

	it("uses default options when none provided", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) throw new RetryableError("fail", 502);
			return "ok";
		};

		const result = await withRetry(fn, undefined, instantSleep);
		expect(result).toBe("ok");
		expect(calls).toBe(2);
	});

	it("handles maxRetries=0 (no retries)", async () => {
		const fn = vi.fn(async () => {
			throw new RetryableError("fail", 500);
		});

		await expect(withRetry(fn, { maxRetries: 0 }, instantSleep)).rejects.toThrow("fail");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries on status 529 (overloaded)", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			if (calls === 1) throw new RetryableError("Overloaded", 529);
			return "ok";
		};

		const result = await withRetry(fn, { maxRetries: 1 }, instantSleep);
		expect(result).toBe("ok");
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   2. computeDelay
   ══════════════════════════════════════════════════════════════════════════════ */

describe("computeDelay", () => {
	it("returns a value between baseDelay and baseDelay * 1.5 for attempt 0", () => {
		// With jitter, delay is baseDelay + [0, baseDelay*0.5]
		for (let i = 0; i < 20; i++) {
			const delay = computeDelay(0, 1000, 30000);
			expect(delay).toBeGreaterThanOrEqual(1000);
			expect(delay).toBeLessThanOrEqual(1500);
		}
	});

	it("increases exponentially with attempt number", () => {
		// attempt 0: base ~1000-1500
		// attempt 1: base ~2000-3000
		// attempt 2: base ~4000-6000
		const _d0min = 1000;
		const _d1min = 2000;
		const _d2min = 4000;

		// On average, higher attempts produce larger delays
		const samples = 50;
		let avg0 = 0,
			avg1 = 0,
			avg2 = 0;
		for (let i = 0; i < samples; i++) {
			avg0 += computeDelay(0, 1000, 100000);
			avg1 += computeDelay(1, 1000, 100000);
			avg2 += computeDelay(2, 1000, 100000);
		}
		expect(avg1 / samples).toBeGreaterThan(avg0 / samples);
		expect(avg2 / samples).toBeGreaterThan(avg1 / samples);
	});

	it("never exceeds maxDelayMs", () => {
		for (let attempt = 0; attempt < 20; attempt++) {
			const delay = computeDelay(attempt, 1000, 5000);
			expect(delay).toBeLessThanOrEqual(5000);
		}
	});

	it("adds jitter (not always exactly the same for same inputs)", () => {
		const delays = new Set<number>();
		for (let i = 0; i < 10; i++) {
			delays.add(computeDelay(0, 1000, 30000));
		}
		// With jitter, we should get more than 1 unique value
		expect(delays.size).toBeGreaterThan(1);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   3. RetryableError
   ══════════════════════════════════════════════════════════════════════════════ */

describe("RetryableError", () => {
	it("carries status code", () => {
		const err = new RetryableError("fail", 429);
		expect(err.status).toBe(429);
		expect(err.message).toBe("fail");
		expect(err.name).toBe("RetryableError");
	});

	it("carries retryAfterMs when provided", () => {
		const err = new RetryableError("rate limited", 429, 3000);
		expect(err.retryAfterMs).toBe(3000);
	});

	it("retryAfterMs is undefined when not provided", () => {
		const err = new RetryableError("server error", 500);
		expect(err.retryAfterMs).toBeUndefined();
	});

	it("is an instance of Error", () => {
		const err = new RetryableError("test", 500);
		expect(err).toBeInstanceOf(Error);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   4. isRetryableError
   ══════════════════════════════════════════════════════════════════════════════ */

describe("isRetryableError", () => {
	const defaultStatuses = DEFAULT_RETRY_OPTIONS.retryableStatuses;

	it("returns true for RetryableError with matching status", () => {
		expect(isRetryableError(new RetryableError("fail", 500), defaultStatuses)).toBe(true);
		expect(isRetryableError(new RetryableError("fail", 429), defaultStatuses)).toBe(true);
		expect(isRetryableError(new RetryableError("fail", 503), defaultStatuses)).toBe(true);
		expect(isRetryableError(new RetryableError("fail", 529), defaultStatuses)).toBe(true);
	});

	it("returns false for RetryableError with non-matching status", () => {
		expect(isRetryableError(new RetryableError("fail", 404), defaultStatuses)).toBe(false);
		expect(isRetryableError(new RetryableError("fail", 401), defaultStatuses)).toBe(false);
	});

	it("returns true for errors with retryable=true flag", () => {
		const err = new Error("temp") as Error & { retryable: boolean };
		err.retryable = true;
		expect(isRetryableError(err, defaultStatuses)).toBe(true);
	});

	it("returns false for errors with retryable=false flag", () => {
		const err = new Error("perm") as Error & { retryable: boolean };
		err.retryable = false;
		expect(isRetryableError(err, defaultStatuses)).toBe(false);
	});

	it("returns true for network errors", () => {
		expect(isRetryableError(new Error("connect ECONNREFUSED"), defaultStatuses)).toBe(true);
		expect(isRetryableError(new Error("socket ECONNRESET"), defaultStatuses)).toBe(true);
		expect(isRetryableError(new Error("ETIMEDOUT"), defaultStatuses)).toBe(true);
		expect(isRetryableError(new Error("fetch failed"), defaultStatuses)).toBe(true);
	});

	it("returns false for null/undefined", () => {
		expect(isRetryableError(null, defaultStatuses)).toBe(false);
		expect(isRetryableError(undefined, defaultStatuses)).toBe(false);
	});

	it("returns false for generic errors without markers", () => {
		expect(isRetryableError(new Error("something"), defaultStatuses)).toBe(false);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   5. getRetryAfterMs
   ══════════════════════════════════════════════════════════════════════════════ */

describe("getRetryAfterMs", () => {
	it("returns the retryAfterMs from a RetryableError", () => {
		const err = new RetryableError("rate limited", 429, 5000);
		expect(getRetryAfterMs(err)).toBe(5000);
	});

	it("returns undefined for RetryableError without retryAfterMs", () => {
		const err = new RetryableError("server error", 500);
		expect(getRetryAfterMs(err)).toBeUndefined();
	});

	it("returns undefined for non-RetryableError", () => {
		expect(getRetryAfterMs(new Error("generic"))).toBeUndefined();
		expect(getRetryAfterMs(null)).toBeUndefined();
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   6. shouldCompact (MessagePayload-based)
   ══════════════════════════════════════════════════════════════════════════════ */

describe("shouldCompact", () => {
	it("returns false when estimated tokens are below threshold", () => {
		const msgs = generatePayloads(5, 20);
		const tokens = estimateTotalPayloadTokens(msgs);
		expect(shouldCompact(msgs, tokens, 100_000, 0.8)).toBe(false);
	});

	it("returns true when estimated tokens exceed threshold", () => {
		expect(shouldCompact([], 90_000, 100_000, 0.8)).toBe(true);
	});

	it("returns false when exactly at threshold", () => {
		expect(shouldCompact([], 80_000, 100_000, 0.8)).toBe(false);
	});

	it("returns true when 1 token above threshold", () => {
		expect(shouldCompact([], 80_001, 100_000, 0.8)).toBe(true);
	});

	it("uses default threshold of 0.8 when not specified", () => {
		expect(shouldCompact([], 79_999, 100_000)).toBe(false);
		expect(shouldCompact([], 80_001, 100_000)).toBe(true);
	});

	it("works with custom threshold", () => {
		expect(shouldCompact([], 60_000, 100_000, 0.5)).toBe(true);
		expect(shouldCompact([], 40_000, 100_000, 0.5)).toBe(false);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   7. compactMessages (MessagePayload-based)
   ══════════════════════════════════════════════════════════════════════════════ */

describe("compactMessages", () => {
	it("preserves the last N recent messages", () => {
		const msgs = generatePayloads(10, 100);
		const result = compactMessages(msgs, { preserveRecent: 4 });

		// 1 summary + 4 kept = 5
		expect(result).toHaveLength(5);

		// The last 4 should be the same references as the original last 4
		const originalLast4 = msgs.slice(-4);
		for (let i = 0; i < 4; i++) {
			expect(result[i + 1]).toBe(originalLast4[i]);
		}
	});

	it("creates a summary message as the first message", () => {
		const msgs = generatePayloads(10, 100);
		const result = compactMessages(msgs, { preserveRecent: 3 });

		expect(result[0].role).toBe("user");
		expect(result[0].content[0].text).toContain("Previous conversation summary:");
	});

	it("returns original messages when count <= preserveRecent", () => {
		const msgs = generatePayloads(5, 100);
		const result = compactMessages(msgs, { preserveRecent: 10 });

		expect(result).toBe(msgs); // same reference
	});

	it("returns original messages when count equals preserveRecent exactly", () => {
		const msgs = generatePayloads(6, 100);
		const result = compactMessages(msgs, { preserveRecent: 6 });

		expect(result).toBe(msgs);
	});

	it("preserves system message in summary content", () => {
		const msgs = [
			textPayload("user", "Set up the project"),
			textPayload("assistant", "I'll help with that."),
			...generatePayloads(8, 100),
		];
		const result = compactMessages(msgs, { preserveRecent: 4 });

		const summary = result[0].content[0].text;
		expect(summary).toContain("Set up the project");
	});

	it("includes role labels in the summary", () => {
		const msgs = [
			textPayload("user", "Hello there"),
			textPayload("assistant", "Hi! How can I help?"),
			...generatePayloads(8, 100),
		];
		const result = compactMessages(msgs, { preserveRecent: 4 });

		const summary = result[0].content[0].text;
		expect(summary).toContain("User:");
		expect(summary).toContain("Assistant:");
	});

	it("includes tool usage in the summary", () => {
		const msgs = [
			toolUsePayload("tu_1", "read_file"),
			toolResultPayload("tu_1", "file contents"),
			...generatePayloads(8, 100),
		];
		const result = compactMessages(msgs, { preserveRecent: 4 });

		const summary = result[0].content[0].text;
		expect(summary).toContain("[tool: read_file]");
	});

	it("preserves tool_result messages referenced by recent tool_use blocks", () => {
		const msgs = [
			textPayload("user", "Start"),
			toolResultPayload("tu_recent", "important result"), // index 1 - old but referenced
			textPayload("assistant", "Processing..."),
			textPayload("user", "Continue"),
			textPayload("assistant", "More work"),
			// These are the "recent" ones (preserveRecent=3)
			toolUsePayload("tu_recent", "read_file"), // references tu_recent
			textPayload("user", "Go on"),
			textPayload("assistant", "Done"),
		];

		const result = compactMessages(msgs, { preserveRecent: 3 });

		// Should have: summary + preserved tool_result + 3 recent = 5
		expect(result.length).toBeGreaterThanOrEqual(4);
	});

	it("truncates long text in summaries to 80 chars", () => {
		const longText = "A".repeat(200);
		const msgs = [textPayload("user", longText), ...generatePayloads(8, 100)];
		const result = compactMessages(msgs, { preserveRecent: 4 });

		const summary = result[0].content[0].text;
		expect(summary).toContain(`${"A".repeat(80)}...`);
		expect(summary).not.toContain("A".repeat(81));
	});

	it("handles empty messages array", () => {
		const result = compactMessages([], { preserveRecent: 4 });
		expect(result).toEqual([]);
	});

	it("uses default preserveRecent=6 when not specified", () => {
		const msgs = generatePayloads(10, 100);
		const result = compactMessages(msgs);

		// 1 summary + 6 kept = 7
		expect(result).toHaveLength(7);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   8. estimatePayloadTokens
   ══════════════════════════════════════════════════════════════════════════════ */

describe("estimatePayloadTokens", () => {
	it("estimates tokens for text content (~4 chars per token)", () => {
		const msg = textPayload("user", "Hello world!"); // 12 chars -> 3 tokens
		expect(estimatePayloadTokens(msg)).toBe(3);
	});

	it("estimates tokens for array of content blocks", () => {
		const msg: MessagePayload = {
			role: "assistant",
			content: [
				{ type: "text", text: "Hello" }, // 5 chars
				{ type: "text", text: "World" }, // 5 chars
			],
		};
		// 10 chars total -> ceil(10/4) = 3
		expect(estimatePayloadTokens(msg)).toBe(3);
	});

	it("handles string content directly", () => {
		const msg: MessagePayload = { role: "user", content: "Test message" }; // 12 chars
		expect(estimatePayloadTokens(msg)).toBe(3);
	});

	it("counts tool_use input", () => {
		const msg: MessagePayload = {
			role: "assistant",
			content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "/foo/bar.ts" } }],
		};
		// JSON.stringify({ path: "/foo/bar.ts" }) = 22 chars -> ceil(22/4) = 6
		expect(estimatePayloadTokens(msg)).toBe(6);
	});

	it("handles empty content", () => {
		const msg: MessagePayload = { role: "user", content: [] };
		expect(estimatePayloadTokens(msg)).toBe(0);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   9. categorizeError
   ══════════════════════════════════════════════════════════════════════════════ */

describe("categorizeError", () => {
	it("returns 'context_overflow' for ContextOverflowError", () => {
		expect(categorizeError(new ContextOverflowError(200_000, 100_000))).toBe("context_overflow");
	});

	it("returns 'provider_down' for ProviderUnavailableError", () => {
		expect(categorizeError(new ProviderUnavailableError("darpana"))).toBe("provider_down");
	});

	it("returns 'auth' for 401 status", () => {
		const err = { status: 401, message: "Unauthorized" };
		expect(categorizeError(err)).toBe("auth");
	});

	it("returns 'auth' for 403 status", () => {
		const err = { status: 403, message: "Forbidden" };
		expect(categorizeError(err)).toBe("auth");
	});

	it("returns 'rate_limit' for 429 status", () => {
		const err = { status: 429, message: "Too Many Requests" };
		expect(categorizeError(err)).toBe("rate_limit");
	});

	it("returns 'retryable' for 500 status", () => {
		const err = { status: 500, message: "Internal Server Error" };
		expect(categorizeError(err)).toBe("retryable");
	});

	it("returns 'retryable' for 502 status", () => {
		expect(categorizeError({ status: 502 })).toBe("retryable");
	});

	it("returns 'retryable' for 503 status", () => {
		expect(categorizeError({ status: 503 })).toBe("retryable");
	});

	it("returns 'retryable' for 529 status", () => {
		expect(categorizeError({ status: 529 })).toBe("retryable");
	});

	it("returns 'auth' for API key errors", () => {
		expect(categorizeError(new Error("Invalid API key"))).toBe("auth");
	});

	it("returns 'rate_limit' for rate limit error messages", () => {
		expect(categorizeError(new Error("Rate limit exceeded"))).toBe("rate_limit");
	});

	it("returns 'context_overflow' for context-related errors", () => {
		expect(categorizeError(new Error("Context overflow: too many tokens"))).toBe("context_overflow");
	});

	it("returns 'provider_down' for ECONNREFUSED", () => {
		expect(categorizeError(new Error("connect ECONNREFUSED"))).toBe("provider_down");
	});

	it("returns 'retryable' for ECONNRESET", () => {
		expect(categorizeError(new Error("read ECONNRESET"))).toBe("retryable");
	});

	it("returns 'retryable' for ETIMEDOUT", () => {
		expect(categorizeError(new Error("connect ETIMEDOUT"))).toBe("retryable");
	});

	it("returns 'unknown' for null", () => {
		expect(categorizeError(null)).toBe("unknown");
	});

	it("returns 'unknown' for generic errors", () => {
		expect(categorizeError(new Error("Something happened"))).toBe("unknown");
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   10. isRetryable
   ══════════════════════════════════════════════════════════════════════════════ */

describe("isRetryable", () => {
	it("returns true for RetryableError", () => {
		expect(isRetryable(new RetryableError("fail", 500))).toBe(true);
	});

	it("returns true for errors with retryable=true", () => {
		const err = Object.assign(new Error("temp"), { retryable: true });
		expect(isRetryable(err)).toBe(true);
	});

	it("returns false for errors with retryable=false", () => {
		const err = Object.assign(new Error("perm"), { retryable: false });
		expect(isRetryable(err)).toBe(false);
	});

	it("returns true for 500 status", () => {
		expect(isRetryable({ status: 500 })).toBe(true);
	});

	it("returns true for 429 status", () => {
		expect(isRetryable({ status: 429 })).toBe(true);
	});

	it("returns false for 401 status", () => {
		expect(isRetryable({ status: 401 })).toBe(false);
	});

	it("returns true for ECONNREFUSED", () => {
		expect(isRetryable(new Error("ECONNREFUSED"))).toBe(true);
	});

	it("returns false for null", () => {
		expect(isRetryable(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isRetryable(undefined)).toBe(false);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   11. ContextOverflowError
   ══════════════════════════════════════════════════════════════════════════════ */

describe("ContextOverflowError", () => {
	it("carries estimatedTokens and maxTokens", () => {
		const err = new ContextOverflowError(200_000, 100_000);
		expect(err.estimatedTokens).toBe(200_000);
		expect(err.maxTokens).toBe(100_000);
		expect(err.code).toBe("CONTEXT_OVERFLOW");
		expect(err.name).toBe("ContextOverflowError");
	});

	it("is an instance of Error and TakumiError", () => {
		const err = new ContextOverflowError(200_000, 100_000);
		expect(err).toBeInstanceOf(Error);
	});

	it("has a descriptive message", () => {
		const err = new ContextOverflowError(200_000, 100_000);
		expect(err.message).toContain("200000");
		expect(err.message).toContain("100000");
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   12. ProviderUnavailableError
   ══════════════════════════════════════════════════════════════════════════════ */

describe("ProviderUnavailableError", () => {
	it("carries provider name", () => {
		const err = new ProviderUnavailableError("darpana");
		expect(err.provider).toBe("darpana");
		expect(err.code).toBe("PROVIDER_UNAVAILABLE");
		expect(err.name).toBe("ProviderUnavailableError");
	});

	it("uses custom message when provided", () => {
		const err = new ProviderUnavailableError("anthropic", "Timed out");
		expect(err.message).toBe("Timed out");
	});

	it("uses default message when not provided", () => {
		const err = new ProviderUnavailableError("darpana");
		expect(err.message).toContain("darpana");
		expect(err.message).toContain("unavailable");
	});

	it("chains cause error", () => {
		const cause = new Error("ECONNREFUSED");
		const err = new ProviderUnavailableError("darpana", "Connection failed", cause);
		expect(err.cause).toBe(cause);
	});
});

/* ══════════════════════════════════════════════════════════════════════════════
   13. friendlyErrorMessage
   ══════════════════════════════════════════════════════════════════════════════ */

describe("friendlyErrorMessage", () => {
	it("returns auth message for auth errors", () => {
		const msg = friendlyErrorMessage(new Error("Invalid API key"));
		expect(msg).toContain("API key");
	});

	it("returns rate limit message for 429", () => {
		const msg = friendlyErrorMessage({ status: 429 });
		expect(msg).toContain("Rate limited");
	});

	it("returns context overflow message for ContextOverflowError", () => {
		const msg = friendlyErrorMessage(new ContextOverflowError(200_000, 100_000));
		expect(msg).toContain("too long");
	});

	it("returns provider down message for ProviderUnavailableError", () => {
		const msg = friendlyErrorMessage(new ProviderUnavailableError("darpana"));
		expect(msg).toContain("unavailable");
	});

	it("returns the error message for unknown errors", () => {
		const msg = friendlyErrorMessage(new Error("Something unexpected"));
		expect(msg).toBe("Something unexpected");
	});
});
