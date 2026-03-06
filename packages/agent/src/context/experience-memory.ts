import type { ToolDefinition, ToolResult } from "@takumi/core";
import type { MessagePayload } from "../loop.js";

export interface ExperienceArchive {
	id: string;
	summary: string;
	messageCount: number;
	preservedCount: number;
	toolNames: string[];
	createdAt: number;
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
		const cleanSummary = summary.trim();
		if (!cleanSummary) {
			return null;
		}

		const archive: ExperienceArchive = {
			id: `MEM-${String(++this.archiveCounter).padStart(3, "0")}`,
			summary: collapseWhitespace(cleanSummary),
			messageCount: compacted.length,
			preservedCount: preserved.length,
			toolNames: collectToolNames(compacted),
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
		if (this.archives.length === 0 && this.toolState.size === 0) {
			return null;
		}

		const sections: string[] = ["## Indexed Experience Memory"];
		for (const archive of this.archives.slice(0, 4)) {
			const toolText = archive.toolNames.length > 0 ? ` · tools: ${archive.toolNames.join(", ")}` : "";
			sections.push(
				`- ${archive.id} · ${archive.messageCount} msgs compacted · ${archive.preservedCount} preserved${toolText}`,
			);
			sections.push(`  ${truncate(archive.summary, 220)}`);
		}

		const runtime = [...this.toolState.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 5);
		if (runtime.length > 0) {
			sections.push("## Stateful Tool Runtime");
			for (const snapshot of runtime) {
				const status = snapshot.lastSuccess ? "ok" : "error";
				const hints = snapshot.fileHints.length > 0 ? ` · files: ${snapshot.fileHints.join(", ")}` : "";
				sections.push(
					`- ${snapshot.toolName} · last ${status} · success ${snapshot.successCount}/${snapshot.successCount + snapshot.failureCount}${hints}`,
				);
				sections.push(`  input: ${snapshot.lastInput}`);
				sections.push(`  output: ${snapshot.lastOutput}`);
			}
		}

		return sections.join("\n");
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

function truncate(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}
	return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}
