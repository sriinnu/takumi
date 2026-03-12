import type { RoutingDecision } from "@takumi/bridge";
import { describe, expect, it, vi } from "vitest";
import { type TaskClassification, TaskComplexity, TaskType } from "../src/classifier.js";
import { AgentRole } from "../src/cluster/types.js";
import { ModelRouter } from "../src/model-router.js";
import { resolveRoutingOverrides } from "../src/task-routing.js";

function makeClassification(overrides?: Partial<TaskClassification>): TaskClassification {
	return {
		complexity: TaskComplexity.STANDARD,
		type: TaskType.CODING,
		estimatedFiles: 4,
		riskLevel: 6,
		confidence: 0.86,
		reasoning: "routing test",
		...overrides,
	};
}

function makeDecision(overrides?: Partial<RoutingDecision>): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "session-123",
			capability: "coding.deep-reasoning",
		},
		selected: {
			id: "engine.llm.reasoner",
			kind: "llm",
			label: "Reasoner",
			capabilities: ["coding.deep-reasoning"],
			costClass: "high",
			trust: "cloud",
			health: "healthy",
			providerFamily: "anthropic",
			invocation: {
				id: "reasoner",
				transport: "http",
				entrypoint: "https://example.test",
				requestShape: "RoutingRequest",
				responseShape: "AgentEvent stream",
				timeoutMs: 30_000,
				streaming: true,
			},
			metadata: { model: "claude-opus-4-5" },
			tags: ["coding"],
		},
		reason: "selected",
		fallbackChain: [],
		policyTrace: ["selected:engine.llm.reasoner"],
		degraded: false,
		...overrides,
	};
}

describe("resolveRoutingOverrides", () => {
	it("returns no overrides when no observer is available", async () => {
		const plan = await resolveRoutingOverrides({
			observer: null,
			sessionId: "session-123",
			currentModel: "claude-sonnet-4-20250514",
			router: new ModelRouter("anthropic"),
			classification: makeClassification(),
		});

		expect(plan).toEqual({ overrides: {}, laneEnvelopes: {}, decisions: [], notes: [] });
	});

	it("groups roles by route class and uses engine-approved same-provider models", async () => {
		const routeResolve = vi
			.fn()
			.mockResolvedValueOnce(
				makeDecision({
					request: {
						consumer: "takumi",
						sessionId: "session-123",
						capability: "coding.patch-cheap",
					},
					selected: {
						...makeDecision().selected!,
						capabilities: ["coding.patch-cheap"],
						metadata: {},
					},
				}),
			)
			.mockResolvedValueOnce(
				makeDecision({
					request: {
						consumer: "takumi",
						sessionId: "session-123",
						capability: "coding.deep-reasoning",
					},
					selected: {
						...makeDecision().selected!,
						capabilities: ["coding.deep-reasoning"],
						metadata: { model: "claude-opus-4-5" },
					},
				}),
			)
			.mockResolvedValueOnce(
				makeDecision({
					request: {
						consumer: "takumi",
						sessionId: "session-123",
						capability: "coding.review.strict",
					},
					selected: {
						...makeDecision().selected!,
						id: "engine.llm.reviewer",
						capabilities: ["coding.review.strict"],
						metadata: { modelId: "claude-sonnet-4-5" },
					},
				}),
			)
			.mockResolvedValueOnce(
				makeDecision({
					request: {
						consumer: "takumi",
						sessionId: "session-123",
						capability: "coding.validation-high-trust",
					},
					selected: {
						...makeDecision().selected!,
						id: "engine.llm.validator",
						capabilities: ["coding.validation-high-trust"],
						metadata: { model: "claude-sonnet-4-5" },
					},
				}),
			);

		const plan = await resolveRoutingOverrides({
			observer: { routeResolve } as never,
			sessionId: "session-123",
			currentModel: "claude-sonnet-4-20250514",
			router: new ModelRouter("anthropic"),
			classification: makeClassification(),
		});

		expect(routeResolve).toHaveBeenCalledTimes(4);
		expect(routeResolve.mock.calls[0][0].capability).toBe("coding.patch-cheap");
		expect(routeResolve.mock.calls[1][0].capability).toBe("coding.deep-reasoning");
		expect(routeResolve.mock.calls[2][0].capability).toBe("coding.review.strict");
		expect(routeResolve.mock.calls[3][0].capability).toBe("coding.validation-high-trust");
		expect(routeResolve.mock.calls[2][0].constraints).toMatchObject({ requireStreaming: true, maxCostClass: "medium" });
		expect(routeResolve.mock.calls[3][0].constraints).toMatchObject({
			requireStreaming: true,
			maxCostClass: "medium",
			trustFloor: "sandboxed",
		});

		expect(plan.overrides[AgentRole.PLANNER]).toBe("claude-opus-4-5");
		expect(plan.overrides[AgentRole.WORKER]).toBe("claude-sonnet-4-20250514");
		expect(plan.overrides[AgentRole.VALIDATOR_CODE]).toBe("claude-sonnet-4-5");
		expect(plan.overrides[AgentRole.VALIDATOR_REQUIREMENTS]).toBe("claude-sonnet-4-5");
		expect(plan.overrides[AgentRole.VALIDATOR_SECURITY]).toBe("claude-sonnet-4-5");
		expect(plan.laneEnvelopes[AgentRole.PLANNER]?.authority).toBe("engine");
		expect(plan.laneEnvelopes[AgentRole.WORKER]?.authority).toBe("takumi-fallback");
		expect(plan.laneEnvelopes[AgentRole.WORKER]?.capability).toBe("coding.patch-cheap");
		expect(plan.decisions).toHaveLength(4);
		expect(plan.notes.some((note) => note.includes("using engine-approved model claude-opus-4-5"))).toBe(true);
		expect(plan.notes.some((note) => note.includes("had no concrete model metadata"))).toBe(true);
	});

	it("keeps Takumi fallback when engine metadata lacks a concrete model", async () => {
		const routeResolve = vi.fn(async () =>
			makeDecision({
				selected: {
					...makeDecision().selected!,
					metadata: {},
				},
			}),
		);

		const plan = await resolveRoutingOverrides({
			observer: { routeResolve } as never,
			sessionId: "session-123",
			currentModel: "claude-sonnet-4-20250514",
			router: new ModelRouter("anthropic"),
			classification: makeClassification({ complexity: TaskComplexity.CRITICAL }),
		});

		expect(plan.overrides[AgentRole.PLANNER]).toBe("claude-opus-4-5");
		expect(plan.laneEnvelopes[AgentRole.PLANNER]?.authority).toBe("takumi-fallback");
		expect(plan.notes.some((note) => note.includes("had no concrete model metadata"))).toBe(true);
	});

	it("rejects engine models that switch provider families away from the active session", async () => {
		const routeResolve = vi.fn(async () =>
			makeDecision({
				selected: {
					...makeDecision().selected!,
					providerFamily: "openai",
					metadata: { model: "gpt-4o" },
				},
			}),
		);

		const plan = await resolveRoutingOverrides({
			observer: { routeResolve } as never,
			sessionId: "session-123",
			currentModel: "claude-sonnet-4-20250514",
			router: new ModelRouter("anthropic"),
			classification: makeClassification({ complexity: TaskComplexity.CRITICAL }),
		});

		expect(plan.overrides[AgentRole.PLANNER]).toBe("claude-opus-4-5");
		expect(plan.laneEnvelopes[AgentRole.PLANNER]?.selectedModel).toBe("gpt-4o");
		expect(plan.notes.some((note) => note.includes("active session is anthropic"))).toBe(true);
	});
});
