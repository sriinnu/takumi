import type { ToolDefinition } from "@takumi/core";
import type { ExperienceMemory } from "../context/experience-memory.js";

export interface ToolSelectionOptions {
	limit?: number;
	experienceMemory?: ExperienceMemory;
	alwaysInclude?: string[];
}

export interface RankedTool {
	tool: ToolDefinition;
	score: number;
	reason: string;
}

const DEFAULT_ALWAYS_INCLUDE = ["ask"];

/** Cache tokenized tool descriptions — tool definitions don't change within a session. */
const toolTokenCache = new WeakMap<ToolDefinition, Set<string>>();

function getToolTokens(tool: ToolDefinition): Set<string> {
	let tokens = toolTokenCache.get(tool);
	if (!tokens) {
		tokens = tokenize(`${tool.name} ${tool.description} ${tool.category}`);
		toolTokenCache.set(tool, tokens);
	}
	return tokens;
}

export function rankToolDefinitions(
	tools: ToolDefinition[],
	query: string,
	options: ToolSelectionOptions = {},
): RankedTool[] {
	const runtimeScores = new Map(
		(options.experienceMemory?.rankTools(tools, query) ?? []).map((entry) => [entry.name, entry]),
	);
	const queryTokens = tokenize(query);

	return tools
		.map((tool) => {
			let score = 0;
			const reasons: string[] = [];
			const runtime = runtimeScores.get(tool.name);
			if (runtime) {
				score += runtime.score;
				reasons.push(runtime.reason);
			}

			const searchable = getToolTokens(tool);
			for (const token of searchable) {
				if (queryTokens.has(token)) {
					score += 3;
				}
			}

			if (matchesVerificationQuery(query, tool)) {
				score += 3;
				reasons.push("verification-friendly");
			}
			if (matchesReadQuery(query, tool)) {
				score += 3;
				reasons.push("discovery-friendly");
			}
			if (matchesEditQuery(query, tool)) {
				score += 3;
				reasons.push("editing-friendly");
			}
			if (tool.requiresPermission) {
				score -= 1;
			}

			return {
				tool,
				score,
				reason: reasons.filter(Boolean).join(", ") || "fallback coverage",
			};
		})
		.sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
}

export function selectToolDefinitions(
	tools: ToolDefinition[],
	query: string,
	options: ToolSelectionOptions = {},
): ToolDefinition[] {
	if (tools.length <= 6) {
		return [...tools];
	}

	const ranked = rankToolDefinitions(tools, query, options);
	const limit = Math.min(options.limit ?? 12, Math.max(4, Math.ceil(tools.length * 0.75)));
	const selected = new Map<string, ToolDefinition>();
	for (const name of [...DEFAULT_ALWAYS_INCLUDE, ...(options.alwaysInclude ?? [])]) {
		const tool = tools.find((entry) => entry.name === name);
		if (tool) {
			selected.set(tool.name, tool);
		}
	}

	for (const entry of ranked) {
		selected.set(entry.tool.name, entry.tool);
		if (selected.size >= limit) {
			break;
		}
	}

	ensureCategoryCoverage(tools, selected, query);

	const order = new Map(ranked.map((entry, index) => [entry.tool.name, index]));
	return [...selected.values()].sort((left, right) => {
		const leftIndex = order.get(left.name) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex = order.get(right.name) ?? Number.MAX_SAFE_INTEGER;
		return leftIndex - rightIndex || left.name.localeCompare(right.name);
	});
}

function ensureCategoryCoverage(tools: ToolDefinition[], selected: Map<string, ToolDefinition>, query: string): void {
	if (/(read|inspect|search|find|understand|where)/i.test(query)) {
		addFirstOfCategory(tools, selected, "read");
	}
	if (/(edit|write|patch|change|update|rename|refactor)/i.test(query)) {
		addFirstOfCategory(tools, selected, "write");
	}
	if (/(test|verify|build|run|lint|check)/i.test(query)) {
		addFirstOfCategory(tools, selected, "execute");
	}
}

function addFirstOfCategory(
	tools: ToolDefinition[],
	selected: Map<string, ToolDefinition>,
	category: ToolDefinition["category"],
): void {
	const tool = tools.find((entry) => entry.category === category && !selected.has(entry.name));
	if (tool) {
		selected.set(tool.name, tool);
	}
}

function matchesVerificationQuery(query: string, tool: ToolDefinition): boolean {
	return tool.category === "execute" && /(test|verify|build|run|lint|check)/i.test(query);
}

function matchesReadQuery(query: string, tool: ToolDefinition): boolean {
	return tool.category === "read" && /(read|inspect|search|find|understand|open|trace)/i.test(query);
}

function matchesEditQuery(query: string, tool: ToolDefinition): boolean {
	return tool.category === "write" && /(edit|write|patch|change|update|rename|refactor|fix)/i.test(query);
}

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9_+#.-]+/g)
			.filter((token) => token.length > 1),
	);
}
