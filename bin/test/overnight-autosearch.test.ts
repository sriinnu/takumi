import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildFocusPlan,
	buildResearchPrompt,
	buildSynthesisPrompt,
	extractFindingHeadlines,
	resolveResearchPaths,
} from "../cli/overnight-autosearch-shared.js";

describe("overnight autosearch helpers", () => {
	it("rotates focus areas for the requested iteration count", () => {
		const plan = buildFocusPlan(10);
		expect(plan).toHaveLength(10);
		expect(plan[0]).toBe("architecture and package boundaries");
		expect(plan[8]).toBe("architecture and package boundaries");
	});

	it("builds default report and raw log paths under .takumi/autosearch", () => {
		const paths = resolveResearchPaths("/repo");
		expect(paths.reportFile).toContain(join("/repo", ".takumi", "autosearch", "overnight-"));
		expect(paths.reportFile.endsWith(".md")).toBe(true);
		expect(paths.rawLogFile.endsWith(".jsonl")).toBe(true);
	});

	it("includes prior findings in the research prompt", () => {
		const prompt = buildResearchPrompt({
			focus: "docs and onboarding",
			iteration: 2,
			previousFindings: ["README omits detached job usage"],
			deadlineHours: 8,
		});
		expect(prompt).toContain("Takumi repository review. Focus: docs and onboarding. Pass 2.");
		expect(prompt).toContain("README omits detached job usage");
		expect(prompt).toContain("## Findings");
	});

	it("extracts finding headlines from bullets and numbered lists", () => {
		const findings = extractFindingHeadlines(["- Missing crash-only resume story", "2. Docs do not explain detached watchers"].join("\n"));
		expect(findings).toEqual([
			"Missing crash-only resume story",
			"Docs do not explain detached watchers",
		]);
	});

	it("builds a synthesis prompt from iteration text", () => {
		const prompt = buildSynthesisPrompt([
			{
				index: 1,
				focus: "testing",
				text: "## Findings\n- Add more integration coverage",
				toolUses: ["glob", "read"],
				inputTokens: 10,
				outputTokens: 20,
				costUsd: 0.01,
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T00:01:00.000Z",
			},
		]);
		expect(prompt).toContain("## Executive Summary");
		expect(prompt).toContain("### Iteration 1 — testing");
	});
});
