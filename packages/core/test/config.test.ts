import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "@takumi/core";

describe("loadConfig", () => {
	const origEnv = { ...process.env };

	beforeEach(() => {
		// Clear takumi-specific env vars
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("TAKUMI_")) {
				delete process.env[key];
			}
		}
		delete process.env.ANTHROPIC_API_KEY;
	});

	afterEach(() => {
		process.env = { ...origEnv };
	});

	it("returns defaults when no config file or env vars are present", () => {
		const config = loadConfig();
		expect(config.model).toBe(DEFAULT_CONFIG.model);
		expect(config.maxTokens).toBe(16384);
		expect(config.thinking).toBe(false);
		expect(config.logLevel).toBe("info");
		expect(config.theme).toBe("default");
		expect(config.permissions).toEqual([]);
		expect(config.experimental).toEqual({});
	});

	it("picks up ANTHROPIC_API_KEY from environment", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-123";
		const config = loadConfig();
		expect(config.apiKey).toBe("sk-test-123");
	});

	it("TAKUMI_API_KEY overrides ANTHROPIC_API_KEY", () => {
		process.env.ANTHROPIC_API_KEY = "sk-anthropic";
		process.env.TAKUMI_API_KEY = "sk-takumi";
		const config = loadConfig();
		expect(config.apiKey).toBe("sk-takumi");
	});

	it("merges CLI overrides with highest priority", () => {
		process.env.TAKUMI_MODEL = "claude-haiku-3";
		const config = loadConfig({ model: "claude-opus-4" });
		expect(config.model).toBe("claude-opus-4");
	});

	it("parses numeric env vars correctly", () => {
		process.env.TAKUMI_MAX_TOKENS = "8192";
		const config = loadConfig();
		expect(config.maxTokens).toBe(8192);
	});

	it("parses boolean env vars for thinking", () => {
		process.env.TAKUMI_THINKING = "true";
		const config = loadConfig();
		expect(config.thinking).toBe(true);
	});

	it("workingDirectory defaults to cwd", () => {
		const config = loadConfig();
		expect(config.workingDirectory).toBe(process.cwd());
	});
});
