import { describe, expect, it, vi } from "vitest";
import type { TakumiConfig } from "@takumi/core";
import {
	formatInteractiveProviderSetupMessage,
	resolveInteractiveProviderWithOnboarding,
	type ChooseProviderAndModelResult,
} from "../cli/interactive-provider-onboarding.js";
import type { CreateResolvedProviderOptions, ResolvedProviderRuntime } from "../cli/provider.js";

function buildConfig(): TakumiConfig {
	return {
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
				targetScore: 9,
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
}

function createProviderConfigurationError(message: string): Error & { code: string; name: string } {
	const error = new Error(message) as Error & { code: string; name: string };
	error.code = "PROVIDER_CONFIG_UNAVAILABLE";
	error.name = "ProviderConfigurationError";
	return error;
}

function createResolution(config: TakumiConfig): ResolvedProviderRuntime {
	return {
		provider: { sendMessage: vi.fn() },
		resolvedConfig: { ...config },
		source: "configured provider",
		usedStandaloneFallback: false,
		warnings: [],
	};
}

describe("formatInteractiveProviderSetupMessage", () => {
	it("summarizes the routed target, detected providers, and recovery hint", () => {
		const message = formatInteractiveProviderSetupMessage({
			error: new Error("missing API key"),
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			preferredProvider: "openai",
			preferredModel: "gpt-4.1",
			providerStatuses: [{ id: "ollama", authenticated: false, credentialSource: "none", models: ["qwen2.5-coder:7b"] }],
			attempt: 1,
			maxAttempts: 2,
		});

		expect(message).toContain("Startup provider setup needed");
		expect(message).toContain("Chitragupta suggested: openai / gpt-4.1");
		expect(message).toContain("Discovered providers: Ollama");
		expect(message).toContain("takumi doctor");
	});
});

describe("resolveInteractiveProviderWithOnboarding", () => {
	it("retries after the user picks a session provider", async () => {
		const config = buildConfig();
		const failure = createProviderConfigurationError("Cannot create provider \"anthropic\": missing API key.");
		const expected = createResolution({ ...config, provider: "ollama", model: "qwen2.5-coder:7b" });
		const resolveProvider = vi
			.fn<(config: TakumiConfig, options?: CreateResolvedProviderOptions) => Promise<ResolvedProviderRuntime>>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce(expected);
		const chooseProvider = vi.fn<
			(config: TakumiConfig) => Promise<ChooseProviderAndModelResult | null>
		>(async (mutableConfig) => {
			mutableConfig.provider = "ollama";
			mutableConfig.model = "qwen2.5-coder:7b";
			return { provider: "ollama", model: "qwen2.5-coder:7b" };
		});
		const lines: string[] = [];

		const result = await resolveInteractiveProviderWithOnboarding(
			config,
			{
				allowOnboarding: true,
				providerModels: { anthropic: ["claude-sonnet-4-20250514"], ollama: ["qwen2.5-coder:7b"] },
				providerStatuses: [{ id: "ollama", authenticated: false, credentialSource: "none", models: ["qwen2.5-coder:7b"] }],
				preferredProvider: "openai",
				preferredModel: "gpt-4.1",
			},
			{ resolveProvider, chooseProviderAndModel: chooseProvider, writeLine: (line) => lines.push(line) },
		);

		expect(result).toBe(expected);
		expect(chooseProvider).toHaveBeenCalledTimes(1);
		expect(resolveProvider).toHaveBeenCalledTimes(2);
		expect(lines[0]).toContain("Startup provider setup needed");
		expect(config.provider).toBe("ollama");
	});

	it("does not prompt when Chitragupta route authority is strict", async () => {
		const config = buildConfig();
		const failure = createProviderConfigurationError("Chitragupta credential resolution failed for openai.");
		const resolveProvider = vi.fn().mockRejectedValue(failure);
		const chooseProvider = vi.fn();

		await expect(
			resolveInteractiveProviderWithOnboarding(
				config,
				{
					allowOnboarding: true,
					strictPreferredRoute: true,
					providerModels: { openai: ["gpt-4.1"] },
					providerStatuses: [],
					preferredProvider: "openai",
					preferredModel: "gpt-4.1",
				},
				{ resolveProvider, chooseProviderAndModel: chooseProvider, writeLine: () => undefined },
			),
		).rejects.toBe(failure);

		expect(chooseProvider).not.toHaveBeenCalled();
	});

	it("rethrows the startup failure when the picker is cancelled", async () => {
		const config = buildConfig();
		const failure = createProviderConfigurationError("Cannot create provider \"anthropic\": missing API key.");
		const resolveProvider = vi.fn().mockRejectedValue(failure);
		const chooseProvider = vi.fn(async () => null);

		await expect(
			resolveInteractiveProviderWithOnboarding(
				config,
				{
					allowOnboarding: true,
					providerModels: { anthropic: ["claude-sonnet-4-20250514"] },
					providerStatuses: [],
				},
				{ resolveProvider, chooseProviderAndModel: chooseProvider, writeLine: () => undefined },
			),
		).rejects.toBe(failure);

		expect(chooseProvider).toHaveBeenCalledTimes(1);
	});
});