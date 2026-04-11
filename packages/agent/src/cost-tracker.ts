/**
 * Streaming Cost Tracker (Phase 38)
 *
 * Real-time cost accumulation with per-turn breakdown, rate projection,
 * and configurable alert thresholds. Sits alongside BudgetGuard but is
 * observation-only — it never throws; it merely reports.
 *
 * Emits snapshots that the TUI can consume to render a live cost widget.
 */

import { createLogger } from "@takumi/core";
import {
	estimateUsageCost as estimateUsageCostValue,
	MODEL_PRICING,
	type ModelPrice,
	type UsageCostInput,
} from "./cost.js";

const log = createLogger("cost-tracker");

// ── Types ────────────────────────────────────────────────────────────────────

export interface TurnCost {
	turn: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd: number;
	model: string;
	/** Epoch ms when the turn completed. */
	timestamp: number;
}

export interface CostSnapshot {
	/** Total accumulated cost in USD. */
	totalUsd: number;
	/** Total input tokens consumed. */
	totalInputTokens: number;
	/** Total output tokens consumed. */
	totalOutputTokens: number;
	/** Per-turn cost breakdown (most recent last). */
	turns: TurnCost[];
	/** Projected cost per minute based on recent window. */
	ratePerMinute: number;
	/** Projected cost if the current rate continues for `projectionMinutes`. */
	projectedUsd: number;
	/** Fraction of budget consumed (0–1, or 0 if no budget). */
	budgetFraction: number;
	/** Active alert level based on budget thresholds. */
	alertLevel: AlertLevel;
	/** Average cost per turn. */
	avgCostPerTurn: number;
	/** Elapsed wall-clock seconds since tracker start. */
	elapsedSeconds: number;
}

export type AlertLevel = "none" | "info" | "warning" | "critical";

export interface CostTrackerConfig {
	/** Model used for pricing lookups. */
	model: string;
	/** Budget limit in USD (Infinity for unlimited). */
	budgetUsd: number;
	/** Seed totals when resuming an existing session. */
	initialInputTokens: number;
	/** Seed totals when resuming an existing session. */
	initialOutputTokens: number;
	/** Seed totals when resuming an existing session. */
	initialUsd: number;
	/** Window size (in turns) for rate projection (default 5). */
	rateWindow: number;
	/** Minutes to project forward (default 10). */
	projectionMinutes: number;
	/** Thresholds as fraction of budget: [info, warning, critical]. */
	alertThresholds: [number, number, number];
	/** Optional callback on each snapshot update. */
	onSnapshot?: (snapshot: CostSnapshot) => void;
}

const DEFAULT_CONFIG: Omit<CostTrackerConfig, "model"> = {
	budgetUsd: Number.POSITIVE_INFINITY,
	initialInputTokens: 0,
	initialOutputTokens: 0,
	initialUsd: 0,
	rateWindow: 5,
	projectionMinutes: 10,
	alertThresholds: [0.5, 0.75, 0.9],
	onSnapshot: undefined,
};

export type { UsageCostInput } from "./cost.js";

export function estimateUsageCost(usage: UsageCostInput, model: string): number {
	return estimateUsageCostValue(usage, model);
}

// ── CostTracker ──────────────────────────────────────────────────────────────

export class CostTracker {
	private readonly config: CostTrackerConfig;
	private readonly turns: TurnCost[] = [];
	private totalInputTokens = 0;
	private totalOutputTokens = 0;
	private totalUsd = 0;
	private readonly startTime: number;

	constructor(config: Pick<CostTrackerConfig, "model"> & Partial<CostTrackerConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config } as CostTrackerConfig;
		this.totalInputTokens = this.config.initialInputTokens;
		this.totalOutputTokens = this.config.initialOutputTokens;
		this.totalUsd = this.config.initialUsd;
		this.startTime = Date.now();
		log.debug(`CostTracker started for model=${config.model}`);
	}

	// ── Recording ────────────────────────────────────────────────────────────

	/**
	 * Record token usage from a completed LLM call.
	 * Returns the updated snapshot.
	 */
	record(
		inputTokens: number,
		outputTokens: number,
		model?: string,
		cacheReadTokens = 0,
		cacheWriteTokens = 0,
	): CostSnapshot {
		const m = model ?? this.config.model;
		const cost = estimateUsageCost({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, m);
		const turn: TurnCost = {
			turn: this.turns.length + 1,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheWriteTokens,
			costUsd: cost,
			model: m,
			timestamp: Date.now(),
		};

		this.turns.push(turn);
		this.totalInputTokens += inputTokens;
		this.totalOutputTokens += outputTokens;
		this.totalUsd += cost;

		const snap = this.snapshot();
		this.config.onSnapshot?.(snap);
		return snap;
	}

	// ── Snapshot ─────────────────────────────────────────────────────────────

	/** Build a read-only snapshot of current cost state. */
	snapshot(): CostSnapshot {
		const elapsedSeconds = (Date.now() - this.startTime) / 1_000;
		const rate = this.computeRate();
		const fraction = Number.isFinite(this.config.budgetUsd) ? this.totalUsd / this.config.budgetUsd : 0;
		const recordedUsd = this.turns.reduce((sum, turn) => sum + turn.costUsd, 0);

		return {
			totalUsd: this.totalUsd,
			totalInputTokens: this.totalInputTokens,
			totalOutputTokens: this.totalOutputTokens,
			turns: [...this.turns],
			ratePerMinute: rate,
			projectedUsd: this.totalUsd + rate * this.config.projectionMinutes,
			budgetFraction: fraction,
			alertLevel: this.computeAlertLevel(fraction),
			avgCostPerTurn: this.turns.length > 0 ? recordedUsd / this.turns.length : 0,
			elapsedSeconds,
		};
	}

	/** Get the pricing info for a model. */
	static pricing(model: string): ModelPrice {
		return MODEL_PRICING[model] ?? { inputPerM: 5.0, outputPerM: 15.0 };
	}

	/** Number of turns recorded so far. */
	get turnCount(): number {
		return this.turns.length;
	}

	/** Total cost accumulated. */
	get total(): number {
		return this.totalUsd;
	}

	/** Update the active budget limit without resetting accumulated totals. */
	setBudgetUsd(budgetUsd: number): CostSnapshot {
		this.config.budgetUsd = budgetUsd;
		const snap = this.snapshot();
		this.config.onSnapshot?.(snap);
		return snap;
	}

	/** Human-readable summary. */
	summary(): string {
		const snap = this.snapshot();
		const budget = Number.isFinite(this.config.budgetUsd) ? `$${this.config.budgetUsd.toFixed(2)}` : "unlimited";
		return (
			`$${snap.totalUsd.toFixed(4)} / ${budget}` +
			` | ${snap.turns.length} turns` +
			` | ~$${snap.ratePerMinute.toFixed(4)}/min` +
			` | ${snap.totalInputTokens.toLocaleString()} in / ${snap.totalOutputTokens.toLocaleString()} out`
		);
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	/** Compute cost rate (USD/minute) from the recent window of turns. */
	private computeRate(): number {
		const window = this.turns.slice(-this.config.rateWindow);
		if (window.length < 2) return 0;

		const oldest = window[0].timestamp;
		const newest = window[window.length - 1].timestamp;
		const spanMs = newest - oldest;
		if (spanMs <= 0) return 0;

		const windowCost = window.reduce((sum, t) => sum + t.costUsd, 0);
		return (windowCost / spanMs) * 60_000; // USD per minute
	}

	/** Map budget fraction to an alert level. */
	private computeAlertLevel(fraction: number): AlertLevel {
		const [info, warning, critical] = this.config.alertThresholds;
		if (fraction >= critical) return "critical";
		if (fraction >= warning) return "warning";
		if (fraction >= info) return "info";
		return "none";
	}
}
