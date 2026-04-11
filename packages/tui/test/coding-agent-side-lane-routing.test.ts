import { AgentRole, type ClassificationResult, ModelRouter, TaskComplexity, TaskType } from "@takumi/agent";
import type { ExecutionLaneEnvelope } from "@takumi/bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prepareMeshClusterMock, resolveRoutingOverridesMock } = vi.hoisted(() => ({
	prepareMeshClusterMock: vi.fn(),
	resolveRoutingOverridesMock: vi.fn(),
}));

vi.mock("../src/chitragupta/chitragupta-executor-runtime.js", () => ({
	ensureCanonicalSessionBinding: vi.fn(async () => {}),
	getBoundSessionId: vi.fn(() => "session-1"),
	observeExecutorEvents: vi.fn(async () => {}),
}));

vi.mock("../src/agent/coding-agent-routing.js", () => ({
	resolveRoutingOverrides: resolveRoutingOverridesMock,
}));

vi.mock("../src/agent/coding-agent-mesh.js", async () => {
	const actual = await vi.importActual<typeof import("../src/agent/coding-agent-mesh.js")>(
		"../src/agent/coding-agent-mesh.js",
	);
	return {
		...actual,
		prepareMeshCluster: prepareMeshClusterMock,
	};
});

import type { AgentRunner } from "../src/agent/agent-runner.js";
import { CodingAgent } from "../src/agent/coding-agent.js";
import { AppState } from "../src/state.js";

function mockRunner(): AgentRunner {
	return {
		submit: vi.fn(async () => {}),
		cancel: vi.fn(),
		clearHistory: vi.fn(),
		isRunning: false,
		permissions: { check: vi.fn(), getRules: vi.fn(() => []), reset: vi.fn() } as never,
		checkToolPermission: vi.fn(async () => true),
	} as unknown as AgentRunner;
}

function makeLaneEnvelope(role: AgentRole, appliedModel: string): ExecutionLaneEnvelope {
	return {
		consumer: "takumi",
		sessionId: "session-1",
		role,
		capability: "coding.patch-cheap",
		authority: "engine",
		enforcement: "same-provider",
		selectedCapabilityId: `cap-${role.toLowerCase()}`,
		selectedProviderFamily: "anthropic",
		selectedModel: appliedModel,
		fallbackModel: "claude-haiku-4-20250514",
		appliedModel,
		degraded: false,
		reason: "engine route approved",
		fallbackChain: [],
		policyTrace: [],
	};
}

function makeClassificationResult(router: ModelRouter): ClassificationResult {
	return {
		classification: {
			complexity: TaskComplexity.STANDARD,
			type: TaskType.CODING,
			estimatedFiles: 4,
			riskLevel: 5,
			confidence: 0.92,
			reasoning: "Multi-agent coding task",
		},
		topology: {
			totalAgents: 4,
			validatorCount: 2,
			usePlanner: true,
			validationStrategy: "majority",
		},
		plan: { name: "test-plan", strategy: "standard" } as never,
		subtasks: [],
		recommendedModel: router.recommend(TaskComplexity.STANDARD, "WORKER"),
	};
}

describe("CodingAgent side-lane routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prepareMeshClusterMock.mockReturnValue({
			roles: [AgentRole.PLANNER, AgentRole.WORKER],
			topology: "council",
			validationStrategy: "majority",
			maxRetries: 1,
			taskDescription: "Route side lanes",
			reasons: [],
			escalateToSabha: false,
		});
	});

	it("passes executable lane envelopes into mesh cluster preparation", async () => {
		const state = new AppState();
		const runner = mockRunner();
		const agent = new CodingAgent(state, runner);
		const router = new ModelRouter("anthropic");
		const result = makeClassificationResult(router);
		const laneEnvelopes = {
			[AgentRole.PLANNER]: makeLaneEnvelope(AgentRole.PLANNER, "claude-sonnet-4-5"),
			[AgentRole.WORKER]: makeLaneEnvelope(AgentRole.WORKER, "claude-sonnet-4-20250514"),
		};

		resolveRoutingOverridesMock.mockResolvedValue({
			overrides: {
				[AgentRole.PLANNER]: "claude-sonnet-4-5",
				[AgentRole.WORKER]: "claude-sonnet-4-20250514",
			},
			laneEnvelopes,
			decisions: [],
			notes: [],
		});

		const fakeOrchestrator = {
			setModelOverrides: vi.fn(),
			setChitraguptaMemory: vi.fn(),
			spawn: vi.fn(async () => ({ id: "cluster-1", agents: new Map([["agent-1", {}]]), phase: "PLANNING" })),
			on: vi.fn(),
			execute: vi.fn(async function* () {
				yield { type: "cluster_complete", clusterId: "cluster-1", success: true, workProduct: null, timestamp: 1 };
			}),
			shutdown: vi.fn(async () => {}),
		};

		(agent as never as { options: { enableOrchestration: boolean } }).options.enableOrchestration = true;
		(agent as never as { classifier: unknown }).classifier = {
			classifyAndGetTopology: vi.fn(async () => result),
			router,
		};
		(agent as never as { orchestrator: unknown }).orchestrator = fakeOrchestrator;

		await agent.start("Route side lanes");

		expect(prepareMeshClusterMock).toHaveBeenCalledWith(
			expect.objectContaining({
				description: "Route side lanes",
				laneEnvelopes,
			}),
		);
	});
});
