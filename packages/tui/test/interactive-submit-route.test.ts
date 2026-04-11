import type { RoutingDecision } from "@takumi/bridge";
import type { AgentEvent } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnsureCanonicalSessionBinding } = vi.hoisted(() => ({
	mockEnsureCanonicalSessionBinding: vi.fn(async () => "canon-1"),
}));

vi.mock("../src/chitragupta/chitragupta-executor-runtime.js", () => ({
	ensureCanonicalSessionBinding: mockEnsureCanonicalSessionBinding,
}));

import { resolveInteractiveSubmitRoute } from "../src/agent/interactive-submit-route.js";
import { AppState } from "../src/state.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-1",
			capability: "coding.review.strict",
		},
		selected: {
			id: "llm.anthropic.sonnet",
			kind: "llm",
			label: "Anthropic Sonnet",
			capabilities: ["coding.review.strict"],
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

function createState(): AppState {
	const state = new AppState();
	state.sessionId.value = "local-1";
	state.provider.value = "anthropic";
	state.model.value = "claude-sonnet-4-20250514";
	state.chitraguptaBridge.value = {
		isConnected: true,
		isSocketMode: true,
	} as never;
	return state;
}

function createDefaultSendMessage() {
	return async function* (): AsyncIterable<AgentEvent> {
		yield* [] as AgentEvent[];
	};
}

describe("resolveInteractiveSubmitRoute", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnsureCanonicalSessionBinding.mockImplementation(async (state: { canonicalSessionId: { value: string } }) => {
			state.canonicalSessionId.value = "canon-1";
			return "canon-1";
		});
	});

	it("emits route lifecycle events when an interactive engine route is applied", async () => {
		const state = createState();
		state.chitraguptaObserver.value = {
			routeResolve: vi.fn(async () => makeDecision()),
		} as never;
		const routeEvents: Array<Record<string, unknown>> = [];

		const result = await resolveInteractiveSubmitRoute({
			state,
			text: "Please review this patch carefully",
			defaultSendMessage: createDefaultSendMessage(),
			emitRouteEvent: (event) => {
				routeEvents.push(event as Record<string, unknown>);
			},
		});

		expect(mockEnsureCanonicalSessionBinding).toHaveBeenCalledWith(state);
		expect(result.authority).toBe("engine");
		expect(result.applied).toBe(true);
		expect(routeEvents[0]).toMatchObject({
			type: "before_route_request",
			flow: "interactive-submit",
			request: expect.objectContaining({ capability: "coding.review.strict" }),
			currentProvider: "anthropic",
			currentModel: "claude-sonnet-4-20250514",
		});
		expect(routeEvents[1]).toMatchObject({
			type: "after_route_resolution",
			flow: "interactive-submit",
			authority: "engine",
			applied: true,
			degraded: false,
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			request: expect.objectContaining({ capability: "coding.review.strict" }),
		});
	});

	it("emits route_degraded when interactive submit falls back after no engine decision", async () => {
		const state = createState();
		state.chitraguptaObserver.value = {
			routeResolve: vi.fn(async () => null),
		} as never;
		const routeEvents: Array<Record<string, unknown>> = [];

		const result = await resolveInteractiveSubmitRoute({
			state,
			text: "Fix this bug",
			defaultSendMessage: createDefaultSendMessage(),
			emitRouteEvent: (event) => {
				routeEvents.push(event as Record<string, unknown>);
			},
		});

		expect(result.authority).toBe("takumi-fallback");
		expect(result.applied).toBe(false);
		expect(routeEvents.map((event) => event.type)).toEqual([
			"before_route_request",
			"after_route_resolution",
			"route_degraded",
		]);
		expect(routeEvents[1]).toMatchObject({
			type: "after_route_resolution",
			flow: "interactive-submit",
			authority: "takumi-fallback",
			applied: false,
			degraded: true,
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			request: expect.objectContaining({ capability: "coding.patch-cheap" }),
		});
		expect(routeEvents[2]).toMatchObject({
			type: "route_degraded",
			flow: "interactive-submit",
			authority: "takumi-fallback",
			applied: false,
			degraded: true,
		});
	});
});
