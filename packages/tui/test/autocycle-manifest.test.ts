import { describe, expect, it } from "vitest";
import { buildAutocycleManifestMarkdown, resolveAutocycleManifestPath } from "../src/autocycle/autocycle-manifest.js";

describe("autocycle manifest helpers", () => {
	it("builds a markdown manifest with objective and metric details", () => {
		const markdown = buildAutocycleManifestMarkdown({
			objective: "Reduce validation bits per byte",
			targetFile: "train.py",
			evalCommand: "uv run train.py",
			evalBudgetMs: 300_000,
			maxIterations: 25,
			optimizeDirection: "minimize",
			metricColumn: "val_bpb",
			createdAt: "2026-03-22T00:00:00.000Z",
		});

		expect(markdown).toContain("# Takumi Autocycle Experiment");
		expect(markdown).toContain("Objective: Reduce validation bits per byte");
		expect(markdown).toContain("Metric column: `val_bpb`");
		expect(markdown).toContain("Eval budget: 300s");
	});

	it("derives a default manifest path under .takumi/autocycle", () => {
		const filePath = resolveAutocycleManifestPath({
			targetFile: "src/train.py",
			cwd: "/repo",
		});

		expect(filePath).toBe("/repo/.takumi/autocycle/src-train.py.experiment.md");
	});
});
