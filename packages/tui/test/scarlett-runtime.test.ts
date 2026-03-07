import { type RoutingDecision, TAKUMI_CAPABILITY } from "@takumi/bridge";
import { describe, expect, it } from "vitest";
import { buildScarlettIntegrityReport, formatScarlettIntegrityReport } from "../src/scarlett-runtime.js";

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "s1",
			capability: "coding.patch-and-validate",
		},
		selected: TAKUMI_CAPABILITY,
		reason: "Selected adapter.takumi.executor",
		fallbackChain: [],
		policyTrace: ["requested:coding.patch-and-validate", "selected:adapter.takumi.executor"],
		degraded: false,
		...overrides,
	};
}

describe("scarlett runtime", () => {
	it("reports healthy state when the control plane is stable", () => {
		const report = buildScarlettIntegrityReport({
			connected: true,
			capabilities: [TAKUMI_CAPABILITY],
			snapshots: [
				{
					capabilityId: TAKUMI_CAPABILITY.id,
					state: "healthy",
					errorRate: 0,
				},
			],
			routingDecisions: [makeDecision()],
			now: 123,
		});

		expect(report.status).toBe("healthy");
		expect(report.findings).toEqual([]);
		expect(report.summary).toContain("stable");
	});

	it("escalates to critical when the bridge disconnects or routes fail open", () => {
		const report = buildScarlettIntegrityReport({
			connected: false,
			capabilities: [TAKUMI_CAPABILITY],
			snapshots: [
				{
					capabilityId: TAKUMI_CAPABILITY.id,
					state: "down",
					errorRate: 1,
					authFailures: 2,
				},
			],
			routingDecisions: [makeDecision({ selected: null, degraded: true })],
			anomaly: {
				severity: "critical",
				details: "Loop detected",
				suggestion: "abort current plan",
			},
			now: 456,
		});

		expect(report.status).toBe("critical");
		expect(report.downCapabilities).toContain(TAKUMI_CAPABILITY.id);
		expect(report.degradedRouteCount).toBe(1);
		expect(report.findings.some((finding) => finding.source === "bridge")).toBe(true);
		expect(report.findings.some((finding) => finding.source === "anomaly")).toBe(true);
	});

	it("formats a readable Scarlett integrity report", () => {
		const report = buildScarlettIntegrityReport({
			connected: true,
			capabilities: [],
			snapshots: [],
			routingDecisions: [],
			now: 789,
		});

		const text = formatScarlettIntegrityReport(report);
		expect(text).toContain("## Scarlett Integrity");
		expect(text).toContain("Status: warning");
		expect(text).toContain("Findings");
	});
});
