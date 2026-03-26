import {
	AgentRole,
	inferProvider,
	type ModelRouter,
	type RoutingOverridePlan,
	resolveTaskRoutingOverrides,
	type TaskClassification,
} from "@takumi/agent";
import type { ChitraguptaObserver, RoutingDecision, RoutingRequest } from "@takumi/bridge";

interface ResolveRoutingOverridesOptions {
	observer: ChitraguptaObserver | null;
	sessionId: string | null;
	currentModel: string;
	router?: ModelRouter;
	classification?: TaskClassification;
}

const DEFAULT_CODING_CLI_PREFERENCES = ["cli.codex"];

export async function resolveRoutingOverrides({
	observer,
	sessionId,
	currentModel,
	router,
	classification,
}: ResolveRoutingOverridesOptions): Promise<RoutingOverridePlan> {
	if (!observer) {
		return { overrides: {}, laneEnvelopes: {}, decisions: [], notes: [] };
	}

	if (!router || !classification) {
		return resolveLegacyRoutingOverrides(observer, sessionId, currentModel);
	}

	return resolveTaskRoutingOverrides({
		observer,
		sessionId,
		currentModel,
		router,
		classification,
	});
}

async function resolveLegacyRoutingOverrides(
	observer: ChitraguptaObserver,
	sessionId: string | null,
	currentModel: string,
): Promise<RoutingOverridePlan> {
	const plans = await Promise.all([
		resolveLegacyPlan(observer, currentModel, [AgentRole.WORKER], {
			consumer: "takumi",
			sessionId: sessionId ?? "transient",
			capability: "coding.patch-cheap",
			constraints: {
				preferLocal: true,
				requireStreaming: true,
				preferredCapabilityIds: DEFAULT_CODING_CLI_PREFERENCES,
			},
			context: { mode: "multi-agent", role: "worker" },
		}),
		resolveLegacyPlan(
			observer,
			currentModel,
			[
				AgentRole.PLANNER,
				AgentRole.VALIDATOR_REQUIREMENTS,
				AgentRole.VALIDATOR_CODE,
				AgentRole.VALIDATOR_SECURITY,
				AgentRole.VALIDATOR_TESTS,
				AgentRole.VALIDATOR_ADVERSARIAL,
			],
			{
				consumer: "takumi",
				sessionId: sessionId ?? "transient",
				capability: "coding.review.strict",
				constraints: {
					requireStreaming: true,
					preferredCapabilityIds: DEFAULT_CODING_CLI_PREFERENCES,
				},
				context: { mode: "multi-agent", role: "coordination" },
			},
		),
	]);

	return plans.reduce<RoutingOverridePlan>(
		(acc, plan) => ({
			overrides: { ...acc.overrides, ...plan.overrides },
			laneEnvelopes: { ...acc.laneEnvelopes, ...plan.laneEnvelopes },
			decisions: [...acc.decisions, ...plan.decisions],
			notes: [...acc.notes, ...plan.notes],
		}),
		{ overrides: {}, laneEnvelopes: {}, decisions: [], notes: [] },
	);
}

async function resolveLegacyPlan(
	observer: ChitraguptaObserver,
	currentModel: string,
	roles: AgentRole[],
	request: RoutingRequest,
): Promise<RoutingOverridePlan> {
	const decision = await observer.routeResolve(request);
	if (!decision?.selected) {
		return { overrides: {}, laneEnvelopes: {}, decisions: decision ? [decision] : [], notes: [] };
	}

	const notes = [`Engine route ${request.capability} → ${decision.selected.id}`];
	const model = extractLegacyOverrideModel(decision, currentModel);
	if (!model) {
		return { overrides: {}, laneEnvelopes: {}, decisions: [decision], notes };
	}
	const selected = decision.selected;

	return {
		overrides: Object.fromEntries(roles.map((role) => [role, model])) as Partial<Record<AgentRole, string>>,
		laneEnvelopes: Object.fromEntries(
			roles.map((role) => [
				role,
				{
					consumer: request.consumer,
					sessionId: request.sessionId,
					role,
					capability: request.capability,
					authority: "engine",
					enforcement: "same-provider",
					selectedCapabilityId: selected.id,
					selectedProviderFamily: selected.providerFamily,
					selectedModel: model,
					fallbackModel: model,
					appliedModel: model,
					degraded: decision.degraded,
					reason: decision.reason,
					fallbackChain: decision.fallbackChain,
					policyTrace: decision.policyTrace,
				},
			]),
		) as RoutingOverridePlan["laneEnvelopes"],
		decisions: [decision],
		notes,
	};
}

function extractLegacyOverrideModel(decision: RoutingDecision, currentModel: string): string | null {
	const selected = decision.selected;
	if (!selected) return null;

	const metadata = selected.metadata;
	const candidate =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: null;
	if (!candidate) return null;

	const selectedProvider = normalizeProviderFamily(selected.providerFamily);
	const candidateProvider = inferProvider(candidate);
	const currentProvider = currentModel ? inferProvider(currentModel) : null;
	if (selectedProvider && selectedProvider !== candidateProvider) return null;
	if (currentProvider && candidateProvider !== currentProvider) return null;
	return candidate;
}

function normalizeProviderFamily(value?: string): ReturnType<typeof inferProvider> | null {
	if (!value) return null;

	switch (value.toLowerCase()) {
		case "anthropic":
			return "anthropic";
		case "openai":
			return "openai";
		case "google":
		case "gemini":
			return "google";
		case "openai-compat":
		case "openrouter":
		case "ollama":
		case "github":
		case "groq":
		case "deepseek":
		case "mistral":
		case "together":
			return "openai-compat";
		case "darpana":
			return null;
		default:
			return null;
	}
}
