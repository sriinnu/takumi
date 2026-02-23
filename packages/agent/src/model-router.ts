/**
 * @file model-router.ts
 * @module agent/model-router
 *
 * Smart LLM Model Router — maps task complexity and agent role to the most
 * appropriate model for each provider family.
 *
 * ## Design
 * Rather than hard-coding a single model in the provider constructor, the
 * router lets the **master orchestrator** (or `CodingAgent`) _recommend_ a
 * model name before each LLM call. Callers can then pass the recommendation
 * to the provider or log it for observability.
 *
 * ## Complexity → Model Tier
 * | Complexity | Tier       | Goal                          |
 * |------------|------------|-------------------------------|
 * | TRIVIAL    | `fast`     | Lowest latency & cost         |
 * | SIMPLE     | `balanced` | Good quality at moderate cost |
 * | STANDARD   | `powerful` | High quality, higher cost     |
 * | CRITICAL   | `frontier` | Best available, any cost      |
 *
 * ## Role Overrides
 * Validator agents use `fast` (there are many of them; speed matters).
 * Planner and Fixer agents use one tier above the base complexity tier.
 *
 * @example
 * ```ts
 * const router = new ModelRouter("anthropic");
 * const rec = router.recommend("STANDARD", "WORKER");
 * console.log(rec.model); // "claude-sonnet-4-20250514"
 * console.log(rec.tier);  // "powerful"
 * ```
 */

// NOTE: Deliberately no import from classifier.ts — that would create a circular
// dependency. We use plain string keys instead of the TaskComplexity enum.

// ─── Types ────────────────────────────────────────────────────────────────────

/** Speed/capability trade-off tier. */
export type ModelTier = "fast" | "balanced" | "powerful" | "frontier";

/**
 * Known provider families.
 * Extend this union as new providers are added.
 */
export type ProviderFamily = "anthropic" | "openai" | "google" | "openai-compat" | "darpana";

/** Agent roles that can influence model selection. */
export type RouterRole =
	| "PLANNER"
	| "WORKER"
	| "VALIDATOR_REQUIREMENTS"
	| "VALIDATOR_CODE"
	| "VALIDATOR_SECURITY"
	| "VALIDATOR_TESTS"
	| "VALIDATOR_ADVERSARIAL"
	| "FIXER"
	| "default";

/** Output of {@link ModelRouter.recommend}. */
export interface ModelRecommendation {
	/** Fully-qualified model string to pass to the provider. */
	model: string;
	/** Capability tier that was selected. */
	tier: ModelTier;
	/** The provider family this recommendation is for. */
	provider: ProviderFamily;
	/** Human-readable rationale (useful for logging). */
	rationale: string;
}

// ─── Model Tier Tables ────────────────────────────────────────────────────────

/**
 * Preferred model per tier for each provider family.
 * Update these strings when new models are released.
 */
export const MODEL_TIERS: Record<ProviderFamily, Record<ModelTier, string>> = {
	anthropic: {
		fast: "claude-haiku-4-20250514",
		balanced: "claude-sonnet-4-20250514",
		powerful: "claude-sonnet-4-5",
		frontier: "claude-opus-4-5",
	},
	openai: {
		fast: "gpt-4o-mini",
		balanced: "gpt-4o",
		powerful: "gpt-4o",
		frontier: "o3",
	},
	google: {
		fast: "gemini-2.0-flash",
		balanced: "gemini-2.5-flash",
		powerful: "gemini-2.5-pro",
		frontier: "gemini-2.5-pro",
	},
	"openai-compat": {
		fast: "gpt-4o-mini",
		balanced: "gpt-4o",
		powerful: "gpt-4o",
		frontier: "gpt-4o",
	},
	darpana: {
		// Darpana proxies Anthropic models by default
		fast: "claude-haiku-4-20250514",
		balanced: "claude-sonnet-4-20250514",
		powerful: "claude-sonnet-4-5",
		frontier: "claude-opus-4-5",
	},
};

// ─── Complexity → Base Tier ───────────────────────────────────────────────────

/**
 * Maps the TaskComplexity enum value strings to model tiers.
 * Using plain string keys avoids a circular dependency with classifier.ts.
 */
const COMPLEXITY_TIER: Record<string, ModelTier> = {
	TRIVIAL: "fast",
	SIMPLE: "balanced",
	STANDARD: "powerful",
	CRITICAL: "frontier",
};

/** Validators always use the fast tier — there can be many of them. */
const VALIDATOR_ROLES = new Set<RouterRole>([
	"VALIDATOR_REQUIREMENTS",
	"VALIDATOR_CODE",
	"VALIDATOR_SECURITY",
	"VALIDATOR_TESTS",
	"VALIDATOR_ADVERSARIAL",
]);

/** Tier upgrade path (planners/fixers get bumped up one step). */
const TIER_UPGRADE: Record<ModelTier, ModelTier> = {
	fast: "balanced",
	balanced: "powerful",
	powerful: "frontier",
	frontier: "frontier",
};

// ─── ModelRouter ──────────────────────────────────────────────────────────────

/**
 * Smart LLM router.  Instantiate once per provider, call `recommend()` per
 * LLM invocation to get the right model for the task.
 */
export class ModelRouter {
	private readonly provider: ProviderFamily;

	/**
	 * @param provider - The provider family the agent is using.
	 *   Defaults to `"anthropic"` which is Takumi's primary provider.
	 */
	constructor(provider: ProviderFamily = "anthropic") {
		this.provider = provider;
	}

	/**
	 * Recommend the best model for a given complexity level and agent role.
	 *
	 * Role-based adjustments:
	 * - **Validators** → always `fast` tier (high count, latency critical).
	 * - **Planner / Fixer** → one tier above the complexity-derived tier.
	 * - **Worker / default** → tier derived directly from complexity.
	 *
	 * @param complexity - Task complexity from `TaskClassifier`.
	 * @param role       - Agent role (optional; defaults to `"default"`).
	 */
	recommend(complexity: string, role: RouterRole = "default"): ModelRecommendation {
		// Resolve base tier from complexity (string key e.g. "STANDARD")
		const baseTier: ModelTier = COMPLEXITY_TIER[complexity] ?? "balanced";

		let tier: ModelTier = baseTier;
		let rationale = `complexity=${complexity}`;

		if (VALIDATOR_ROLES.has(role)) {
			// Validators always use fast tier to keep cluster latency low
			tier = "fast";
			rationale += `, role=${role} → fast (validator override)`;
		} else if (role === "PLANNER" || role === "FIXER") {
			// Planners and fixers need extra capability — bump one tier
			tier = TIER_UPGRADE[baseTier];
			rationale += `, role=${role} → ${tier} (bumped from ${baseTier})`;
		} else {
			rationale += `, role=${role}`;
		}

		const tiers = MODEL_TIERS[this.provider];
		const model = tiers[tier];

		return { model, tier, provider: this.provider, rationale };
	}

	/**
	 * Get all tier→model mappings for the current provider.
	 * Useful for `/router` status commands.
	 */
	getTierMap(): Record<ModelTier, string> {
		return { ...MODEL_TIERS[this.provider] };
	}
}

/**
 * Convenience factory — infers the provider family from a model string.
 *
 * @param modelString - A model ID like `"claude-sonnet-4-20250514"` or
 *   `"gpt-4o"` used to guess which provider family is active.
 */
export function inferProvider(modelString: string): ProviderFamily {
	const m = modelString.toLowerCase();
	if (m.startsWith("claude")) return "anthropic";
	if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
	if (m.startsWith("gemini")) return "google";
	return "openai-compat";
}

// ─── Dynamic Temperature Scaling ──────────────────────────────────────────────

/**
 * Calculates the optimal temperature for a task based on complexity, phase, and retry count.
 *
 * **Research Foundation:** Temperature controls exploration vs exploitation in LLM sampling.
 * - Low temperature (0.0-0.3): Deterministic, focused, good for validation/critical tasks
 * - Medium temperature (0.4-0.7): Balanced, good for standard coding
 * - High temperature (0.8-1.0): Creative, diverse, good for brainstorming/first attempts
 *
 * **Algorithm:**
 * 1. Base temperature from complexity:
 *    - TRIVIAL: 0.3 (deterministic, one clear solution)
 *    - SIMPLE: 0.5 (slight variation acceptable)
 *    - STANDARD: 0.7 (moderate creativity)
 *    - CRITICAL: 0.9 (explore solution space on first try)
 *
 * 2. Adjust by phase:
 *    - PLANNING: +0.1 (want diverse plan options)
 *    - EXECUTING: base (default worker behavior)
 *    - VALIDATING: always 0.2 (consistency matters for validators)
 *    - FIXING: -0.2 (more focused repair)
 *
 * 3. Decay on retries:
 *    - attemptNumber > 1: reduce by 0.1 per retry (max 3 retries)
 *    - Rationale: if high temp failed, try more deterministic approach
 *
 * 4. Clamp to [0.0, 1.0]
 *
 * @param complexity - Task complexity level (string to avoid circular dep)
 * @param phase - Current cluster phase (string to avoid circular dep)
 * @param attemptNumber - 1-indexed retry count (default: 1)
 * @returns Temperature value in [0.0, 1.0]
 *
 * @example
 * ```ts
 * const temp = getTemperatureForTask("CRITICAL", "EXECUTING", 1);
 * console.log(temp); // 0.9 (high exploration for first critical attempt)
 *
 * const temp2 = getTemperatureForTask("CRITICAL", "EXECUTING", 3);
 * console.log(temp2); // 0.7 (reduced after 2 failed attempts)
 *
 * const temp3 = getTemperatureForTask("STANDARD", "VALIDATING", 1);
 * console.log(temp3); // 0.2 (always low for validators)
 * ```
 */
export function getTemperatureForTask(
	complexity: "TRIVIAL" | "SIMPLE" | "STANDARD" | "CRITICAL",
	phase: "PLANNING" | "EXECUTING" | "VALIDATING" | "FIXING",
	attemptNumber = 1,
): number {
	// Step 1: Base temperature from complexity
	const baseTemps: Record<string, number> = {
		TRIVIAL: 0.3,
		SIMPLE: 0.5,
		STANDARD: 0.7,
		CRITICAL: 0.9,
	};
	let temp = baseTemps[complexity] ?? 0.7;

	// Step 2: Override for validation phase (always low, regardless of complexity)
	if (phase === "VALIDATING") {
		return 0.2;
	}

	// Step 3: Adjust by phase
	const phaseAdjustments: Record<string, number> = {
		PLANNING: 0.1, // Want diverse plan options
		EXECUTING: 0.0, // Base temp
		FIXING: -0.2, // More focused repair
	};
	temp += phaseAdjustments[phase] ?? 0;

	// Step 4: Decay on retries (but not below 0.3 — never fully deterministic for workers)
	if (attemptNumber > 1) {
		const decayFactor = Math.min(attemptNumber - 1, 3) * 0.1;
		temp = Math.max(0.3, temp - decayFactor);
	}

	// Step 5: Clamp to [0.0, 1.0]
	return Math.max(0.0, Math.min(1.0, temp));
}
