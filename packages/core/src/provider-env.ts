import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDER_ENV_KEYS: Record<string, string[]> = {
	anthropic: ["ANTHROPIC_API_KEY"],
	openai: ["OPENAI_API_KEY"],
	github: ["GITHUB_TOKEN"],
	gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	groq: ["GROQ_API_KEY"],
	deepseek: ["DEEPSEEK_API_KEY"],
	mistral: ["MISTRAL_API_KEY"],
	together: ["TOGETHER_API_KEY"],
	openrouter: ["OPENROUTER_API_KEY"],
	zai: ["ZAI_API_KEY", "GLM_API_KEY"],
	moonshot: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
	minimax: ["MINIMAX_API_KEY"],
	xai: ["XAI_API_KEY", "GROK_API_KEY"],
	alibaba: ["ALIBABA_API_KEY", "DASHSCOPE_API_KEY"],
	bedrock: ["BEDROCK_API_KEY", "AWS_BEARER_TOKEN"],
	ollama: [],
};

export const PROVIDER_ENDPOINT_ENV_KEYS: Record<string, string[]> = {
	zai: ["ZAI_ENDPOINT"],
	moonshot: ["MOONSHOT_ENDPOINT"],
	minimax: ["MINIMAX_ENDPOINT"],
	xai: ["XAI_ENDPOINT", "GROK_ENDPOINT"],
	alibaba: ["ALIBABA_ENDPOINT", "DASHSCOPE_ENDPOINT"],
	bedrock: ["BEDROCK_ENDPOINT", "AWS_BEDROCK_ENDPOINT"],
};

const PROVIDER_ALIASES: Record<string, string> = {
	claude: "anthropic",
	google: "gemini",
	grok: "xai",
	glm: "zai",
	kimi: "moonshot",
	dashscope: "alibaba",
};

function envFilePaths(cwd: string): string[] {
	const home = homedir();
	return [
		join(cwd, ".env"),
		join(cwd, ".takumi", ".env"),
		join(home, ".takumi", ".env"),
		join(home, ".config", "takumi", ".env"),
	];
}

function parseEnvFile(path: string): Record<string, string> {
	if (!existsSync(path)) return {};

	try {
		const parsed: Record<string, string> = {};
		const content = readFileSync(path, "utf-8");
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
			const eqIndex = trimmed.indexOf("=");
			const key = trimmed.slice(0, eqIndex).trim();
			let value = trimmed.slice(eqIndex + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			parsed[key] = value;
		}
		return parsed;
	} catch {
		return {};
	}
}

export function normalizeProviderName(provider?: string): string | undefined {
	if (!provider) return undefined;
	const normalized = provider.trim().toLowerCase();
	return PROVIDER_ALIASES[normalized] ?? normalized;
}

export function loadMergedEnv(cwd = process.cwd()): Record<string, string | undefined> {
	const merged: Record<string, string | undefined> = {};
	for (const path of envFilePaths(cwd)) {
		Object.assign(merged, parseEnvFile(path));
	}
	for (const [key, value] of Object.entries(process.env)) {
		merged[key] = value;
	}
	return merged;
}

export function resolveProviderCredential(
	provider: string | undefined,
	env: Record<string, string | undefined>,
): string | undefined {
	const normalized = normalizeProviderName(provider);
	if (!normalized) return undefined;
	for (const key of PROVIDER_ENV_KEYS[normalized] ?? []) {
		const value = env[key];
		if (value) return value;
	}
	return undefined;
}

export function resolveProviderEndpoint(
	provider: string | undefined,
	env: Record<string, string | undefined>,
): string | undefined {
	const normalized = normalizeProviderName(provider);
	if (!normalized) return undefined;
	for (const key of PROVIDER_ENDPOINT_ENV_KEYS[normalized] ?? []) {
		const value = env[key];
		if (value) return value;
	}
	return undefined;
}

export function collectConfiguredProviders(
	env: Record<string, string | undefined>,
): Array<{ provider: string; apiKey: string }> {
	const configured: Array<{ provider: string; apiKey: string }> = [];
	for (const provider of Object.keys(PROVIDER_ENV_KEYS)) {
		const apiKey = resolveProviderCredential(provider, env);
		if (apiKey) configured.push({ provider, apiKey });
	}
	return configured;
}
