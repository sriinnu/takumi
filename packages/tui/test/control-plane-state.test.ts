import { type RoutingDecision, TAKUMI_CAPABILITY } from "@takumi/bridge";
import { describe, expect, it } from "vitest";
import {
	appendRoutingDecisions,
	formatCapabilityHealthSnapshot,
	formatRoutingDecision,
	mergeControlPlaneCapabilities,
	summarizeTakumiCapabilityHealth,
	upsertCapabilityHealthSnapshot,
} from "../src/control-plane-state.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "s1",
			capability: "coding.patch-and-validate",
		},
		selected: TAKUMI_CAPABILITY,
		reason: "Selected adapter.takumi.executor",
		fallbackChain: ["cli.codex"],
		policyTrace: ["requested:coding.patch-and-validate", "selected:adapter.takumi.executor"],
		degraded: false,
		...overrides,
	};
}

describe("control plane state helpers", () => {
	it("merges Takumi capability into capability lists", () => {
		const capabilities = mergeControlPlaneCapabilities([{ ...TAKUMI_CAPABILITY, label: "Takumi" }]);
		expect(capabilities[0]?.id).toBe(TAKUMI_CAPABILITY.id);
	});

	it("caps remembered routing decisions", () => {
		const decisions = appendRoutingDecisions(
			[],
			Array.from({ length: 20 }, (_, index) => makeDecision({ reason: `${index}` })),
		);
		expect(decisions).toHaveLength(12);
		expect(decisions[0]?.reason).toBe("8");
	});

	it("summarizes degraded health from routing decisions", () => {
		const snapshot = summarizeTakumiCapabilityHealth({
			connected: true,
			routingDecisions: [makeDecision({ degraded: true })],
			now: 123,
		});
		expect(snapshot.state).toBe("degraded");
		expect(snapshot.reason).toContain("degraded lane");
	});

	it("upserts Takumi health snapshots", () => {
		const snapshot = summarizeTakumiCapabilityHealth({ connected: true, now: 123 });
		const next = upsertCapabilityHealthSnapshot([{ ...snapshot, capabilityId: "llm.openai.gpt-5" }], snapshot);
		expect(next[0]?.capabilityId).toBe(TAKUMI_CAPABILITY.id);
		expect(next).toHaveLength(2);
	});

	it("formats routing and health output", () => {
		const decisionText = formatRoutingDecision(makeDecision());
		const healthText = formatCapabilityHealthSnapshot(summarizeTakumiCapabilityHealth({ connected: true, now: 123 }));
		expect(decisionText).toContain("Trace:");
		expect(healthText).toContain(TAKUMI_CAPABILITY.id);
	});
});
