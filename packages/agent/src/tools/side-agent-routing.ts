import {
	inferProvider,
	type ModelRecommendation,
	ModelRouter,
	type ProviderFamily,
	type TopicDomain,
} from "../model-router.js";

const TOPIC_DOMAINS: readonly TopicDomain[] = [
	"code-generation",
	"code-review",
	"code-refactor",
	"debugging",
	"security-analysis",
	"testing",
	"documentation",
	"translation",
	"data-analysis",
	"architecture",
	"general",
];

const TOPIC_HINTS: ReadonlyArray<{ topic: TopicDomain; pattern: RegExp }> = [
	{ topic: "security-analysis", pattern: /security|vulnerab|threat|auth|permission|exploit|xss|csrf|injection/i },
	{ topic: "debugging", pattern: /debug|fix|bug|broken|failure|incident|regression|error/i },
	{ topic: "testing", pattern: /test|spec|assert|coverage|vitest|jest|playwright/i },
	{ topic: "documentation", pattern: /docs?|readme|changelog|guide|explain|summari[sz]e/i },
	{ topic: "translation", pattern: /translate|locali[sz]e|localization|i18n|l10n/i },
	{ topic: "data-analysis", pattern: /data|dataset|metrics|analysis|trend|csv|jsonl|table/i },
	{ topic: "architecture", pattern: /architect|design|topology|system|plan|migration|refactor strategy/i },
	{ topic: "code-review", pattern: /review|audit|inspect|critique|second pass/i },
	{ topic: "code-refactor", pattern: /refactor|restructure|cleanup|extract|rename/i },
	{ topic: "code-generation", pattern: /implement|build|create|add|scaffold|generate|feature/i },
];

export interface SideAgentRoutingDecision {
	model: string;
	topic?: TopicDomain;
	provider: ProviderFamily;
	rationale?: string;
	source: "explicit" | "topic" | "preferred" | "default" | "fallback";
}

function isTopicDomain(value: unknown): value is TopicDomain {
	return typeof value === "string" && TOPIC_DOMAINS.includes(value as TopicDomain);
}

function normalizeComplexity(value: unknown): string {
	if (typeof value !== "string") return "STANDARD";
	const normalized = value.trim().toUpperCase();
	return ["TRIVIAL", "SIMPLE", "STANDARD", "CRITICAL"].includes(normalized) ? normalized : "STANDARD";
}

export function inferTopicDomain(description: string, requestedTopic?: unknown): TopicDomain | undefined {
	if (isTopicDomain(requestedTopic)) return requestedTopic;
	for (const hint of TOPIC_HINTS) {
		if (hint.pattern.test(description)) return hint.topic;
	}
	return undefined;
}

function buildTopicRecommendation(topic: TopicDomain, complexity: string, defaultModel?: string): ModelRecommendation {
	const provider = defaultModel ? inferProvider(defaultModel) : "anthropic";
	return new ModelRouter(provider).recommendForTopic(topic, complexity);
}

export function resolveSideAgentRouting(input: {
	description: string;
	model?: unknown;
	topic?: unknown;
	complexity?: unknown;
	preferredModel?: unknown;
	defaultModel?: string;
}): SideAgentRoutingDecision {
	if (typeof input.model === "string" && input.model.trim()) {
		return {
			model: input.model.trim(),
			provider: inferProvider(input.model.trim()),
			source: "explicit",
		};
	}

	const topic = inferTopicDomain(input.description, input.topic);
	if (topic) {
		const recommendation = buildTopicRecommendation(topic, normalizeComplexity(input.complexity), input.defaultModel);
		return {
			model: recommendation.model,
			topic,
			provider: recommendation.provider,
			rationale: recommendation.rationale,
			source: "topic",
		};
	}

	if (typeof input.preferredModel === "string" && input.preferredModel.trim()) {
		return {
			model: input.preferredModel.trim(),
			provider: inferProvider(input.preferredModel.trim()),
			source: "preferred",
		};
	}

	if (input.defaultModel) {
		return {
			model: input.defaultModel,
			provider: inferProvider(input.defaultModel),
			source: "default",
		};
	}

	return {
		model: "claude-sonnet",
		provider: "anthropic",
		source: "fallback",
	};
}
