import { normalizeProviderName, type TakumiConfig } from "@takumi/core";
import type { ModelRouteInfo } from "kosha-discovery";
import { koshaModel, koshaModelRouteInfo, mapKoshaProvider } from "./kosha-bridge.js";

export interface StartupModelPolicyRequest {
	provider?: string;
	model: string;
	allow: string[];
	prefer: string[];
}

export interface StartupModelPolicyAttempt {
	requestedModel: string;
	providerName: string;
	model: string;
	source: string;
	version?: string;
	intent?: string;
	routeProvider: string;
	originProvider?: string;
	isDirect: boolean;
	isPreferred: boolean;
}

export interface StartupModelPolicyResolution {
	request: StartupModelPolicyRequest;
	attempts: StartupModelPolicyAttempt[];
}

/**
 * Resolve startup-only model policy through Kosha.
 *
 * This is intentionally opt-in for the first slice: if `modelPolicy` is not
 * configured, Takumi preserves the legacy startup path.
 */
export async function resolveStartupModelPolicy(
	config: TakumiConfig,
): Promise<StartupModelPolicyResolution | null> {
	if (!config.modelPolicy) {
		return null;
	}

	const request: StartupModelPolicyRequest = {
		provider: normalizeRequestedProvider(config.provider),
		model: config.model,
		allow: normalizePolicyList(config.modelPolicy.allow),
		prefer: normalizePolicyList(config.modelPolicy.prefer),
	};
	const orderedRequests = buildRequestedModelOrder(request);
	const allowedIds = await resolveAllowedModelIds(request.allow);
	const attempts: StartupModelPolicyAttempt[] = [];
	const seenTargets = new Set<string>();

	for (const rawRequest of orderedRequests) {
		const model = await koshaModel(rawRequest);
		if (!model) continue;
		if (allowedIds.size > 0 && !allowedIds.has(model.id)) continue;

		const rankedRoutes = rankKoshaRoutes(await koshaModelRouteInfo(model.id), request.provider);
		for (const route of rankedRoutes) {
			const providerName = mapKoshaProvider(route.provider);
			const targetKey = `${providerName}:${route.model.id}`;
			if (seenTargets.has(targetKey)) continue;
			seenTargets.add(targetKey);

			attempts.push({
				requestedModel: rawRequest,
				providerName,
				model: route.model.id,
				source: `Kosha policy (${rawRequest} → ${providerName} / ${route.model.id})`,
				version: route.version,
				intent: rawRequest !== route.model.id ? rawRequest : undefined,
				routeProvider: route.provider,
				originProvider: route.originProvider,
				isDirect: route.isDirect,
				isPreferred: route.isPreferred,
			});
		}
	}

	if (attempts.length === 0) {
		throw new Error(formatNoAllowedModelError(request));
	}

	return { request, attempts };
}

function normalizePolicyList(values: string[] | undefined): string[] {
	const normalized: string[] = [];
	for (const value of values ?? []) {
		const trimmed = value.trim();
		if (!trimmed || normalized.includes(trimmed)) continue;
		normalized.push(trimmed);
	}
	return normalized;
}

function normalizeRequestedProvider(provider: string | undefined): string | undefined {
	if (!provider) return undefined;
	return normalizeProviderName(provider) ?? provider;
}

function buildRequestedModelOrder(request: StartupModelPolicyRequest): string[] {
	return normalizePolicyList([...request.prefer, request.model, ...request.allow]);
}

async function resolveAllowedModelIds(allow: string[]): Promise<Set<string>> {
	const allowedIds = new Set<string>();
	for (const rawRequest of allow) {
		const model = await koshaModel(rawRequest);
		if (model) {
			allowedIds.add(model.id);
		}
	}
	return allowedIds;
}

function rankKoshaRoutes(routes: ModelRouteInfo[], requestedProvider?: string): ModelRouteInfo[] {
	const normalizedRequestedProvider = normalizeRequestedProvider(requestedProvider);
	return [...routes].sort((left, right) => {
		const scoreDelta = scoreRoute(right, normalizedRequestedProvider) - scoreRoute(left, normalizedRequestedProvider);
		if (scoreDelta !== 0) return scoreDelta;
		const providerDelta = left.provider.localeCompare(right.provider);
		if (providerDelta !== 0) return providerDelta;
		return left.model.id.localeCompare(right.model.id);
	});
}

function scoreRoute(route: ModelRouteInfo, requestedProvider?: string): number {
	let score = 0;
	const mappedProvider = mapKoshaProvider(route.provider);
	if (requestedProvider && mappedProvider === requestedProvider) score += 16;
	if (route.isPreferred) score += 8;
	if (route.isDirect) score += 4;
	if (requestedProvider && normalizeRequestedProvider(route.originProvider) === requestedProvider) score += 2;
	return score;
}

function formatNoAllowedModelError(request: StartupModelPolicyRequest): string {
	const policyParts: string[] = [];
	if (request.allow.length > 0) {
		policyParts.push(`allow: ${request.allow.join(", ")}`);
	}
	if (request.prefer.length > 0) {
		policyParts.push(`prefer: ${request.prefer.join(", ")}`);
	}
	const policySuffix = policyParts.length > 0 ? ` (${policyParts.join("; ")})` : "";
	return `Startup model policy could not resolve an allowed model for \"${request.model}\"${policySuffix}.`;
}