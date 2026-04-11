import { describe, expect, it, vi } from "vitest";
import { refreshControlPlaneLanesFromDaemon } from "../src/chitragupta/control-plane-lanes.js";

function makeLane() {
	return {
		key: "primary",
		role: "primary",
		laneId: "lane-1",
		durableKey: "durable-1",
		snapshotAt: 123,
		policy: {
			contractVersion: 1,
			role: "primary",
			preferLocal: null,
			allowCloud: true,
			maxCostClass: "medium",
			requireStreaming: true,
			hardProviderFamily: null,
			preferredProviderFamilies: ["gemini"],
			toolAccess: "inherit",
			privacyBoundary: "cloud-ok",
			fallbackStrategy: "same-provider",
			tags: ["startup"],
		},
		requestedPolicy: {
			contractVersion: 1,
			role: "primary",
			preferLocal: null,
			allowCloud: true,
			maxCostClass: "medium",
			requireStreaming: true,
			hardProviderFamily: null,
			preferredProviderFamilies: ["gemini"],
			toolAccess: "inherit",
			privacyBoundary: "cloud-ok",
			fallbackStrategy: "same-provider",
			tags: ["startup"],
		},
		effectivePolicy: {
			contractVersion: 1,
			role: "primary",
			preferLocal: null,
			allowCloud: true,
			maxCostClass: "medium",
			requireStreaming: true,
			hardProviderFamily: null,
			preferredProviderFamilies: ["gemini"],
			toolAccess: "inherit",
			privacyBoundary: "cloud-ok",
			fallbackStrategy: "same-provider",
			tags: ["startup"],
		},
		constraintsApplied: { requireStreaming: true },
		policyHash: "policy-1",
		policyWarnings: [],
		route: null,
		routingDecision: null,
	};
}

function makeWorkerLane() {
	return {
		...makeLane(),
		key: "worker",
		role: "worker",
		laneId: "lane-2",
		durableKey: "durable-2",
		requestedPolicy: {
			...makeLane().requestedPolicy,
			role: "worker",
			preferLocal: true,
			allowCloud: false,
			hardProviderFamily: "ollama",
			privacyBoundary: "strict-local",
		},
		effectivePolicy: {
			...makeLane().effectivePolicy,
			role: "worker",
			preferLocal: true,
			allowCloud: true,
			maxCostClass: "medium",
			privacyBoundary: "local-preferred",
		},
		policyHash: "policy-worker",
		policyWarnings: ["worker lane relaxed to cloud fallback"],
	};
}

describe("refreshControlPlaneLanesFromDaemon", () => {
	it("prefers refreshed daemon lane truth over cached local lanes", async () => {
		const bridge = {
			routeLanesRefresh: vi.fn(async () => ({
				contractVersion: 1,
				sessionId: "canon-1",
				project: "/repo",
				primaryLaneKey: "primary",
				laneCount: 1,
				lanes: [makeLane()],
			})),
			routeLanesGet: vi.fn(async () => null),
		};

		const result = await refreshControlPlaneLanesFromDaemon(bridge as never, "canon-1", "/repo");

		expect(result.source).toBe("route.lanes.refresh");
		expect(result.lanes[0]?.authoritySource).toBe("route.lanes.refresh");
		expect(bridge.routeLanesGet).not.toHaveBeenCalled();
	});

	it("falls back to stored daemon lane truth when refresh fails", async () => {
		const bridge = {
			routeLanesRefresh: vi.fn(async () => {
				throw new Error("refresh failed");
			}),
			routeLanesGet: vi.fn(async () => ({
				contractVersion: 1,
				sessionId: "canon-1",
				project: "/repo",
				primaryLaneKey: "primary",
				laneCount: 1,
				lanes: [makeLane()],
			})),
		};

		const result = await refreshControlPlaneLanesFromDaemon(bridge as never, "canon-1", "/repo");

		expect(result.source).toBe("route.lanes.get");
		expect(result.warnings).toContain("Control-plane lane refresh failed: refresh failed");
		expect(result.lanes[0]?.authoritySource).toBe("route.lanes.get");
	});

	it("preserves multiple daemon lanes and policy metadata during rebind fallback", async () => {
		const bridge = {
			routeLanesRefresh: vi.fn(async () => {
				throw new Error("refresh failed");
			}),
			routeLanesGet: vi.fn(async () => ({
				contractVersion: 1,
				sessionId: "canon-1",
				project: "/repo",
				primaryLaneKey: "primary",
				laneCount: 2,
				lanes: [makeWorkerLane(), makeLane()],
			})),
		};

		const result = await refreshControlPlaneLanesFromDaemon(bridge as never, "canon-1", "/repo");

		expect(result.source).toBe("route.lanes.get");
		expect(result.lanes.map((lane) => lane.key)).toEqual(["worker", "primary"]);
		expect(result.lanes[0]).toMatchObject({
			key: "worker",
			authoritySource: "route.lanes.get",
			policyHash: "policy-worker",
			policyWarnings: ["worker lane relaxed to cloud fallback"],
			requestedPolicy: {
				hardProviderFamily: "ollama",
				privacyBoundary: "strict-local",
			},
			effectivePolicy: {
				maxCostClass: "medium",
				privacyBoundary: "local-preferred",
			},
		});
	});
});
