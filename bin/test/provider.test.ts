import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TakumiConfig } from "@takumi/core";

vi.mock("../cli/cli-auth.js", () => ({
	tryResolveCliToken: vi.fn(() => undefined),
}));

vi.mock("../cli/kosha-bridge.js", () => ({
	koshaEndpoint: vi.fn(async () => ""),
}));

import { tryResolveCliToken } from "../cli/cli-auth.js";
import { buildSingleProvider } from "../cli/provider.js";

const mockTryResolveCliToken = vi.mocked(tryResolveCliToken);

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
		left: ["model", "mesh", "scarlett"],
		center: ["status"],
		right: ["metrics", "keybinds"],
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
		vi.restoreAllMocks();
		mockTryResolveCliToken.mockReturnValue(undefined);
		delete process.env.ZAI_API_KEY;
		delete process.env.KIMI_API_KEY;
		delete process.env.MOONSHOT_API_KEY;
		delete process.env.TAKUMI_API_KEY;
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

	it("prefers Codex CLI credentials over a different provider's sticky apiKey when switching to openai", async () => {
		const agent = createAgentDouble();
		mockTryResolveCliToken.mockImplementation((provider) => (provider === "codex" ? "codex-cli-key" : undefined));

		const provider = await buildSingleProvider(
			"openai",
			{ ...baseConfig, provider: "anthropic", apiKey: "claude-config-key" },
			agent,
		);

		expect(provider).toBeInstanceOf(agent.OpenAIProvider);
		expect(provider.config.apiKey).toBe("codex-cli-key");
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
	});
});