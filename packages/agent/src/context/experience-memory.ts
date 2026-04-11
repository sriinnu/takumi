import type { ToolDefinition, ToolResult } from "@takumi/core";
import type { MessagePayload } from "../loop.js";

export interface ExperienceArchive {
	id: string;
	summary: string;
	messageCount: number;
	preservedCount: number;
	toolNames: string[];
	fileHints: string[];
	createdAt: number;
}

export interface ExperienceRecall {
	archive: ExperienceArchive;
	score: number;
	reason: string;
	matchedTerms: string[];
}

export interface ToolRuntimeSnapshot {
	toolName: string;
	lastInput: string;
	lastOutput: string;
	lastSuccess: boolean;
	lastUsedAt: number;
	successCount: number;
	failureCount: number;
	fileHints: string[];
}

export class ExperienceMemory {
	private archives: ExperienceArchive[] = [];
	private toolState = new Map<string, ToolRuntimeSnapshot>();
	private archiveCounter = 0;

	archiveCompaction(
		summary: string,
		compacted: MessagePayload[],
		preserved: MessagePayload[],
	): ExperienceArchive | null {
		if (!summary.trim()) {
			return null;
		}

		const archive: ExperienceArchive = {
			id: `MEM-${String(++this.archiveCounter).padStart(3, "0")}`,
			summary: collapseWhitespace(summary),
			messageCount: compacted.length,
			preservedCount: preserved.length,
			toolNames: collectToolNames(compacted),
			fileHints: collectArchiveFileHints(compacted),
			createdAt: Date.now(),
		};

		this.archives = [archive, ...this.archives].slice(0, 12);
		return archive;
	}

	recordToolUse(toolName: string, input: Record<string, unknown>, result: ToolResult): void {
		const current = this.toolState.get(toolName);
		const fileHints = unique([...extractFileHints(input), ...(current?.fileHints ?? [])]).slice(0, 6);
		const next: ToolRuntimeSnapshot = {
			toolName,
			lastInput: truncate(JSON.stringify(input), 180),
			lastOutput: truncate(typeof result.output === "string" ? result.output : JSON.stringify(result.output), 220),
			lastSuccess: !result.isError,
			lastUsedAt: Date.now(),
			successCount: (current?.successCount ?? 0) + (result.isError ? 0 : 1),
			failureCount: (current?.failureCount ?? 0) + (result.isError ? 1 : 0),
			fileHints,
		};
		this.toolState.set(toolName, next);
	}

	buildPromptSection(): string | null {
		return joinSections(this.buildArchiveCatalogPromptSection(), this.buildRuntimePromptSection());
	}

	buildArchiveCatalogPromptSection(maxArchives = 4): string | null {
		if (this.archives.length === 0) {
			return null;
		}

		const sections: string[] = ["## Indexed Experience Memory"];
		for (const archive of this.archives.slice(0, maxArchives)) {
			const toolText = archive.toolNames.length > 0 ? ` · tools: ${archive.toolNames.join(", ")}` : "";
			const fileText = archive.fileHints.length > 0 ? ` · files: ${archive.fileHints.join(", ")}` : "";
			sections.push(
				`- ${archive.id} · ${archive.messageCount} msgs compacted · ${archive.preservedCount} preserved${toolText}${fileText}`,
			);
			sections.push(`  ${truncate(archive.summary, 220)}`);
		}

		return sections.join("\n");
	}

	buildRuntimePromptSection(): string | null {
		const runtime = [...this.toolState.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 5);
		if (runtime.length === 0) {
			return null;
		}

		const sections: string[] = ["## Stateful Tool Runtime"];
		for (const snapshot of runtime) {
			const status = snapshot.lastSuccess ? "ok" : "error";
			const hints = snapshot.fileHints.length > 0 ? ` · files: ${snapshot.fileHints.join(", ")}` : "";
			sections.push(
				`- ${snapshot.toolName} · last ${status} · success ${snapshot.successCount}/${snapshot.successCount + snapshot.failureCount}${hints}`,
			);
			sections.push(`  input: ${snapshot.lastInput}`);
			sections.push(`  output: ${snapshot.lastOutput}`);
		}

		return sections.join("\n");
	}

	findRelevantArchives(userText: string, limit = 3): ExperienceRecall[] {
		const normalizedQuery = collapseWhitespace(userText.toLowerCase());
		const queryTerms = tokenizeSearchTerms(normalizedQuery);
		if (!normalizedQuery || queryTerms.length === 0 || this.archives.length === 0) {
			return [];
		}

		const now = Date.now();
		return this.archives
			.map((archive) => scoreArchive(archive, queryTerms, normalizedQuery, now))
			.filter((entry): entry is ExperienceRecall => Boolean(entry))
			.sort((left, right) => right.score - left.score || right.archive.createdAt - left.archive.createdAt)
			.slice(0, limit);
	}

	buildRehydrationPromptSection(userText: string, limit = 3): string | null {
		const recalls = this.findRelevantArchives(userText, limit);
		if (recalls.length === 0) {
			return null;
		}

		return [
			"## Relevant Archived Experience",
			...recalls.flatMap((recall) => {
				const reason = recall.reason ? ` · ${recall.reason}` : "";
				return [`- ${recall.archive.id}${reason}`, `  ${truncate(recall.archive.summary, 220)}`];
			}),
		].join("\n");
	}

	rankTools(
		availableTools: ToolDefinition[],
		userText: string,
	): Array<{ name: string; score: number; reason: string }> {
		const query = userText.toLowerCase();
		return availableTools
			.map((tool) => {
				const toolQuery = `${tool.name} ${tool.description}`.toLowerCase();
				let score = tokenOverlapScore(query, toolQuery);
				const state = this.toolState.get(tool.name);
				const reasons: string[] = [];
				if (score > 0) {
					reasons.push("matches request keywords");
				}
				if (state) {
					const total = state.successCount + state.failureCount;
					const successRatio = total > 0 ? state.successCount / total : 0;
					score += Math.round(successRatio * 4);
					if (Date.now() - state.lastUsedAt < 15 * 60 * 1000) {
						score += 2;
						reasons.push("recent runtime state available");
					}
					if (state.lastSuccess) {
						reasons.push("last run succeeded");
					}
				}
				if (tool.category === "read" && /(inspect|read|understand|find|search|check)/.test(query)) {
					score += 2;
					reasons.push("read-first task");
				}
				if (tool.category === "execute" && /(test|build|run|verify|lint)/.test(query)) {
					score += 2;
					reasons.push("verification task");
				}
				return {
					name: tool.name,
					score,
					reason: reasons.length > 0 ? unique(reasons).join(", ") : "general-purpose fallback",
				};
			})
			.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
			.slice(0, 5);
	}

	get archiveCount(): number {
		return this.archives.length;
	}

	get runtimeCount(): number {
		return this.toolState.size;
	}

	clear(): void {
		this.archives = [];
		this.toolState.clear();
		this.archiveCounter = 0;
	}

	/** Build a structured summary of files the agent has operated on, surviving compaction. */
	buildFileAwarenessSummary(): string | null {
		const fileTools = [...this.toolState.values()].filter((s) => s.fileHints.length > 0);
		if (fileTools.length === 0) return null;

		const lines = ["## File Awareness (survives compaction)"];
		const seen = new Set<string>();
		for (const snapshot of fileTools) {
			for (const hint of snapshot.fileHints) {
				if (seen.has(hint)) continue;
				seen.add(hint);
				const status = snapshot.lastSuccess ? "ok" : "error";
				lines.push(`- ${hint} (last: ${snapshot.toolName}, ${status})`);
			}
		}
		return lines.join("\n");
	}
}

function scoreArchive(
	archive: ExperienceArchive,
	queryTerms: string[],
	normalizedQuery: string,
	now: number,
): ExperienceRecall | null {
	const matchedFiles = archive.fileHints.filter((hint) => hasSearchMatch(hint, queryTerms, normalizedQuery));
	const matchedTools = archive.toolNames.filter((toolName) => hasSearchMatch(toolName, queryTerms, normalizedQuery));
	const matchedSummaryTerms = findMatchedTerms(archive.summary, queryTerms).slice(0, 4);
	if (matchedFiles.length === 0 && matchedTools.length === 0) {
		if (matchedSummaryTerms.length === 0) {
			return null;
		}
		if (matchedSummaryTerms.length === 1 && queryTerms.length > 1) {
			return null;
		}
	}

	let score = 0;
	const reasons: string[] = [];
	if (matchedFiles.length > 0) {
		score += matchedFiles.length * 6;
		reasons.push(`files: ${matchedFiles.join(", ")}`);
	}
	if (matchedTools.length > 0) {
		score += matchedTools.length * 4;
		reasons.push(`tools: ${matchedTools.join(", ")}`);
	}
	if (matchedSummaryTerms.length > 0) {
		score += matchedSummaryTerms.length * 2;
		reasons.push(`keywords: ${matchedSummaryTerms.join(", ")}`);
	}

	const ageMs = now - archive.createdAt;
	if (score > 0 && ageMs < 30 * 60 * 1000) {
		score += 1;
		reasons.push("recent archive");
	} else if (score > 0 && ageMs < 6 * 60 * 60 * 1000) {
		score += 0.5;
	}

	if (score === 0) {
		return null;
	}

	return {
		archive,
		score,
		reason: reasons.join(" · "),
		matchedTerms: unique([...matchedFiles, ...matchedTools, ...matchedSummaryTerms]),
	};
}

function collectToolNames(messages: MessagePayload[]): string[] {
	const names = new Set<string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (
				block &&
				typeof block === "object" &&
				"type" in block &&
				block.type === "tool_use" &&
				"name" in block &&
				typeof block.name === "string"
			) {
				names.add(block.name);
			}
		}
	}
	return [...names];
}

function collectArchiveFileHints(messages: MessagePayload[]): string[] {
	const hints: string[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (
				!block ||
				typeof block !== "object" ||
				!("type" in block) ||
				block.type !== "tool_use" ||
				!("input" in block) ||
				typeof block.input !== "object" ||
				block.input === null ||
				Array.isArray(block.input)
			) {
				continue;
			}
			hints.push(...extractFileHints(block.input as Record<string, unknown>));
		}
	}
	return unique(hints).slice(0, 8);
}

function extractFileHints(input: Record<string, unknown>): string[] {
	const hints: string[] = [];
	for (const [key, value] of Object.entries(input)) {
		if (!/(path|file|dir|cwd|target)/i.test(key) || typeof value !== "string") {
			continue;
		}
		hints.push(value);
	}
	return unique(hints).slice(0, 6);
}

function tokenOverlapScore(left: string, right: string): number {
	const leftTokens = new Set(left.split(/[^a-z0-9_]+/g).filter((token) => token.length > 2));
	let score = 0;
	for (const token of right.split(/[^a-z0-9_]+/g)) {
		if (token.length > 2 && leftTokens.has(token)) {
			score += 2;
		}
	}
	return score;
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function findMatchedTerms(value: string, queryTerms: string[]): string[] {
	const searchTerms = tokenizeSearchTerms(value);
	return unique(searchTerms.filter((term) => queryTerms.includes(term))).slice(0, 6);
}

function hasSearchMatch(value: string, queryTerms: string[], normalizedQuery: string): boolean {
	const normalizedValue = collapseWhitespace(value.toLowerCase());
	if (!normalizedValue) {
		return false;
	}
	if (normalizedQuery.includes(normalizedValue)) {
		return true;
	}
	return findMatchedTerms(normalizedValue, queryTerms).length > 0;
}

function tokenizeSearchTerms(value: string): string[] {
	const normalized = value
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/[_./-]+/g, " ")
		.toLowerCase();
	return unique(normalized.split(/[^a-z0-9]+/g).filter((term) => term.length > 2 && !STOP_WORDS.has(term)));
}

function joinSections(...sections: Array<string | null>): string | null {
	const filtered = sections.map((section) => section?.trim() ?? "").filter(Boolean);
	return filtered.length > 0 ? filtered.join("\n\n") : null;
}

function truncate(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}
	return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

const STOP_WORDS = new Set([
	"about",
	"after",
	"before",
	"check",
	"from",
	"into",
	"that",
	"the",
	"then",
	"this",
	"with",
]);
