/**
 * @file model-router.ts
 * @module agent/model-router
 *
 * Smart LLM Model Router — maps task complexity and agent role to a
 * Chitragupta-approved route class plus a provider-local fallback model.
 *
 * ## Design
 * Rather than hard-coding a single model in the provider constructor, the
 * router lets Takumi recommend a semantic route class first, then keep a
 * same-provider fallback model for when the control-plane is unavailable.
 * This makes routing hierarchical:
 * - Chitragupta decides which lanes are allowed/healthy.
 * - Takumi decides which lane best fits each sub-role and task weight.
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
 * Engine-owned route classes. Takumi schedules work onto these semantic
 * lanes; Chitragupta resolves them to concrete backends/models.
 */
export type EngineRouteClass =
	| "coding.fast-local"
	| "coding.deep-reasoning"
	| "coding.review.strict"
	| "coding.patch-cheap"
	| "coding.validation-high-trust"
	| "classification.local-fast"
	| "memory.semantic-recall";

/**
 * Known provider families.
 * Extend this union as new providers are added.
 */
export type ProviderFamily =
	| "anthropic"
	| "openai"
	| "google"
	| "openai-compat"
	| "darpana"
	| "azure-openai"
	| "bedrock"
	| "mistral"
	| "groq"
	| "deepseek"
	| "together"
	| "xai"
	| "openrouter";

/** Agent roles that can influence model selection. */
export type RouterRole =
	| "CLASSIFIER"
	| "PLANNER"
	| "IMPLEMENTER"
	| "WORKER"
	| "REVIEWER"
	| "RESEARCHER"
	| "SUMMARIZER"
	| "VALIDATOR_REQUIREMENTS"
	| "VALIDATOR_CODE"
	| "VALIDATOR_SECURITY"
	| "VALIDATOR_TESTS"
	| "VALIDATOR_ADVERSARIAL"
	| "FIXER"
	| "default";

/** Output of {@link ModelRouter.recommend}. */
export interface ModelRecommendation {
	/** Semantic route class Takumi wants for this invocation. */
	routeClass: EngineRouteClass;
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

// Tier tables extracted to model-tiers.ts to stay under the 450-LOC guardrail.
export { MODEL_TIERS } from "./model-tiers.js";

import { MODEL_TIERS } from "./model-tiers.js";

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

/** Tier downgrade path used by economy / cheap lanes. */
const TIER_DOWNGRADE: Record<ModelTier, ModelTier> = {
	fast: "fast",
	balanced: "fast",
	powerful: "balanced",
	frontier: "powerful",
};

/** Map a role + complexity to Takumi's preferred engine lane. */
export function recommendRouteClass(complexity: string, role: RouterRole = "default"): EngineRouteClass {
	if (role === "CLASSIFIER") return "classification.local-fast";
	if (role === "SUMMARIZER") return "coding.fast-local";
	if (role === "RESEARCHER") {
		return complexity === "CRITICAL" ? "coding.deep-reasoning" : "coding.fast-local";
	}
	if (role === "REVIEWER") return "coding.review.strict";
	if (role === "PLANNER") return "coding.deep-reasoning";
	if (role === "FIXER") {
		return complexity === "CRITICAL" ? "coding.deep-reasoning" : "coding.patch-cheap";
	}
	if (VALIDATOR_ROLES.has(role)) {
		return role === "VALIDATOR_CODE" || role === "VALIDATOR_REQUIREMENTS"
			? "coding.review.strict"
			: "coding.validation-high-trust";
	}
	if (role === "IMPLEMENTER" || role === "WORKER") {
		return complexity === "CRITICAL" ? "coding.deep-reasoning" : "coding.patch-cheap";
	}
	if (complexity === "CRITICAL") return "coding.deep-reasoning";
	if (complexity === "TRIVIAL") return "coding.fast-local";
	return "coding.patch-cheap";
}

function resolveTierForRouteClass(baseTier: ModelTier, routeClass: EngineRouteClass): ModelTier {
	switch (routeClass) {
		case "classification.local-fast":
		case "memory.semantic-recall":
		case "coding.fast-local":
			return "fast";
		case "coding.patch-cheap":
			return TIER_DOWNGRADE[baseTier];
		case "coding.deep-reasoning": {
			const upgraded = TIER_UPGRADE[baseTier];
			return upgraded === "balanced" ? "powerful" : upgraded;
		}
		case "coding.review.strict":
			return baseTier === "fast" ? "balanced" : baseTier === "balanced" ? "powerful" : baseTier;
		case "coding.validation-high-trust":
			return baseTier === "fast" ? "balanced" : baseTier;
	}
}

// ─── Topic-Based Model Selection ──────────────────────────────────────────────

/**
 * Task domain for sub-agent topic-based routing.
 * Sub-agents working on different topics should use models best suited
 * for that domain — code review needs reasoning, translation needs speed.
 */
export type TopicDomain =
	| "code-generation"
	| "code-review"
	| "code-refactor"
	| "debugging"
	| "security-analysis"
	| "testing"
	| "documentation"
	| "translation"
	| "data-analysis"
	| "architecture"
	| "general";

/** Maps a topic domain to the best-fit role + a tier bias offset. */
const TOPIC_ROLE_MAP: Record<TopicDomain, { role: RouterRole; tierBias: number }> = {
	"code-generation": { role: "IMPLEMENTER", tierBias: 0 },
	"code-review": { role: "REVIEWER", tierBias: 1 },
	"code-refactor": { role: "IMPLEMENTER", tierBias: 0 },
	debugging: { role: "FIXER", tierBias: 1 },
	"security-analysis": { role: "VALIDATOR_SECURITY", tierBias: 1 },
	testing: { role: "VALIDATOR_TESTS", tierBias: 0 },
	documentation: { role: "SUMMARIZER", tierBias: -1 },
	translation: { role: "WORKER", tierBias: -1 },
	"data-analysis": { role: "RESEARCHER", tierBias: 0 },
	architecture: { role: "PLANNER", tierBias: 1 },
	general: { role: "WORKER", tierBias: 0 },
};

/**
 * Optional provider preference per topic. For instance, reasoning-heavy
 * tasks may prefer Anthropic, while speed-sensitive tasks prefer Groq.
 * `undefined` means "use the default provider".
 */
const TOPIC_PROVIDER_PREFERENCE: Partial<Record<TopicDomain, ProviderFamily>> = {
	"security-analysis": "anthropic",
	architecture: "anthropic",
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
	 * Recommend the best route class and fallback model for a given complexity
	 * level and agent role.
	 *
	 * Chitragupta remains the final routing authority; this is Takumi's bounded
	 * local scheduler. The returned `model` is a same-provider fallback only.
	 *
	 * @param complexity - Task complexity from `TaskClassifier`.
	 * @param role       - Agent role (optional; defaults to `"default"`).
	 */
	recommend(complexity: string, role: RouterRole = "default"): ModelRecommendation {
		// Resolve base tier from complexity (string key e.g. "STANDARD")
		const baseTier: ModelTier = COMPLEXITY_TIER[complexity] ?? "balanced";
		const routeClass = recommendRouteClass(complexity, role);
		const tier = resolveTierForRouteClass(baseTier, routeClass);
		const rationale = `complexity=${complexity}, role=${role}, routeClass=${routeClass}, baseTier=${baseTier}, tier=${tier}`;

		const tiers = MODEL_TIERS[this.provider];
		const model = tiers[tier];

		return { routeClass, model, tier, provider: this.provider, rationale };
	}

	/**
	 * Get all tier→model mappings for the current provider.
	 * Useful for `/router` status commands.
	 */
	getTierMap(): Record<ModelTier, string> {
		return { ...MODEL_TIERS[this.provider] };
	}

	/**
	 * Topic-aware recommendation for sub-agents. Different task domains benefit
	 * from different model strengths — a code review sub-agent wants a reasoning
	 * model, while a translation sub-agent can use a fast model.
	 *
	 * @param topic - The task domain (e.g. "code-review", "translation").
	 * @param complexity - Task complexity from `TaskClassifier`.
	 */
	recommendForTopic(topic: TopicDomain, complexity: string): ModelRecommendation {
		const mapping = TOPIC_ROLE_MAP[topic] ?? { role: "WORKER" as const, tierBias: 0 };
		const baseTier: ModelTier = COMPLEXITY_TIER[complexity] ?? "balanced";
		const routeClass = recommendRouteClass(complexity, mapping.role);
		let tier = resolveTierForRouteClass(baseTier, routeClass);

		// Apply topic tier bias (e.g. security analysis gets +1 tier)
		if (mapping.tierBias > 0) {
			for (let i = 0; i < mapping.tierBias; i++) tier = TIER_UPGRADE[tier];
		} else if (mapping.tierBias < 0) {
			for (let i = 0; i < Math.abs(mapping.tierBias); i++) tier = TIER_DOWNGRADE[tier];
		}

		// Topic-specific provider preference: if the topic prefers a different
		// provider and we have multiple available, note it in the rationale.
		const preferredProvider = TOPIC_PROVIDER_PREFERENCE[topic];
		const provider = preferredProvider && MODEL_TIERS[preferredProvider] ? preferredProvider : this.provider;
		const tiers = MODEL_TIERS[provider];
		const model = tiers[tier];
		const rationale =
			`topic=${topic}, complexity=${complexity}, role=${mapping.role}, ` +
			`routeClass=${routeClass}, tier=${tier}, provider=${provider}`;

		return { routeClass, model, tier, provider, rationale };
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
	if (m.startsWith("anthropic.claude") || m.startsWith("anthropic/")) return "bedrock";
	if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
	if (m.startsWith("gemini")) return "google";
	if (m.startsWith("mistral")) return "mistral";
	if (m.startsWith("grok")) return "xai";
	if (m.startsWith("deepseek")) return "deepseek";
	if (m.startsWith("llama") || m.startsWith("meta-llama")) return "together";
	if (m.includes("/")) return "openrouter";
	return "openai-compat";
}

/**
 * Extend the static MODEL_TIERS with dynamically-discovered models from
 * kosha-discovery. Call once after kosha initialises to keep the router
 * in sync with whatever the user actually has available.
 */
export function syncModelTiersFromKosha(providerModels: Record<string, string[]>): void {
	const familyMap: Record<string, ProviderFamily> = {
		anthropic: "anthropic",
		openai: "openai",
		gemini: "google",
		google: "google",
		ollama: "openai-compat",
		openrouter: "openrouter",
		groq: "groq",
		deepseek: "deepseek",
		mistral: "mistral",
		together: "together",
		github: "openai-compat",
		xai: "xai",
		"azure-openai": "azure-openai",
		bedrock: "bedrock",
	};

	for (const [provider, models] of Object.entries(providerModels)) {
		const family = familyMap[provider];
		if (!family || models.length === 0) continue;

		// For openai-compat providers that aren't already in MODEL_TIERS,
		// populate tiers from the discovered model list.
		if (family === "openai-compat" && provider !== "openai") {
			// Use the first model as default across tiers
			const m = models[0];
			if (!MODEL_TIERS["openai-compat"]) continue;
			// Only override if we don't already have good defaults
			if (MODEL_TIERS["openai-compat"].fast === "gpt-4o-mini") {
				MODEL_TIERS["openai-compat"] = {
					fast: models[0] ?? m,
					balanced: models[Math.min(1, models.length - 1)] ?? m,
					powerful: models[Math.min(2, models.length - 1)] ?? m,
					frontier: models[models.length - 1] ?? m,
				};
			}
		}
	}
}

// ─── Dynamic Temperature Scaling ──────────────────────────────────────────────

// Extracted to temperature.ts for LOC guardrail — re-export for backward compat.
export { getTemperatureForTask } from "./temperature.js";
