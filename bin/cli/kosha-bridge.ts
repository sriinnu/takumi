/**
 * @file kosha-bridge.ts
 * @module cli/kosha-bridge
 *
 * Lazy-initialised bridge to kosha-discovery (कोश).
 *
 * Provides a singleton ModelRegistry that discovers AI providers,
 * resolves credentials, enriches models with pricing, and caches
 * results. All heavy lifting is delegated to kosha-discovery's own
 * credential resolver + provider discoverers.
 *
 * ## Design
 * - **Lazy singleton** — `getKosha()` creates and caches the registry
 *   on first call; subsequent calls return the same instance.
 * - **CLI-first priority** — Kosha already resolves credentials in the
 *   order: CLI tools → env vars → config files, matching Takumi's own
 *   preference for "zero-config" auth.
 * - **Thin helpers** — `koshaAutoDetect`, `koshaListProviderModels`,
 *   and `koshaEndpoint` translate kosha types into the shapes Takumi
 *   expects, keeping the rest of the CLI layer unchanged.
 */

import type { ModelCard, ModelRegistry, ModelRouteInfo, ProviderInfo } from "kosha-discovery";

// ─── Singleton ────────────────────────────────────────────────────────────────

let _registry: ModelRegistry | null = null;
let _initPromise: Promise<ModelRegistry> | null = null;

/** I let tests and strict operators disable local-runtime discovery explicitly. */
function isLocalProviderDiscoveryDisabled(): boolean {
	return process.env.TAKUMI_DISABLE_LOCAL_PROVIDER_DISCOVERY === "1";
}

/**
 * Return the shared Kosha ModelRegistry, creating it on the first call.
 *
 * Discovery runs once; the registry is cached in memory for the process
 * lifetime while kosha-discovery's own disk cache avoids redundant API
 * calls across invocations.
 */
export async function getKosha(): Promise<ModelRegistry> {
	if (_registry) return _registry;

	if (!_initPromise) {
		_initPromise = (async () => {
			const { createKosha } = await import("kosha-discovery");
			const registry = await createKosha();
			_registry = registry;
			return registry;
		})();
	}

	return _initPromise;
}

/** Reset the singleton — only useful in tests. */
export function resetKosha(): void {
	_registry = null;
	_initPromise = null;
}

// ─── Auth detection (replaces hand-rolled autoDetectAuth) ─────────────────────

export interface KoshaDetectedAuth {
	provider: string;
	apiKey: string;
	model?: string;
	source: string;
	baseUrl?: string;
}

/**
 * Map kosha's `credentialSource` to a human-readable description.
 */
function describeSource(info: ProviderInfo): string {
	const src = info.credentialSource ?? "none";
	switch (src) {
		case "cli":
			return `CLI credentials (~/.${info.id}/)`;
		case "env":
			return `env var`;
		case "config":
			return `config file`;
		case "oauth":
			return `OAuth token`;
		default:
			return info.id === "ollama" ? "local server" : "none";
	}
}

/**
 * Pick a sensible default model for a provider.
 * Prefers chat models, sorts by newest (highest discoveredAt).
 */
function pickDefaultModel(info: ProviderInfo): string | undefined {
	const chatModels = info.models.filter((m) => m.mode === "chat");
	if (chatModels.length === 0) return info.models[0]?.id;

	// Sort by discoveredAt desc, then name length asc (prefer shorter canonical IDs)
	chatModels.sort((a, b) => b.discoveredAt - a.discoveredAt || a.id.length - b.id.length);
	return chatModels[0].id;
}

/**
 * Use kosha-discovery to auto-detect the best available provider and
 * credential, honouring the priority: CLI providers → env vars → local.
 *
 * Returns the first authenticated provider found, or null.
 */
export async function koshaAutoDetect(): Promise<KoshaDetectedAuth | null> {
	const kosha = await getKosha();
	const providers = kosha.providers_list();

	// Priority buckets: CLI creds first, then env, then config/oauth, then local
	const priority: Record<string, number> = { cli: 0, env: 1, config: 2, oauth: 3, none: 4 };

	const authenticated = providers
		.filter((p) => p.authenticated || (!isLocalProviderDiscoveryDisabled() && p.id === "ollama"))
		.sort((a, b) => {
			const aPri = priority[a.credentialSource ?? "none"] ?? 5;
			const bPri = priority[b.credentialSource ?? "none"] ?? 5;
			return aPri - bPri;
		});

	if (authenticated.length === 0) return null;

	// For ollama, only consider it if it actually has models (i.e. running)
	for (const candidate of authenticated) {
		if (candidate.id === "ollama" && candidate.models.length === 0) continue;
		if (candidate.id !== "ollama" && !candidate.authenticated) continue;

		// Kosha tells us which providers look ready; Takumi still verifies that
		// it can resolve a concrete direct credential before selecting one.
		const apiKey = await resolveApiKey(candidate);
		if (!apiKey && candidate.id !== "ollama") continue;

		const model = pickDefaultModel(candidate);
		const source = `Kosha: ${candidate.name} (${describeSource(candidate)})`;
		return {
			provider: mapKoshaProvider(candidate.id),
			apiKey,
			model,
			source,
			baseUrl: candidate.baseUrl,
		};
	}

	return null;
}

/** Map Kosha provider IDs to Takumi's internal provider names. */
export function mapKoshaProvider(koshaId: string): string {
	const mapping: Record<string, string> = {
		anthropic: "anthropic",
		openai: "openai",
		google: "gemini",
		ollama: "ollama",
		openrouter: "openrouter",
		bedrock: "bedrock",
		vertex: "vertex",
	};
	return mapping[koshaId] ?? koshaId;
}

/**
 * Resolve the raw API key for a provider using Takumi's env-var and CLI
 * fallback chain. Kosha tells us *which* provider is authenticated and
 * *how*, but the raw key extraction still goes through the host system.
 */
async function resolveApiKey(info: ProviderInfo): Promise<string> {
	const env = process.env;

	// 1. Check environment variables keyed by provider
	const envMap: Record<string, string[]> = {
		anthropic: ["ANTHROPIC_API_KEY"],
		openai: ["OPENAI_API_KEY"],
		google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
		ollama: [],
		openrouter: ["OPENROUTER_API_KEY"],
		bedrock: ["AWS_ACCESS_KEY_ID"],
		vertex: ["GOOGLE_APPLICATION_CREDENTIALS"],
	};

	for (const envVar of envMap[info.id] ?? []) {
		if (env[envVar]) return env[envVar]!;
	}

	// 2. Respect a generic TAKUMI_API_KEY only when the provider is pinned.
	const configuredProvider = mapKoshaProvider(env.TAKUMI_PROVIDER ?? "");
	if (env.TAKUMI_API_KEY && configuredProvider === mapKoshaProvider(info.id)) {
		return env.TAKUMI_API_KEY;
	}

	// 3. For CLI-sourced creds, use Takumi's existing tryResolveCliToken
	if (info.credentialSource === "cli" || info.credentialSource === "oauth") {
		const { tryResolveCliToken } = await import("./cli-auth.js");
		const token = tryResolveCliToken(info.id);
		if (token) return token;
	}

	// 4. Ollama needs no key
	if (info.id === "ollama") return "";

	return "";
}

// ─── Provider / model helpers ─────────────────────────────────────────────────

/**
 * List all kosha-discovered providers with their auth status.
 */
export async function koshaProviders(): Promise<ProviderInfo[]> {
	const kosha = await getKosha();
	return kosha.providers_list();
}

/**
 * Return model IDs for a given provider (chat models only by default).
 */
export async function koshaListProviderModels(
	providerId: string,
	mode: "chat" | "embedding" | "image" | "audio" | "moderation" = "chat",
): Promise<string[]> {
	const kosha = await getKosha();
	return kosha.models({ provider: providerId, mode }).map((m: ModelCard) => m.id);
}

/**
 * Return all providers and their chat models, suitable for completion UIs.
 * Returns a `Record<takumiProvider, modelId[]>`.
 */
export async function koshaProviderModels(): Promise<Record<string, string[]>> {
	const kosha = await getKosha();
	const providers = kosha.providers_list();
	const result: Record<string, string[]> = {};

	for (const p of providers) {
		const takumiName = mapKoshaProvider(p.id);
		const chatModels = p.models
			.filter((m) => m.mode === "chat")
			.map((m) => m.id);
		if (chatModels.length > 0) {
			result[takumiName] = chatModels;
		}
	}

	return result;
}

/**
 * Resolve the API endpoint for a provider using kosha's baseUrl.
 * Falls back to Takumi's hardcoded PROVIDER_ENDPOINTS where needed.
 */
export async function koshaEndpoint(providerId: string): Promise<string> {
	const kosha = await getKosha();
	const koshaProviderId = providerId === "gemini" ? "google" : providerId;
	const info = kosha.provider(koshaProviderId);

	if (info?.baseUrl) {
		// Kosha returns bare base URLs (e.g. "https://api.anthropic.com").
		// Takumi expands them into the provider-specific runtime base URL.
		const base = info.baseUrl.replace(/\/$/, "");
		if (providerId === "gemini") {
			return base.endsWith("/v1beta/models") ? base : `${base}/v1beta/models`;
		}
		if (providerId === "ollama") return `${base}/v1/chat/completions`;
		if (providerId === "openrouter") return `${base}/api/v1/chat/completions`;
		if (providerId !== "anthropic") return `${base}/v1/chat/completions`;
		return base;
	}

	return "";
}

/**
 * Resolve a model alias to its canonical ID using kosha's alias system.
 */
export async function koshaResolveAlias(alias: string): Promise<string> {
	const kosha = await getKosha();
	return kosha.resolve(alias);
}

/**
 * Get a single model's full info by ID or alias.
 */
export async function koshaModel(idOrAlias: string): Promise<ModelCard | undefined> {
	const kosha = await getKosha();
	return kosha.model(idOrAlias);
}

/**
 * Get all serving routes for a resolved model.
 *
 * Accepts either a canonical model ID or a Kosha alias.
 */
export async function koshaModelRouteInfo(idOrAlias: string): Promise<ModelRouteInfo[]> {
	const kosha = await getKosha();
	const model = kosha.model(idOrAlias);
	if (!model) return [];
	return kosha.modelRouteInfo(model.id);
}
