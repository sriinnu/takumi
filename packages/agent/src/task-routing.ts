import type {
	ChitraguptaObserver,
	ConsumerConstraint,
	ExecutionLaneAuthority,
	ExecutionLaneEnvelope,
	RoutingDecision,
	RoutingRequest,
} from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { TaskClassification } from "./classifier.js";
import { AgentRole } from "./cluster/types.js";
import { inferProvider, type ModelRecommendation, type ModelRouter } from "./model-router.js";

const log = createLogger("task-routing");

interface ResolveRoutingOverridesOptions {
	observer: ChitraguptaObserver | null;
	sessionId: string | null;
	currentModel: string;
	router: ModelRouter;
	classification: TaskClassification;
}

export interface RoutingOverridePlan {
	overrides: Partial<Record<AgentRole, string>>;
	laneEnvelopes: Partial<Record<AgentRole, ExecutionLaneEnvelope>>;
	decisions: RoutingDecision[];
	notes: string[];
}

interface RoleLaneSelection {
	role: AgentRole;
	recommendation: ModelRecommendation;
}

const ROUTED_ROLES: AgentRole[] = [
	AgentRole.WORKER,
	AgentRole.PLANNER,
	AgentRole.VALIDATOR_REQUIREMENTS,
	AgentRole.VALIDATOR_CODE,
	AgentRole.VALIDATOR_SECURITY,
	AgentRole.VALIDATOR_TESTS,
	AgentRole.VALIDATOR_ADVERSARIAL,
];

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

	const selections = ROUTED_ROLES.map((role) => ({
		role,
		recommendation: router.recommend(classification.complexity, roleToRouterRole(role)),
	}));

	const groups = groupSelectionsByRouteClass(selections);
	const plans = await Promise.all(
		groups.map(async (group) => {
			const request = buildRoutingRequest(
				group[0].recommendation,
				sessionId,
				classification,
				group.map((item) => item.role),
			);
			const decision = await observer.routeResolve(request);
			const notes = decision?.selected
				? [`Engine lane ${request.capability} → ${decision.selected.id}`]
				: [`No engine lane resolved for ${request.capability}; using Takumi fallback.`];

			const overrides: Partial<Record<AgentRole, string>> = {};
			const laneEnvelopes: Partial<Record<AgentRole, ExecutionLaneEnvelope>> = {};
			for (const item of group) {
				const resolved = resolveConcreteModel(item.recommendation, decision, currentModel);
				const { model, note } = resolved;
				overrides[item.role] = model;
				laneEnvelopes[item.role] = buildLaneEnvelope(request, item.role, resolved, decision);
				if (note) notes.push(`${item.role}: ${note}`);
			}

			return {
				overrides,
				laneEnvelopes,
				decisions: decision ? [decision] : [],
				notes,
			};
		}),
	);

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

function groupSelectionsByRouteClass(selections: RoleLaneSelection[]): RoleLaneSelection[][] {
	const groups = new Map<string, RoleLaneSelection[]>();
	for (const selection of selections) {
		const key = `${selection.recommendation.routeClass}|${selection.recommendation.provider}`;
		const bucket = groups.get(key) ?? [];
		bucket.push(selection);
		groups.set(key, bucket);
	}
	return Array.from(groups.values());
}

function buildRoutingRequest(
	recommendation: ModelRecommendation,
	sessionId: string | null,
	classification: TaskClassification,
	roles: AgentRole[],
): RoutingRequest {
	return {
		consumer: "takumi",
		sessionId: sessionId ?? "transient",
		capability: recommendation.routeClass,
		constraints: constraintsForRouteClass(recommendation.routeClass),
		context: {
			complexity: classification.complexity,
			taskType: classification.type,
			confidence: classification.confidence,
			riskLevel: classification.riskLevel,
			roles,
			takumiFallbackModel: recommendation.model,
			providerFamily: recommendation.provider,
		},
	};
}

function constraintsForRouteClass(routeClass: ModelRecommendation["routeClass"]): ConsumerConstraint {
	switch (routeClass) {
		case "classification.local-fast":
		case "memory.semantic-recall":
			return { preferLocal: true, allowCloud: false, maxCostClass: "low" };
		case "coding.fast-local":
			return { preferLocal: true, requireStreaming: true, maxCostClass: "low" };
		case "coding.patch-cheap":
			return { preferLocal: true, requireStreaming: true, maxCostClass: "low" };
		case "coding.review.strict":
			return { requireStreaming: true, maxCostClass: "medium" };
		case "coding.validation-high-trust":
			return { requireStreaming: true, maxCostClass: "medium", trustFloor: "sandboxed" };
		case "coding.deep-reasoning":
			return { requireStreaming: true, maxCostClass: "high" };
	}
}

function resolveConcreteModel(
	recommendation: ModelRecommendation,
	decision: RoutingDecision | null,
	currentModel: string,
): {
	model: string;
	note?: string;
	authority: ExecutionLaneAuthority;
	enforcement: ExecutionLaneEnvelope["enforcement"];
	selectedCapabilityId?: string;
	selectedProviderFamily?: string;
	selectedModel?: string;
} {
	const selected = decision?.selected;
	if (!selected) {
		return {
			model: recommendation.model,
			authority: "takumi-fallback",
			enforcement: "capability-only",
		};
	}

	const metadata = selected.metadata;
	const candidate =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: null;
	if (!candidate) {
		return {
			model: recommendation.model,
			authority: "takumi-fallback",
			enforcement: "capability-only",
			selectedCapabilityId: selected.id,
			selectedProviderFamily: selected.providerFamily,
			note: `route ${selected.id} had no concrete model metadata; kept fallback ${recommendation.model}`,
		};
	}

	const candidateProvider = inferProvider(candidate);
	const currentProvider = currentModel ? inferProvider(currentModel) : null;
	const selectedProvider = normalizeProviderFamily(selected.providerFamily);

	if (selectedProvider && selectedProvider !== candidateProvider) {
		log.debug(`Ignoring route ${selected.id} model ${candidate}; provider metadata mismatch`);
		return {
			model: recommendation.model,
			authority: "takumi-fallback",
			enforcement: "same-provider",
			selectedCapabilityId: selected.id,
			selectedProviderFamily: selected.providerFamily,
			selectedModel: candidate,
			note: `route ${selected.id} metadata mismatched provider family; kept fallback ${recommendation.model}`,
		};
	}
	if (currentProvider && candidateProvider !== currentProvider) {
		return {
			model: recommendation.model,
			authority: "takumi-fallback",
			enforcement: "same-provider",
			selectedCapabilityId: selected.id,
			selectedProviderFamily: selected.providerFamily,
			selectedModel: candidate,
			note: `route ${selected.id} resolved to ${candidate} (${candidateProvider}), but active session is ${currentProvider}; kept fallback ${recommendation.model}`,
		};
	}

	return {
		model: candidate,
		note: `using engine-approved model ${candidate}`,
		authority: "engine",
		enforcement: "same-provider",
		selectedCapabilityId: selected.id,
		selectedProviderFamily: selected.providerFamily,
		selectedModel: candidate,
	};
}

function buildLaneEnvelope(
	request: RoutingRequest,
	role: AgentRole,
	resolved: ReturnType<typeof resolveConcreteModel>,
	decision: RoutingDecision | null,
): ExecutionLaneEnvelope {
	return {
		consumer: request.consumer,
		sessionId: request.sessionId,
		role,
		capability: request.capability,
		authority: resolved.authority,
		enforcement: resolved.enforcement,
		selectedCapabilityId: resolved.selectedCapabilityId,
		selectedProviderFamily: resolved.selectedProviderFamily,
		selectedModel: resolved.selectedModel,
		fallbackModel: (request.context?.takumiFallbackModel as string | undefined) ?? resolved.model,
		appliedModel: resolved.model,
		degraded: decision?.degraded ?? false,
		reason: decision?.reason ?? `Takumi fallback for ${request.capability}`,
		fallbackChain: decision?.fallbackChain ?? [],
		policyTrace: decision?.policyTrace ?? [],
	};
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

function roleToRouterRole(role: AgentRole) {
	switch (role) {
		case AgentRole.PLANNER:
			return "PLANNER" as const;
		case AgentRole.WORKER:
			return "WORKER" as const;
		case AgentRole.VALIDATOR_REQUIREMENTS:
			return "VALIDATOR_REQUIREMENTS" as const;
		case AgentRole.VALIDATOR_CODE:
			return "VALIDATOR_CODE" as const;
		case AgentRole.VALIDATOR_SECURITY:
			return "VALIDATOR_SECURITY" as const;
		case AgentRole.VALIDATOR_TESTS:
			return "VALIDATOR_TESTS" as const;
		case AgentRole.VALIDATOR_ADVERSARIAL:
			return "VALIDATOR_ADVERSARIAL" as const;
	}
}
