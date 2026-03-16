import { DEFAULT_CONFIG, loadConfig, PROVIDER_ENDPOINTS } from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("loadConfig", () => {
	const origEnv = { ...process.env };

	beforeEach(() => {
		for (const key of [
			...Object.keys(process.env).filter((key) => key.startsWith("TAKUMI_")),
			"ANTHROPIC_API_KEY",
			"CLAUDE_CODE_OAUTH_TOKEN",
			"OPENAI_API_KEY",
			"GITHUB_TOKEN",
			"GEMINI_API_KEY",
			"GOOGLE_API_KEY",
			"GROQ_API_KEY",
			"XAI_API_KEY",
			"GROK_API_KEY",
			"DEEPSEEK_API_KEY",
			"MISTRAL_API_KEY",
			"TOGETHER_API_KEY",
			"OPENROUTER_API_KEY",
			"ALIBABA_API_KEY",
			"DASHSCOPE_API_KEY",
			"ZAI_API_KEY",
			"KIMI_API_KEY",
			"MOONSHOT_API_KEY",
			"BEDROCK_API_KEY",
			"AWS_BEARER_TOKEN",
			"XAI_ENDPOINT",
			"GROK_ENDPOINT",
			"ALIBABA_ENDPOINT",
			"DASHSCOPE_ENDPOINT",
			"ZAI_ENDPOINT",
			"BEDROCK_ENDPOINT",
			"AWS_BEDROCK_ENDPOINT",
		]) {
			delete process.env[key];
		}
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

	it("deep-merges orchestration overrides so model routing does not wipe defaults", () => {
		const config = loadConfig({
			orchestration: {
				modelRouting: {
					classifier: "gpt-4o-mini",
					taskTypes: {
						REVIEW: {
							worker: "gpt-4o-mini",
						},
					},
				},
			},
		} as any);

		expect(config.orchestration?.enabled).toBe(true);
		expect(config.orchestration?.mesh?.defaultTopology).toBe("hierarchical");
		expect(config.orchestration?.modelRouting?.classifier).toBe("gpt-4o-mini");
		expect(config.orchestration?.modelRouting?.taskTypes?.REVIEW?.worker).toBe("gpt-4o-mini");
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

	it("uses a provider-specific key when exactly one provider is configured", () => {
		process.env.XAI_API_KEY = "xai-test-key";
		const config = loadConfig();
		expect(config.provider).toBe("xai");
		expect(config.apiKey).toBe("xai-test-key");
	});

	it("uses the configured provider's key when multiple keys exist", () => {
		process.env.XAI_API_KEY = "xai-test-key";
		process.env.ALIBABA_API_KEY = "ali-test-key";
		const config = loadConfig({ provider: "alibaba" });
		expect(config.provider).toBe("alibaba");
		expect(config.apiKey).toBe("ali-test-key");
	});

	it("uses provider-specific endpoint aliases when explicit endpoint is not set", () => {
		process.env.BEDROCK_API_KEY = "bedrock-test-key";
		process.env.BEDROCK_ENDPOINT = "https://bedrock.example.com/v1/chat/completions";
		const config = loadConfig({ provider: "bedrock" });
		expect(config.provider).toBe("bedrock");
		expect(config.apiKey).toBe("bedrock-test-key");
		expect(config.endpoint).toBe("https://bedrock.example.com/v1/chat/completions");
	});

	it("workingDirectory defaults to cwd", () => {
		const config = loadConfig();
		expect(config.workingDirectory).toBe(process.cwd());
	});
});

describe("PROVIDER_ENDPOINTS", () => {
	it("includes all expected providers", () => {
		const expected = [
			"openai",
			"github",
			"groq",
			"xai",
			"deepseek",
			"mistral",
			"together",
			"openrouter",
			"alibaba",
			"zai",
		];
		for (const p of expected) {
			expect(PROVIDER_ENDPOINTS).toHaveProperty(p);
			expect(typeof PROVIDER_ENDPOINTS[p]).toBe("string");
			expect(PROVIDER_ENDPOINTS[p].length).toBeGreaterThan(0);
		}
	});

	it("github endpoint points to GitHub Models (not api.openai.com)", () => {
		expect(PROVIDER_ENDPOINTS.github).toBe("https://models.inference.ai.azure.com/chat/completions");
		expect(PROVIDER_ENDPOINTS.github).not.toContain("openai.com");
	});

	it("openai endpoint points to api.openai.com", () => {
		expect(PROVIDER_ENDPOINTS.openai).toContain("openai.com");
	});

	it("all endpoints are valid URLs (https for remote, http allowed for localhost)", () => {
		for (const [provider, url] of Object.entries(PROVIDER_ENDPOINTS)) {
			expect(() => new URL(url), `${provider} endpoint should be a valid URL`).not.toThrow();
			const parsed = new URL(url);
			const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
			if (!isLocal) {
				expect(url, `${provider} remote endpoint should use https`).toMatch(/^https:\/\//);
			}
		}
	});
});
