/**
 * Hub-aware slash commands (P0-2).
 *
 * I keep artifact review here and expose a legacy `/lane` shim so older route
 * muscle memory still works without stealing `/lanes` away from tracked
 * side-lane operations.
 */

import { gitBranch, gitDiff, gitStatus } from "@takumi/bridge";
import { type ArtifactKind, ArtifactStore } from "@takumi/core";
import { readArtifactPromotionSummary } from "../chitragupta/chitragupta-artifact-promotion.js";
import type { AppCommandContext } from "./app-command-context.js";
import { registerLegacyLaneCommand } from "./route-command-surface.js";

const artifactStore = new ArtifactStore();
const MAX_ARTIFACT_ROWS = 12;
const MAX_ARTIFACT_DETAIL_LINES = 160;
const ARTIFACT_KINDS: ArtifactKind[] = [
	"plan",
	"design_review",
	"implementation",
	"validation",
	"postmortem",
	"handoff",
	"assistant_response",
	"exec_result",
	"reflection",
	"summary",
];
const ARTIFACT_USAGE = [
	"Usage:",
	"  /artifacts                  — list session artifacts",
	"  /artifacts list [kind]      — list artifacts filtered by kind",
	"  /artifacts inspect <#|id>   — inspect artifact detail",
	"  /artifacts promote <#|id>   — mark artifact promoted",
	"  /artifacts demote <#|id>    — clear promoted flag",
	"  /artifacts review           — show repo diff review surface",
].join("\n");

type ArtifactManifestEntry = Awaited<ReturnType<ArtifactStore["manifest"]>>[number];
type StoredArtifactEntry = NonNullable<Awaited<ReturnType<ArtifactStore["load"]>>>;

/** Strip ANSI escape sequences from untrusted data before TUI display. */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function isArtifactKind(value: string): value is ArtifactKind {
	return ARTIFACT_KINDS.includes(value as ArtifactKind);
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	if (maxLength <= 1) return text.slice(0, maxLength);
	return `${text.slice(0, maxLength - 1)}…`;
}

function looksLikeDiff(text: string): boolean {
	return (
		text.includes("diff --git") ||
		text.includes("@@ ") ||
		text.split("\n").some((line) => line.startsWith("+") || line.startsWith("-"))
	);
}

function formatCodeFence(text: string, language = ""): string {
	const clean = stripAnsi(text).trimEnd();
	if (!clean) return "";
	const lines = clean.split("\n");
	const clipped = lines.slice(0, MAX_ARTIFACT_DETAIL_LINES).join("\n");
	const suffix = lines.length > MAX_ARTIFACT_DETAIL_LINES ? "\n… (truncated)" : "";
	return [`\`\`\`${language}`.trimEnd(), clipped, `${suffix}\n\`\`\``].join("\n");
}

async function loadScopedArtifacts(
	ctx: AppCommandContext,
	kind?: ArtifactKind,
	limit = MAX_ARTIFACT_ROWS,
): Promise<ArtifactManifestEntry[]> {
	const sessionIds = Array.from(
		new Set(
			[ctx.state.sessionId.value, ctx.state.canonicalSessionId.value].filter(
				(value): value is string => typeof value === "string" && value.length > 0,
			),
		),
	);
	const manifests =
		sessionIds.length > 0
			? await Promise.all(sessionIds.map((sessionId) => artifactStore.manifest({ sessionId, kind, limit })))
			: [await artifactStore.manifest({ kind, limit })];
	return Array.from(new Map(manifests.flat().map((entry) => [entry.artifactId, entry] as const)).values())
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
		.slice(0, limit);
}

function resolveImportState(
	ctx: AppCommandContext,
	artifactId: string,
	manifestStatus?: ArtifactManifestEntry["importStatus"],
): string {
	const summary = readArtifactPromotionSummary(ctx.state);
	if (summary.importedArtifactIds.includes(artifactId)) return "imported";
	if (summary.pendingArtifactIds.includes(artifactId)) return "pending";
	return manifestStatus ?? "local";
}

function formatArtifactState(ctx: AppCommandContext, artifact: ArtifactManifestEntry | StoredArtifactEntry): string {
	const states: string[] = [];
	if (artifact.promoted) states.push("promoted");
	states.push(resolveImportState(ctx, artifact.artifactId, artifact.importStatus));
	return Array.from(new Set(states)).join("/");
}

function formatArtifactList(ctx: AppCommandContext, artifacts: ArtifactManifestEntry[], kind?: ArtifactKind): string {
	const scopeIds = [ctx.state.sessionId.value, ctx.state.canonicalSessionId.value].filter(Boolean);
	const review = readArtifactPromotionSummary(ctx.state);
	const scopeLabel = scopeIds.length > 0 ? scopeIds.join(" • ") : "all local artifacts";
	const rows = artifacts.map((artifact, index) => {
		const time = new Date(artifact.createdAt).toLocaleTimeString();
		const stateLabel = formatArtifactState(ctx, artifact);
		return `  ${String(index + 1).padStart(2)}  ${stripAnsi(artifact.kind).padEnd(18)} ${stateLabel.padEnd(18)} ${time.padEnd(10)} ${stripAnsi(truncate(artifact.summary, 64))}`;
	});
	return [
		`## Hub Artifacts (${artifacts.length})`,
		"",
		`Scope: ${scopeLabel}`,
		`Review: ${review.status} • ${review.pendingArtifactIds.length} pending • ${review.importedArtifactIds.length} imported${kind ? ` • filter=${kind}` : ""}`,
		"",
		`  ${"#".padStart(4)}  ${"Kind".padEnd(18)} ${"State".padEnd(18)} ${"Time".padEnd(10)} Summary`,
		`  ${"─".repeat(4)}  ${"─".repeat(18)} ${"─".repeat(18)} ${"─".repeat(10)} ${"─".repeat(40)}`,
		...rows,
	].join("\n");
}

async function resolveArtifactTarget(
	ctx: AppCommandContext,
	target: string,
): Promise<{ artifact: StoredArtifactEntry; ordinal?: number } | null> {
	const trimmed = target.trim();
	if (!trimmed) return null;

	if (/^\d+$/.test(trimmed)) {
		const index = Number.parseInt(trimmed, 10);
		if (Number.isNaN(index) || index < 1) return null;
		const artifacts = await loadScopedArtifacts(ctx, undefined, MAX_ARTIFACT_ROWS);
		const match = artifacts[index - 1];
		if (!match) return null;
		const artifact = await artifactStore.load(match.artifactId);
		return artifact ? { artifact, ordinal: index } : null;
	}

	const direct = await artifactStore.load(trimmed);
	if (direct) return { artifact: direct };

	const artifacts = await loadScopedArtifacts(ctx, undefined, MAX_ARTIFACT_ROWS * 2);
	const prefixMatch = artifacts.find((artifact) => artifact.artifactId.startsWith(trimmed));
	if (!prefixMatch) return null;
	const artifact = await artifactStore.load(prefixMatch.artifactId);
	return artifact ? { artifact } : null;
}

function formatArtifactDetail(ctx: AppCommandContext, artifact: StoredArtifactEntry, ordinal?: number): string {
	const detailLines = [
		"## Artifact Review",
		"",
		`${ordinal ? `#${ordinal} • ` : ""}${artifact.kind} • ${artifact.producer} • ${new Date(artifact.createdAt).toLocaleString()}`,
		`State: ${formatArtifactState(ctx, artifact)}`,
		`Artifact ID: ${artifact.artifactId}`,
		`Summary: ${stripAnsi(artifact.summary)}`,
	];

	if (artifact.path) detailLines.push(`Path: ${artifact.path}`);
	if (artifact.taskId) detailLines.push(`Task: ${artifact.taskId}`);
	if (artifact.laneId) detailLines.push(`Lane: ${artifact.laneId}`);
	if (typeof artifact.confidence === "number")
		detailLines.push(`Confidence: ${(artifact.confidence * 100).toFixed(0)}%`);
	if (artifact.lastImportError) detailLines.push(`Last import error: ${stripAnsi(artifact.lastImportError)}`);
	if (artifact.metadata && Object.keys(artifact.metadata).length > 0) {
		detailLines.push("", "### Metadata");
		for (const [key, value] of Object.entries(artifact.metadata).slice(0, 8)) {
			detailLines.push(`- ${key}: ${stripAnsi(typeof value === "string" ? value : JSON.stringify(value))}`);
		}
	}

	if (!artifact.body?.trim()) {
		detailLines.push("", "This artifact has metadata only.");
		return detailLines.join("\n");
	}

	const fence = looksLikeDiff(artifact.body) ? "diff" : "text";
	detailLines.push("", "### Body", formatCodeFence(artifact.body, fence));
	return detailLines.join("\n");
}

function buildRepoReviewSurface(): string {
	const cwd = process.cwd();
	const status = gitStatus(cwd);
	const branch = gitBranch(cwd) ?? "unknown";
	if (!status || status.isClean) {
		return `## Review Surface\n\nBranch: ${branch}\n\nRepo is clean — nothing to review.`;
	}

	const stagedDiff = gitDiff(cwd, true) ?? "";
	const workingDiff = gitDiff(cwd, false) ?? "";
	const lines = [
		"## Review Surface",
		"",
		`Branch: ${branch}`,
		`Staged: ${status.staged.length} • Modified: ${status.modified.length} • Untracked: ${status.untracked.length}`,
	];

	if (status.staged.length > 0) lines.push(`Staged files: ${status.staged.join(", ")}`);
	if (status.modified.length > 0) lines.push(`Modified files: ${status.modified.join(", ")}`);
	if (status.untracked.length > 0) lines.push(`Untracked files: ${status.untracked.join(", ")}`);
	if (stagedDiff.trim()) lines.push("", "### Staged diff", formatCodeFence(stagedDiff, "diff"));
	if (workingDiff.trim()) lines.push("", "### Working diff", formatCodeFence(workingDiff, "diff"));
	return lines.join("\n");
}

async function completeArtifactArgs(ctx: AppCommandContext, partial: string): Promise<string[]> {
	const subcommands = ["list", "inspect ", "promote ", "demote ", "review"];
	const normalized = partial.trimStart();
	const hasTrailingSpace = /\s$/.test(partial);
	if (!normalized) return subcommands;

	const tokens = normalized.split(/\s+/);
	const sub = tokens[0].toLowerCase();

	if (tokens.length === 1 && !hasTrailingSpace) {
		return [...subcommands, ...ARTIFACT_KINDS.map((kind) => `${kind} `)].filter((value) => value.startsWith(sub));
	}

	if (sub === "list" || (tokens.length === 1 && hasTrailingSpace)) {
		const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
		return ARTIFACT_KINDS.filter((kind) => kind.startsWith(prefix));
	}

	if (["inspect", "show", "detail", "promote", "demote"].includes(sub)) {
		const prefix = hasTrailingSpace ? "" : (tokens[1] ?? "");
		const artifacts = await loadScopedArtifacts(ctx, undefined, MAX_ARTIFACT_ROWS);
		return artifacts.map((artifact) => `${artifact.artifactId} `).filter((artifactId) => artifactId.startsWith(prefix));
	}

	return [];
}

export function registerHubCommands(ctx: AppCommandContext): void {
	registerLegacyLaneCommand(ctx);

	// ── /artifacts — list hub artifacts from this session ─────────────────────
	ctx.commands.register(
		"/artifacts",
		"Inspect session artifacts and repo review state",
		async (args) => {
			const trimmed = args.trim();
			const [rawSubcommand = "list", ...rest] = trimmed ? trimmed.split(/\s+/) : [];
			const subcommand = rawSubcommand.toLowerCase();

			try {
				if (!trimmed || subcommand === "list" || isArtifactKind(subcommand)) {
					const requestedKind = isArtifactKind(subcommand)
						? subcommand
						: rest[0] && isArtifactKind(rest[0].toLowerCase())
							? (rest[0].toLowerCase() as ArtifactKind)
							: undefined;
					const artifacts = await loadScopedArtifacts(ctx, requestedKind);
					if (artifacts.length === 0) {
						return ctx.addInfoMessage(
							requestedKind
								? `No ${requestedKind} artifacts recorded for this session yet.`
								: "No artifacts recorded for this session yet.",
						);
					}
					return ctx.addInfoMessage(formatArtifactList(ctx, artifacts, requestedKind));
				}

				if (["inspect", "show", "detail"].includes(subcommand)) {
					const target = rest.join(" ").trim();
					if (!target) return ctx.addInfoMessage("Usage: /artifacts inspect <#|artifact-id>");
					const resolved = await resolveArtifactTarget(ctx, target);
					if (!resolved) return ctx.addInfoMessage(`Artifact not found: ${target}`);
					return ctx.addInfoMessage(formatArtifactDetail(ctx, resolved.artifact, resolved.ordinal));
				}

				if (subcommand === "promote" || subcommand === "demote") {
					const target = rest.join(" ").trim();
					if (!target) return ctx.addInfoMessage(`Usage: /artifacts ${subcommand} <#|artifact-id>`);
					const resolved = await resolveArtifactTarget(ctx, target);
					if (!resolved) return ctx.addInfoMessage(`Artifact not found: ${target}`);
					const promoted = subcommand === "promote";
					const changed = await artifactStore.setPromoted(resolved.artifact.artifactId, promoted);
					if (!changed) {
						return ctx.addInfoMessage(`Failed to ${subcommand} artifact ${resolved.artifact.artifactId}.`);
					}
					return ctx.addInfoMessage(
						`${promoted ? "Promoted" : "Demoted"} ${resolved.artifact.artifactId} • ${stripAnsi(resolved.artifact.summary)}`,
					);
				}

				if (["review", "repo", "diff"].includes(subcommand)) {
					return ctx.addInfoMessage(buildRepoReviewSurface());
				}

				return ctx.addInfoMessage(ARTIFACT_USAGE);
			} catch (err) {
				return ctx.addInfoMessage(`Failed to inspect artifacts: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
		{ aliases: ["/art"], getArgumentCompletions: (partial) => completeArtifactArgs(ctx, partial) },
	);
}
