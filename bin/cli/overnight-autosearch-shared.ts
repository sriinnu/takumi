import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_HOURS = 8;
const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_MAX_TURNS = 16;
const RESEARCH_FOCI = [
	"architecture and package boundaries",
	"CLI, tmux, and terminal-first ergonomics",
	"desktop and macOS operator workflow",
	"agent runtime reliability and failure handling",
	"tooling safety, permissions, and unattended execution",
	"test coverage, regressions, and validation blind spots",
	"docs, onboarding, and discoverability",
	"performance, latency, and scaling bottlenecks",
] as const;

/**
 * I capture the portable overnight review options so the script entrypoint and
 * the bin test surface share one contract.
 */
export interface OvernightAutosearchOptions {
	cwd: string;
	hours: number;
	maxIterations: number;
	model?: string;
	reportFile?: string;
	maxTurns: number;
}

/**
 * I describe where the overnight review writes its synthesized output.
 */
export interface ResearchPaths {
	reportFile: string;
	rawLogFile: string;
}

/**
 * I keep each review iteration structured enough for the synthesis pass.
 */
export interface ResearchIterationResult {
	index: number;
	focus: string;
	text: string;
	toolUses: string[];
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	startedAt: string;
	completedAt: string;
}

/**
 * I normalize positive integer CLI inputs so long-running review jobs stay
 * within safe bounds even when callers pass garbage.
 */
export function clampPositiveInt(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.max(1, Math.floor(value));
}

/**
 * I rotate review focus areas so unattended passes do not burn all budget on a
 * single slice of the repo.
 */
export function buildFocusPlan(maxIterations: number): string[] {
	return Array.from({ length: clampPositiveInt(maxIterations, DEFAULT_MAX_ITERATIONS) }, (_, index) => {
		return RESEARCH_FOCI[index % RESEARCH_FOCI.length];
	});
}

/**
 * I keep default report paths under the workspace-local `.takumi/autosearch`
 * tree so cleanup and artifact discovery stay predictable.
 */
export function resolveResearchPaths(cwd: string, explicitReportFile?: string): ResearchPaths {
	if (explicitReportFile) {
		const reportFile = resolve(cwd, explicitReportFile);
		const suffix = reportFile.endsWith(".md") ? reportFile.slice(0, -3) : reportFile;
		return {
			reportFile,
			rawLogFile: `${suffix}.jsonl`,
		};
	}

	const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	const base = join(resolve(cwd), ".takumi", "autosearch", `overnight-${stamp}`);
	return {
		reportFile: `${base}.md`,
		rawLogFile: `${base}.jsonl`,
	};
}

/**
 * I build a bounded research prompt that keeps each pass grounded in local
 * evidence and biased toward fresh gaps instead of repeated findings.
 */
export function buildResearchPrompt(input: {
	focus: string;
	iteration: number;
	previousFindings: string[];
	deadlineHours: number;
}): string {
	const prior = input.previousFindings.length
		? input.previousFindings.slice(-6).map((item) => `- ${item}`).join("\n")
		: "- none yet";

	return [
		`Takumi repository review. Focus: ${input.focus}. Pass ${input.iteration}.`,
		`Total run budget: about ${input.deadlineHours} hour(s).`,
		"Read-only review only. Base conclusions on collected repository evidence.",
		"Think silently and return only the final answer.",
		"Do not narrate your process, do not emit tool logs, and do not include progress updates.",
		"Do not call external or repository tools when local evidence is already provided.",
		"Prefer new gaps, blind spots, or improvements not already covered below.",
		"Previous findings:",
		prior,
		"Return exactly these Markdown sections:",
		"## Findings",
		"- 3 to 4 items. For each: why it matters, evidence, next step.",
		"## Evidence",
		"- files, symbols, or searches inspected.",
		"## Morning Brief",
		"- top 2 follow-ups for tomorrow.",
	].join("\n");
}

/**
 * I compress iteration notes into one synthesis prompt so the final report
 * stays deterministic and easy to post-process.
 */
export function buildSynthesisPrompt(iterations: ResearchIterationResult[]): string {
	const combined = iterations
		.map((iteration) => {
			return [`### Iteration ${iteration.index} — ${iteration.focus}`, iteration.text.trim()].join("\n\n");
		})
		.join("\n\n");

	return [
		"Synthesize the repository review notes below.",
		"Deduplicate overlap and keep only high-confidence points.",
		"Return only the final synthesis. Do not include tool logs, intermediate reasoning, or progress narration.",
		"Return exactly these Markdown sections:",
		"## Executive Summary",
		"## Top Gaps",
		"## Recommended Next Moves",
		"## Evidence Map",
		"",
		combined,
	].join("\n");
}

/**
 * I extract short finding headlines so later passes can avoid spending budget on
 * the same point repeatedly.
 */
export function extractFindingHeadlines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- ") || /^[0-9]+\.\s/.test(line))
		.map((line) => line.replace(/^[-*]\s+/, "").replace(/^[0-9]+\.\s+/, ""))
		.slice(0, 8);
}

/**
 * I parse the overnight review CLI options in one place so tests and the script
 * entrypoint cannot drift.
 */
export function parseCliOptions(argv: string[]): OvernightAutosearchOptions {
	const { values } = parseArgs({
		args: argv,
		options: {
			hours: { type: "string" },
			maxIterations: { type: "string" },
			model: { type: "string" },
			report: { type: "string" },
			cwd: { type: "string" },
			maxTurns: { type: "string" },
		},
		strict: false,
	});
	const cwd = typeof values.cwd === "string" ? values.cwd : process.cwd();
	const model = typeof values.model === "string" ? values.model : undefined;
	const reportFile = typeof values.report === "string" ? values.report : undefined;
	const hours = typeof values.hours === "string" ? Number(values.hours) : DEFAULT_HOURS;
	const maxIterations = typeof values.maxIterations === "string" ? Number(values.maxIterations) : DEFAULT_MAX_ITERATIONS;
	const maxTurns = typeof values.maxTurns === "string" ? Number(values.maxTurns) : DEFAULT_MAX_TURNS;

	return {
		cwd: resolve(cwd),
		hours,
		maxIterations: clampPositiveInt(maxIterations, DEFAULT_MAX_ITERATIONS),
		model,
		reportFile,
		maxTurns: clampPositiveInt(maxTurns, DEFAULT_MAX_TURNS),
	};
}
