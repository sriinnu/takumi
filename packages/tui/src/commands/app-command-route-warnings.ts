import { inferProvider } from "@takumi/agent";
import type { RoutingDecision } from "@takumi/bridge";
import { normalizeProviderName } from "@takumi/core";
import type { AppState } from "../state.js";

const OPENAI_COMPAT_PROVIDERS = new Set([
	"openai",
	"openrouter",
	"ollama",
	"github",
	"groq",
	"deepseek",
	"mistral",
	"together",
	"xai",
	"alibaba",
	"bedrock",
	"zai",
]);

interface EngineRouteSelection {
	capability: string;
	selectedCapabilityId?: string;
	provider?: string;
	model?: string;
}

/**
 * Build a transparency warning when `/provider` overrides the last engine
 * routing decision that produced a concrete provider or model target.
 */
export function buildProviderOverrideWarning(state: AppState, nextProvider: string): string | null {
	const latestRoute = getLatestEngineRoute(state);
	if (!latestRoute?.provider) return null;

	const normalizedNextProvider = normalizeProviderName(nextProvider) ?? nextProvider;
	if (latestRoute.provider === normalizedNextProvider) return null;
	return `Override notice: last engine route ${latestRoute.capability} selected ${formatRouteTarget(latestRoute)}; switching provider to ${normalizedNextProvider} bypasses that route.`;
}

/**
 * Build a transparency warning when `/model` diverges from the engine's last
 * concrete model decision.
 */
export function buildModelOverrideWarning(state: AppState, nextModel: string): string | null {
	const latestRoute = getLatestEngineRoute(state);
	if (!latestRoute?.model || latestRoute.model === nextModel) return null;
	return `Override notice: last engine route ${latestRoute.capability} selected ${formatRouteTarget(latestRoute)}; setting model to ${nextModel} bypasses that route.`;
}

function getLatestEngineRoute(state: AppState): EngineRouteSelection | null {
	const decisions = [...state.routingDecisions.value].reverse();
	for (const decision of decisions) {
		if (!decision.selected) continue;
		const model = extractSelectedModel(decision);
		const provider = resolvePreferredProvider(decision, model, state.provider.value);
		if (!provider && !model) continue;
		return {
			capability: decision.request.capability,
			selectedCapabilityId: decision.selected.id,
			provider,
			model,
		};
	}
	return null;
}

function extractSelectedModel(decision: RoutingDecision): string | undefined {
	const metadata = decision.selected?.metadata;
	if (typeof metadata?.model === "string") return metadata.model;
	if (typeof metadata?.modelId === "string") return metadata.modelId;
	return undefined;
}

function resolvePreferredProvider(
	decision: RoutingDecision,
	model: string | undefined,
	configuredProvider: string,
): string | undefined {
	const providerFromModel = model ? mapProviderFamilyToProvider(inferProvider(model), configuredProvider) : undefined;
	if (providerFromModel) {
		return providerFromModel;
	}
	return mapProviderFamilyToProvider(decision.selected?.providerFamily, configuredProvider);
}

function mapProviderFamilyToProvider(family: string | undefined, configuredProvider: string): string | undefined {
	const normalizedFamily = normalizeProviderName(family);
	if (!normalizedFamily) return undefined;
	if (normalizedFamily === "openai-compat") {
		const normalizedConfiguredProvider = normalizeProviderName(configuredProvider);
		return normalizedConfiguredProvider && OPENAI_COMPAT_PROVIDERS.has(normalizedConfiguredProvider)
			? normalizedConfiguredProvider
			: undefined;
	}
	return normalizedFamily;
}

function formatRouteTarget(route: EngineRouteSelection): string {
	if (route.provider) {
		return `${route.provider}${route.model ? ` / ${route.model}` : ""}`;
	}
	if (route.model) {
		return route.model;
	}
	return route.selectedCapabilityId ?? route.capability;
}
