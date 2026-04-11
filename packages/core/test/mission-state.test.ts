import { describe, expect, it } from "vitest";
import {
	createMission,
	isMissionDegraded,
	isMissionTerminal,
	isTransitionAllowed,
	promoteArtifact,
	transitionMission,
} from "../src/mission-state.js";

describe("createMission", () => {
	it("creates a mission in the planning phase", () => {
		const m = createMission("m-1", "Ship the feature");
		expect(m.id).toBe("m-1");
		expect(m.objective).toBe("Ship the feature");
		expect(m.phase).toBe("planning");
		expect(m.authority).toBe("engine");
		expect(m.transitions).toEqual([]);
		expect(m.promotedArtifactIds).toEqual([]);
		expect(m.createdAt).toBeLessThanOrEqual(Date.now());
	});

	it("accepts optional criteria and constraints", () => {
		const m = createMission("m-2", "Research", {
			acceptanceCriteria: ["report delivered"],
			constraints: { maxTokens: 50_000, allowDegradedLocal: true },
			authority: "local-only",
		});
		expect(m.acceptanceCriteria).toEqual(["report delivered"]);
		expect(m.constraints.maxTokens).toBe(50_000);
		expect(m.authority).toBe("local-only");
	});
});

describe("isTransitionAllowed", () => {
	it("allows planning → active", () => {
		expect(isTransitionAllowed("planning", "active")).toBe(true);
	});

	it("allows active → validating", () => {
		expect(isTransitionAllowed("active", "validating")).toBe(true);
	});

	it("rejects completed → active (terminal)", () => {
		expect(isTransitionAllowed("completed", "active")).toBe(false);
	});

	it("rejects halted → active (terminal)", () => {
		expect(isTransitionAllowed("halted", "active")).toBe(false);
	});

	it("allows blocked → active (unblock)", () => {
		expect(isTransitionAllowed("blocked", "active")).toBe(true);
	});

	it("allows degraded → validating", () => {
		expect(isTransitionAllowed("degraded", "validating")).toBe(true);
	});

	it("rejects planning → completed (skip phases)", () => {
		expect(isTransitionAllowed("planning", "completed")).toBe(false);
	});
});

describe("transitionMission", () => {
	it("transitions planning → active and records lineage", () => {
		const m = createMission("m-1", "Test");
		const result = transitionMission(m, "active", "Decomposition complete");
		expect(result.ok).toBe(true);
		expect(result.mission.phase).toBe("active");
		expect(result.mission.transitions).toHaveLength(1);
		expect(result.mission.transitions[0]!.from).toBe("planning");
		expect(result.mission.transitions[0]!.to).toBe("active");
		expect(result.mission.transitions[0]!.reason).toBe("Decomposition complete");
	});

	it("rejects disallowed transitions", () => {
		const m = createMission("m-1", "Test");
		const result = transitionMission(m, "completed", "Magic");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("not allowed");
		expect(result.mission).toBe(m); // original returned unchanged
	});

	it("does not mutate the original mission", () => {
		const m = createMission("m-1", "Test");
		const result = transitionMission(m, "active", "Go");
		expect(result.ok).toBe(true);
		expect(m.phase).toBe("planning");
		expect(m.transitions).toHaveLength(0);
		expect(result.mission).not.toBe(m);
	});

	it("carries forward authority override", () => {
		const m = createMission("m-1", "Test");
		const r1 = transitionMission(m, "active", "Go");
		const r2 = transitionMission(r1.mission, "degraded", "Lost Chitragupta", {
			authority: "local-only",
		});
		expect(r2.ok).toBe(true);
		expect(r2.mission.authority).toBe("local-only");
		expect(r2.mission.transitions[1]!.authority).toBe("local-only");
	});

	it("records stop reason on terminal transitions", () => {
		const m = createMission("m-1", "Test");
		const r1 = transitionMission(m, "active", "Go");
		const r2 = transitionMission(r1.mission, "halted", "Budget exceeded", {
			stopReason: "budget_exhausted",
		});
		expect(r2.ok).toBe(true);
		expect(r2.mission.phase).toBe("halted");
		expect(r2.mission.stopReason).toBe("budget_exhausted");
	});

	it("builds up transition lineage through multiple phases", () => {
		let m = createMission("m-1", "Multi-phase");
		m = transitionMission(m, "active", "Start").mission;
		m = transitionMission(m, "blocked", "Waiting on API key").mission;
		m = transitionMission(m, "active", "Key received").mission;
		m = transitionMission(m, "validating", "Tests running").mission;
		m = transitionMission(m, "completed", "All tests pass", { stopReason: "criteria_met" }).mission;
		expect(m.transitions).toHaveLength(5);
		expect(m.phase).toBe("completed");
		expect(m.stopReason).toBe("criteria_met");
	});
});

describe("promoteArtifact", () => {
	it("adds an artifact ID to the ledger", () => {
		const m = createMission("m-1", "Test");
		const next = promoteArtifact(m, "art-1");
		expect(next.promotedArtifactIds).toEqual(["art-1"]);
		expect(m.promotedArtifactIds).toEqual([]); // immutable
	});

	it("deduplicates repeated promotions", () => {
		let m = createMission("m-1", "Test");
		m = promoteArtifact(m, "art-1");
		const same = promoteArtifact(m, "art-1");
		expect(same).toBe(m); // no-op returns same reference
	});
});

describe("isMissionTerminal", () => {
	it("returns true for completed", () => {
		const m = { ...createMission("m-1", "T"), phase: "completed" as const };
		expect(isMissionTerminal(m)).toBe(true);
	});

	it("returns true for halted", () => {
		const m = { ...createMission("m-1", "T"), phase: "halted" as const };
		expect(isMissionTerminal(m)).toBe(true);
	});

	it("returns false for active", () => {
		expect(isMissionTerminal(createMission("m-1", "T"))).toBe(false);
	});
});

describe("isMissionDegraded", () => {
	it("returns true for local-only authority", () => {
		const m = createMission("m-1", "T", { authority: "local-only" });
		expect(isMissionDegraded(m)).toBe(true);
	});

	it("returns true for degraded phase", () => {
		const m = createMission("m-1", "T");
		const r = transitionMission(m, "active", "Go");
		const d = transitionMission(r.mission, "degraded", "Lost connection", { authority: "local-only" });
		expect(isMissionDegraded(d.mission)).toBe(true);
	});

	it("returns false for engine authority in active phase", () => {
		const m = createMission("m-1", "T");
		const r = transitionMission(m, "active", "Go");
		expect(isMissionDegraded(r.mission)).toBe(false);
	});
});
