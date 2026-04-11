import { describe, expect, it } from "vitest";
import {
	buildDegradedExecutionSummary,
	buildRouteDegradedSource,
	buildSyncFailureSource,
	recordRouteDegradedExecution,
	summarizeDegradedExecutionContext,
	upsertDegradedExecutionSource,
} from "../src/degraded-execution-context.js";
import { AppState } from "../src/state.js";

describe("degraded execution context", () => {
	it("merges repeated degraded sources without losing the first detection time", () => {
		const first = buildRouteDegradedSource(
			{
				request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
				selected: { id: "lane-main", providerFamily: "anthropic" } as never,
				reason: "Initial degraded route",
				fallbackChain: ["lane-fallback"],
				policyTrace: [],
				degraded: true,
			} as never,
			1000,
		);
		const second = buildRouteDegradedSource(
			{
				request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
				selected: { id: "lane-main", providerFamily: "anthropic" } as never,
				reason: "Later degraded route",
				fallbackChain: ["lane-second"],
				policyTrace: [],
				degraded: true,
			} as never,
			2000,
		);

		const merged = upsertDegradedExecutionSource(upsertDegradedExecutionSource(null, first), second);

		expect(merged.firstDetectedAt).toBe(1000);
		expect(merged.lastUpdatedAt).toBe(2000);
		expect(merged.sources[0]).toMatchObject({
			kind: "route_degraded",
			reason: "Later degraded route",
			firstDetectedAt: 1000,
			lastDetectedAt: 2000,
			fallbackChain: ["lane-fallback", "lane-second"],
		});
	});

	it("builds one summary across route and replay degradation", () => {
		const summary = buildDegradedExecutionSummary({
			firstDetectedAt: 1000,
			lastUpdatedAt: 3000,
			sources: [
				buildRouteDegradedSource(
					{
						request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
						selected: { id: "lane-main", providerFamily: "anthropic" } as never,
						reason: "Primary lane degraded",
						fallbackChain: ["lane-fallback"],
						policyTrace: [],
						degraded: true,
					} as never,
					1000,
				),
				buildSyncFailureSource(
					{
						status: "failed",
						lastError: "bridge unavailable during replay",
						lastFailedMessageId: "user-2",
					},
					1,
					3000,
				),
			],
		});

		expect(summary.summary).toContain("route degraded and replay failed");
		expect(summary.route?.fallbackChain).toEqual(["lane-fallback"]);
		expect(summary.sync?.lastFailedMessageId).toBe("user-2");
	});

	it("keeps degraded execution visible after the latest route has recovered", () => {
		const state = new AppState();
		recordRouteDegradedExecution(
			state,
			{
				request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
				selected: { id: "lane-main", providerFamily: "anthropic" } as never,
				reason: "Primary lane degraded",
				fallbackChain: ["lane-fallback"],
				policyTrace: [],
				degraded: true,
			} as never,
			1000,
		);
		state.routingDecisions.value = [
			{
				request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
				selected: { id: "lane-main", providerFamily: "anthropic" } as never,
				reason: "Primary lane recovered",
				fallbackChain: [],
				policyTrace: [],
				degraded: false,
			} as never,
		];

		const summary = summarizeDegradedExecutionContext(state, 2000);

		expect(summary).toMatchObject({
			active: true,
			route: { reason: "Primary lane degraded" },
		});
	});
});
