import { AgentRole } from "@takumi/agent";
import type { ChitraguptaObserver, RoutingDecision } from "@takumi/bridge";
import { describe, expect, it, vi } from "vitest";
import { resolveRoutingOverrides } from "../src/agent/coding-agent-routing.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "s1",
			capability: "coding.patch-and-validate",
		},
		selected: {
			id: "llm.anthropic.sonnet",
			kind: "llm",
			label: "Anthropic Sonnet",
			capabilities: ["coding.patch-and-validate"],
			costClass: "medium",
			trust: "cloud",
			health: "healthy",
			providerFamily: "anthropic",
			invocation: {
				id: "anthropic-api",
				transport: "http",
				entrypoint: "https://api.anthropic.com",
				requestShape: "chat.completions",
				responseShape: "stream",
				timeoutMs: 30_000,
				streaming: true,
			},
			tags: ["chat"],
			metadata: { model: "claude-sonnet-4-5" },
		},
		reason: "Selected llm.anthropic.sonnet",
		fallbackChain: [],
		policyTrace: ["selected:llm.anthropic.sonnet"],
		degraded: false,
		...overrides,
	};
}

describe("resolveRoutingOverrides", () => {
	it("returns empty overrides when no observer is available", async () => {
		const result = await resolveRoutingOverrides({
			observer: null,
			sessionId: "s1",
			currentModel: "claude-sonnet-4-5",
		});
		expect(result).toEqual({ overrides: {}, laneEnvelopes: {}, decisions: [], notes: [] });
	});

	it("applies same-provider engine-selected models to matching roles", async () => {
		const routeEvents: Array<Record<string, unknown>> = [];
		const observer = {
			routeResolve: vi
				.fn()
				.mockResolvedValueOnce(
					makeDecision({
						request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
						selected: {
							...makeDecision().selected!,
							capabilities: ["coding.patch-cheap"],
						},
					}),
				)
				.mockResolvedValueOnce(
					makeDecision({
						request: { consumer: "takumi", sessionId: "s1", capability: "coding.review.strict" },
						selected: {
							...makeDecision().selected!,
							id: "llm.anthropic.haiku",
							capabilities: ["coding.review.strict"],
							metadata: { model: "claude-haiku-4-20250514" },
						},
					}),
				),
		} as unknown as ChitraguptaObserver;

		const result = await resolveRoutingOverrides({
			observer,
			sessionId: "s1",
			currentModel: "claude-sonnet-4-20250514",
			emitRouteEvent: (event) => {
				routeEvents.push(event as Record<string, unknown>);
			},
		});

		expect((observer.routeResolve as ReturnType<typeof vi.fn>).mock.calls[0][0].constraints).toMatchObject({
			preferLocal: true,
			requireStreaming: true,
			preferredCapabilityIds: ["cli.codex"],
		});
		expect((observer.routeResolve as ReturnType<typeof vi.fn>).mock.calls[1][0].constraints).toMatchObject({
			requireStreaming: true,
			preferredCapabilityIds: ["cli.codex"],
		});
		expect(result.overrides[AgentRole.WORKER]).toBe("claude-sonnet-4-5");
		expect(result.overrides[AgentRole.PLANNER]).toBe("claude-haiku-4-20250514");
		expect(result.overrides[AgentRole.VALIDATOR_CODE]).toBe("claude-haiku-4-20250514");
		expect(result.laneEnvelopes[AgentRole.WORKER]?.selectedCapabilityId).toBe("llm.anthropic.sonnet");
		expect(result.decisions).toHaveLength(2);
		expect(result.notes).toContain("Engine route coding.patch-cheap → llm.anthropic.sonnet");
		expect(routeEvents.filter((event) => event.type === "before_route_request")).toHaveLength(2);
		expect(routeEvents.filter((event) => event.type === "after_route_resolution")).toHaveLength(2);
		expect(routeEvents.some((event) => event.type === "route_degraded")).toBe(false);
	});

	it("keeps routing notes but skips cross-provider overrides", async () => {
		const observer = {
			routeResolve: vi
				.fn()
				.mockResolvedValueOnce(
					makeDecision({
						request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-cheap" },
						selected: {
							...makeDecision().selected!,
							providerFamily: "openai",
							capabilities: ["coding.patch-cheap"],
							metadata: { model: "gpt-4o" },
						},
					}),
				)
				.mockResolvedValueOnce(null),
		} as unknown as ChitraguptaObserver;

		const result = await resolveRoutingOverrides({
			observer,
			sessionId: "s1",
			currentModel: "claude-sonnet-4-20250514",
		});

		expect(result.overrides[AgentRole.WORKER]).toBeUndefined();
		expect(result.laneEnvelopes).toEqual({});
		expect(result.decisions).toHaveLength(1);
		expect(result.notes).toContain("Engine route coding.patch-cheap → llm.anthropic.sonnet");
	});
});
