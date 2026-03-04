/**
 * Adaptive System Prompt (Phase 41)
 *
 * Dynamically adjusts system prompt sections based on:
 *   - detected task type (code, search, chat, review, debug)
 *   - observed tool-usage patterns
 *   - remaining token budget / context pressure
 *
 * Works as a post-processor for the system prompt built by builder.ts.
 * Each section is tagged with priority, weight, and minimum / preferred
 * token budgets so the adapter can trim or expand intelligently.
 */

import { createLogger } from "@takumi/core";

const log = createLogger("adaptive-prompt");

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Task type inferred from the user's message or recent activity.
 */
export type TaskType = "code" | "search" | "chat" | "review" | "debug" | "unknown";

/**
 * A tagged section of the system prompt.
 */
export interface PromptSection {
	/** Unique identifier (e.g. "identity", "tools", "project", "guidelines"). */
	id: string;
	/** The raw text content. */
	content: string;
	/** Priority — higher is more important. 0-100. */
	priority: number;
	/** Estimated tokens (approx chars / 4). */
	estimatedTokens: number;
	/** Minimum tokens required to keep this section useful. */
	minTokens: number;
	/** Can this section be omitted entirely? */
	optional: boolean;
}

export interface AdaptivePromptConfig {
	/** Total token budget for the system prompt. */
	maxTokens: number;
	/** Weights per task type — each maps section IDs to priority boosts. */
	taskWeights: Record<TaskType, Record<string, number>>;
	/** Ratio of budget below which aggressive trimming kicks in. */
	pressureThreshold: number;
}

export interface ToolUsageProfile {
	/** Tool name → number of times used in the session so far. */
	counts: Record<string, number>;
	/** Total tool invocations. */
	total: number;
}

export interface AdaptResult {
	/** The adapted (possibly trimmed) system prompt. */
	prompt: string;
	/** Sections that were included. */
	includedSections: string[];
	/** Sections that were dropped. */
	droppedSections: string[];
	/** Estimated token usage. */
	estimatedTokens: number;
	/** Detected task type used for weighting. */
	taskType: TaskType;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_TASK_WEIGHTS: Record<TaskType, Record<string, number>> = {
	code: { tools: 20, project: 15, guidelines: 10, identity: 0, conventions: 10 },
	search: { tools: 25, project: 10, guidelines: 5, identity: 0, conventions: 0 },
	chat: { tools: -10, project: 5, guidelines: 5, identity: 15, conventions: 0 },
	review: { tools: 10, project: 20, guidelines: 15, identity: 0, conventions: 20 },
	debug: { tools: 15, project: 10, guidelines: 10, identity: 0, conventions: 5 },
	unknown: { tools: 10, project: 10, guidelines: 10, identity: 5, conventions: 5 },
};

const DEFAULT_CONFIG: AdaptivePromptConfig = {
	maxTokens: 4096,
	taskWeights: DEFAULT_TASK_WEIGHTS,
	pressureThreshold: 0.3,
};

// ── Task Classification ──────────────────────────────────────────────────────

const TASK_PATTERNS: [TaskType, RegExp][] = [
	["debug", /\b(debug|error|bug|fix|crash|stack\s?trace|exception|traceback|segfault)\b/i],
	["review", /\b(review|pr|pull\s?request|diff|code\s?review|approve|feedback)\b/i],
	["search", /\b(find|search|grep|where\s+is|look\s+for|locate|which\s+file)\b/i],
	["code", /\b(implement|create|write|add|build|refactor|update|modify|change)\b/i],
	["chat", /\b(explain|what\s+is|how\s+does|why|tell\s+me|describe|help)\b/i],
];

/** Infer task type from a user message. */
export function classifyTask(message: string): TaskType {
	for (const [type, regex] of TASK_PATTERNS) {
		if (regex.test(message)) return type;
	}
	return "unknown";
}

// ── Token Helpers ────────────────────────────────────────────────────────────

/** Rough token estimate (chars / 4). */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Truncate text to roughly fit a token budget. */
function truncateToTokens(text: string, maxTokens: number): string {
	const maxChars = maxTokens * 4;
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 3)}...`;
}

// ── AdaptivePromptManager ────────────────────────────────────────────────────

export class AdaptivePromptManager {
	private readonly config: AdaptivePromptConfig;
	private readonly toolProfile: ToolUsageProfile = { counts: {}, total: 0 };

	constructor(config?: Partial<AdaptivePromptConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ── Tool usage tracking ──────────────────────────────────────────────────

	/** Record a tool usage event. */
	recordToolUsage(toolName: string): void {
		this.toolProfile.counts[toolName] = (this.toolProfile.counts[toolName] ?? 0) + 1;
		this.toolProfile.total++;
	}

	/** Get current tool usage profile. */
	getToolProfile(): ToolUsageProfile {
		return { counts: { ...this.toolProfile.counts }, total: this.toolProfile.total };
	}

	// ── Section Parsing ──────────────────────────────────────────────────────

	/**
	 * Parse a system prompt built by builder.ts into tagged sections.
	 * Sections are delimited by `# Heading` lines.
	 */
	parseSections(systemPrompt: string): PromptSection[] {
		const lines = systemPrompt.split("\n");
		const sections: PromptSection[] = [];
		let currentId = "preamble";
		let currentLines: string[] = [];

		for (const line of lines) {
			const heading = line.match(/^#\s+(.+)/);
			if (heading) {
				if (currentLines.length > 0) {
					sections.push(this.buildSection(currentId, currentLines.join("\n")));
				}
				currentId = heading[1].toLowerCase().replace(/\s+/g, "-");
				currentLines = [line];
			} else {
				currentLines.push(line);
			}
		}

		if (currentLines.length > 0) {
			sections.push(this.buildSection(currentId, currentLines.join("\n")));
		}

		return sections;
	}

	private buildSection(id: string, content: string): PromptSection {
		const tokens = estimateTokens(content);
		return {
			id,
			content,
			priority: this.basePriority(id),
			estimatedTokens: tokens,
			minTokens: Math.max(20, Math.floor(tokens * 0.3)),
			optional: id !== "identity" && id !== "available-tools",
		};
	}

	private basePriority(id: string): number {
		const priorities: Record<string, number> = {
			identity: 90,
			"available-tools": 85,
			"project-context": 70,
			instructions: 60,
			guidelines: 55,
			environment: 50,
			conventions: 45,
			preamble: 40,
		};
		return priorities[id] ?? 40;
	}

	// ── Adapt ────────────────────────────────────────────────────────────────

	/**
	 * Adapt a system prompt to fit within the token budget,
	 * prioritising sections by task type and tool usage patterns.
	 */
	adapt(systemPrompt: string, taskType: TaskType): AdaptResult {
		const sections = this.parseSections(systemPrompt);
		const weights = this.config.taskWeights[taskType] ?? this.config.taskWeights.unknown;

		// Apply task-type priority boosts.
		for (const section of sections) {
			const boost = weights[section.id] ?? 0;
			section.priority += boost;
		}

		// Boost tool section if tools are heavily used.
		if (this.toolProfile.total > 10) {
			const toolSection = sections.find((s) => s.id === "available-tools");
			if (toolSection) toolSection.priority += 5;
		}

		// Sort by priority descending.
		sections.sort((a, b) => b.priority - a.priority);

		// Greedy packing within budget.
		let remaining = this.config.maxTokens;
		const included: PromptSection[] = [];
		const dropped: string[] = [];
		const underPressure = remaining < this.config.maxTokens * this.config.pressureThreshold;

		for (const section of sections) {
			if (section.estimatedTokens <= remaining) {
				included.push(section);
				remaining -= section.estimatedTokens;
			} else if (!section.optional) {
				// Must include — truncate to fit.
				const truncated = truncateToTokens(section.content, remaining);
				included.push({ ...section, content: truncated, estimatedTokens: remaining });
				remaining = 0;
			} else if (!underPressure && section.minTokens <= remaining) {
				// Trim to minimum.
				const truncated = truncateToTokens(section.content, remaining);
				included.push({ ...section, content: truncated, estimatedTokens: section.minTokens });
				remaining -= section.minTokens;
			} else {
				dropped.push(section.id);
			}
		}

		// Re-sort by original document order (based on the full list).
		const sectionOrder = this.parseSections(systemPrompt).map((s) => s.id);
		included.sort((a, b) => sectionOrder.indexOf(a.id) - sectionOrder.indexOf(b.id));

		const prompt = included.map((s) => s.content).join("\n\n");
		const estimatedTokens = this.config.maxTokens - remaining;

		log.info(
			`Adapted prompt: task=${taskType}, ` +
				`sections=${included.length}/${sections.length}, ` +
				`tokens≈${estimatedTokens}/${this.config.maxTokens}, ` +
				`dropped=[${dropped.join(", ")}]`,
		);

		return {
			prompt,
			includedSections: included.map((s) => s.id),
			droppedSections: dropped,
			estimatedTokens,
			taskType,
		};
	}

	// ── Convenience ──────────────────────────────────────────────────────────

	/**
	 * One-shot: classify a message, then adapt the prompt accordingly.
	 */
	adaptForMessage(systemPrompt: string, userMessage: string): AdaptResult {
		const taskType = classifyTask(userMessage);
		return this.adapt(systemPrompt, taskType);
	}
}
