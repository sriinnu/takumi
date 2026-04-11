import type { SessionControlPlaneLaneState } from "@takumi/core";
import { describe, expect, it } from "vitest";
import {
	findPrimaryControlPlaneLane,
	validateReplayBeforeCanonicalImport,
} from "../src/app-session-replay-validation.js";

function makePolicy(overrides: Record<string, unknown> = {}) {
	return {
		role: "primary",
		preferLocal: null,
		allowCloud: true,
		maxCostClass: "medium",
		requireStreaming: true,
		hardProviderFamily: null,
		preferredProviderFamilies: ["anthropic"],
		toolAccess: "inherit",
		privacyBoundary: "cloud-ok",
		fallbackStrategy: "same-provider",
		tags: ["session"],
		...overrides,
	} as SessionControlPlaneLaneState["policy"];
}

function makeLane(overrides: Partial<SessionControlPlaneLaneState> = {}) {
	return {
		key: "primary",
		role: "primary",
		laneId: "lane-primary",
		durableKey: "durable-primary",
		snapshotAt: 123,
		capability: "coding.patch-cheap",
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		degraded: false,
		policyHash: "policy-a",
		policy: makePolicy({ contractVersion: 1 }),
		...overrides,
	} satisfies SessionControlPlaneLaneState;
}

describe("app-session-replay-validation", () => {
	it("prefers the primary lane when present", () => {
		const lane = findPrimaryControlPlaneLane([
			makeLane({ key: "worker", role: "worker", laneId: "lane-worker", durableKey: "durable-worker" }),
			makeLane(),
		]);

		expect(lane).toMatchObject({ key: "primary", role: "primary" });
	});

	it("blocks canonical replay when authoritative lane truth drifts and local turns are pending", () => {
		const result = validateReplayBeforeCanonicalImport({
			canonicalSessionId: "canon-42",
			pendingLocalTurns: 2,
			sessionModel: "claude-sonnet-4-20250514",
			currentProvider: "anthropic",
			storedLanes: [makeLane()],
			refreshedLanes: [
				makeLane({
					capability: "coding.review.strict",
					provider: "openai",
					model: "gpt-4o",
					policyHash: "policy-b",
					policy: makePolicy({ contractVersion: 2 }),
				}),
			],
		});

		expect(result.ok).toBe(false);
		expect(result.blocking).toBe(true);
		expect(result.conflicts.map((conflict) => conflict.kind)).toEqual([
			"route_intent_mismatch",
			"provider_mismatch",
			"model_mismatch",
			"policy_hash_mismatch",
			"policy_version_mismatch",
		]);
		expect(result.summary).toContain("canon-42");
		expect(result.summary).toContain("while 2 local turn(s) were pending");
	});

	it("keeps compatibility drift non-blocking when nothing is waiting to replay", () => {
		const result = validateReplayBeforeCanonicalImport({
			canonicalSessionId: "canon-42",
			pendingLocalTurns: 0,
			sessionModel: "claude-sonnet-4-20250514",
			currentProvider: "anthropic",
			storedLanes: [makeLane()],
			refreshedLanes: [makeLane({ provider: "openai" })],
		});

		expect(result.ok).toBe(false);
		expect(result.blocking).toBe(false);
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.kind).toBe("provider_mismatch");
	});

	it("warns when authoritative daemon lane truth is unavailable", () => {
		const result = validateReplayBeforeCanonicalImport({
			canonicalSessionId: "canon-42",
			pendingLocalTurns: 1,
			sessionModel: "claude-sonnet-4-20250514",
			currentProvider: "anthropic",
			storedLanes: [makeLane()],
			refreshedLanes: [],
		});

		expect(result.ok).toBe(true);
		expect(result.blocking).toBe(false);
		expect(result.conflicts).toEqual([]);
		expect(result.warnings).toContain(
			"Authoritative daemon lane snapshot unavailable; replay validation is incomplete.",
		);
	});
});
