import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "./errors.js";
import type { OrchestrationConfig } from "./orchestration-types.js";
import type { TakumiConfig } from "./types.js";

/** Default API endpoints per provider (OpenAI-compatible chat completions). */
export const PROVIDER_ENDPOINTS: Record<string, string> = {
	openai: "https://api.openai.com/v1/chat/completions",
	// GitHub Models — OpenAI-compatible, uses a `gh auth token` as the API key
	github: "https://models.inference.ai.azure.com/chat/completions",
	groq: "https://api.groq.com/openai/v1/chat/completions",
	deepseek: "https://api.deepseek.com/v1/chat/completions",
	mistral: "https://api.mistral.ai/v1/chat/completions",
	together: "https://api.together.xyz/v1/chat/completions",
	openrouter: "https://openrouter.ai/api/v1/chat/completions",
	ollama: "http://localhost:11434/v1/chat/completions",
};

const DEFAULT_CONFIG: TakumiConfig = {
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
	// Keep default as string to match existing tests expecting "default"
	theme: "default",
	logLevel: "info",
	maxTurns: 100,
	experimental: {},
	// Orchestration defaults — safe, single-agent unless complexity warrants multi
	orchestration: {
		enabled: true,
		defaultMode: "multi",
		complexityThreshold: "STANDARD",
		maxValidationRetries: 3,
		isolationMode: "none",
		ensemble: {
			enabled: false,
			workerCount: 3,
			temperature: 0.9,
			parallel: true,
		},
		weightedVoting: {
			minConfidenceThreshold: 0.1,
		},
		reflexion: {
			enabled: false,
			maxHistorySize: 3,
			useAkasha: true,
		},
		moA: {
			enabled: false,
			rounds: 2,
			validatorCount: 3,
			allowCrossTalk: true,
			temperatures: [0.2, 0.1, 0.05],
		},
		progressiveRefinement: {
			enabled: false,
			maxIterations: 3,
			minImprovement: 0.05,
			useCriticModel: true,
			targetScore: 9.0,
		},
		adaptiveTemperature: {
			enabled: true,
		},
		mesh: {
			defaultTopology: "hierarchical",
			lucyAdaptiveTopology: true,
			scarlettAdaptiveTopology: true,
			sabhaEscalation: {
				enabled: true,
				integrityThreshold: "critical",
				minValidationAttempts: 1,
			},
		},
	},
	statusBar: {
		left: ["model", "mesh", "scarlett"],
		center: ["status"],
		right: ["metrics", "keybinds"],
	},
	plugins: [],
	packages: [],
	// maxCostUsd is intentionally undefined — no limit by default
};

/** Config file search paths, in priority order (first found wins). */
function configPaths(): string[] {
	const home = homedir();
	const cwd = process.cwd();
	return [
		join(cwd, ".takumi", "config.json"),
		join(cwd, "takumi.config.json"),
		join(home, ".takumi", "config.json"),
		join(home, ".config", "takumi", "config.json"),
	];
}

/** Read and parse a JSON config file, returning null on any failure. */
function readConfigFile(path: string): Partial<TakumiConfig> | null {
	try {
		if (!existsSync(path)) return null;
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new ConfigError(`Config at ${path} must be a JSON object`);
		}
		return parsed as Partial<TakumiConfig>;
	} catch (err) {
		if (err instanceof ConfigError) throw err;
		throw new ConfigError(`Failed to read config at ${path}: ${(err as Error).message}`);
	}
}

/**
 * Map environment variables to config fields.
 *
 * API key priority: TAKUMI_API_KEY > provider-specific key > ANTHROPIC_API_KEY
 * Provider detection: TAKUMI_PROVIDER > inferred from env key present
 */
function envOverrides(): Partial<TakumiConfig> {
	const overrides: Partial<TakumiConfig> = {};
	const env = process.env;

	// ── Provider-specific API keys (lowest to highest priority) ────────────
	// Each sets both apiKey and provider, later entries override earlier ones.
	// Order: provider-specific keys (alphabetical), then ANTHROPIC, then TAKUMI.
	const providerKeys: Array<{ envVar: string; provider: string }> = [
		{ envVar: "DEEPSEEK_API_KEY", provider: "deepseek" },
		{ envVar: "GROQ_API_KEY", provider: "groq" },
		{ envVar: "MISTRAL_API_KEY", provider: "mistral" },
		{ envVar: "TOGETHER_API_KEY", provider: "together" },
		{ envVar: "OPENROUTER_API_KEY", provider: "openrouter" },
		{ envVar: "OPENAI_API_KEY", provider: "openai" },
		{ envVar: "GOOGLE_API_KEY", provider: "gemini" },
		{ envVar: "GEMINI_API_KEY", provider: "gemini" },
	];

	for (const { envVar, provider } of providerKeys) {
		if (env[envVar]) {
			overrides.apiKey = env[envVar];
			overrides.provider = provider;
		}
	}

	// ANTHROPIC_API_KEY overrides provider-specific keys
	if (env.ANTHROPIC_API_KEY) {
		overrides.apiKey = env.ANTHROPIC_API_KEY;
		overrides.provider = "anthropic";
	}

	// TAKUMI_API_KEY is highest priority for the key itself (but doesn't set provider)
	if (env.TAKUMI_API_KEY) overrides.apiKey = env.TAKUMI_API_KEY;

	// ── Explicit provider/endpoint overrides ──────────────────────────────
	if (env.TAKUMI_PROVIDER) overrides.provider = env.TAKUMI_PROVIDER;
	if (env.TAKUMI_ENDPOINT) overrides.endpoint = env.TAKUMI_ENDPOINT;

	// ── Other env vars ────────────────────────────────────────────────────
	if (env.TAKUMI_MODEL) overrides.model = env.TAKUMI_MODEL;
	if (env.TAKUMI_MAX_TOKENS) overrides.maxTokens = Number.parseInt(env.TAKUMI_MAX_TOKENS, 10);
	if (env.TAKUMI_PROXY_URL) overrides.proxyUrl = env.TAKUMI_PROXY_URL;
	if (env.TAKUMI_THEME) overrides.theme = env.TAKUMI_THEME;
	if (env.TAKUMI_LOG_LEVEL) overrides.logLevel = env.TAKUMI_LOG_LEVEL as TakumiConfig["logLevel"];
	if (env.TAKUMI_THINKING === "true") overrides.thinking = true;
	if (env.TAKUMI_THINKING === "false") overrides.thinking = false;
	if (env.TAKUMI_THINKING_BUDGET) overrides.thinkingBudget = Number.parseInt(env.TAKUMI_THINKING_BUDGET, 10);

	return overrides;
}

function mergeTakumiConfig(base: TakumiConfig, override: Partial<TakumiConfig>): TakumiConfig {
	const merged: TakumiConfig = {
		...base,
		...override,
	};

	if (base.orchestration || override.orchestration) {
		const baseOrchestration = base.orchestration;
		const overrideOrchestration = override.orchestration;
		merged.orchestration = {
			...baseOrchestration,
			...overrideOrchestration,
			...(baseOrchestration || overrideOrchestration
				? {
						ensemble: {
							...baseOrchestration?.ensemble,
							...overrideOrchestration?.ensemble,
						},
						weightedVoting: {
							...baseOrchestration?.weightedVoting,
							...overrideOrchestration?.weightedVoting,
						},
						reflexion: {
							...baseOrchestration?.reflexion,
							...overrideOrchestration?.reflexion,
						},
						moA: {
							...baseOrchestration?.moA,
							...overrideOrchestration?.moA,
						},
						progressiveRefinement: {
							...baseOrchestration?.progressiveRefinement,
							...overrideOrchestration?.progressiveRefinement,
						},
						adaptiveTemperature: {
							...baseOrchestration?.adaptiveTemperature,
							...overrideOrchestration?.adaptiveTemperature,
							baseTemperatures: {
								...baseOrchestration?.adaptiveTemperature?.baseTemperatures,
								...overrideOrchestration?.adaptiveTemperature?.baseTemperatures,
							},
						},
						modelRouting: {
							...baseOrchestration?.modelRouting,
							...overrideOrchestration?.modelRouting,
							taskTypes: {
								...baseOrchestration?.modelRouting?.taskTypes,
								...overrideOrchestration?.modelRouting?.taskTypes,
							},
						},
						mesh: {
							...baseOrchestration?.mesh,
							...overrideOrchestration?.mesh,
							sabhaEscalation: {
								...baseOrchestration?.mesh?.sabhaEscalation,
								...overrideOrchestration?.mesh?.sabhaEscalation,
							},
						},
					}
				: {}),
		} as OrchestrationConfig;
	}

	if (base.statusBar || override.statusBar) {
		merged.statusBar = {
			...base.statusBar,
			...override.statusBar,
		};
	}

	if (base.sideAgent || override.sideAgent) {
		merged.sideAgent = {
			maxConcurrent: 2,
			tmux: false,
			...base.sideAgent,
			...override.sideAgent,
		};
	}

	if (base.chitraguptaDaemon || override.chitraguptaDaemon) {
		merged.chitraguptaDaemon = {
			...base.chitraguptaDaemon,
			...override.chitraguptaDaemon,
		};
	}

	return merged;
}

/**
 * Auto-detect provider from model name when no explicit provider is set.
 * Returns the provider name if detected, undefined otherwise.
 */
export function detectProviderFromModel(model: string): string | undefined {
	if (!model) return undefined;
	const m = model.toLowerCase();

	if (m.startsWith("gpt-") || m.startsWith("o1-") || m.startsWith("o3-") || m.startsWith("o4-")) return "openai";
	if (m.startsWith("gemini-")) return "gemini";
	if (m.startsWith("claude-")) return "anthropic";
	if (m.startsWith("deepseek-")) return "deepseek";
	if (m.startsWith("mistral-")) return "mistral";
	// llama/mixtral without an API key likely means local ollama
	if (m.startsWith("llama") || m.startsWith("mixtral")) return "ollama";

	return undefined;
}

/**
 * Validate orchestration configuration for arXiv multi-agent strategies.
 * Throws ConfigError if validation fails.
 */
function validateOrchestrationConfig(config: OrchestrationConfig): void {
	// Ensemble validation
	if (config.ensemble?.enabled) {
		if (config.ensemble.workerCount < 2 || config.ensemble.workerCount > 7) {
			throw new ConfigError("orchestration.ensemble.workerCount must be 2-7");
		}
		if (config.ensemble.temperature < 0 || config.ensemble.temperature > 1) {
			throw new ConfigError("orchestration.ensemble.temperature must be 0.0-1.0");
		}
	}

	// MoA validation
	if (config.moA?.enabled) {
		if (config.moA.rounds < 1 || config.moA.rounds > 3) {
			throw new ConfigError("orchestration.moA.rounds must be 1-3");
		}
		if (config.moA.validatorCount < 2) {
			throw new ConfigError("orchestration.moA.validatorCount must be >= 2");
		}
		if (config.moA.temperatures.length < config.moA.rounds) {
			throw new ConfigError("orchestration.moA.temperatures must have >= rounds elements");
		}
	}

	// Progressive validation
	if (config.progressiveRefinement?.enabled) {
		if (config.progressiveRefinement.maxIterations < 1 || config.progressiveRefinement.maxIterations > 5) {
			throw new ConfigError("orchestration.progressiveRefinement.maxIterations must be 1-5");
		}
		if (config.progressiveRefinement.minImprovement < 0 || config.progressiveRefinement.minImprovement > 1) {
			throw new ConfigError("orchestration.progressiveRefinement.minImprovement must be 0.0-1.0");
		}
	}

	if (config.mesh?.sabhaEscalation?.minValidationAttempts !== undefined) {
		if (config.mesh.sabhaEscalation.minValidationAttempts < 1) {
			throw new ConfigError("orchestration.mesh.sabhaEscalation.minValidationAttempts must be >= 1");
		}
	}

	if (
		config.mesh?.defaultTopology &&
		!["sequential", "parallel", "hierarchical", "council", "swarm", "adversarial", "healing"].includes(
			config.mesh.defaultTopology,
		)
	) {
		throw new ConfigError("orchestration.mesh.defaultTopology is invalid");
	}

	if (
		config.mesh?.sabhaEscalation?.integrityThreshold &&
		!["warning", "critical"].includes(config.mesh.sabhaEscalation.integrityThreshold)
	) {
		throw new ConfigError("orchestration.mesh.sabhaEscalation.integrityThreshold must be warning or critical");
	}

	// Conflict detection
	if (config.ensemble?.enabled && config.progressiveRefinement?.enabled) {
		throw new ConfigError("orchestration.ensemble and progressiveRefinement cannot both be enabled");
	}
}

/**
 * Load configuration by merging defaults < config-file < environment.
 * Accepts optional CLI overrides that take highest priority.
 */
export function loadConfig(cliOverrides?: Partial<TakumiConfig>): TakumiConfig {
	// 1. Start with defaults
	let config: TakumiConfig = { ...DEFAULT_CONFIG };

	// 2. Merge first config file found
	for (const path of configPaths()) {
		const fileConfig = readConfigFile(path);
		if (fileConfig !== null) {
			config = mergeTakumiConfig(config, fileConfig);
			break;
		}
	}

	// 3. Merge environment variables
	const env = envOverrides();
	config = mergeTakumiConfig(config, env);

	// 4. Merge CLI overrides
	if (cliOverrides) {
		config = mergeTakumiConfig(config, cliOverrides);
	}

	// 5. Auto-detect provider from model name if provider is still the default
	if (config.provider === "anthropic" && !cliOverrides?.provider && !env.provider) {
		const detected = detectProviderFromModel(config.model);
		if (detected) {
			config.provider = detected;
		}
	}

	// 6. Resolve default endpoint for the provider if none explicitly set
	if (!config.endpoint && config.provider !== "anthropic") {
		config.endpoint = PROVIDER_ENDPOINTS[config.provider] || "";
	}

	// 7. Validate orchestration config if present
	if (config.orchestration) {
		validateOrchestrationConfig(config.orchestration);
	}

	return config;
}

export { DEFAULT_CONFIG };
