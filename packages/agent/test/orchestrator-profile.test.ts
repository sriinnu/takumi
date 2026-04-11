import type { ExecutionLaneEnvelope } from "@takumi/bridge";
import { describe, expect, it, vi } from "vitest";
import type { AgentProfileStore } from "../src/cluster/agent-identity.js";
import { getProfileBiasedModel, getRecordedRoleModel } from "../src/cluster/orchestrator-profile.js";
import { AgentRole } from "../src/cluster/types.js";

function makeLaneEnvelope(role: AgentRole, appliedModel: string): ExecutionLaneEnvelope {
	return {
		consumer: "takumi",
		sessionId: "session-1",
		role,
		capability: "coding.patch-cheap",
		authority: "engine",
		enforcement: "same-provider",
		selectedCapabilityId: "cli.codex",
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

describe("orchestrator lane-aware routing", () => {
	it("prefers executable lane envelopes over plain overrides and profile history", () => {
		const store = {
			bestModelForRole: vi.fn(() => "profile-model"),
		} as unknown as AgentProfileStore;

		const model = getProfileBiasedModel(
			AgentRole.WORKER,
			{ [AgentRole.WORKER]: makeLaneEnvelope(AgentRole.WORKER, "claude-sonnet-4-20250514") },
			{ [AgentRole.WORKER]: "override-model" },
			store,
			"Refactor the validator stack",
		);

		expect(model).toBe("claude-sonnet-4-20250514");
		expect(store.bestModelForRole).not.toHaveBeenCalled();
	});

	it("records the applied lane model for Lucy's profile memory", () => {
		const model = getRecordedRoleModel(
			AgentRole.PLANNER,
			{ [AgentRole.PLANNER]: makeLaneEnvelope(AgentRole.PLANNER, "claude-sonnet-4-5") },
			{ [AgentRole.PLANNER]: "override-model" },
		);

		expect(model).toBe("claude-sonnet-4-5");
	});
});
