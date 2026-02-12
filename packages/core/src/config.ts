import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TakumiConfig } from "./types.js";
import { ConfigError } from "./errors.js";

const DEFAULT_CONFIG: TakumiConfig = {
	apiKey: "",
	model: "claude-sonnet-4-20250514",
	maxTokens: 16384,
	thinking: false,
	thinkingBudget: 10000,
	systemPrompt: "",
	workingDirectory: process.cwd(),
	proxyUrl: "",
	permissions: [],
	theme: "default",
	logLevel: "info",
	maxTurns: 100,
	experimental: {},
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

/** Map environment variables to config fields. */
function envOverrides(): Partial<TakumiConfig> {
	const overrides: Partial<TakumiConfig> = {};
	const env = process.env;

	if (env.ANTHROPIC_API_KEY) overrides.apiKey = env.ANTHROPIC_API_KEY;
	if (env.TAKUMI_API_KEY) overrides.apiKey = env.TAKUMI_API_KEY;
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
			config = { ...config, ...fileConfig };
			break;
		}
	}

	// 3. Merge environment variables
	const env = envOverrides();
	config = { ...config, ...env };

	// 4. Merge CLI overrides
	if (cliOverrides) {
		config = { ...config, ...cliOverrides };
	}

	return config;
}

export { DEFAULT_CONFIG };
