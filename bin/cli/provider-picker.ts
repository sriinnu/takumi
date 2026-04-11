import type { TakumiConfig } from "@takumi/core";
import { koshaProviderModels, koshaProviders } from "./kosha-bridge.js";

export interface ChooseProviderAndModelOptions {
	preferredProvider?: string;
	preferredModel?: string;
	showIntro?: boolean;
}

export interface ChooseProviderAndModelResult {
	provider: string;
	model: string;
}

/**
 * I drive the first-run provider picker with a cheap static fallback and a
 * richer Kosha-backed view when discovery is available.
 */
export async function chooseProviderAndModel(
	config: TakumiConfig,
	providerModels: Record<string, string[]>,
	options: ChooseProviderAndModelOptions = {},
): Promise<ChooseProviderAndModelResult | null> {
	const p = await import("@clack/prompts");

	if (options.showIntro !== false) {
		p.intro("\x1b[1;36mTakumi AI Coding Agent\x1b[0m");
	}

	let dynamicProviders: Record<string, string[]> = {};
	try {
		dynamicProviders = await koshaProviderModels();
	} catch {
		// I stay on the static catalog when Kosha discovery is unavailable.
	}

	const allProviders = { ...providerModels, ...dynamicProviders };

	let koshaProviderStatus: Array<{ id: string; name: string; authenticated: boolean }> = [];
	try {
		const discoveredProviders = await koshaProviders();
		koshaProviderStatus = discoveredProviders.map((provider) => ({
			id: mapKoshaToTakumi(provider.id),
			name: provider.name,
			authenticated: provider.authenticated || provider.id === "ollama",
		}));
	} catch {
		// I keep the picker usable even when provider status discovery fails.
	}

	const providerChoice = await p.select({
		message: "Select AI Provider",
		options: buildProviderOptions(allProviders, koshaProviderStatus),
		initialValue: options.preferredProvider || config.provider || "anthropic",
	});

	if (p.isCancel(providerChoice)) {
		p.outro("Startup cancelled.");
		return null;
	}

	const selectedProvider = providerChoice as string;
	const models = allProviders[selectedProvider] || [];

	let selectedModel = config.model;
	if (models.length > 0) {
		const modelChoice = await p.select({
			message: "Select Model",
			options: models.map((model) => ({ value: model, label: model })),
			initialValue: resolveInitialModel(models, options.preferredModel, config.model),
		});
		if (p.isCancel(modelChoice)) {
			p.outro("Startup cancelled.");
			return null;
		}
		selectedModel = modelChoice as string;
	} else {
		const modelInput = await p.text({
			message: "Enter Model Name",
			initialValue: options.preferredModel || config.model,
		});
		if (p.isCancel(modelInput)) {
			p.outro("Startup cancelled.");
			return null;
		}
		selectedModel = modelInput as string;
	}

	config.provider = selectedProvider;
	config.model = selectedModel;
	p.outro(`Starting with \x1b[32m${selectedProvider}\x1b[0m / \x1b[32m${selectedModel}\x1b[0m...`);
	return { provider: selectedProvider, model: selectedModel };
}

/** I map Kosha provider IDs to Takumi provider names. */
function mapKoshaToTakumi(koshaId: string): string {
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

/** I keep provider labels readable in the first-run picker. */
const PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Claude (Anthropic)",
	openai: "OpenAI (GPT / Codex / o-series)",
	gemini: "Google Gemini",
	github: "GitHub Models (free with gh CLI)",
	groq: "Groq (Fast Llama/Mixtral)",
	deepseek: "DeepSeek",
	mistral: "Mistral AI",
	together: "Together AI",
	openrouter: "OpenRouter",
	ollama: "Ollama (Local)",
	bedrock: "AWS Bedrock",
	vertex: "Google Vertex AI",
};

/**
 * I sort authenticated providers first so the picker defaults to the paths
 * that are most likely to work immediately.
 */
function buildProviderOptions(
	allProviders: Record<string, string[]>,
	koshaStatus: Array<{ id: string; name: string; authenticated: boolean }>,
): Array<{ value: string; label: string; hint?: string }> {
	const statusMap = new Map(koshaStatus.map((status) => [status.id, status]));
	const authenticated: Array<{ value: string; label: string; hint?: string }> = [];
	const unauthenticated: Array<{ value: string; label: string; hint?: string }> = [];

	for (const provider of Object.keys(allProviders)) {
		const status = statusMap.get(provider);
		const option = {
			value: provider,
			label: PROVIDER_LABELS[provider] ?? provider,
			hint: status?.authenticated ? `✓ ${allProviders[provider].length} models` : undefined,
		};
		if (status?.authenticated) {
			authenticated.push(option);
		} else {
			unauthenticated.push(option);
		}
	}

	return [...authenticated, ...unauthenticated];
}

function resolveInitialModel(models: string[], preferredModel: string | undefined, configuredModel: string): string {
	if (preferredModel && models.includes(preferredModel)) {
		return preferredModel;
	}
	if (models.includes(configuredModel)) {
		return configuredModel;
	}
	return models[0];
}
