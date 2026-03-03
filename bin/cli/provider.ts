import type { TakumiConfig } from "@takumi/core";
import { PROVIDER_ENDPOINTS } from "@takumi/core";
import { tryResolveCliToken } from "./cli-auth.js";

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

	if (providerName === "anthropic") {
		// Priority: CLI tools → env vars (pi-mono ecosystem standard)
		const key =
			config.apiKey ||
			tryResolveCliToken("anthropic") ||
			env.ANTHROPIC_API_KEY ||
			env.CLAUDE_CODE_OAUTH_TOKEN ||
			env.TAKUMI_API_KEY;
		if (!key) return null;
		return new agent.DirectProvider({ ...config, apiKey: key });
	}

	if (providerName === "gemini") {
		// Priority: CLI tools → env vars
		const key =
			config.apiKey ||
			tryResolveCliToken("gemini") ||
			env.GEMINI_API_KEY ||
			env.GOOGLE_API_KEY ||
			env.TAKUMI_API_KEY;
		if (!key) return null;
		return new agent.GeminiProvider({
			...config,
			apiKey: key,
			endpoint: config.endpoint || PROVIDER_ENDPOINTS[providerName] || "",
		});
	}

	const keyMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		github: "GITHUB_TOKEN",
		groq: "GROQ_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
		mistral: "MISTRAL_API_KEY",
		together: "TOGETHER_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		ollama: "",
	};

	const envVar = keyMap[providerName];
	// Priority: CLI tools → env vars (pi-mono ecosystem standard)
	const key =
		config.apiKey ||
		(providerName === "openai" ? tryResolveCliToken("codex") : undefined) ||
		(providerName === "github" ? tryResolveCliToken("github") : undefined) ||
		tryResolveCliToken(providerName) ||
		(envVar ? env[envVar] : undefined) ||
		env.TAKUMI_API_KEY;
	if (!key && providerName !== "ollama") return null;

	return new agent.OpenAIProvider({
		...config,
		apiKey: key || "",
		endpoint: config.endpoint || PROVIDER_ENDPOINTS[providerName] || "",
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
