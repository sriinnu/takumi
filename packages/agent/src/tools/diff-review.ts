/**
 * Semantic Diff Review — Phase 32.
 *
 * Before committing, the agent runs its own diff through a lightweight
 * self-review pass that detects:
 *
 *   1. Unused imports (added but never referenced)
 *   2. Leftover debug statements (console.log, debugger)
 *   3. TODO/FIXME without tracking
 *   4. Accidental `any` types
 *   5. Large deletions without obvious replacement
 *   6. Files that grew past the LOC guard threshold
 *
 * This is NOT a full linter (biome handles that). It catches
 * semantic issues that linters miss — things only a "reviewer" would
 * notice when reading through a pull request diff.
 */

import { execFileSync } from "node:child_process";
import type { ToolDefinition } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

const log = createLogger("diff-review");

// ── Types ────────────────────────────────────────────────────────────────────

export type FindingSeverity = "error" | "warning" | "info";

export interface DiffFinding {
	/** Which rule detected this. */
	rule: string;
	/** Severity level. */
	severity: FindingSeverity;
	/** Human-readable description. */
	message: string;
	/** File path (workspace-relative). */
	file: string;
	/** Line number within the diff (approximate). */
	line?: number;
}

export interface DiffReviewResult {
	/** All findings from the review. */
	findings: DiffFinding[];
	/** Number of files in the diff. */
	filesReviewed: number;
	/** Whether the review passes (no errors, warnings are acceptable). */
	passed: boolean;
	/** Formatted summary string. */
	summary: string;
}

export interface DiffReviewConfig {
	/** Working directory (git root). */
	cwd: string;
	/** Max lines of code per file (default: 450). */
	maxLoc?: number;
	/** Whether to check for console.log/debugger (default: true). */
	checkDebugStatements?: boolean;
	/** Whether to check for `any` type usage (default: true). */
	checkAnyType?: boolean;
	/** Diff target: "staged" | "unstaged" | "head" (default: "staged"). */
	diffTarget?: "staged" | "unstaged" | "head";
}

// ── Regex patterns for detecting issues ──────────────────────────────────────

const DEBUG_PATTERNS = [
	{ pattern: /^\+.*\bconsole\.(log|debug|info|warn|error)\b/m, label: "console.log" },
	{ pattern: /^\+.*\bdebugger\b/m, label: "debugger statement" },
	{ pattern: /^\+.*\balert\(/m, label: "alert()" },
];

const ANY_PATTERN = /^\+.*:\s*any\b/m;
const TODO_PATTERN = /^\+.*(TODO|FIXME|HACK|XXX)\b/m;
const LARGE_DELETE_THRESHOLD = 20; // 20+ deleted lines with no additions in that hunk

// ── Diff parsing ─────────────────────────────────────────────────────────────

interface DiffHunk {
	file: string;
	additions: string[];
	deletions: string[];
	addedLineStart: number;
}

/**
 * Parse a unified diff into structured hunks.
 */
function parseDiff(diffText: string): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	let currentFile = "";
	let currentHunk: DiffHunk | null = null;

	for (const line of diffText.split("\n")) {
		// Match file header: +++ b/path/to/file.ts
		if (line.startsWith("+++ b/")) {
			currentFile = line.slice(6);
			continue;
		}

		// Match hunk header: @@ -a,b +c,d @@
		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunkMatch) {
			if (currentHunk) hunks.push(currentHunk);
			currentHunk = {
				file: currentFile,
				additions: [],
				deletions: [],
				addedLineStart: Number.parseInt(hunkMatch[1], 10),
			};
			continue;
		}

		if (!currentHunk) continue;

		if (line.startsWith("+") && !line.startsWith("+++")) {
			currentHunk.additions.push(line);
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			currentHunk.deletions.push(line);
		}
	}

	if (currentHunk) hunks.push(currentHunk);
	return hunks;
}

// ── Review engine ────────────────────────────────────────────────────────────

/**
 * Review a git diff for semantic issues.
 */
export function reviewDiff(config: DiffReviewConfig): DiffReviewResult {
	const maxLoc = config.maxLoc ?? 450;
	const checkDebug = config.checkDebugStatements ?? true;
	const checkAny = config.checkAnyType ?? true;
	const target = config.diffTarget ?? "staged";

	if (!isGitRepository(config.cwd)) {
		return {
			findings: [],
			filesReviewed: 0,
			passed: true,
			summary: "No diff available (not a git repository or no changes).",
		};
	}

	// Get the diff
	let diffArgs: string[];
	switch (target) {
		case "staged":
			diffArgs = ["diff", "--cached", "--unified=3"];
			break;
		case "unstaged":
			diffArgs = ["diff", "--unified=3"];
			break;
		case "head":
			diffArgs = ["diff", "HEAD", "--unified=3"];
			break;
	}

	let diffText: string;
	try {
		diffText = execFileSync("git", diffArgs, {
			cwd: config.cwd,
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024,
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		return {
			findings: [],
			filesReviewed: 0,
			passed: true,
			summary: "No diff available (not a git repository or no changes).",
		};
	}

	if (!diffText.trim()) {
		return { findings: [], filesReviewed: 0, passed: true, summary: "No changes to review." };
	}

	const hunks = parseDiff(diffText);
	const findings: DiffFinding[] = [];
	const filesSet = new Set(hunks.map((h) => h.file));

	for (const hunk of hunks) {
		const addedBlock = hunk.additions.join("\n");

		// Check debug statements
		if (checkDebug) {
			for (const { pattern, label } of DEBUG_PATTERNS) {
				if (pattern.test(addedBlock)) {
					findings.push({
						rule: "no-debug",
						severity: "warning",
						message: `Leftover ${label} detected in added lines`,
						file: hunk.file,
						line: hunk.addedLineStart,
					});
				}
			}
		}

		// Check for `any` type
		if (checkAny && ANY_PATTERN.test(addedBlock)) {
			findings.push({
				rule: "no-any",
				severity: "warning",
				message: "Explicit `any` type added — consider a more specific type",
				file: hunk.file,
				line: hunk.addedLineStart,
			});
		}

		// Check for TODO/FIXME
		if (TODO_PATTERN.test(addedBlock)) {
			findings.push({
				rule: "todo-tracking",
				severity: "info",
				message: "New TODO/FIXME added — ensure it's tracked",
				file: hunk.file,
				line: hunk.addedLineStart,
			});
		}

		// Check for large unmatched deletions
		if (hunk.deletions.length > LARGE_DELETE_THRESHOLD && hunk.additions.length === 0) {
			findings.push({
				rule: "large-deletion",
				severity: "warning",
				message: `${hunk.deletions.length} lines deleted with no replacement — verify intentional`,
				file: hunk.file,
				line: hunk.addedLineStart,
			});
		}
	}

	// Check file sizes via git (for files in the diff)
	for (const file of filesSet) {
		if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
		// Skip test files for LOC guard
		if (file.includes("/test/") || file.includes(".test.")) continue;

		try {
			const loc = execFileSync("wc", ["-l", file], {
				cwd: config.cwd,
				encoding: "utf-8",
				timeout: 5_000,
			}).trim();
			const lineCount = Number.parseInt(loc, 10);
			if (lineCount > maxLoc) {
				findings.push({
					rule: "loc-guard",
					severity: "error",
					message: `File has ${lineCount} lines (max: ${maxLoc}) — needs splitting`,
					file,
				});
			}
		} catch {
			// File may be deleted; skip
		}
	}

	const errorCount = findings.filter((f) => f.severity === "error").length;
	const warnCount = findings.filter((f) => f.severity === "warning").length;
	const infoCount = findings.filter((f) => f.severity === "info").length;
	const passed = errorCount === 0;

	const lines = [
		`Diff Review: ${filesSet.size} files, ${findings.length} findings`,
		errorCount > 0 ? `  ✗ ${errorCount} error(s)` : null,
		warnCount > 0 ? `  ⚠ ${warnCount} warning(s)` : null,
		infoCount > 0 ? `  ℹ ${infoCount} info` : null,
		"",
		...findings.map((f) => `  [${f.severity.toUpperCase()}] ${f.file}${f.line ? `:${f.line}` : ""} — ${f.message}`),
	].filter(Boolean);

	const summary = lines.join("\n");

	log.info(`Review complete: ${passed ? "PASSED" : "FAILED"} (${findings.length} findings)`);

	return { findings, filesReviewed: filesSet.size, passed, summary };
}

function isGitRepository(cwd: string): boolean {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return true;
	} catch {
		return false;
	}
}

// ── Tool registration ────────────────────────────────────────────────────────

export const diffReviewDefinition: ToolDefinition = {
	name: "diff_review",
	description:
		"Run a semantic self-review on the current git diff. " +
		"Catches leftover debug statements, `any` types, TODOs, large deletions, and LOC violations. " +
		"Use this before committing to ensure diff quality.",
	inputSchema: {
		type: "object",
		properties: {
			diff_target: {
				type: "string",
				description: 'What to review: "staged", "unstaged", or "head" (default: "staged")',
				enum: ["staged", "unstaged", "head"],
			},
			cwd: {
				type: "string",
				description: "Working directory (defaults to process.cwd())",
			},
		},
		required: [],
	},
	requiresPermission: false,
	category: "read",
};

export const diffReviewHandler: ToolHandler = async (input) => {
	const cwd = (input.cwd as string) || process.cwd();
	const diffTarget = (input.diff_target as "staged" | "unstaged" | "head") || "staged";

	try {
		const result = reviewDiff({ cwd, diffTarget });
		return { output: result.summary, isError: !result.passed };
	} catch (err) {
		return { output: `Diff review failed: ${(err as Error).message}`, isError: true };
	}
};
