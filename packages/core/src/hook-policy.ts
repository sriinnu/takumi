import { createLogger } from "./logger.js";

const log = createLogger("hook-policy");

/**
 * How a hook failure affects the calling runtime path.
 *
 * - `fail_open`:   log + continue (current default behavior)
 * - `warn_only`:   emit a structured warning + continue
 * - `fail_closed`: re-throw — the hook failure aborts the caller
 */
export type HookFailurePolicy = "fail_open" | "warn_only" | "fail_closed";

/** Per-event-type policy overrides. Unspecified events fall back to `defaultPolicy`. */
export interface HookPolicyConfig {
	/** Default for any event type not explicitly overridden. */
	defaultPolicy: HookFailurePolicy;
	/** Optional per-event overrides. */
	overrides?: Partial<Record<string, HookFailurePolicy>>;
}

/** Structured warning emitted when policy is `warn_only`. */
export interface HookWarning {
	eventType: string;
	error: string;
	stack?: string;
	policy: HookFailurePolicy;
	/** Milliseconds the hook ran before failing. */
	durationMs?: number;
}

/** Result of executing a hook under policy governance. */
export interface HookPolicyResult {
	/** Whether the hook ran successfully. */
	ok: boolean;
	/** Warning emitted when policy is `warn_only`. */
	warning?: HookWarning;
	/** Duration in milliseconds. */
	durationMs: number;
}

/** The canonical fail-open config Takumi uses by default. */
export const DEFAULT_HOOK_POLICY: HookPolicyConfig = {
	defaultPolicy: "fail_open",
};

/** Resolve the effective policy for a given event type. */
export function resolveHookPolicy(config: HookPolicyConfig, eventType: string): HookFailurePolicy {
	return config.overrides?.[eventType] ?? config.defaultPolicy;
}

/**
 * Execute a hook callback under the governance of a failure policy.
 *
 * - `fail_open`:   swallow the error, log it, return `{ ok: false }`
 * - `warn_only`:   swallow the error, return a structured `HookWarning`
 * - `fail_closed`: re-throw the error — caller is responsible for catching
 */
export async function executeWithHookPolicy(
	eventType: string,
	policy: HookFailurePolicy,
	fn: () => Promise<void> | void,
): Promise<HookPolicyResult> {
	const start = performance.now();
	try {
		await fn();
		return { ok: true, durationMs: performance.now() - start };
	} catch (err) {
		const durationMs = performance.now() - start;
		const message = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error ? err.stack : undefined;

		if (policy === "fail_closed") {
			log.error(`Hook [${eventType}] failed (fail_closed) after ${durationMs.toFixed(1)}ms: ${message}`);
			throw err;
		}

		if (policy === "warn_only") {
			const warning: HookWarning = { eventType, error: message, stack, policy, durationMs };
			log.warn(`Hook [${eventType}] warning after ${durationMs.toFixed(1)}ms: ${message}`);
			return { ok: false, warning, durationMs };
		}

		// fail_open — silent swallow with debug logging
		log.debug(`Hook [${eventType}] failed (fail_open) after ${durationMs.toFixed(1)}ms: ${message}`);
		return { ok: false, durationMs };
	}
}
