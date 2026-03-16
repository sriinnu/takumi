import type { TakumiConfig } from "@takumi/core";
import { normalizeProviderName, PROVIDER_ENDPOINT_ENV_KEYS, PROVIDER_ENDPOINTS } from "@takumi/core";
import { tryResolveCliToken } from "./cli-auth.js";
import { koshaEndpoint } from "./kosha-bridge.js";

function resolveConfigApiKey(providerName: string, config: TakumiConfig): string | undefined {
	if (!config.apiKey) return undefined;

	const configuredProvider = config.provider || "anthropic";
	return configuredProvider === providerName ? config.apiKey : undefined;
}

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

export async function buildSingleProvider(
	providerName: string,
	config: TakumiConfig,
	agent: any,
): Promise<any | null> {
	const env = process.env;
	const normalizedProvider = normalizeProviderName(providerName) ?? providerName;
	const configApiKey = resolveConfigApiKey(normalizedProvider, config);

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
			tryResolveCliToken("gemini") ||
			env.GEMINI_API_KEY ||
			env.GOOGLE_API_KEY ||
			env.TAKUMI_API_KEY;
		if (!key) return null;
		const endpoint = await resolveEndpoint("google");
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
		(normalizedProvider === "openai" ? tryResolveCliToken("codex") : undefined) ||
		(normalizedProvider === "github" ? tryResolveCliToken("github") : undefined) ||
		tryResolveCliToken(normalizedProvider) ||
		(normalizedProvider === "zai" ? env.KIMI_API_KEY || env.MOONSHOT_API_KEY : undefined) ||
		(normalizedProvider === "xai" ? env.GROK_API_KEY : undefined) ||
		(normalizedProvider === "alibaba" ? env.DASHSCOPE_API_KEY : undefined) ||
		(normalizedProvider === "bedrock" ? env.AWS_BEARER_TOKEN : undefined) ||
		(envVar ? env[envVar] : undefined) ||
		env.TAKUMI_API_KEY;
	if (!key && normalizedProvider !== "ollama") return null;

	const endpoint = await resolveEndpoint(normalizedProvider);

	return new agent.OpenAIProvider({
		...config,
		provider: normalizedProvider,
		apiKey: key || "",
		endpoint,
	});
}

export async function createProvider(config: TakumiConfig, fallbackName?: string): Promise<any> {
	const agent = await import("@takumi/agent");

	if (config.proxyUrl) {
		return new agent.DarpanaProvider(config);
	}

	if (fallbackName) {
		const primaryName = config.provider || "anthropic";
		const primary = await buildSingleProvider(primaryName, config, agent);
		const fallback = await buildSingleProvider(fallbackName, config, agent);

		if (!primary) throw new Error(`Cannot create primary provider "${primaryName}": missing API key or config.`);
		if (!fallback) throw new Error(`Cannot create fallback provider "${fallbackName}": missing API key or config.`);

		return new agent.FailoverProvider({
			providers: [
				{ name: primaryName, provider: primary, priority: 0 },
				{ name: fallbackName, provider: fallback, priority: 1 },
			],
			onSwitch: (from: string, to: string, reason: string) => {
				process.stderr.write(`\x1b[33m[failover]\x1b[0m Switching from ${from} to ${to}: ${reason}\n`);
			},
		});
	}

	if (config.provider === "anthropic" || !config.provider) {
		return new agent.DirectProvider(config);
	}

	if (config.provider === "gemini") {
		try {
			const { GeminiProvider } = await import("@takumi/agent");
			const raw = config as unknown as Record<string, unknown>;
			return new GeminiProvider({
				apiKey: String(raw.apiKey ?? ""),
				model: String(raw.model ?? "gemini-1.5-flash"),
				maxTokens: Number(raw.maxTokens ?? 16384),
				thinking: Boolean(raw.thinking ?? false),
				thinkingBudget: Number(raw.thinkingBudget ?? 8000),
			});
		} catch {
			throw new Error("GeminiProvider is not yet available. Install or build @takumi/agent with Gemini support.");
		}
	}

	try {
		const { OpenAIProvider } = await import("@takumi/agent");
		return new OpenAIProvider({
			...config,
			endpoint: config.endpoint || PROVIDER_ENDPOINTS[config.provider] || config.endpoint,
		});
	} catch {
		throw new Error(
			`OpenAIProvider is not yet available for provider "${config.provider}". Install or build @takumi/agent with OpenAI-compatible support.`,
		);
	}
}
