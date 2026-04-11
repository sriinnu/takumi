import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_HOOK_POLICY,
	executeWithHookPolicy,
	type HookPolicyConfig,
	resolveHookPolicy,
} from "../src/hook-policy.js";

describe("resolveHookPolicy", () => {
	it("returns default policy when no overrides exist", () => {
		expect(resolveHookPolicy(DEFAULT_HOOK_POLICY, "session:start")).toBe("fail_open");
	});

	it("returns per-event override when present", () => {
		const config: HookPolicyConfig = {
			defaultPolicy: "fail_open",
			overrides: { "session:start": "fail_closed", "tool:run": "warn_only" },
		};
		expect(resolveHookPolicy(config, "session:start")).toBe("fail_closed");
		expect(resolveHookPolicy(config, "tool:run")).toBe("warn_only");
	});

	it("falls back to default policy for un-overridden event types", () => {
		const config: HookPolicyConfig = {
			defaultPolicy: "warn_only",
			overrides: { "session:start": "fail_closed" },
		};
		expect(resolveHookPolicy(config, "message:assistant")).toBe("warn_only");
	});
});

describe("executeWithHookPolicy", () => {
	it("returns ok: true and timing when the hook succeeds", async () => {
		const fn = vi.fn();
		const result = await executeWithHookPolicy("session:start", "fail_open", fn);
		expect(result.ok).toBe(true);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.warning).toBeUndefined();
		expect(fn).toHaveBeenCalledOnce();
	});

	describe("fail_open", () => {
		it("swallows the error and returns ok: false", async () => {
			const fn = vi.fn(() => {
				throw new Error("boom");
			});
			const result = await executeWithHookPolicy("session:start", "fail_open", fn);
			expect(result.ok).toBe(false);
			expect(result.warning).toBeUndefined();
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("warn_only", () => {
		it("returns a structured warning without re-throwing", async () => {
			const fn = vi.fn(() => {
				throw new Error("oops");
			});
			const result = await executeWithHookPolicy("tool:run", "warn_only", fn);
			expect(result.ok).toBe(false);
			expect(result.warning).toBeDefined();
			expect(result.warning!.eventType).toBe("tool:run");
			expect(result.warning!.error).toBe("oops");
			expect(result.warning!.policy).toBe("warn_only");
			expect(result.warning!.stack).toBeDefined();
			expect(result.warning!.durationMs).toBeGreaterThanOrEqual(0);
		});
	});

	describe("fail_closed", () => {
		it("re-throws the hook error", async () => {
			const fn = vi.fn(() => {
				throw new Error("critical");
			});
			await expect(executeWithHookPolicy("session:start", "fail_closed", fn)).rejects.toThrow("critical");
		});
	});

	it("handles async hook functions", async () => {
		const fn = vi.fn(async () => {
			await Promise.resolve();
		});
		const result = await executeWithHookPolicy("message:user", "fail_open", fn);
		expect(result.ok).toBe(true);
	});

	it("handles non-Error thrown values in fail_open", async () => {
		const fn = vi.fn(() => {
			throw "string-error"; // eslint-disable-line no-throw-literal
		});
		const result = await executeWithHookPolicy("session:start", "fail_open", fn);
		expect(result.ok).toBe(false);
	});

	it("handles non-Error thrown values in warn_only", async () => {
		const fn = vi.fn(() => {
			throw 42; // eslint-disable-line no-throw-literal
		});
		const result = await executeWithHookPolicy("session:start", "warn_only", fn);
		expect(result.ok).toBe(false);
		expect(result.warning!.error).toBe("42");
		expect(result.warning!.stack).toBeUndefined();
	});
});

describe("DEFAULT_HOOK_POLICY", () => {
	it("uses fail_open as default policy", () => {
		expect(DEFAULT_HOOK_POLICY.defaultPolicy).toBe("fail_open");
	});

	it("has no overrides", () => {
		expect(DEFAULT_HOOK_POLICY.overrides).toBeUndefined();
	});
});
