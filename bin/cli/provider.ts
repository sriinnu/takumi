import type { ChitraguptaBridge } from "@takumi/bridge";
import type { TakumiConfig } from "@takumi/core";
import { loadMergedEnv, normalizeProviderName, PROVIDER_ENDPOINT_ENV_KEYS, PROVIDER_ENDPOINTS } from "@takumi/core";
import { autoDetectAuth, tryResolveCliToken } from "./cli-auth.js";
import { koshaEndpoint } from "./kosha-bridge.js";
import { resolveStartupModelPolicy, type StartupModelPolicyResolution } from "./startup-model-policy.js";

type BootstrapCredentialBridge = Pick<ChitraguptaBridge, "requestProviderCredential">;

/** Only preserve a configured API key when the rebased provider still matches the original provider scope. */
function resolveConfigApiKey(
	providerName: string,
	config: TakumiConfig,
	bridge?: BootstrapCredentialBridge,
): string | undefined {
	if (!config.apiKey) return undefined;

	const configuredProvider = normalizeProviderName(config.provider || "anthropic") ?? (config.provider || "anthropic");
	const explicitDirectApiKey = config.experimental?.takumiExplicitApiKey === true;
	return configuredProvider === providerName && (!bridge || explicitDirectApiKey) ? config.apiKey : undefined;
}

/** Normalize provider aliases and keep a stable default for startup paths. */
function normalizeOrDefaultProvider(providerName?: string): string {
	const defaulted = providerName || "anthropic";
	return normalizeProviderName(defaulted) ?? defaulted;
}

/** Format provider/model targets consistently for warnings and failures. */
function describeProviderTarget(providerName: string, model?: string): string {
	return model ? `${providerName} / ${model}` : providerName;
}

/** Keep daemon credential lookups on the daemon's canonical provider ids. */
function mapTakumiProviderToDaemonProvider(providerName: string): string {
	return providerName === "gemini" ? "google" : providerName;
}

/** Ask Chitragupta for the routed provider credential before local CLI or env fallback. */
async function resolveDaemonVaultCredential(
	bridge: BootstrapCredentialBridge | undefined,
	providerName: string,
): Promise<string | undefined> {
	if (!bridge) return undefined;
	try {
		const resolved = await bridge.requestProviderCredential(mapTakumiProviderToDaemonProvider(providerName));
		return resolved?.found && typeof resolved.value === "string" && resolved.value.trim() ? resolved.value : undefined;
	} catch {
		throw createProviderConfigurationError(`Chitragupta credential resolution failed for ${providerName}.`);
	}
}

/**
 * Re-scope provider-specific config so switching providers does not drag along
 * the previous provider's endpoint or API key.
 */
export function rebaseProviderConfig(
	config: TakumiConfig,
	providerName: string,
	model?: string,
	apiKey?: string,
): TakumiConfig {
	const normalizedProvider = normalizeOrDefaultProvider(providerName);
	const configuredProvider = normalizeOrDefaultProvider(config.provider);
	const preserveScopedFields = configuredProvider === normalizedProvider;

	return {
		...config,
		provider: normalizedProvider,
		model: model ?? config.model,
		apiKey: apiKey ?? (preserveScopedFields ? config.apiKey : ""),
		endpoint: preserveScopedFields ? config.endpoint : "",
	};
}

/**
 * Local endpoints and Ollama do not require a cloud credential, so startup can
 * proceed without prompting for an API key.
 */
export function canSkipApiKey(config: TakumiConfig): boolean {
	if (config.provider === "ollama") return true;
	if (config.endpoint) {
		try {
			const url = new URL(config.endpoint);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
		} catch {
			// invalid URL, don't skip
		}
	}
	return false;
}

/**
 * Build a concrete provider implementation from config, CLI auth, env, or
 * local endpoint discovery without mutating the caller's config object.
 */
export async function buildSingleProvider(
	providerName: string,
	config: TakumiConfig,
	agent: any,
	bridge?: BootstrapCredentialBridge,
): Promise<any | null> {
	const env = loadMergedEnv(config.workingDirectory || process.cwd());
	const normalizedProvider = normalizeProviderName(providerName) ?? providerName;
	const configApiKey = resolveConfigApiKey(normalizedProvider, config, bridge);
	const daemonVaultKey = configApiKey ? undefined : await resolveDaemonVaultCredential(bridge, normalizedProvider);

	// Resolve endpoint: CLI override → kosha-discovery → hardcoded fallback
	const resolveEndpoint = async (name: string): Promise<string> => {
		if (config.endpoint) return config.endpoint;
		for (const envVar of PROVIDER_ENDPOINT_ENV_KEYS[name] ?? []) {
			if (env[envVar]) return env[envVar];
		}
		try {
			const koshaUrl = await koshaEndpoint(name);
			if (koshaUrl) return koshaUrl;
		} catch {
			// kosha unavailable — fall through
		}
		return PROVIDER_ENDPOINTS[name] || "";
	};

	if (normalizedProvider === "anthropic") {
		// Priority: CLI tools → env vars (pi-mono ecosystem standard)
		const key =
			configApiKey ||
			daemonVaultKey ||
			tryResolveCliToken("anthropic") ||
			env.ANTHROPIC_API_KEY ||
			env.CLAUDE_CODE_OAUTH_TOKEN ||
			env.TAKUMI_API_KEY;
		if (!key) return null;
		return new agent.DirectProvider({ ...config, provider: normalizedProvider, apiKey: key });
	}

	if (normalizedProvider === "gemini") {
		// Priority: CLI tools → env vars
		const key =
			configApiKey ||
			daemonVaultKey ||
			tryResolveCliToken("gemini") ||
			env.GEMINI_API_KEY ||
			env.GOOGLE_API_KEY ||
			env.TAKUMI_API_KEY;
		if (!key) return null;
		const endpoint = await resolveEndpoint(normalizedProvider);
		return new agent.GeminiProvider({
			...config,
			provider: normalizedProvider,
			apiKey: key,
			endpoint,
		});
	}

	const keyMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		github: "GITHUB_TOKEN",
		groq: "GROQ_API_KEY",
		xai: "XAI_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
		mistral: "MISTRAL_API_KEY",
		together: "TOGETHER_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		alibaba: "ALIBABA_API_KEY",
		bedrock: "BEDROCK_API_KEY",
		zai: "ZAI_API_KEY",
		ollama: "",
	};

	const envVar = keyMap[normalizedProvider];
	// Priority: CLI tools → env vars (pi-mono ecosystem standard)
	const key =
		configApiKey ||
		daemonVaultKey ||
		(normalizedProvider === "openai" ? tryResolveCliToken("codex") : undefined) ||
		(normalizedProvider === "github" ? tryResolveCliToken("github") : undefined) ||
		tryResolveCliToken(normalizedProvider) ||
		(normalizedProvider === "zai" ? env.KIMI_API_KEY || env.MOONSHOT_API_KEY : undefined) ||
		(normalizedProvider === "xai" ? env.GROK_API_KEY : undefined) ||
		(normalizedProvider === "alibaba" ? env.DASHSCOPE_API_KEY : undefined) ||
		(normalizedProvider === "bedrock" ? env.AWS_BEARER_TOKEN : undefined) ||
		(envVar ? env[envVar] : undefined) ||
		env.TAKUMI_API_KEY;
	const allowMissingKey = normalizedProvider === "ollama" || canSkipApiKey({ ...config, provider: normalizedProvider });
	if (!key && !allowMissingKey) return null;

	const endpoint = await resolveEndpoint(normalizedProvider);

	return new agent.OpenAIProvider({
		...config,
		provider: normalizedProvider,
		apiKey: key || "",
		endpoint,
	});
}

export interface CreateResolvedProviderOptions {
	fallbackName?: string;
	preferredProvider?: string;
	preferredModel?: string;
	allowStandaloneFallback?: boolean;
	bootstrapBridge?: BootstrapCredentialBridge;
	/**
	 * When true, a Chitragupta-selected provider/model route is treated as
	 * authoritative and Takumi must fail closed instead of silently falling back
	 * to a configured or auto-detected provider.
	 */
	strictPreferredRoute?: boolean;
}

interface RouteIncompatibleError extends Error {
	code: "ROUTE_INCOMPATIBLE";
}

/**
 * Raised when Takumi cannot establish any executable provider path after the
 * control-plane and local discovery checks have both had their say.
 */
interface ProviderConfigurationError extends Error {
	code: "PROVIDER_CONFIG_UNAVAILABLE";
}

/** Create a fail-closed error when an engine-owned route cannot be honored locally. */
function createRouteIncompatibleError(providerName: string, model?: string): RouteIncompatibleError {
	const detail = describeProviderTarget(providerName, model);
	const error = new Error(
		`Chitragupta assigned ${detail}, but Takumi cannot initialize it locally. Failing closed instead of silently rerouting.`,
	) as RouteIncompatibleError;
	error.name = "RouteIncompatibleError";
	error.code = "ROUTE_INCOMPATIBLE";
	return error;
}

/** Create a stable config-classification error for startup and headless callers. */
function createProviderConfigurationError(message: string): ProviderConfigurationError {
	const error = new Error(message) as ProviderConfigurationError;
	error.name = "ProviderConfigurationError";
	error.code = "PROVIDER_CONFIG_UNAVAILABLE";
	return error;
}

/** Detect the authoritative-route mismatch failure that must stay fail-closed. */
export function isRouteIncompatibleError(error: unknown): error is RouteIncompatibleError {
	return (
		error instanceof Error &&
		((error as Partial<RouteIncompatibleError>).code === "ROUTE_INCOMPATIBLE" || error.name === "RouteIncompatibleError")
	);
}

/** Detect provider bootstrap failures that should surface as config errors. */
export function isProviderConfigurationError(error: unknown): error is ProviderConfigurationError {
	return (
		error instanceof Error &&
		((error as Partial<ProviderConfigurationError>).code === "PROVIDER_CONFIG_UNAVAILABLE" ||
			error.name === "ProviderConfigurationError")
	);
}

export interface ResolvedProviderRuntime {
	provider: any;
	resolvedConfig: TakumiConfig;
	source: string;
	usedStandaloneFallback: boolean;
	warnings: string[];
	startupModelSelection?: {
		requestedProvider?: string;
		requestedModel: string;
		allow: string[];
		prefer: string[];
		matchedRequest: string;
		resolvedProvider: string;
		resolvedModel: string;
		resolvedVersion?: string;
		resolvedIntent?: string;
		routeProvider: string;
		originProvider?: string;
	};
}

/**
 * Resolve the startup-only Kosha model policy before standalone auth fallback,
 * preserving the operator's allow/prefer contract.
 */
async function resolvePolicyManagedProvider(
	config: TakumiConfig,
	agent: any,
	bridge?: BootstrapCredentialBridge,
): Promise<ResolvedProviderRuntime | null> {
	const policyResolution = await resolveStartupModelPolicy(config);
	if (!policyResolution) return null;

	for (const attempt of policyResolution.attempts) {
		const candidateConfig = rebaseProviderConfig(config, attempt.providerName, attempt.model);
		const provider = await buildSingleProvider(attempt.providerName, candidateConfig, agent, bridge);
		if (!provider) continue;

		return {
			provider,
			resolvedConfig: candidateConfig,
			source: attempt.source,
			usedStandaloneFallback: false,
			warnings: [],
			startupModelSelection: buildStartupModelSelection(policyResolution, attempt),
		};
	}

	throw createProviderConfigurationError(formatModelPolicyFailure(policyResolution));
}

/** Build the requested/resolved startup model surface shown in the UI. */
function buildStartupModelSelection(
	resolution: StartupModelPolicyResolution,
	attempt: StartupModelPolicyResolution["attempts"][number],
): NonNullable<ResolvedProviderRuntime["startupModelSelection"]> {
	return {
		requestedProvider: resolution.request.provider,
		requestedModel: resolution.request.model,
		allow: resolution.request.allow,
		prefer: resolution.request.prefer,
		matchedRequest: attempt.requestedModel,
		resolvedProvider: attempt.providerName,
		resolvedModel: attempt.model,
		resolvedVersion: attempt.version,
		resolvedIntent: attempt.intent,
		routeProvider: attempt.routeProvider,
		originProvider: attempt.originProvider,
	};
}

/** Format a fail-closed startup policy message with operator-usable detail. */
function formatModelPolicyFailure(resolution: StartupModelPolicyResolution): string {
	const allowText = resolution.request.allow.length > 0 ? `allow: ${resolution.request.allow.join(", ")}` : "allow: none";
	const preferText = resolution.request.prefer.length > 0 ? `prefer: ${resolution.request.prefer.join(", ")}` : "prefer: none";
	const attemptedTargets = resolution.attempts.map((attempt) => describeProviderTarget(attempt.providerName, attempt.model));
	const attemptedText = attemptedTargets.length > 0 ? ` Tried: ${attemptedTargets.join(", ")}.` : "";
	return `No allowed model is available for startup policy \"${resolution.request.model}\" (${allowText}; ${preferText}).${attemptedText}`;
}

/**
 * Keep standalone fallback model selection honest when the detected provider
 * differs from the originally configured or routed target.
 */
function resolveStandaloneDetectedModel(
	config: TakumiConfig,
	detectedProvider: string,
	detectedModel: string | undefined,
	preferredProvider: string | undefined,
	preferredModel: string | undefined,
): string | undefined {
	if (typeof detectedModel === "string" && detectedModel.trim()) {
		return detectedModel.trim();
	}
	if (preferredModel && preferredProvider && normalizeOrDefaultProvider(preferredProvider) === detectedProvider) {
		return preferredModel;
	}
	if (normalizeOrDefaultProvider(config.provider) === detectedProvider) {
		return config.model;
	}
	return undefined;
}

/**
 * Resolve the primary provider by honoring engine-owned routes first, then the
 * configured provider, then startup model policy, and finally standalone auth.
 */
async function resolvePrimaryProvider(
	config: TakumiConfig,
	agent: any,
	options: CreateResolvedProviderOptions,
): Promise<ResolvedProviderRuntime> {
	const warnings: string[] = [];
	const preferredProvider = options.preferredProvider ? normalizeOrDefaultProvider(options.preferredProvider) : undefined;
	const preferredModel = options.preferredModel?.trim() || undefined;
	const strictPreferredRoute = Boolean(options.strictPreferredRoute && preferredProvider);
	const hasStartupModelPolicy = Boolean(config.modelPolicy);
	const configuredProvider = normalizeOrDefaultProvider(config.provider);
	const attempts: Array<{ providerName: string; model?: string; source: string; preferred: boolean }> = [];
	const seenProviders = new Set<string>();

	const queueAttempt = (providerName: string, model: string | undefined, source: string, preferred: boolean): void => {
		const normalizedProvider = normalizeOrDefaultProvider(providerName);
		if (seenProviders.has(normalizedProvider)) return;
		seenProviders.add(normalizedProvider);
		attempts.push({ providerName: normalizedProvider, model, source, preferred });
	};

	if (preferredProvider) {
		queueAttempt(
			preferredProvider,
			preferredModel,
			`Chitragupta route (${describeProviderTarget(preferredProvider, preferredModel)})`,
			true,
		);
	}

	if (!strictPreferredRoute && !hasStartupModelPolicy) {
		queueAttempt(
			configuredProvider,
			preferredModel && (!preferredProvider || preferredProvider === configuredProvider) ? preferredModel : config.model,
			"configured provider",
			false,
		);
	}

	for (const attempt of attempts) {
		const candidateConfig = rebaseProviderConfig(config, attempt.providerName, attempt.model);
		const provider = await buildSingleProvider(attempt.providerName, candidateConfig, agent, options.bootstrapBridge);
		if (provider) {
			return {
				provider,
				resolvedConfig: candidateConfig,
				source: attempt.source,
				usedStandaloneFallback: false,
				warnings,
			};
		}

		if (attempt.preferred) {
			if (strictPreferredRoute) {
				throw createRouteIncompatibleError(attempt.providerName, attempt.model);
			}
			warnings.push(
				`Chitragupta requested ${describeProviderTarget(attempt.providerName, attempt.model)}, but it is unavailable locally.`,
			);
		}
	}

	const policyManagedResolution = await resolvePolicyManagedProvider(config, agent, options.bootstrapBridge);
	if (policyManagedResolution) {
		return {
			...policyManagedResolution,
			warnings: [...warnings, ...policyManagedResolution.warnings],
		};
	}

	if (!strictPreferredRoute && options.allowStandaloneFallback !== false) {
		// Standalone discovery is still allowed after bootstrap; it just no longer
		// runs as a blocking preflight before Chitragupta has routed the startup.
		const detected = await autoDetectAuth();
		if (detected) {
			const detectedProvider = normalizeOrDefaultProvider(detected.provider);
			const detectedModel = resolveStandaloneDetectedModel(
				config,
				detectedProvider,
				detected.model,
				preferredProvider,
				preferredModel,
			);
			if (!detectedModel && detectedProvider !== configuredProvider) {
				warnings.push(
					`Takumi detected ${detected.source}, but it did not expose a compatible startup model for ${detectedProvider}.`,
				);
			} else {
				const detectedConfig = rebaseProviderConfig(config, detectedProvider, detectedModel, detected.apiKey);
				const provider = await buildSingleProvider(detectedProvider, detectedConfig, agent, options.bootstrapBridge);
				if (provider) {
					return {
						provider,
						resolvedConfig: detectedConfig,
						source: detected.source,
						usedStandaloneFallback: true,
						warnings,
					};
				}

				warnings.push(`Takumi detected ${detected.source}, but could not initialize ${detectedProvider}.`);
			}
		}
	}

	const preferredDetail = preferredProvider
		? ` (Chitragupta requested ${describeProviderTarget(preferredProvider, preferredModel)})`
		: "";
	throw createProviderConfigurationError(
		`Cannot create provider "${configuredProvider}"${preferredDetail}: missing API key or local provider config.`,
	);
}

/**
 * Shared entry point for interactive and headless provider startup, including
 * optional Darpana proxy mode and failover wrapping.
 */
export async function createResolvedProvider(
	config: TakumiConfig,
	options: CreateResolvedProviderOptions = {},
): Promise<ResolvedProviderRuntime> {
	const agent = await import("@takumi/agent");

	if (config.proxyUrl) {
		return {
			provider: new agent.DarpanaProvider(config),
			resolvedConfig: config,
			source: "proxy",
			usedStandaloneFallback: false,
			warnings: [],
		};
	}

	const primaryResolution = await resolvePrimaryProvider(config, agent, options);
	if (options.strictPreferredRoute) {
		return primaryResolution;
	}

	const fallbackName = options.fallbackName ? normalizeOrDefaultProvider(options.fallbackName) : undefined;
	if (!fallbackName || fallbackName === primaryResolution.resolvedConfig.provider) {
		return primaryResolution;
	}

	const fallbackConfig = rebaseProviderConfig(config, fallbackName, primaryResolution.resolvedConfig.model);
	const fallback = await buildSingleProvider(fallbackName, fallbackConfig, agent, options.bootstrapBridge);
	if (!fallback) {
		throw createProviderConfigurationError(
			`Cannot create fallback provider "${fallbackName}": missing API key or config.`,
		);
	}

	return {
		...primaryResolution,
		provider: new agent.FailoverProvider({
			providers: [
				{ name: primaryResolution.resolvedConfig.provider || "anthropic", provider: primaryResolution.provider, priority: 0 },
				{ name: fallbackName, provider: fallback, priority: 1 },
			],
			onSwitch: (from: string, to: string, reason: string) => {
				process.stderr.write(`\x1b[33m[failover]\x1b[0m Switching from ${from} to ${to}: ${reason}\n`);
			},
		}),
	};
}

/** Legacy convenience wrapper around the richer provider-resolution runtime. */
export async function createProvider(config: TakumiConfig, fallbackName?: string): Promise<any> {
	const resolved = await createResolvedProvider(config, { fallbackName });
	return resolved.provider;
}
