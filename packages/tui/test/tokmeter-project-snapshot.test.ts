import { describe, expect, it, vi } from "vitest";
import { TokmeterProjectTracker } from "../src/http-bridge/tokmeter-project-snapshot.js";

function createCoreDouble() {
	return {
		scan: vi.fn(async () => []),
		getAllProjects: () => [{ project: "takumi" }, { project: "-Users-sriinnu-Personal-takumi" }],
		getModelCosts: () => [
			{
				model: "claude-sonnet-4-20250514",
				provider: "claude-code",
				inputTokens: 800,
				outputTokens: 400,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
				totalTokens: 1_200,
				cost: 0.42,
				percentageOfTotal: 70,
			},
			{
				model: "gpt-4o",
				provider: "codex",
				inputTokens: 300,
				outputTokens: 100,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
				totalTokens: 400,
				cost: 0.18,
				percentageOfTotal: 30,
			},
		],
		getProviderBreakdown: () => [
			{
				provider: "claude-code",
				totalTokens: 1_200,
				cost: 0.42,
				models: ["claude-sonnet-4-20250514"],
				percentageOfTotal: 70,
			},
			{
				provider: "codex",
				totalTokens: 400,
				cost: 0.18,
				models: ["gpt-4o"],
				percentageOfTotal: 30,
			},
		],
		getDailyBreakdown: () => [
			{
				date: "2026-04-01",
				totalTokens: 600,
				inputTokens: 400,
				outputTokens: 200,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
				cost: 0.2,
				records: 2,
			},
			{
				date: "2026-04-02",
				totalTokens: 1_000,
				inputTokens: 700,
				outputTokens: 300,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokens: 0,
				cost: 0.4,
				records: 3,
			},
		],
		getStats: () => ({
			totalTokens: 1_600,
			totalCost: 0.6,
			inputTokens: 1_100,
			outputTokens: 500,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			totalRecords: 5,
			projects: 2,
			models: 2,
			providers: 2,
			activeDays: 2,
			longestStreak: 2,
			firstUsed: 0,
			lastUsed: 0,
		}),
	};
}

describe("TokmeterProjectTracker", () => {
	it("builds a cached project snapshot from tokmeter aggregates", async () => {
		const core = createCoreDouble();
		const tracker = new TokmeterProjectTracker({
			projectRoot: "/Users/sriinnu/Personal/takumi",
			cacheTtlMs: 60_000,
			now: () => Date.parse("2026-04-02T12:00:00.000Z"),
			createCore: async () => core as never,
		});

		const first = await tracker.getSnapshot();
		const second = await tracker.getSnapshot();

		expect(core.scan).toHaveBeenCalledTimes(1);
		expect(core.scan).toHaveBeenCalledWith({ project: "takumi" });
		expect(first).toBe(second);
		expect(first.projectQuery).toBe("takumi");
		expect(first.totalTokens).toBe(1_600);
		expect(first.totalCostUsd).toBeCloseTo(0.6);
		expect(first.todayTokens).toBe(1_000);
		expect(first.todayCostUsd).toBeCloseTo(0.4);
		expect(first.topModels[0]).toMatchObject({
			model: "claude-sonnet-4-20250514",
			provider: "claude-code",
			costUsd: 0.42,
		});
		expect(first.topProviders[0]).toMatchObject({ provider: "claude-code", costUsd: 0.42 });
		expect(first.recentDaily).toEqual([
			{ date: "2026-04-01", totalTokens: 600, costUsd: 0.2 },
			{ date: "2026-04-02", totalTokens: 1_000, costUsd: 0.4 },
		]);
		expect(first.note).toContain("Combined 2 matching tokmeter project buckets");
	});

	it("returns a stable error snapshot when tokmeter fails", async () => {
		const tracker = new TokmeterProjectTracker({
			projectRoot: "/Users/sriinnu/Personal/takumi",
			now: () => Date.parse("2026-04-02T12:00:00.000Z"),
			createCore: async () => {
				throw new Error("tokmeter missing");
			},
		});

		const snapshot = await tracker.getSnapshot();

		expect(snapshot.totalTokens).toBe(0);
		expect(snapshot.totalCostUsd).toBe(0);
		expect(snapshot.recentDaily).toHaveLength(7);
		expect(snapshot.note).toContain("Tokmeter sync failed");
	});
});
