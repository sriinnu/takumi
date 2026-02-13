/**
 * FailoverProvider — wraps multiple providers and auto-switches on failure.
 *
 * Tries providers in priority order (lower number = higher priority).
 * If a provider fails with a retryable/unavailable error, increments its
 * failure count and tries the next available provider. After enough failures,
 * a provider is marked unavailable until its cooldown period expires.
 *
 * Non-retryable errors (auth failures, bad requests) are never failed over —
 * those are user mistakes that need to be fixed.
 *
 * Mid-stream failures (after the first event has been yielded) do NOT trigger
 * failover, since partial responses have already been sent to the user.
 */

import type { AgentEvent } from "@takumi/core";
import { AgentErrorClass, createLogger } from "@takumi/core";
import type { MessagePayload } from "../loop.js";
import { RetryableError } from "../retry.js";
import { ProviderUnavailableError, categorizeError } from "../errors.js";

const log = createLogger("failover-provider");

// ── Types ─────────────────────────────────────────────────────────────────────

/** A provider instance that can send messages. */
export interface ProviderLike {
	sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: any[],
		signal?: AbortSignal,
	): AsyncGenerator<AgentEvent> | AsyncIterable<AgentEvent>;
}

/** Status tracking for a single provider. */
export interface ProviderStatus {
	failures: number;
	lastFailure: number;
	available: boolean;
}

/** Configuration for a provider entry in the failover chain. */
export interface FailoverEntry {
	name: string;
	provider: ProviderLike;
	priority: number; // lower = tried first
}

/** Configuration for the FailoverProvider. */
export interface FailoverProviderConfig {
	providers: FailoverEntry[];
	maxFailuresBeforeSwitch?: number; // default: 2
	cooldownMs?: number; // default: 60000 (1 min)
	onSwitch?: (from: string, to: string, reason: string) => void;
}

// ── Non-retryable error detection ─────────────────────────────────────────────

/**
 * Determine if an error is a non-retryable user mistake (auth, bad request)
 * that should NOT trigger failover.
 */
function isNonRetryableUserError(error: unknown): boolean {
	const category = categorizeError(error);
	if (category === "auth") return true;

	// Check for 400-class client errors (except 429 which is rate limiting)
	if (typeof error === "object" && error !== null && "status" in error) {
		const status = (error as { status: number }).status;
		if (status >= 400 && status < 500 && status !== 429) return true;
	}

	// AgentErrorClass with retryable=false and no status (bad request, missing key)
	if (error instanceof AgentErrorClass && !error.retryable) return true;

	return false;
}

/**
 * Determine if an error should trigger failover to the next provider.
 */
function shouldFailover(error: unknown): boolean {
	// Never fail over on user mistakes
	if (isNonRetryableUserError(error)) return false;

	// Fail over on provider unavailable
	if (error instanceof ProviderUnavailableError) return true;

	// Fail over on retryable errors (these have already been retried by the retry layer)
	if (error instanceof RetryableError) return true;

	// Fail over on categorized retryable/provider_down/rate_limit errors
	const category = categorizeError(error);
	if (category === "retryable" || category === "provider_down" || category === "rate_limit") return true;

	return false;
}

// ── FailoverProvider ──────────────────────────────────────────────────────────

export class FailoverProvider {
	private entries: FailoverEntry[];
	private maxFailures: number;
	private cooldownMs: number;
	private switchCallback?: (from: string, to: string, reason: string) => void;
	private statusMap: Map<string, ProviderStatus>;
	private currentProviderName: string;

	/** Inject a custom clock for testing (returns epoch ms). */
	public _now: () => number = Date.now;

	constructor(config: FailoverProviderConfig) {
		if (!config.providers || config.providers.length === 0) {
			throw new Error("FailoverProvider requires at least one provider");
		}

		// Sort by priority (lower = higher priority)
		this.entries = [...config.providers].sort((a, b) => a.priority - b.priority);
		this.maxFailures = config.maxFailuresBeforeSwitch ?? 2;
		this.cooldownMs = config.cooldownMs ?? 60_000;
		this.switchCallback = config.onSwitch;

		// Initialize status for each provider
		this.statusMap = new Map();
		for (const entry of this.entries) {
			this.statusMap.set(entry.name, {
				failures: 0,
				lastFailure: 0,
				available: true,
			});
		}

		this.currentProviderName = this.entries[0].name;
	}

	/** Get the name of the currently active provider. */
	get activeProvider(): string {
		return this.currentProviderName;
	}

	/** Get a snapshot of provider health status. */
	get providerStatus(): Map<string, ProviderStatus> {
		// Return a copy with updated availability based on cooldown
		const now = this._now();
		const result = new Map<string, ProviderStatus>();

		for (const [name, status] of this.statusMap) {
			const cooledDown =
				!status.available && status.lastFailure > 0 && now - status.lastFailure >= this.cooldownMs;

			result.set(name, {
				failures: status.failures,
				lastFailure: status.lastFailure,
				available: status.available || cooledDown,
			});
		}

		return result;
	}

	/** Reset failure counts for a specific provider or all providers. */
	resetFailures(providerName?: string): void {
		if (providerName) {
			const status = this.statusMap.get(providerName);
			if (status) {
				status.failures = 0;
				status.lastFailure = 0;
				status.available = true;
			}
		} else {
			for (const status of this.statusMap.values()) {
				status.failures = 0;
				status.lastFailure = 0;
				status.available = true;
			}
		}
	}

	/**
	 * Get available providers sorted by priority.
	 * Providers that have cooled down are re-enabled.
	 */
	private getAvailableProviders(): FailoverEntry[] {
		const now = this._now();
		const available: FailoverEntry[] = [];

		for (const entry of this.entries) {
			const status = this.statusMap.get(entry.name)!;

			// Check if cooled down
			if (!status.available && status.lastFailure > 0 && now - status.lastFailure >= this.cooldownMs) {
				log.info(`Provider "${entry.name}" cooldown expired, re-enabling`);
				status.available = true;
				status.failures = 0;
				status.lastFailure = 0;
			}

			if (status.available) {
				available.push(entry);
			}
		}

		return available;
	}

	/**
	 * Record a failure for a provider.
	 * If failures exceed the threshold, mark it unavailable.
	 */
	private recordFailure(name: string, reason: string): void {
		const status = this.statusMap.get(name);
		if (!status) return;

		status.failures++;
		status.lastFailure = this._now();

		log.warn(`Provider "${name}" failure #${status.failures}: ${reason}`);

		if (status.failures >= this.maxFailures) {
			status.available = false;
			log.warn(`Provider "${name}" marked unavailable after ${status.failures} failures`);
		}
	}

	/**
	 * Send messages through the failover chain.
	 *
	 * Tries providers in priority order. On failure, records the failure
	 * and tries the next available provider. If all providers fail, throws
	 * the last error.
	 */
	async *sendMessage(
		messages: MessagePayload[],
		system: string,
		tools?: any[],
		signal?: AbortSignal,
	): AsyncGenerator<AgentEvent> {
		const available = this.getAvailableProviders();

		if (available.length === 0) {
			throw new ProviderUnavailableError(
				"failover",
				"All providers are unavailable. Use resetFailures() or wait for cooldown.",
			);
		}

		let lastError: unknown;

		for (let i = 0; i < available.length; i++) {
			const entry = available[i];
			const previousProvider = this.currentProviderName;
			this.currentProviderName = entry.name;

			// Notify on switch (skip the first attempt — that's not a switch)
			if (i > 0 && this.switchCallback) {
				const reason =
					lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
				this.switchCallback(previousProvider, entry.name, reason);
			}

			let hasYielded = false;

			try {
				log.info(`Trying provider "${entry.name}"`);

				const stream = entry.provider.sendMessage(messages, system, tools, signal);

				for await (const event of stream) {
					hasYielded = true;
					yield event;
				}
				// Success — reset failure count for this provider
				const status = this.statusMap.get(entry.name);
				if (status && status.failures > 0) {
					status.failures = 0;
				}
				return; // Stream completed successfully
			} catch (error) {
				// Mid-stream failure: don't failover, we already sent partial data
				if (hasYielded) {
					log.error(
						`Mid-stream failure on provider "${entry.name}", not failing over (partial data sent)`,
					);
					throw error;
				}

				lastError = error;

				// Non-retryable errors: don't fail over, propagate immediately
				if (isNonRetryableUserError(error)) {
					log.error(`Non-retryable error on provider "${entry.name}", not failing over`);
					throw error;
				}

				// Check if this error is failover-worthy
				if (!shouldFailover(error)) {
					throw error;
				}

				// Record failure and potentially mark unavailable
				const reason = error instanceof Error ? error.message : String(error);
				this.recordFailure(entry.name, reason);

				// If there are more providers to try, continue the loop
				if (i < available.length - 1) {
					log.info(`Failing over from "${entry.name}" to next available provider`);
					continue;
				}

				// Last provider also failed — throw
				log.error("All available providers failed");
			}
		}

		// All providers exhausted
		throw lastError;
	}
}
