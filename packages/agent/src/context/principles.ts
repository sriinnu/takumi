import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition } from "@takumi/core";

const MEMORY_DIR = ".takumi/memory";
const PRINCIPLES_FILE = "principles.json";

export interface EvolvingPrinciple {
	id: string;
	text: string;
	triggers: string[];
	confidence: number;
	evidenceCount: number;
	createdAt: number;
	lastApplied: number;
}

export interface PrincipleTurnSignal {
	request: string;
	toolNames: string[];
	toolCategories: Array<NonNullable<ToolDefinition["category"]>>;
	hadError: boolean;
	finalResponse?: string;
}

export class PrincipleMemory {
	private readonly dir: string;
	private readonly filePath: string;
	private principles: EvolvingPrinciple[] = [];

	constructor(cwd: string) {
		this.dir = join(cwd, MEMORY_DIR);
		this.filePath = join(this.dir, PRINCIPLES_FILE);
	}

	load(): void {
		if (!existsSync(this.filePath)) {
			this.principles = [];
			return;
		}

		try {
			this.principles = JSON.parse(readFileSync(this.filePath, "utf-8")) as EvolvingPrinciple[];
		} catch {
			this.principles = [];
		}
	}

	save(): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(this.filePath, JSON.stringify(this.principles, null, "\t"), "utf-8");
	}

	observeTurn(signal: PrincipleTurnSignal): EvolvingPrinciple[] {
		if (signal.hadError) {
			return [];
		}

		const candidates = derivePrinciples(signal);
		const updated: EvolvingPrinciple[] = [];
		for (const candidate of candidates) {
			const existing = this.principles.find((principle) => principle.text === candidate.text);
			if (existing) {
				existing.confidence = Math.min(existing.confidence + 1, 10);
				existing.evidenceCount += 1;
				existing.lastApplied = Date.now();
				existing.triggers = unique([...existing.triggers, ...candidate.triggers]).slice(0, 8);
				updated.push(existing);
				continue;
			}

			const principle: EvolvingPrinciple = {
				id: `principle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				text: candidate.text,
				triggers: candidate.triggers,
				confidence: 1,
				evidenceCount: 1,
				createdAt: Date.now(),
				lastApplied: Date.now(),
			};
			this.principles.push(principle);
			updated.push(principle);
		}

		if (updated.length > 0) {
			this.principles.sort((left, right) => right.confidence - left.confidence || right.lastApplied - left.lastApplied);
			this.principles = this.principles.slice(0, 50);
		}

		return updated;
	}

	recall(query: string, limit = 5): EvolvingPrinciple[] {
		const tokens = tokenize(query);
		return [...this.principles]
			.map((principle) => {
				let score = principle.confidence * 2 + principle.evidenceCount;
				for (const trigger of principle.triggers) {
					if (tokens.has(trigger)) {
						score += 4;
					}
				}
				for (const token of tokenize(principle.text)) {
					if (tokens.has(token)) {
						score += 2;
					}
				}
				return { principle, score };
			})
			.filter((entry) => entry.score > 0)
			.sort((left, right) => right.score - left.score)
			.slice(0, limit)
			.map((entry) => entry.principle);
	}

	formatForPrompt(principles: EvolvingPrinciple[]): string {
		if (principles.length === 0) {
			return "";
		}

		return [
			"## Self-Evolving Principles",
			...principles.map((principle) => `- ${principle.text} (confidence: ${principle.confidence})`),
		].join("\n");
	}

	getAll(): EvolvingPrinciple[] {
		return [...this.principles];
	}
}

function derivePrinciples(signal: PrincipleTurnSignal): Array<{ text: string; triggers: string[] }> {
	const principles: Array<{ text: string; triggers: string[] }> = [];
	const request = signal.request.toLowerCase();
	const categories = new Set(signal.toolCategories);
	const toolNames = new Set(signal.toolNames);

	if (categories.has("read") && (categories.has("write") || request.includes("fix") || request.includes("edit"))) {
		principles.push({
			text: "Inspect the relevant files before making edits, then keep the change set minimal.",
			triggers: ["inspect", "edit", "fix", "refactor"],
		});
	}

	if (categories.has("execute") || /test|verify|build|lint|check/.test(request)) {
		principles.push({
			text: "Finish code changes with an executable verification step instead of trusting the first draft.",
			triggers: ["test", "verify", "build", "lint", "check"],
		});
	}

	if (
		(toolNames.has("grep") || toolNames.has("glob") || toolNames.has("read_file")) &&
		/find|search|trace|locate/.test(request)
	) {
		principles.push({
			text: "For investigation tasks, narrow the search space before opening or modifying files.",
			triggers: ["find", "search", "trace", "locate"],
		});
	}

	if (
		(request.includes("readme") || request.includes("docs") || request.includes("documentation")) &&
		categories.has("read")
	) {
		principles.push({
			text: "Documentation changes should start from the existing docs so terminology and roadmap stay consistent.",
			triggers: ["readme", "docs", "documentation"],
		});
	}

	if (signal.finalResponse && /verified|validated|build passed|tests passed/i.test(signal.finalResponse)) {
		principles.push({
			text: "When validation succeeds, surface the exact verification result so the user sees evidence, not vibes.",
			triggers: ["verified", "validated", "tests", "build"],
		});
	}

	return uniqueByText(principles);
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function uniqueByText(
	values: Array<{ text: string; triggers: string[] }>,
): Array<{ text: string; triggers: string[] }> {
	const seen = new Set<string>();
	const result: Array<{ text: string; triggers: string[] }> = [];
	for (const value of values) {
		if (seen.has(value.text)) {
			continue;
		}
		seen.add(value.text);
		result.push(value);
	}
	return result;
}

function tokenize(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.split(/[^a-z0-9_+#.-]+/g)
			.filter((token) => token.length > 1),
	);
}
