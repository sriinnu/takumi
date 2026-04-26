import type { FastProviderStatus } from "./cli-auth.js";

export interface StartupProviderTruth {
	providerModels: Record<string, string[]>;
	providerStatuses: FastProviderStatus[];
	providerCatalogAuthority: "merge" | "strict";
}

interface StartupBootstrapInventoryModel {
	id: string;
	available: boolean;
}

interface StartupBootstrapInventoryProvider {
	id: string;
	authenticated: boolean;
	credentialSource: string | null;
	models: StartupBootstrapInventoryModel[];
}

const DIRECT_SESSION_PROVIDER_IDS = new Set([
	"anthropic",
	"openai",
	"github",
	"gemini",
	"groq",
	"xai",
	"deepseek",
	"mistral",
	"together",
	"openrouter",
	"alibaba",
	"bedrock",
	"zai",
	"moonshot",
	"minimax",
	"ollama",
]);

/** I keep startup provider/model truth scoped to providers Takumi can actually boot directly. */
export function deriveStartupProviderTruth(
	providerModels: Record<string, string[]>,
	providerStatuses: FastProviderStatus[],
	bootstrapResult?: unknown,
): StartupProviderTruth {
	const inventory = readBootstrapInventory(bootstrapResult);
	const inventoryProviders = inventory?.providers?.filter((provider) => isDirectSessionProvider(provider.id)) ?? [];
	if (inventoryProviders.length === 0) {
		return {
			providerModels: cloneProviderModelCatalog(providerModels),
			providerStatuses: cloneProviderStatuses(providerStatuses),
			providerCatalogAuthority: "merge",
		};
	}

	const inventoryRanks = buildInventoryRankMap(inventory?.providerPriority ?? []);
	const inventoryCatalog: Record<string, string[]> = {};
	const inventoryStatuses = inventoryProviders
		.map((provider) => {
			const models = dedupeModels(provider.models.filter((model) => model.available).map((model) => model.id));
			return {
				id: provider.id,
				authenticated: provider.authenticated,
				credentialSource: normalizeCredentialSource(provider.credentialSource),
				models,
			} satisfies FastProviderStatus;
		})
		.filter((provider) => shouldSurfaceDirectProvider(provider))
		.sort((left, right) => compareInventoryProviders(left.id, right.id, inventoryRanks));
	for (const provider of inventoryStatuses) {
		inventoryCatalog[provider.id] = provider.models;
	}

	return {
		providerModels: inventoryCatalog,
		providerStatuses: inventoryStatuses,
		providerCatalogAuthority: "strict",
	};
}

function readBootstrapInventory(value: unknown): { providerPriority: string[]; providers: StartupBootstrapInventoryProvider[] } | null {
	if (!isRecord(value)) return null;
	const inventory = value.inventory;
	if (!isRecord(inventory) || !Array.isArray(inventory.providers)) return null;
	return {
		providerPriority: Array.isArray(inventory.providerPriority)
			? inventory.providerPriority.filter((providerId): providerId is string => typeof providerId === "string")
			: [],
		providers: inventory.providers
			.filter(isRecord)
			.map((provider) => ({
				id: typeof provider.id === "string" ? provider.id : "",
				authenticated: provider.authenticated === true,
				credentialSource: typeof provider.credentialSource === "string" ? provider.credentialSource : null,
				models: Array.isArray(provider.models)
					? provider.models
							.filter(isRecord)
							.map((model) => ({
								id: typeof model.id === "string" ? model.id : "",
								available: model.available === true,
							}))
					: [],
			}))
			.filter((provider) => provider.id.length > 0),
	};
}

function isDirectSessionProvider(providerId: string): boolean {
	return DIRECT_SESSION_PROVIDER_IDS.has(providerId);
}

function shouldSurfaceDirectProvider(provider: FastProviderStatus): boolean {
	return provider.authenticated || (provider.id === "ollama" && provider.models.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneProviderModelCatalog(providerModels: Record<string, string[]>): Record<string, string[]> {
	return Object.fromEntries(Object.entries(providerModels).map(([provider, models]) => [provider, [...models]]));
}

function cloneProviderStatuses(providerStatuses: FastProviderStatus[]): FastProviderStatus[] {
	return providerStatuses.map((provider) => ({
		...provider,
		models: [...provider.models],
	}));
}

function buildInventoryRankMap(priority: string[]): Map<string, number> {
	return new Map(priority.map((providerId, index) => [providerId, index]));
}

function compareInventoryProviders(leftId: string, rightId: string, ranks: Map<string, number>): number {
	const leftRank = ranks.get(leftId) ?? Number.MAX_SAFE_INTEGER;
	const rightRank = ranks.get(rightId) ?? Number.MAX_SAFE_INTEGER;
	return leftRank === rightRank ? leftId.localeCompare(rightId) : leftRank - rightRank;
}

function normalizeCredentialSource(source: string | null): FastProviderStatus["credentialSource"] {
	switch (source) {
		case "env":
		case "cli":
		case "config":
		case "oauth":
		case "none":
			return source;
		default:
			if (typeof source === "string" && source.includes("env")) return "env";
			if (typeof source === "string" && source.includes("cli")) return "cli";
			if (typeof source === "string" && source.includes("oauth")) return "oauth";
			if (typeof source === "string" && source.includes("vault")) return "config";
			return "none";
	}
}

function dedupeModels(models: string[]): string[] {
	return [...new Set(models.filter((model) => model.trim().length > 0))];
}
