import type { NativeSideAgentLaneSpec, NativeSideAgentQueryResult } from "../workflow/workflow-side-agent-lanes.js";
import type { AppCommandContext } from "./app-command-context.js";
import { buildSessionContext } from "./app-command-macros.js";

export interface NativeWorktreeCreateResult {
	path: string;
	branch: string;
	label: string;
}

export function parseTestMode(args: string): { mode: "unit" | "integration" | "e2e"; scope: string } {
	const trimmed = args.trim();
	if (!trimmed) {
		return { mode: "unit", scope: "" };
	}
	const [first, ...rest] = trimmed.split(/\s+/);
	if (first === "unit" || first === "integration" || first === "e2e") {
		return { mode: first, scope: rest.join(" ").trim() };
	}
	return { mode: "unit", scope: trimmed };
}

export function buildPlanningPrompt(kind: string, task: string, ctx: AppCommandContext, extra = ""): string {
	return [
		`Workflow command: ${kind}`,
		"Stay in analysis mode.",
		"Do not edit files, do not write code, and do not run mutating commands.",
		extra,
		"Return concise Markdown with: framing, assumptions, plan/options, risks, and next steps.",
		"",
		buildSessionContext(ctx),
		"",
		`Task: ${task}`,
	]
		.filter(Boolean)
		.join("\n");
}

export function slugifyLaneLabel(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 24);
	return slug || `lane-${Date.now().toString(36)}`;
}

export function formatDelegatedLaneOutput(label: string, report: NativeSideAgentQueryResult): string {
	return [
		`Delegated ${label} lane output:`,
		typeof report.response === "string" ? report.response : JSON.stringify(report.response, null, 2),
	].join("\n");
}

export function buildTeamLaneSpecs(task: string): NativeSideAgentLaneSpec[] {
	return [
		{
			label: "architect",
			task: `Architecture lane for: ${task}`,
			query: [
				`Define the architect lane charter for: ${task}`,
				"Return strict JSON with keys: summary, mission, deliverables, dependencies, risks, firstMoves.",
				"Focus on decomposition, interfaces, sequencing, and where parallel lanes must sync.",
			].join("\n"),
			topic: "architecture",
			complexity: "STANDARD",
		},
		{
			label: "builder",
			task: `Implementation lane for: ${task}`,
			query: [
				`Define the builder lane charter for: ${task}`,
				"Return strict JSON with keys: summary, mission, deliverables, dependencies, risks, firstMoves.",
				"Focus on implementation slices, merge order, and what can run independently without cross-lane thrash.",
			].join("\n"),
			topic: "code-generation",
			complexity: "STANDARD",
		},
		{
			label: "verifier",
			task: `Verification lane for: ${task}`,
			query: [
				`Define the verifier lane charter for: ${task}`,
				"Return strict JSON with keys: summary, mission, deliverables, dependencies, risks, firstMoves.",
				"Focus on validation gates, failure signals, rollout safety, and what must be proven before merge.",
			].join("\n"),
			topic: "testing",
			complexity: "CRITICAL",
		},
	];
}
