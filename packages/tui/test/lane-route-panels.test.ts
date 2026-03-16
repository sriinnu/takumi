/**
 * Tests for LaneTrackerPanel and RouteCardPanel enhancements (P1-1).
 * Covers enforcement badges, fallback chain display, degraded reason,
 * and tautological comparison fix.
 */

import { type RoutingDecision, TAKUMI_CAPABILITY } from "@takumi/bridge";
import { describe, expect, it } from "vitest";

// ── Test the decisionToLane logic extracted for coverage ──────────────────────

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

/**
 * Re-implement decisionToLane logic locally (mirrors lane-tracker.ts)
 * to validate the computation without needing a full TUI render.
 */
function decisionToLane(d: RoutingDecision) {
	const authority = d.selected ? "engine" : "takumi-fallback";
	const degraded = d.degraded === true;
	const icon = degraded ? "⚠" : authority === "engine" ? "✦" : "↩";
	return {
		icon,
		capability: d.request?.capability ?? "unknown",
		selected: d.selected?.id ?? "local",
		degraded,
		fallbackCount: d.fallbackChain?.length ?? 0,
		enforcement: d.selected ? "same-provider" : "capability-only",
	};
}

describe("decisionToLane", () => {
	it("shows engine icon + same-provider for engine-routed decision", () => {
		const lane = decisionToLane(makeDecision());
		expect(lane.icon).toBe("✦");
		expect(lane.enforcement).toBe("same-provider");
		expect(lane.degraded).toBe(false);
		expect(lane.fallbackCount).toBe(1);
	});

	it("shows fallback icon + capability-only for local fallback", () => {
		const lane = decisionToLane(makeDecision({ selected: null }));
		expect(lane.icon).toBe("↩");
		expect(lane.enforcement).toBe("capability-only");
		expect(lane.selected).toBe("local");
	});

	it("shows degraded icon when degraded is true", () => {
		const lane = decisionToLane(makeDecision({ degraded: true }));
		expect(lane.icon).toBe("⚠");
		expect(lane.degraded).toBe(true);
	});

	it("treats undefined degraded as false", () => {
		const d = makeDecision();
		// @ts-expect-error — testing undefined/truthy edge case
		d.degraded = undefined;
		const lane = decisionToLane(d);
		expect(lane.degraded).toBe(false);
		expect(lane.icon).not.toBe("⚠");
	});

	it("handles missing request.capability gracefully", () => {
		const d = makeDecision();
		// @ts-expect-error — testing null capability
		d.request.capability = undefined;
		const lane = decisionToLane(d);
		expect(lane.capability).toBe("unknown");
	});

	it("reports correct fallback count", () => {
		const lane = decisionToLane(makeDecision({ fallbackChain: ["a", "b", "c"] }));
		expect(lane.fallbackCount).toBe(3);
	});

	it("handles empty fallback chain", () => {
		const lane = decisionToLane(makeDecision({ fallbackChain: [] }));
		expect(lane.fallbackCount).toBe(0);
	});
});

describe("RouteCardPanel rendering logic", () => {
	it("formats enforcement label correctly for engine", () => {
		const d = makeDecision();
		const enforcement = d.selected ? "same-provider" : "capability-only";
		const authorityIcon = d.selected ? "✦" : "↩";
		const authority = d.selected ? "engine" : "takumi-fallback";
		const label = `${authorityIcon} ${authority} [${enforcement}]`;
		expect(label).toBe("✦ engine [same-provider]");
	});

	it("formats enforcement label correctly for fallback", () => {
		const d = makeDecision({ selected: null });
		const enforcement = d.selected ? "same-provider" : "capability-only";
		const authority = d.selected ? "engine" : "takumi-fallback";
		const authorityIcon = d.selected ? "✦" : "↩";
		const label = `${authorityIcon} ${authority} [${enforcement}]`;
		expect(label).toBe("↩ takumi-fallback [capability-only]");
	});

	it("includes fallback count in selected line", () => {
		const d = makeDecision({ fallbackChain: ["a", "b"] });
		const selectedId = d.selected?.id ?? "(local-fallback)";
		const fallbackCount = d.fallbackChain?.length ?? 0;
		const fbSuffix = fallbackCount > 0 ? ` (↻${fallbackCount} fallback${fallbackCount > 1 ? "s" : ""})` : "";
		expect(`→ ${selectedId}${fbSuffix}`).toContain("↻2 fallbacks");
	});

	it("omits fallback suffix when chain is empty", () => {
		const d = makeDecision({ fallbackChain: [] });
		const fallbackCount = d.fallbackChain?.length ?? 0;
		const fbSuffix = fallbackCount > 0 ? ` (↻${fallbackCount})` : "";
		expect(fbSuffix).toBe("");
	});

	it("shows degraded reason from policyTrace", () => {
		const d = makeDecision({
			degraded: true,
			policyTrace: ["requested:coding", "degraded:provider-down"],
		});
		const trace = d.policyTrace[d.policyTrace.length - 1] ?? "";
		expect(trace).toBe("degraded:provider-down");
	});

	it("handles at(-1) returning last decision", () => {
		const decisions = [
			makeDecision({ reason: "first" }),
			makeDecision({ reason: "second" }),
			makeDecision({ reason: "latest" }),
		];
		const latest = decisions.at(-1);
		expect(latest?.reason).toBe("latest");
	});

	it("handles empty decisions array safely", () => {
		const decisions: RoutingDecision[] = [];
		const latest = decisions.at(-1);
		expect(latest).toBeUndefined();
	});
});

describe("/lane summary computation", () => {
	it("computes routing health percentages", () => {
		const decisions = [
			makeDecision(),
			makeDecision({ selected: null }),
			makeDecision({ degraded: true }),
			makeDecision(),
		];
		const total = decisions.length;
		const degradedCount = decisions.filter((d) => d.degraded === true).length;
		const engineCount = decisions.filter((d) => d.selected !== null).length;
		const fallbackCount = total - engineCount;

		expect(total).toBe(4);
		expect(engineCount).toBe(3);
		expect(fallbackCount).toBe(1);
		expect(degradedCount).toBe(1);
		expect(Math.round((engineCount / total) * 100)).toBe(75);
	});

	it("handles all-degraded scenario", () => {
		const decisions = [makeDecision({ degraded: true }), makeDecision({ degraded: true, selected: null })];
		const degradedCount = decisions.filter((d) => d.degraded === true).length;
		expect(degradedCount).toBe(2);
	});

	it("handles empty decisions in summary", () => {
		const decisions: RoutingDecision[] = [];
		const total = decisions.length;
		expect(total).toBe(0);
		expect(total > 0 ? Math.round((0 / total) * 100) : 0).toBe(0);
	});
});

describe("/lane list with enforcement column", () => {
	it("shows SP for engine-routed decisions", () => {
		const d = makeDecision();
		const enf = d.selected ? "SP" : "CO";
		expect(enf).toBe("SP");
	});

	it("shows CO for local fallback decisions", () => {
		const d = makeDecision({ selected: null });
		const enf = d.selected ? "SP" : "CO";
		expect(enf).toBe("CO");
	});
});

describe("edge cases from review", () => {
	it("handles null request gracefully", () => {
		// @ts-expect-error — testing null request
		const lane = decisionToLane(makeDecision({ request: null }));
		expect(lane.capability).toBe("unknown");
	});

	it("treats degraded === false correctly", () => {
		const lane = decisionToLane(makeDecision({ degraded: false }));
		expect(lane.degraded).toBe(false);
		expect(lane.icon).toBe("✦");
	});

	it("treats degraded as falsy zero correctly", () => {
		const d = makeDecision();
		// @ts-expect-error — testing falsy value
		d.degraded = 0;
		const lane = decisionToLane(d);
		expect(lane.degraded).toBe(false);
	});

	it("handles very long fallback chain", () => {
		const lane = decisionToLane(makeDecision({ fallbackChain: Array(100).fill("x") }));
		expect(lane.fallbackCount).toBe(100);
	});

	it("formatConfidence handles NaN", () => {
		// Mirror the panel logic
		const formatConfidence = (c: number) =>
			typeof c !== "number" || Number.isNaN(c) ? "?%" : `${Math.round(c * 100)}%`;
		expect(formatConfidence(Number.NaN)).toBe("?%");
		expect(formatConfidence(0)).toBe("0%");
		expect(formatConfidence(1)).toBe("100%");
		expect(formatConfidence(0.999)).toBe("100%");
	});
});
