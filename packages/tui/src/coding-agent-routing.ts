import { AgentRole, inferProvider } from "@takumi/agent";
import type { ChitraguptaObserver, RoutingDecision, RoutingRequest } from "@takumi/bridge";

const CHAT_ROLES = [
	AgentRole.PLANNER,
	AgentRole.VALIDATOR_REQUIREMENTS,
	AgentRole.VALIDATOR_CODE,
	AgentRole.VALIDATOR_SECURITY,
	AgentRole.VALIDATOR_TESTS,
	AgentRole.VALIDATOR_ADVERSARIAL,
] as const;

interface RoutingOverridePlan {
	overrides: Partial<Record<AgentRole, string>>;
	decisions: RoutingDecision[];
	notes: string[];
}

interface ResolveRoutingOverridesOptions {
	observer: ChitraguptaObserver | null;
	sessionId: string | null;
	currentModel: string;
}

export async function resolveRoutingOverrides({
	observer,
	sessionId,
	currentModel,
}: ResolveRoutingOverridesOptions): Promise<RoutingOverridePlan> {
	if (!observer) {
		return { overrides: {}, decisions: [], notes: [] };
	}

	const plans = await Promise.all([
		resolvePlan(observer, currentModel, [AgentRole.WORKER], {
			consumer: "takumi",
			sessionId: sessionId ?? "transient",
			capability: "coding.patch-and-validate",
			constraints: { preferLocal: true, requireStreaming: true },
			context: { mode: "multi-agent", role: "worker" },
		}),
		resolvePlan(observer, currentModel, [...CHAT_ROLES], {
			consumer: "takumi",
			sessionId: sessionId ?? "transient",
			capability: "chat.high-reliability",
			constraints: { requireStreaming: true },
			context: { mode: "multi-agent", role: "coordination" },
		}),
	]);

	return plans.reduce<RoutingOverridePlan>(
		(acc, plan) => ({
			overrides: { ...acc.overrides, ...plan.overrides },
			decisions: [...acc.decisions, ...plan.decisions],
			notes: [...acc.notes, ...plan.notes],
		}),
		{ overrides: {}, decisions: [], notes: [] },
	);
}

async function resolvePlan(
	observer: ChitraguptaObserver,
	currentModel: string,
	roles: AgentRole[],
	request: RoutingRequest,
): Promise<RoutingOverridePlan> {
	const decision = await observer.routeResolve(request);
	if (!decision?.selected) {
		return { overrides: {}, decisions: [], notes: [] };
	}

	const notes = [`Engine route ${request.capability} → ${decision.selected.id}`];
	const model = extractOverrideModel(decision, currentModel);
	if (!model) {
		return { overrides: {}, decisions: [decision], notes };
	}

	return {
		overrides: Object.fromEntries(roles.map((role) => [role, model])) as Partial<Record<AgentRole, string>>,
		decisions: [decision],
		notes: [...notes, `Using engine-selected model ${model} for ${roles.length === 1 ? roles[0] : request.capability}`],
	};
}

function extractOverrideModel(decision: RoutingDecision, currentModel: string): string | null {
	const selected = decision.selected;
	if (!selected) {
		return null;
	}

	const metadata = selected.metadata;
	const candidate =
		typeof metadata?.model === "string"
			? metadata.model
			: typeof metadata?.modelId === "string"
				? metadata.modelId
				: null;
	if (!candidate) {
		return null;
	}

	const selectedProvider = normalizeProviderFamily(selected.providerFamily);
	const candidateProvider = inferProvider(candidate);
	const currentProvider = currentModel ? inferProvider(currentModel) : null;
	if (selectedProvider && selectedProvider !== candidateProvider) {
		return null;
	}
	if (currentProvider && candidateProvider !== currentProvider) {
		return null;
	}

	return candidate;
}

function normalizeProviderFamily(value?: string): ReturnType<typeof inferProvider> | null {
	if (!value) {
		return null;
	}

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
		default:
			return null;
	}
}
