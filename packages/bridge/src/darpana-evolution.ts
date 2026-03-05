/**
 * Darpana Evolution Hooks — Phase 54
 *
 * Adds intelligence layers between Takumi and the LLM proxy:
 *
 * 1. **Request Transform** — Modify prompts before they reach the LLM,
 *    applying learned optimizations from Chitragupta patterns.
 * 2. **Response Reflect** — Compare LLM output against Chitragupta
 *    predictions to track accuracy and improve future predictions.
 * 3. **Cost Router** — Suggest cheaper models when Chitragupta
 *    predicts high confidence for the current task.
 *
 * This is the "Darpana Evolution" layer from the binding spec:
 * the mirror that transforms what passes through it.
 *
 * Design:
 * - Pure functions + a lightweight coordinator class.
 * - Hooks are optional — each can be enabled/disabled independently.
 * - No direct LLM calls — just transforms on existing message payloads.
 * - Cost routing is advisory (returns a recommendation, doesn't override).
 */

import { createLogger } from "@takumi/core";

const log = createLogger("darpana-evolution");

// ── Types ────────────────────────────────────────────────────────────────────

/** A transform applied to outgoing LLM messages. */
export interface RequestTransform {
	/** Unique identifier for this transform. */
	id: string;
	/** Human-readable description. */
	description: string;
	/** Priority (lower = applied first). */
	priority: number;
	/** Whether this transform is currently enabled. */
	enabled: boolean;
	/** Source of the transform (manual, pattern, prediction). */
	source: "manual" | "pattern" | "prediction";
	/**
	 * Transform function. Receives system prompt + messages, returns modified versions.
	 * Return null to skip (no-op).
	 */
	apply: (ctx: TransformContext) => TransformResult | null;
}

export interface TransformContext {
	systemPrompt: string;
	messages: ReadonlyArray<{ role: string; content: string }>;
	model: string;
	sessionId: string;
}

export interface TransformResult {
	systemPrompt?: string;
	/** Prepend these strings to the system prompt. */
	prependSystem?: string[];
	/** Append these strings to the system prompt. */
	appendSystem?: string[];
	/** Additional context to inject before the last user message. */
	injectContext?: string;
}

/** A reflection comparing LLM output to prediction. */
export interface ReflectionEntry {
	sessionId: string;
	turnIndex: number;
	timestamp: number;
	/** What Chitragupta predicted the LLM would do. */
	prediction: string | null;
	predictionConfidence: number;
	/** What the LLM actually produced (truncated). */
	actualSummary: string;
	/** Did the output match the prediction? */
	matched: boolean;
	/** Model used. */
	model: string;
}

/** Cost routing recommendation. */
export interface CostRouteAdvice {
	/** Currently configured model. */
	currentModel: string;
	/** Recommended model (may be the same). */
	recommendedModel: string;
	/** Confidence in the recommendation (0-1). */
	confidence: number;
	/** Estimated cost ratio (recommended / current). 0.3 = 70% cheaper. */
	costRatio: number;
	/** Reason for the recommendation. */
	reason: string;
}

/** Configuration for cost routing thresholds. */
export interface CostRouterConfig {
	/** Min prediction confidence to recommend downgrade. Default: 0.85. */
	downgradeThreshold?: number;
	/** Min reflection accuracy to trust predictions. Default: 0.7. */
	minReflectionAccuracy?: number;
	/** Minimum reflections before enabling routing. Default: 10. */
	minReflections?: number;
	/** Model tier mappings: model → cheaper alternative. */
	downgradePaths?: Record<string, string>;
	/** Relative cost per model (for cost ratio calculation). */
	modelCosts?: Record<string, number>;
}

const DEFAULT_COST_CONFIG: Required<CostRouterConfig> = {
	downgradeThreshold: 0.85,
	minReflectionAccuracy: 0.7,
	minReflections: 10,
	downgradePaths: {
		"claude-opus-4-20250514": "claude-sonnet-4-20250514",
		"claude-sonnet-4-20250514": "claude-haiku-3-20250307",
		opus: "sonnet",
		sonnet: "haiku",
	},
	modelCosts: {
		"claude-opus-4-20250514": 1.0,
		"claude-sonnet-4-20250514": 0.2,
		"claude-haiku-3-20250307": 0.04,
		opus: 1.0,
		sonnet: 0.2,
		haiku: 0.04,
	},
};

// ── DarpanaEvolution ─────────────────────────────────────────────────────────

export class DarpanaEvolution {
	private readonly transforms: RequestTransform[] = [];
	private readonly reflections: ReflectionEntry[] = [];
	private readonly costConfig: Required<CostRouterConfig>;
	private _enabled = true;

	constructor(costConfig?: CostRouterConfig) {
		this.costConfig = { ...DEFAULT_COST_CONFIG, ...costConfig };
	}

	// ── Enable / Disable ───────────────────────────────────────────────────────

	get enabled(): boolean {
		return this._enabled;
	}

	set enabled(value: boolean) {
		this._enabled = value;
		log.info(`DarpanaEvolution ${value ? "enabled" : "disabled"}`);
	}

	// ── Request Transforms ─────────────────────────────────────────────────────

	/** Register a request transform. */
	addTransform(transform: RequestTransform): void {
		this.transforms.push(transform);
		this.transforms.sort((a, b) => a.priority - b.priority);
		log.debug(`Added transform "${transform.id}" (priority: ${transform.priority})`);
	}

	/** Remove a transform by ID. */
	removeTransform(id: string): boolean {
		const idx = this.transforms.findIndex((t) => t.id === id);
		if (idx === -1) return false;
		this.transforms.splice(idx, 1);
		return true;
	}

	/** Enable or disable a transform by ID. */
	setTransformEnabled(id: string, enabled: boolean): boolean {
		const t = this.transforms.find((t) => t.id === id);
		if (!t) return false;
		t.enabled = enabled;
		return true;
	}

	/**
	 * Apply all enabled transforms to a request context.
	 * Returns the modified system prompt (original if no transforms matched).
	 */
	applyTransforms(ctx: TransformContext): { systemPrompt: string; injectedContext: string | null } {
		if (!this._enabled) return { systemPrompt: ctx.systemPrompt, injectedContext: null };

		let systemPrompt = ctx.systemPrompt;
		let injectedContext: string | null = null;

		for (const transform of this.transforms) {
			if (!transform.enabled) continue;
			try {
				const r = transform.apply(ctx);
				if (!r) continue;

				if (r.systemPrompt) systemPrompt = r.systemPrompt;
				if (r.prependSystem?.length) {
					systemPrompt = `${r.prependSystem.join("\n")}\n${systemPrompt}`;
				}
				if (r.appendSystem?.length) {
					systemPrompt = `${systemPrompt}\n${r.appendSystem.join("\n")}`;
				}
				if (r.injectContext) {
					injectedContext = injectedContext ? `${injectedContext}\n${r.injectContext}` : r.injectContext;
				}

				log.debug(`Transform "${transform.id}" applied`);
			} catch (err) {
				log.warn(`Transform "${transform.id}" error: ${(err as Error).message}`);
			}
		}

		return { systemPrompt, injectedContext };
	}

	/** Get all registered transforms. */
	getTransforms(): ReadonlyArray<RequestTransform> {
		return this.transforms;
	}

	// ── Response Reflection ────────────────────────────────────────────────────

	/** Record a reflection comparing prediction to actual LLM output. */
	recordReflection(entry: ReflectionEntry): void {
		this.reflections.push(entry);
		// Cap at 500 entries (FIFO)
		if (this.reflections.length > 500) {
			this.reflections.splice(0, this.reflections.length - 500);
		}
		log.debug(`Reflection recorded: matched=${entry.matched}, model=${entry.model}`);
	}

	/** Get reflection accuracy for a specific model. */
	reflectionAccuracy(model?: string): { accuracy: number; total: number } {
		const relevant = model ? this.reflections.filter((r) => r.model === model) : this.reflections;
		if (relevant.length === 0) return { accuracy: 0, total: 0 };
		const matched = relevant.filter((r) => r.matched).length;
		return { accuracy: matched / relevant.length, total: relevant.length };
	}

	/** Get all reflections (most recent first). */
	getReflections(limit?: number): ReadonlyArray<ReflectionEntry> {
		const sorted = [...this.reflections].reverse();
		return limit ? sorted.slice(0, limit) : sorted;
	}

	// ── Cost Routing ───────────────────────────────────────────────────────────

	/**
	 * Get cost routing advice based on prediction confidence and reflection accuracy.
	 * Returns null if no recommendation can be made (insufficient data or low confidence).
	 */
	getCostAdvice(currentModel: string, predictionConfidence: number): CostRouteAdvice | null {
		if (!this._enabled) return null;

		// Check if we have enough reflections
		const { accuracy, total } = this.reflectionAccuracy(currentModel);
		if (total < this.costConfig.minReflections) {
			return null; // Not enough data
		}

		// Check reflection accuracy
		if (accuracy < this.costConfig.minReflectionAccuracy) {
			return null; // Predictions not reliable enough
		}

		// Check prediction confidence
		if (predictionConfidence < this.costConfig.downgradeThreshold) {
			return null; // Not confident enough to downgrade
		}

		// Find downgrade path
		const cheaperModel = this.costConfig.downgradePaths[currentModel];
		if (!cheaperModel) {
			return null; // No cheaper alternative
		}

		const currentCost = this.costConfig.modelCosts[currentModel] ?? 1.0;
		const cheaperCost = this.costConfig.modelCosts[cheaperModel] ?? currentCost;
		const costRatio = currentCost > 0 ? cheaperCost / currentCost : 1.0;

		return {
			currentModel,
			recommendedModel: cheaperModel,
			confidence: predictionConfidence,
			costRatio,
			reason:
				`Prediction confidence ${(predictionConfidence * 100).toFixed(0)}% ` +
				`with ${(accuracy * 100).toFixed(0)}% reflection accuracy ` +
				`(${total} samples) → ${((1 - costRatio) * 100).toFixed(0)}% cost saving`,
		};
	}

	// ── Stats ──────────────────────────────────────────────────────────────────

	/** Summary stats for monitoring. */
	stats(): {
		transformCount: number;
		enabledTransforms: number;
		reflectionCount: number;
		reflectionAccuracy: number;
	} {
		const { accuracy } = this.reflectionAccuracy();
		return {
			transformCount: this.transforms.length,
			enabledTransforms: this.transforms.filter((t) => t.enabled).length,
			reflectionCount: this.reflections.length,
			reflectionAccuracy: accuracy,
		};
	}
}
