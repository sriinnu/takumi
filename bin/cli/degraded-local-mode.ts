import type { ExecLocalFallbackSnapshot } from "@takumi/core";
import type { FastProviderStatus } from "./cli-auth.js";

const OFFLINE_CONTROL_PLANE_CAPABILITIES = [
	"memory/RAG recall",
	"canonical sessions",
	"engine-selected routing",
] as const;

const PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Claude",
	openai: "OpenAI",
	github: "GitHub Models",
	gemini: "Gemini",
	groq: "Groq",
	xai: "xAI",
	deepseek: "DeepSeek",
	mistral: "Mistral",
	together: "Together",
	openrouter: "OpenRouter",
	ollama: "Ollama",
	alibaba: "Alibaba",
	bedrock: "Bedrock",
	zai: "Z.AI / GLM",
	moonshot: "Moonshot / Kimi",
	minimax: "MiniMax",
};

export interface DegradedLocalModeStatus extends ExecLocalFallbackSnapshot {
	readonly providers: FastProviderStatus[];
	readonly requiresOperatorConsent: boolean;
}

/**
 * I convert the fast provider snapshot into an operator-facing degraded-mode
 * summary so bootstrap, TUI startup, and headless runs all describe the same
 * fallback truth.
 */
export function buildDegradedLocalModeStatus(input: {
	chitraguptaDegraded: boolean;
	currentProvider?: string;
	currentModel?: string;
	providerStatuses: FastProviderStatus[];
}): DegradedLocalModeStatus | null {
	if (!input.chitraguptaDegraded) return null;

	const currentTarget = formatCurrentTarget(input.currentProvider, input.currentModel);
	const providerSummary = formatDiscoveredProviderSummary(input.providerStatuses);
	const summary =
		`Degraded local mode: Chitragupta-backed ${OFFLINE_CONTROL_PLANE_CAPABILITIES.join(", ")} are offline until rebind. ` +
		`Current runtime: ${currentTarget}. Discovered providers: ${providerSummary}.`;

	return {
		active: true,
		providerCount: input.providerStatuses.length,
		currentTarget,
		summary,
		providers: input.providerStatuses,
		requiresOperatorConsent: true,
	};
}

/** I keep the startup prompt compact while still showing the important truth. */
export function formatDiscoveredProviderSummary(providerStatuses: FastProviderStatus[]): string {
	if (providerStatuses.length === 0) return "none";

	return providerStatuses.map(formatProviderStatus).join(", ");
}

/** Ask once before Takumi continues without the Chitragupta control plane. */
export async function confirmDegradedLocalMode(status: DegradedLocalModeStatus): Promise<boolean> {
	const p = await import("@clack/prompts");
	p.note(
		[
			"Takumi can continue, but it will do so without the canonical Chitragupta control plane.",
			`Current runtime: ${status.currentTarget}`,
			`Discovered providers: ${formatDiscoveredProviderSummary(status.providers)}`,
			`Unavailable until rebind: ${OFFLINE_CONTROL_PLANE_CAPABILITIES.join(", ")}`,
		].join("\n"),
		"Degraded local mode",
	);

	const confirmed = await p.confirm({
		message: "Continue in degraded local mode?",
		initialValue: true,
	});

	if (p.isCancel(confirmed) || !confirmed) {
		p.outro("Stopped before entering degraded local mode.");
		return false;
	}

	p.outro("Continuing in degraded local mode.");
	return true;
}

function formatCurrentTarget(provider?: string, model?: string): string {
	if (provider && model) return `${provider} / ${model}`;
	if (provider) return provider;
	if (model) return model;
	return "unresolved provider";
}

function formatProviderStatus(provider: FastProviderStatus): string {
	const label = PROVIDER_LABELS[provider.id] ?? provider.id;
	const source = provider.credentialSource === "none" ? "local" : provider.credentialSource;
	const models = provider.models.slice(0, 2);
	const moreModels = provider.models.length > models.length ? ` +${provider.models.length - models.length} more` : "";

	if (provider.id === "ollama") {
		const modelList = models.length > 0 ? `: ${models.join(", ")}${moreModels}` : "";
		return `${label} (${provider.models.length} local model${provider.models.length === 1 ? "" : "s"}${modelList})`;
	}

	if (models.length > 0) {
		return `${label} (${source}: ${models.join(", ")}${moreModels})`;
	}

	return `${label} (${source})`;
}
