/**
 * LLM cost tracking and projection.
 *
 * Pricing table: USD per 1M tokens (input / output).
 * Curated from public provider pricing pages — approximate, updated Q1 2026.
 *
 * BudgetGuard enforces a hard-stop when the configured limit is reached,
 * allowing callers to abort rather than silently overspend.
 */

import { TaskComplexity } from "./classifier.js";

// ── Pricing table ─────────────────────────────────────────────────────────────

export interface ModelPrice {
	/** USD per 1M input tokens. */
	inputPerM: number;
	/** USD per 1M output tokens. */
	outputPerM: number;
}

/** Per-model pricing in USD/1M tokens. Falls back to DEFAULT_PRICE. */
export const MODEL_PRICING: Record<string, ModelPrice> = {
	// Anthropic
	"claude-opus-4-20250514": { inputPerM: 15.0, outputPerM: 75.0 },
	"claude-sonnet-4-20250514": { inputPerM: 3.0, outputPerM: 15.0 },
	"claude-haiku-3-20240307": { inputPerM: 0.25, outputPerM: 1.25 },
	// OpenAI
	"gpt-4o": { inputPerM: 5.0, outputPerM: 15.0 },
	"gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
	o1: { inputPerM: 15.0, outputPerM: 60.0 },
	"o1-mini": { inputPerM: 3.0, outputPerM: 12.0 },
	// Google
	"gemini-2.0-flash": { inputPerM: 0.1, outputPerM: 0.4 },
	"gemini-2.0-pro": { inputPerM: 3.5, outputPerM: 10.5 },
	// Groq (billed by compute, priced similarly)
	"llama-3.3-70b-versatile": { inputPerM: 0.59, outputPerM: 0.79 },
	"llama-3.1-8b-instant": { inputPerM: 0.05, outputPerM: 0.08 },
	// DeepSeek
	"deepseek-reasoner": { inputPerM: 0.55, outputPerM: 2.19 },
	"deepseek-chat": { inputPerM: 0.27, outputPerM: 1.1 },
};

/** Fallback when model is not in the pricing table. */
const DEFAULT_PRICE: ModelPrice = { inputPerM: 5.0, outputPerM: 15.0 };

// ── Cost estimation ───────────────────────────────────────────────────────────

/**
 * Compute actual cost in USD for a completed API call.
 */
export function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
	const price = MODEL_PRICING[model] ?? DEFAULT_PRICE;
	return (inputTokens / 1_000_000) * price.inputPerM + (outputTokens / 1_000_000) * price.outputPerM;
}

/** Typical token consumption per agent role type (conservative estimates). */
const TOKENS_PER_AGENT: Record<TaskComplexity, { agents: number; tokensEach: number }> = {
	[TaskComplexity.TRIVIAL]: { agents: 1, tokensEach: 4_000 },
	[TaskComplexity.SIMPLE]: { agents: 2, tokensEach: 8_000 },
	[TaskComplexity.STANDARD]: { agents: 4, tokensEach: 12_000 },
	[TaskComplexity.CRITICAL]: { agents: 7, tokensEach: 20_000 },
};

export interface CostEstimate {
	/** Lower bound in USD (minimal successful run). */
	minUsd: number;
	/** Upper bound in USD (full retry, all validators). */
	maxUsd: number;
	/** Assumed number of agents at this complexity. */
	agentCount: number;
}

/**
 * Pre-execution cost projection for a multi-agent cluster task.
 * The range accounts for validation retries (up to 3×).
 */
export function estimateClusterCost(complexity: TaskComplexity, model: string): CostEstimate {
	const { agents, tokensEach } = TOKENS_PER_AGENT[complexity];
	const price = MODEL_PRICING[model] ?? DEFAULT_PRICE;
	// 30% input, 70% output split is typical for coding tasks
	const costPerAgent =
		((tokensEach * 0.3) / 1_000_000) * price.inputPerM + ((tokensEach * 0.7) / 1_000_000) * price.outputPerM;
	const minUsd = costPerAgent * agents;
	const maxUsd = costPerAgent * agents * 3; // worst-case: 3 validation retries
	return { minUsd, maxUsd, agentCount: agents };
}

// ── BudgetGuard ───────────────────────────────────────────────────────────────

export class BudgetExceededError extends Error {
	constructor(
		public readonly spentUsd: number,
		public readonly limitUsd: number,
	) {
		super(`Budget exceeded: spent $${spentUsd.toFixed(4)} of $${limitUsd.toFixed(2)} limit`);
		this.name = "BudgetExceededError";
	}
}

export interface BudgetGuardOptions {
	/** Hard spend limit in USD. */
	limitUsd: number;
	/** Model ID used to price token usage. */
	model: string;
	/** Optional callback fired after each record() call (for status-bar updates). */
	onUpdate?: (spentUsd: number, limitUsd: number) => void;
}

/**
 * Tracks cumulative spend and throws BudgetExceededError when the limit
 * is crossed. Designed to be called from the agent loop on every
 * `usage_update` event.
 */
export class BudgetGuard {
	private spentUsd = 0;
	private readonly limitUsd: number;
	private readonly model: string;
	private readonly onUpdate?: (spentUsd: number, limitUsd: number) => void;

	constructor(opts: BudgetGuardOptions) {
		this.limitUsd = opts.limitUsd;
		this.model = opts.model;
		this.onUpdate = opts.onUpdate;
	}

	/**
	 * Record token usage from a single LLM call.
	 * Throws BudgetExceededError if the running total exceeds the limit.
	 */
	record(inputTokens: number, outputTokens: number): void {
		this.spentUsd += estimateCost(inputTokens, outputTokens, this.model);
		this.onUpdate?.(this.spentUsd, this.limitUsd);
		if (this.spentUsd > this.limitUsd) {
			throw new BudgetExceededError(this.spentUsd, this.limitUsd);
		}
	}

	/** Current spend in USD. */
	get spent(): number {
		return this.spentUsd;
	}

	/** Remaining budget in USD (may be negative if exceeded). */
	get remaining(): number {
		return this.limitUsd - this.spentUsd;
	}

	/** Fraction of budget consumed (0–1+). Returns 0 for unlimited budget. */
	get fraction(): number {
		if (!Number.isFinite(this.limitUsd)) return 0;
		return this.spentUsd / this.limitUsd;
	}

	/** Summary string for display. */
	summary(): string {
		const limitStr = Number.isFinite(this.limitUsd) ? `$${this.limitUsd.toFixed(2)}` : "unlimited";
		const pctStr = Number.isFinite(this.limitUsd) ? ` (${(this.fraction * 100).toFixed(1)}%)` : "";
		return `$${this.spentUsd.toFixed(4)} / ${limitStr}${pctStr}`;
	}
}
