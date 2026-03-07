import { describe, expect, it } from "vitest";
import {
	type CapabilityDescriptor,
	capabilitySupports,
	chooseCapability,
	compareCapabilities,
	filterCapabilities,
	getCapabilityTier,
	isCapabilityName,
	type RoutingRequest,
} from "../src/control-plane.js";

function makeCapability(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
	return {
		id: "adapter.takumi.executor",
		kind: "adapter",
		label: "Takumi Executor",
		capabilities: ["coding.patch-and-validate"],
		costClass: "medium",
		trust: "privileged",
		health: "healthy",
		invocation: {
			id: "takumi-agent-loop",
			transport: "inproc",
			entrypoint: "@takumi/agent/loop",
			requestShape: "RoutingRequest",
			responseShape: "AgentEvent stream",
			timeoutMs: 120_000,
			streaming: true,
		},
		tags: ["coding"],
		...overrides,
	};
}

function makeRequest(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
	return {
		consumer: "takumi",
		sessionId: "s1",
		capability: "coding.patch-and-validate",
		...overrides,
	};
}

describe("control-plane helpers", () => {
	it("validates semantic capability names", () => {
		expect(isCapabilityName("coding.patch-and-validate")).toBe(true);
		expect(isCapabilityName("chat.high-reliability")).toBe(true);
		expect(isCapabilityName("OpenAI")).toBe(false);
		expect(isCapabilityName("coding")).toBe(false);
	});

	it("assigns lower tiers to local capabilities and higher tiers to cloud ones", () => {
		expect(getCapabilityTier(makeCapability({ kind: "tool", trust: "local" }))).toBe(1);
		expect(getCapabilityTier(makeCapability({ kind: "local-model", trust: "local" }))).toBe(2);
		expect(getCapabilityTier(makeCapability({ kind: "llm", trust: "cloud" }))).toBe(3);
		expect(getCapabilityTier(makeCapability({ health: "down" }))).toBe(4);
	});

	it("filters capabilities against hard constraints", () => {
		const request = makeRequest({
			constraints: {
				allowCloud: false,
				requireStreaming: true,
				maxCostClass: "medium",
			},
		});

		expect(capabilitySupports(makeCapability({ trust: "local" }), request)).toBe(true);
		expect(capabilitySupports(makeCapability({ trust: "cloud" }), request)).toBe(false);
		expect(
			capabilitySupports(makeCapability({ invocation: { ...makeCapability().invocation, streaming: false } }), request),
		).toBe(false);
		expect(capabilitySupports(makeCapability({ costClass: "high" }), request)).toBe(false);
	});

	it("prefers local and explicitly preferred capabilities when sorting", () => {
		const localCli = makeCapability({ id: "cli.codex", kind: "cli", trust: "local", costClass: "low" });
		const takumi = makeCapability();
		const cloud = makeCapability({ id: "llm.openai.gpt-5", kind: "llm", trust: "cloud", costClass: "high" });

		const sorted = [cloud, takumi, localCli].sort((left, right) =>
			compareCapabilities(left, right, {
				preferLocal: true,
				preferredCapabilityIds: ["adapter.takumi.executor"],
			}),
		);

		expect(sorted.map((item) => item.id)).toEqual(["adapter.takumi.executor", "cli.codex", "llm.openai.gpt-5"]);
	});

	it("filters capabilities by semantic query", () => {
		const capabilities = [
			makeCapability({ id: "cli.codex", kind: "cli", tags: ["coding", "local"], trust: "local" }),
			makeCapability({ id: "llm.openai.gpt-5", kind: "llm", tags: ["coding", "cloud"], trust: "cloud" }),
			makeCapability({
				id: "embedding.local",
				kind: "embedding",
				capabilities: ["embedding.index-build"],
				tags: ["index"],
			}),
		];

		const filtered = filterCapabilities(capabilities, {
			capability: "coding.patch-and-validate",
			kinds: ["cli", "llm", "adapter"],
			tags: ["coding"],
		});

		expect(filtered.map((item) => item.id)).toEqual(["cli.codex", "llm.openai.gpt-5"]);
	});

	it("chooses the best capability and produces a policy trace", () => {
		const request = makeRequest({ constraints: { preferLocal: true, allowCloud: false } });
		const decision = chooseCapability(
			[
				makeCapability({ id: "llm.openai.gpt-5", kind: "llm", trust: "cloud" }),
				makeCapability({ id: "cli.codex", kind: "cli", trust: "local", costClass: "low" }),
				makeCapability(),
			],
			request,
		);

		expect(decision.selected?.id).toBe("cli.codex");
		expect(decision.policyTrace).toContain("constraint:preferLocal");
		expect(decision.policyTrace).toContain("constraint:noCloud");
		expect(decision.fallbackChain).toContain("adapter.takumi.executor");
	});
});
