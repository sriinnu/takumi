import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AutocycleManifestInput {
	objective: string;
	targetFile: string;
	evalCommand: string;
	evalBudgetMs: number;
	maxIterations: number;
	optimizeDirection: "minimize" | "maximize";
	metricRegex?: string;
	metricColumn?: string;
	manifestFile?: string;
	cwd?: string;
	createdAt?: string;
}

export function resolveAutocycleManifestPath(
	input: Pick<AutocycleManifestInput, "targetFile" | "manifestFile" | "cwd">,
): string {
	const cwd = path.resolve(input.cwd ?? process.cwd());
	if (input.manifestFile?.trim()) {
		return path.resolve(cwd, input.manifestFile);
	}

	const safeTargetStem =
		input.targetFile
			.replaceAll(/[\\/]+/g, "-")
			.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "") || "target";

	return path.join(cwd, ".takumi", "autocycle", `${safeTargetStem}.experiment.md`);
}

export function buildAutocycleManifestMarkdown(input: AutocycleManifestInput): string {
	const createdAt = input.createdAt ?? new Date().toISOString();
	const metricLine = input.metricColumn
		? `Metric column: \`${input.metricColumn}\``
		: input.metricRegex
			? `Metric regex: \`${input.metricRegex}\``
			: "Metric extraction: exit-code only";

	return [
		"# Takumi Autocycle Experiment",
		"",
		`- Created: ${createdAt}`,
		`- Objective: ${input.objective}`,
		`- Target file: \`${input.targetFile}\``,
		`- Eval command: \`${input.evalCommand}\``,
		`- Eval budget: ${Math.round(input.evalBudgetMs / 1000)}s`,
		`- Max iterations: ${input.maxIterations}`,
		`- Optimize direction: ${input.optimizeDirection}`,
		`- ${metricLine}`,
		"",
		"## Notes",
		"",
		"- This file captures the research intent and evaluation contract for this autocycle run.",
		"- The JSONL ledger remains the append-only source of iteration outcomes.",
	].join("\n");
}

export async function writeAutocycleManifest(input: AutocycleManifestInput): Promise<string> {
	const filePath = resolveAutocycleManifestPath(input);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${buildAutocycleManifestMarkdown(input)}\n`, "utf-8");
	return filePath;
}
