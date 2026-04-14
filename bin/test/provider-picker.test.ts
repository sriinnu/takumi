import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TakumiConfig } from "@takumi/core";

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	isCancel: vi.fn(() => false),
	select: vi.fn(),
	text: vi.fn(),
}));

vi.mock("../cli/kosha-bridge.js", () => ({
	koshaProviderModels: vi.fn(async () => ({
		openrouter: ["openrouter/anthropic/claude-sonnet-4"],
		openai: ["gpt-4o"],
		moonshot: ["kimi-k2.5"],
	})),
	koshaProviders: vi.fn(async () => []),
}));

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

describe("chooseProviderAndModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("filters dead catalog providers when live provider status is present", async () => {
		const prompts = await import("@clack/prompts");
			vi.mocked(prompts.select)
				.mockImplementationOnce(async (input) => {
					const values = input.options.map((option) => option.value);
					expect(values).toEqual(["openrouter", "moonshot"]);
					return "openrouter";
				})
			.mockImplementationOnce(async (input) => {
				const values = input.options.map((option) => option.value);
				expect(values).toContain("openrouter/anthropic/claude-sonnet-4");
				expect(values).not.toContain("gpt-4o");
				return "openrouter/anthropic/claude-sonnet-4";
			});

		const { chooseProviderAndModel } = await import("../cli/provider-picker.js");
		const config = buildConfig();
		const result = await chooseProviderAndModel(
			config,
			{
				anthropic: ["claude-sonnet-4-20250514"],
				openai: ["gpt-4o"],
				openrouter: ["openrouter/anthropic/claude-sonnet-4"],
				moonshot: ["kimi-k2.5"],
			},
			{
				showIntro: false,
				providerStatuses: [
					{
						id: "openrouter",
						authenticated: true,
						credentialSource: "env",
						models: ["openrouter/anthropic/claude-sonnet-4"],
					},
					{
						id: "moonshot",
						authenticated: true,
						credentialSource: "env",
						models: ["kimi-k2.5"],
					},
				],
			},
		);

		expect(result).toEqual({
			provider: "openrouter",
			model: "openrouter/anthropic/claude-sonnet-4",
		});
		expect(config.provider).toBe("openrouter");
		expect(config.model).toBe("openrouter/anthropic/claude-sonnet-4");
	});

	it("keeps authoritative daemon-backed catalogs provider-scoped and exact", async () => {
		const prompts = await import("@clack/prompts");
		vi.mocked(prompts.select)
			.mockImplementationOnce(async () => "zai")
			.mockImplementationOnce(async (input) => {
				const values = input.options.map((option) => option.value);
				expect(values).toEqual(["glm-5", "glm-4.7-flash"]);
				expect(values).not.toContain("kimi-k2");
				return "glm-5";
			});

		const { chooseProviderAndModel } = await import("../cli/provider-picker.js");
		const config = buildConfig();
		const result = await chooseProviderAndModel(
			config,
			{
				zai: ["glm-5", "glm-4.7-flash"],
			},
			{
				showIntro: false,
				catalogAuthority: "strict",
				providerStatuses: [
					{
						id: "zai",
						authenticated: true,
						credentialSource: "env",
						models: ["glm-5", "glm-4.7-flash"],
					},
				],
			},
		);

		expect(result).toEqual({
			provider: "zai",
			model: "glm-5",
		});
	});
});
