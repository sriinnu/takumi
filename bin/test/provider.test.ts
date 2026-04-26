import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TakumiConfig } from "@takumi/core";

const { mockAutoDetectAuth } = vi.hoisted(() => ({
	mockAutoDetectAuth: vi.fn<
		() => Promise<{
			provider: string;
			apiKey: string;
			model?: string;
			source: string;
		} | null>
	>(async () => null),
}));

const { mockKoshaModel, mockKoshaModelRouteInfo } = vi.hoisted(() => ({
	mockKoshaModel: vi.fn<(idOrAlias: string) => Promise<Record<string, unknown> | undefined>>(async () => undefined),
	mockKoshaModelRouteInfo: vi.fn<(idOrAlias: string) => Promise<Record<string, unknown>[]>>(async () => []),
}));

vi.mock("../cli/cli-auth.js", () => ({
	tryResolveCliToken: vi.fn(() => undefined),
	autoDetectAuth: mockAutoDetectAuth,
}));

vi.mock("../cli/kosha-bridge.js", () => ({
	koshaEndpoint: vi.fn(async () => ""),
	koshaModel: mockKoshaModel,
	koshaModelRouteInfo: mockKoshaModelRouteInfo,
	mapKoshaProvider: vi.fn((provider: string) => (provider === "google" ? "gemini" : provider)),
}));

vi.mock("@takumi/agent", () => {
	class DirectProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	class GeminiProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	class OpenAIProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	class DarpanaProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	class FailoverProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	return { DirectProvider, GeminiProvider, OpenAIProvider, DarpanaProvider, FailoverProvider };
});

import { tryResolveCliToken } from "../cli/cli-auth.js";
import { buildSingleProvider, createResolvedProvider, isRouteIncompatibleError } from "../cli/provider.js";

const mockTryResolveCliToken = vi.mocked(tryResolveCliToken);
type BootstrapCredentialBridge = NonNullable<Parameters<typeof buildSingleProvider>[3]>;

const baseConfig: TakumiConfig = {
	apiKey: "",
	model: "claude-sonnet-4-20250514",
	maxTokens: 16384,
	thinking: false,
	thinkingBudget: 10000,
	systemPrompt: "",
	workingDirectory: process.cwd(),
	proxyUrl: "",
	provider: "anthropic",
	endpoint: "",
	permissions: [],
	theme: "default",
	logLevel: "info",
	maxTurns: 100,
	experimental: {},
	orchestration: {
		enabled: true,
		defaultMode: "multi",
		complexityThreshold: "STANDARD",
		maxValidationRetries: 3,
		isolationMode: "none",
		ensemble: { enabled: false, workerCount: 3, temperature: 0.9, parallel: true },
		weightedVoting: { minConfidenceThreshold: 0.1 },
		reflexion: { enabled: false, maxHistorySize: 3, useAkasha: true },
		moA: { enabled: false, rounds: 2, validatorCount: 3, allowCrossTalk: true, temperatures: [0.2, 0.1, 0.05] },
		progressiveRefinement: {
			enabled: false,
			maxIterations: 3,
			minImprovement: 0.05,
			useCriticModel: true,
			targetScore: 9.0,
		},
		adaptiveTemperature: { enabled: true },
		mesh: {
			defaultTopology: "hierarchical",
			lucyAdaptiveTopology: true,
			scarlettAdaptiveTopology: true,
			sabhaEscalation: { enabled: true, integrityThreshold: "critical", minValidationAttempts: 1 },
		},
	},
	statusBar: {
		left: ["model", "mesh", "cluster"],
		center: ["status"],
		right: ["authority", "metrics", "context", "scarlett", "keybinds"],
	},
	plugins: [],
	packages: [],
};

function createAgentDouble() {
	class DirectProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	class GeminiProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	class OpenAIProvider {
		constructor(public readonly config: Record<string, unknown>) {}
	}

	return { DirectProvider, GeminiProvider, OpenAIProvider };
}

describe("buildSingleProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTryResolveCliToken.mockReturnValue(undefined);
		mockAutoDetectAuth.mockResolvedValue(null);
		mockKoshaModel.mockResolvedValue(undefined);
		mockKoshaModelRouteInfo.mockResolvedValue([]);
		delete process.env.OPENAI_API_KEY;
		delete process.env.ZAI_API_KEY;
		delete process.env.KIMI_API_KEY;
		delete process.env.MOONSHOT_API_KEY;
		delete process.env.MINIMAX_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.GOOGLE_API_KEY;
		delete process.env.TAKUMI_API_KEY;
		delete process.env.TAKUMI_PROVIDER;
	});

	it("uses config.apiKey for the configured provider", async () => {
		const agent = createAgentDouble();
		const provider = await buildSingleProvider(
			"anthropic",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.DirectProvider);
		expect(provider.config.apiKey).toBe("claude-config-key");
	});

	it("keeps the configured provider apiKey even when the bootstrap bridge is present", async () => {
		const agent = createAgentDouble();
		const bridge: BootstrapCredentialBridge = {
			requestProviderCredential: vi.fn(async () => ({
				found: false,
				providerId: "anthropic",
				boundProviderId: "anthropic",
				modelId: null,
				routeClass: null,
				selectedCapabilityId: null,
				consumer: "takumi",
				value: null,
				needsRekey: false,
			})),
		};

		const provider = await buildSingleProvider(
			"anthropic",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
			bridge,
		);

		expect(provider).toBeInstanceOf(agent.DirectProvider);
		expect(provider.config.apiKey).toBe("claude-config-key");
		expect(bridge.requestProviderCredential).not.toHaveBeenCalled();
	});

	it("respects a pinned TAKUMI_API_KEY for the pinned provider even with bridge bootstrap", async () => {
		const agent = createAgentDouble();
		process.env.TAKUMI_PROVIDER = "openai";
		process.env.TAKUMI_API_KEY = "takumi-openai-key";

		const provider = await buildSingleProvider(
			"openai",
			{ ...baseConfig, provider: "openai", apiKey: "" },
			agent,
			{ requestProviderCredential: vi.fn(async () => ({ found: false, value: null })) } as never,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("takumi-openai-key");
	});

	it("prefers OPENAI_API_KEY over a different provider's sticky apiKey when switching to openai", async () => {
		const agent = createAgentDouble();
		process.env.OPENAI_API_KEY = "openai-env-key";

		const provider = await buildSingleProvider(
			"openai",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("openai-env-key");
	});

	it("prefers ZAI env credentials over a different provider's sticky apiKey when switching to zai", async () => {
		const agent = createAgentDouble();
		process.env.ZAI_API_KEY = "zai-env-key";

		const provider = await buildSingleProvider(
			"zai",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("zai-env-key");
		expect(provider.config.providerName).toBe("zai");
	});

	it("keeps Moonshot credentials on the Moonshot provider instead of leaking them into Z.AI", async () => {
		const agent = createAgentDouble();
		process.env.KIMI_API_KEY = "kimi-env-key";

		const provider = await buildSingleProvider(
			"moonshot",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("kimi-env-key");
		expect(provider.config.providerName).toBe("moonshot");
	});

	it("supports MiniMax as a first-class OpenAI-compatible provider", async () => {
		const agent = createAgentDouble();
		process.env.MINIMAX_API_KEY = "minimax-env-key";

		const provider = await buildSingleProvider(
			"minimax",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("minimax-env-key");
		expect(provider.config.providerName).toBe("minimax");
	});

	it("allows local OpenAI-compatible endpoints without an API key", async () => {
		const agent = createAgentDouble();
		const provider = await buildSingleProvider(
			"openai",
			{ ...baseConfig, provider: "openai", apiKey: "", endpoint: "http://127.0.0.1:11434/v1" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("");
		expect(provider.config.endpoint).toBe("http://127.0.0.1:11434/v1");
	});

	it("maps gemini to the daemon's google credential id", async () => {
		const agent = createAgentDouble();
		const bridge: BootstrapCredentialBridge = {
			requestProviderCredential: vi.fn<BootstrapCredentialBridge["requestProviderCredential"]>(async () => ({
				found: true,
				providerId: "google",
				boundProviderId: "google",
				modelId: null,
				routeClass: null,
				selectedCapabilityId: null,
				consumer: "takumi",
				value: "daemon-gemini-key",
				needsRekey: false,
			})),
		};

		const provider = await buildSingleProvider("gemini", { ...baseConfig, provider: "gemini", apiKey: "" }, agent, bridge);

		expect(provider).toBeInstanceOf(agent.GeminiProvider);
		expect(bridge.requestProviderCredential).toHaveBeenCalledWith("google");
		expect(provider.config.apiKey).toBe("daemon-gemini-key");
	});

	it("falls back to the native Gemini endpoint when no override is configured", async () => {
		const agent = createAgentDouble();
		process.env.GEMINI_API_KEY = "gemini-env-key";

		const provider = await buildSingleProvider(
			"gemini",
			{ ...baseConfig, provider: "gemini", apiKey: "", endpoint: "" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.GeminiProvider);
		expect(provider.config.endpoint).toBe("https://generativelanguage.googleapis.com/v1beta/models");
	});
});

describe("createResolvedProvider", () => {
	it("resolves startup model policy aliases through Kosha", async () => {
		mockTryResolveCliToken.mockImplementation((provider) => (provider === "anthropic" ? "claude-cli-key" : undefined));
		mockKoshaModel.mockImplementation(async (idOrAlias: string) => {
			if (idOrAlias === "claude" || idOrAlias === "claude-sonnet-4-20250514") {
				return {
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4",
					provider: "anthropic",
					originProvider: "anthropic",
					mode: "chat",
					capabilities: ["chat", "code"],
					contextWindow: 200000,
					maxOutputTokens: 8192,
					aliases: ["claude"],
					discoveredAt: Date.now(),
					source: "api",
				};
			}
			return undefined;
		});
		mockKoshaModelRouteInfo.mockResolvedValue([
			{
				model: {
					id: "claude-sonnet-4-20250514",
					name: "Claude Sonnet 4",
					provider: "anthropic",
					originProvider: "anthropic",
					mode: "chat",
					capabilities: ["chat", "code"],
					contextWindow: 200000,
					maxOutputTokens: 8192,
					aliases: ["claude"],
					discoveredAt: Date.now(),
					source: "api",
				},
				provider: "anthropic",
				originProvider: "anthropic",
				version: "20250514",
				isDirect: true,
				isPreferred: true,
			},
		]);

		const resolution = await createResolvedProvider({
			...baseConfig,
			provider: "anthropic",
			model: "claude",
			apiKey: "",
			modelPolicy: {
				allow: ["claude"],
			},
		});

		expect(resolution.resolvedConfig.provider).toBe("anthropic");
		expect(resolution.resolvedConfig.model).toBe("claude-sonnet-4-20250514");
		expect(resolution.source).toContain("Kosha policy");
		expect(resolution.startupModelSelection).toEqual(
			expect.objectContaining({
				requestedModel: "claude",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4-20250514",
				resolvedVersion: "20250514",
				resolvedIntent: "claude",
			}),
		);
	});

	it("fails closed when no allowed Kosha model can be initialized locally", async () => {
		mockKoshaModel.mockImplementation(async (idOrAlias: string) => {
			if (idOrAlias === "gpt-4.1") {
				return {
					id: "gpt-4.1",
					name: "GPT-4.1",
					provider: "openai",
					originProvider: "openai",
					mode: "chat",
					capabilities: ["chat", "code"],
					contextWindow: 128000,
					maxOutputTokens: 8192,
					aliases: ["gpt-4.1"],
					discoveredAt: Date.now(),
					source: "api",
				};
			}
			return undefined;
		});
		mockKoshaModelRouteInfo.mockResolvedValue([
			{
				model: {
					id: "gpt-4.1",
					name: "GPT-4.1",
					provider: "openai",
					originProvider: "openai",
					mode: "chat",
					capabilities: ["chat", "code"],
					contextWindow: 128000,
					maxOutputTokens: 8192,
					aliases: ["gpt-4.1"],
					discoveredAt: Date.now(),
					source: "api",
				},
				provider: "openai",
				originProvider: "openai",
				version: "4.1",
				isDirect: true,
				isPreferred: true,
			},
		]);

		await expect(
			createResolvedProvider({
				...baseConfig,
				provider: "anthropic",
				model: "claude",
				apiKey: "",
				modelPolicy: {
					allow: ["gpt-4.1"],
					prefer: ["gpt-4.1"],
				},
			}),
		).rejects.toThrow(/No allowed model is available/);
	});

	it("honors Chitragupta provider handoff when the routed provider is available", async () => {
		mockTryResolveCliToken.mockImplementation((provider) => (provider === "gemini" ? "gemini-cli-key" : undefined));

		const resolution = await createResolvedProvider(
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			{ preferredProvider: "gemini", preferredModel: "gemini-2.5-pro" },
		);

		expect(resolution.resolvedConfig.provider).toBe("gemini");
		expect(resolution.resolvedConfig.model).toBe("gemini-2.5-pro");
		expect(resolution.source).toContain("Chitragupta route");
		expect(resolution.usedStandaloneFallback).toBe(false);
		expect(resolution.provider.config.apiKey).toBe("gemini-cli-key");
	});

	it("falls back to any detected standalone provider when the configured provider is unavailable", async () => {
		mockAutoDetectAuth.mockResolvedValue({
			provider: "openai",
			apiKey: "openai-env-key",
			model: "gpt-4.1",
			source: "OPENAI_API_KEY",
		});

		const resolution = await createResolvedProvider({
			...baseConfig,
			provider: "anthropic",
			apiKey: "",
			endpoint: "",
		});

		expect(resolution.resolvedConfig.provider).toBe("openai");
		expect(resolution.resolvedConfig.model).toBe("gpt-4.1");
		expect(resolution.usedStandaloneFallback).toBe(true);
		expect(resolution.source).toBe("OPENAI_API_KEY");
		expect(resolution.provider.config.apiKey).toBe("openai-env-key");
	});

	it("uses a provider default when standalone fallback detects a provider without a model", async () => {
		mockAutoDetectAuth.mockResolvedValue({
			provider: "openai",
			apiKey: "openai-env-key",
			source: "OPENAI_API_KEY",
		});

		const resolution = await createResolvedProvider({
			...baseConfig,
			provider: "anthropic",
			apiKey: "",
			endpoint: "",
		});

		expect(resolution.resolvedConfig.provider).toBe("openai");
		expect(resolution.resolvedConfig.model).toBe("gpt-4.1");
		expect(resolution.usedStandaloneFallback).toBe(true);
	});

	it("uses the detected model when standalone fallback switches providers", async () => {
		mockAutoDetectAuth.mockResolvedValue({
			provider: "ollama",
			apiKey: "",
			model: "qwen2.5-coder:7b",
			source: "Ollama (local)",
		});

		const resolution = await createResolvedProvider({
			...baseConfig,
			provider: "openai",
			model: "claude-sonnet-4-20250514",
			apiKey: "",
			endpoint: "",
		});

		expect(resolution.resolvedConfig.provider).toBe("ollama");
		expect(resolution.resolvedConfig.model).toBe("qwen2.5-coder:7b");
		expect(resolution.usedStandaloneFallback).toBe(true);
	});

	it("fails closed when an authoritative Chitragupta route cannot be honored locally", async () => {
		await expect(
			createResolvedProvider(
				{
					...baseConfig,
					provider: "anthropic",
					apiKey: "",
					endpoint: "",
				},
				{
					preferredProvider: "impossible-provider",
					preferredModel: "black-hole-1",
					strictPreferredRoute: true,
				},
			),
		).rejects.toSatisfy((error: unknown) => isRouteIncompatibleError(error));
	});

	it("keeps a locally configured direct key even when bridge bootstrap is present", async () => {
		process.env.OPENAI_API_KEY = "ambient-openai-key";

		const resolution = await createResolvedProvider(
			{ ...baseConfig, provider: "openai", model: "gpt-4.1", apiKey: "ambient-openai-key" },
			{
				preferredProvider: "openai",
				preferredModel: "gpt-4.1",
				bootstrapBridge: {
					requestProviderCredential: vi.fn(async () => {
						throw new Error("bridge failed");
					}),
				},
			},
		);

		expect(resolution.resolvedConfig.provider).toBe("openai");
		expect(resolution.provider.config.apiKey).toBe("ambient-openai-key");
		expect(resolution.source).toContain("Chitragupta route");
	});
});
