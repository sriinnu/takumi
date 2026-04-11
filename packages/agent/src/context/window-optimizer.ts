/**
 * Context window optimizer.
 *
 * I keep the prompt-packing and history-budget logic together here so the
 * runner and agent loop can share one truthful view of the model window.
 * This is the middleware seam that turns a pile of isolated features
 * (budgets, smart context, compaction, experience memory) into one bounded
 * context policy.
 */

import type { ExtensionRunner } from "../extensions/extension-runner.js";
import type { MessagePayload } from "../loop.js";
import { buildUserMessage } from "../message.js";
import { allocateTokenBudget, estimateTokens, type TokenBudget, truncateToTokenBudget } from "./budget.js";
import {
	compactMessagesDetailed,
	DEFAULT_COMPACT_OPTIONS,
	estimateTotalPayloadTokens,
	type PayloadCompactOptions,
} from "./compact.js";
import type { ExperienceMemory } from "./experience-memory.js";
import { type ContextItem, SmartContextWindow } from "./smart-context.js";

export interface PromptContextSection {
	/** Stable identifier for ranking and reporting. */
	id: string;
	/** Fully formatted section content, headings included when desired. */
	content: string;
	/** Context bucket for smart ranking heuristics. */
	kind?: ContextItem["kind"];
	/** Whether the section should receive a pin boost. */
	pinned?: boolean;
	/** Relative importance / reuse signal. */
	referenceCount?: number;
	/** Optional ripple proximity to the current task. */
	rippleDepth?: number;
	/** Last time the section was refreshed. */
	lastTouched?: number;
}

export interface OptimizedPromptWindow {
	prompt: string | undefined;
	budget: TokenBudget;
	historyTokens: number;
	promptBudgetTokens: number;
	basePromptTokens: number;
	sectionBudgetTokens: number;
	includedSectionIds: string[];
	excludedSectionIds: string[];
}

export interface HistoryCompactionPlan {
	budget: TokenBudget;
	softLimitTokens: number;
	hardLimitTokens: number;
	threshold: number;
}

export interface HistoryCompactionResult {
	summary: string;
	tokensBefore: number;
	tokensAfter: number;
	plan: HistoryCompactionPlan;
}

interface OptimizePromptWindowOptions {
	totalContextTokens: number;
	historyTokens: number;
	basePrompt?: string;
	sections: PromptContextSection[];
	promptBudgetTokens?: number;
	now?: number;
}

interface BuildHistoryCompactionPlanOptions {
	totalContextTokens: number;
	historyTokens: number;
	threshold?: number;
}

interface MaybeCompactHistoryOptions {
	messages: MessagePayload[];
	estimatedHistoryTokens: number;
	totalContextTokens: number;
	compactOptions?: Partial<PayloadCompactOptions> | false;
	extensionRunner?: ExtensionRunner;
	experienceMemory?: ExperienceMemory;
	signal?: AbortSignal;
}

const DEFAULT_PROMPT_SECTION_KIND: ContextItem["kind"] = "summary";

/**
 * Estimate the history footprint for the next turn, including the pending user
 * message that has not yet been appended to history.
 */
export function estimateTurnHistoryTokens(
	history: MessagePayload[],
	text: string,
	images?: Array<{ mediaType: string; data: string }>,
): number {
	return estimateTotalPayloadTokens([...history, { role: "user", content: buildUserMessage(text, images) }]);
}

/**
 * Pack optional prompt sections into the available system-prompt budget.
 *
 * The base prompt is treated as the immovable core. Everything else competes
 * for the remaining section budget using the SmartContextWindow scorer.
 */
export function optimizePromptWindow(options: OptimizePromptWindowOptions): OptimizedPromptWindow {
	const budget = allocateTokenBudget(options.totalContextTokens, options.historyTokens);
	const basePrompt = options.basePrompt?.trim() ?? "";
	const basePromptTokens = estimateTokens(basePrompt);
	const promptBudgetTokens = Math.max(0, options.promptBudgetTokens ?? budget.system);
	const sectionBudgetTokens = Math.max(0, promptBudgetTokens - basePromptTokens);

	if (sectionBudgetTokens === 0 || options.sections.length === 0) {
		const prompt = finalizePrompt(basePrompt, promptBudgetTokens);
		return {
			prompt,
			budget,
			historyTokens: options.historyTokens,
			promptBudgetTokens,
			basePromptTokens,
			sectionBudgetTokens,
			includedSectionIds: [],
			excludedSectionIds: options.sections.map((section) => section.id),
		};
	}

	const now = options.now ?? Date.now();
	const smartContext = new SmartContextWindow({ maxTokens: sectionBudgetTokens });
	const sectionsById = new Map<string, PromptContextSection>();

	for (const section of options.sections) {
		const content = section.content.trim();
		if (!content) {
			continue;
		}
		sectionsById.set(section.id, section);
		smartContext.upsert({
			id: section.id,
			content,
			kind: section.kind ?? DEFAULT_PROMPT_SECTION_KIND,
			lastTouched: section.lastTouched ?? now,
			referenceCount: Math.max(1, section.referenceCount ?? 1),
			pinned: section.pinned,
			rippleDepth: section.rippleDepth,
		});
	}

	const packed = smartContext.pack();
	const includedSections = packed.included
		.map(({ item }) => sectionsById.get(item.id))
		.filter((section): section is PromptContextSection => Boolean(section));
	const includedSectionIds = includedSections.map((section) => section.id);
	const excludedSectionIds = packed.excluded.map(({ item }) => item.id).filter((id) => sectionsById.has(id));

	const prompt = finalizePrompt(
		[basePrompt, ...includedSections.map((section) => section.content.trim())].filter(Boolean).join("\n\n"),
		promptBudgetTokens,
	);

	return {
		prompt,
		budget,
		historyTokens: options.historyTokens,
		promptBudgetTokens,
		basePromptTokens,
		sectionBudgetTokens,
		includedSectionIds,
		excludedSectionIds,
	};
}

/** Build the budget envelope the history compactor should respect. */
export function buildHistoryCompactionPlan(options: BuildHistoryCompactionPlanOptions): HistoryCompactionPlan {
	const budget = allocateTokenBudget(options.totalContextTokens, options.historyTokens);
	const threshold = clampThreshold(options.threshold ?? DEFAULT_COMPACT_OPTIONS.threshold);
	return {
		budget,
		softLimitTokens: Math.max(1, Math.floor(budget.history * threshold)),
		hardLimitTokens: budget.history,
		threshold,
	};
}

/**
 * Run history compaction when the estimated history footprint exceeds its
 * allocated slice of the model window.
 */
export async function maybeCompactHistory(
	options: MaybeCompactHistoryOptions,
): Promise<HistoryCompactionResult | null> {
	if (options.compactOptions === false) {
		return null;
	}

	const threshold =
		typeof options.compactOptions === "object" && options.compactOptions.threshold !== undefined
			? options.compactOptions.threshold
			: DEFAULT_COMPACT_OPTIONS.threshold;
	const plan = buildHistoryCompactionPlan({
		totalContextTokens: options.totalContextTokens,
		historyTokens: options.estimatedHistoryTokens,
		threshold,
	});
	if (options.estimatedHistoryTokens <= plan.softLimitTokens) {
		return null;
	}

	const beforeCompact = options.extensionRunner
		? await options.extensionRunner.emitCancellable({
				type: "session_before_compact",
				messageCount: options.messages.length,
				estimatedTokens: options.estimatedHistoryTokens,
				signal: options.signal ?? new AbortController().signal,
			})
		: undefined;
	if (beforeCompact?.cancel) {
		return null;
	}

	const compacted = compactMessagesDetailed(options.messages, {
		...(typeof options.compactOptions === "object" ? options.compactOptions : {}),
		maxTokens: plan.hardLimitTokens,
	});
	if (compacted.compactedMessages.length === 0) {
		return null;
	}

	const summaryOverride =
		beforeCompact && "summary" in beforeCompact && typeof beforeCompact.summary === "string"
			? beforeCompact.summary.trim()
			: "";
	let summary = summaryOverride || compacted.summary;
	if (summaryOverride) {
		overrideSummary(compacted.messages, summaryOverride);
	}

	options.experienceMemory?.archiveCompaction(summary, compacted.compactedMessages, compacted.preservedMessages);

	const fileAwareness = options.experienceMemory?.buildFileAwarenessSummary();
	if (fileAwareness) {
		injectFileAwareness(compacted.messages, fileAwareness);
	}

	options.messages.splice(0, options.messages.length, ...compacted.messages);
	const tokensAfter = estimateTotalPayloadTokens(options.messages);
	const summaryText = readSummary(compacted.messages) ?? summary;
	if (summaryText) {
		summary = summaryText;
	}

	if (options.extensionRunner) {
		await options.extensionRunner.emit({
			type: "session_compact",
			summary,
			tokensBefore: options.estimatedHistoryTokens,
			tokensAfter,
		});
	}

	return {
		summary,
		tokensBefore: options.estimatedHistoryTokens,
		tokensAfter,
		plan,
	};
}

function finalizePrompt(prompt: string, promptBudgetTokens: number): string | undefined {
	const trimmed = prompt.trim();
	if (!trimmed) {
		return undefined;
	}
	if (promptBudgetTokens <= 0) {
		return trimmed;
	}
	return truncateToTokenBudget(trimmed, promptBudgetTokens);
}

function clampThreshold(threshold: number): number {
	if (!Number.isFinite(threshold)) {
		return DEFAULT_COMPACT_OPTIONS.threshold;
	}
	return Math.min(1, Math.max(0.1, threshold));
}

function overrideSummary(messages: MessagePayload[], summary: string): void {
	const first = messages[0];
	if (!first || !Array.isArray(first.content) || first.content[0]?.type !== "text") {
		return;
	}
	first.content[0].text = summary;
}

function injectFileAwareness(messages: MessagePayload[], fileAwareness: string): void {
	const first = messages[0];
	if (!first || !Array.isArray(first.content) || first.content[0]?.type !== "text") {
		return;
	}
	if (first.content[0].text.includes(fileAwareness)) {
		return;
	}
	first.content[0].text = `${first.content[0].text}\n\n${fileAwareness}`;
}

function readSummary(messages: MessagePayload[]): string | null {
	const first = messages[0];
	if (!first || !Array.isArray(first.content) || first.content[0]?.type !== "text") {
		return null;
	}
	return first.content[0].text;
}
