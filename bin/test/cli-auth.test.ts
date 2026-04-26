/**
 * cli-auth.test.ts — tests for autoDetectAuth, tryResolveCliToken, probeOllama.
 *
 * Filesystem and child_process are mocked so no real credentials or CLIs are
 * required. fetch is stubbed globally to simulate Ollama responses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted before imports) ────────────────────────────────────

vi.mock("node:child_process", () => ({
	execSync: vi.fn(() => {
		throw new Error("command not found");
	}),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => {
			throw new Error("no such file");
		}),
	};
});

const { koshaAutoDetect } = vi.hoisted(() => ({
	koshaAutoDetect: vi.fn(async () => null),
}));

vi.mock("../cli/kosha-bridge.js", () => ({
	koshaAutoDetect,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { autoDetectAuth, collectFastProviderStatus, probeOllama, tryResolveCliToken } from "../cli/cli-auth.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal Ollama /api/tags response containing one model. */
function ollamaResponse(models: Array<{ name: string }>): Response {
	return new Response(JSON.stringify({ models }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/** Capture and restore process.env around each test. */
const origEnv = { ...process.env };

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
	vi.resetAllMocks();
	// Default: no credential files, no CLIs
	mockExistsSync.mockReturnValue(false);
	mockReadFileSync.mockImplementation(() => {
		throw new Error("no such file");
	});
	mockExecSync.mockImplementation(() => {
		throw new Error("command not found");
	});
	koshaAutoDetect.mockResolvedValue(null);
	// Default: Ollama not available
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

	// Strip all credential-related env vars
	for (const key of [
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"GEMINI_API_KEY",
		"GOOGLE_API_KEY",
		"XAI_API_KEY",
		"GROK_API_KEY",
		"GROQ_API_KEY",
		"DEEPSEEK_API_KEY",
		"MISTRAL_API_KEY",
		"TOGETHER_API_KEY",
		"OPENROUTER_API_KEY",
		"ALIBABA_API_KEY",
		"DASHSCOPE_API_KEY",
		"BEDROCK_API_KEY",
		"AWS_BEARER_TOKEN",
		"ZAI_API_KEY",
		"GLM_API_KEY",
		"KIMI_API_KEY",
		"MOONSHOT_API_KEY",
		"MINIMAX_API_KEY",
		"GITHUB_TOKEN",
		"CODEX_HOME",
	]) {
		delete process.env[key];
	}
});

afterEach(() => {
	vi.unstubAllGlobals();
	// Restore env
	for (const key of Object.keys(process.env)) {
		if (!(key in origEnv)) delete process.env[key];
	}
	Object.assign(process.env, origEnv);
});

// ── probeOllama ───────────────────────────────────────────────────────────────

describe("probeOllama", () => {
	it("returns [] when Ollama is not reachable", async () => {
		expect(await probeOllama()).toEqual([]);
	});

	it("returns [] when Ollama response is not ok", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
		expect(await probeOllama()).toEqual([]);
	});

	it("returns [] when models array is empty", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaResponse([])));
		expect(await probeOllama()).toEqual([]);
	});

	it("returns model names when Ollama is running", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(ollamaResponse([{ name: "llama3:8b" }, { name: "mistral:7b" }])),
		);
		expect(await probeOllama()).toEqual(["llama3:8b", "mistral:7b"]);
	});

	it("filters out falsy model names", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ models: [{ name: "llama3:8b" }, { name: "" }, {}] }), {
					status: 200,
				}),
			),
		);
		expect(await probeOllama()).toEqual(["llama3:8b"]);
	});
});

// ── tryResolveCliToken ────────────────────────────────────────────────────────

describe("tryResolveCliToken", () => {
	it("returns undefined for an unknown provider", () => {
		expect(tryResolveCliToken("unknown-provider")).toBeUndefined();
	});

	it("returns undefined when gh CLI is not installed (github provider)", () => {
		expect(tryResolveCliToken("github")).toBeUndefined();
	});

	it("returns gh token when gh CLI succeeds (github provider)", () => {
		mockExecSync.mockImplementation((cmd: unknown) =>
			cmd === "gh auth token" ? ("ghp_test_token_123\n" as any) : (() => { throw new Error(); })(),
		);
		expect(tryResolveCliToken("github")).toBe("ghp_test_token_123");
	});

	it("returns undefined when gh CLI returns empty string (github provider)", () => {
		mockExecSync.mockImplementation((cmd: unknown) =>
			cmd === "gh auth token" ? ("" as any) : (() => { throw new Error(); })(),
		);
		expect(tryResolveCliToken("github")).toBeUndefined();
	});

	it("returns undefined for anthropic when no credential files exist", () => {
		expect(tryResolveCliToken("anthropic")).toBeUndefined();
	});

	it("returns undefined for gemini when no credential files exist and gcloud not installed", () => {
		expect(tryResolveCliToken("gemini")).toBeUndefined();
	});

	it("returns undefined for openai/codex when no credential files exist", () => {
		expect(tryResolveCliToken("openai")).toBeUndefined();
	});
});

// ── autoDetectAuth ────────────────────────────────────────────────────────────

describe("autoDetectAuth", () => {
	it("returns null when no credentials are available", async () => {
		expect(await autoDetectAuth()).toBeNull();
	});

	it("returns anthropic for ANTHROPIC_API_KEY", async () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("anthropic");
		expect(result!.apiKey).toBe("sk-ant-test");
		expect(result!.source).toBe("ANTHROPIC_API_KEY");
		expect(koshaAutoDetect).not.toHaveBeenCalled();
	});

	it("does not treat CLAUDE_CODE_OAUTH_TOKEN as a direct Anthropic API credential", async () => {
		process.env.CLAUDE_CODE_OAUTH_TOKEN = "oauth-test-token";
		const result = await autoDetectAuth();
		expect(result).toBeNull();
	});

	it("returns openai for OPENAI_API_KEY", async () => {
		process.env.OPENAI_API_KEY = "sk-openai-test";
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("openai");
		expect(result!.apiKey).toBe("sk-openai-test");
		expect(result!.source).toBe("OPENAI_API_KEY");
	});

	it("returns openai for a Codex API-key auth file", async () => {
		process.env.CODEX_HOME = "/tmp/codex-home";
		mockExistsSync.mockImplementation((path: unknown) => String(path).endsWith("/auth.json"));
		mockReadFileSync.mockImplementation((path: unknown) => {
			if (String(path).endsWith("/auth.json")) {
				return JSON.stringify({
					auth_mode: "api_key",
					apiKey: "sk-codex-test",
				}) as never;
			}
			throw new Error("no such file");
		});

		const result = await autoDetectAuth();

		expect(result).not.toBeNull();
		expect(result!.provider).toBe("openai");
		expect(result!.apiKey).toBe("sk-codex-test");
		expect(result!.model).toBe("gpt-4.1");
		expect(result!.source).toBe("Codex auth (~/.codex/auth.json)");
	});

	it("returns github for GITHUB_TOKEN", async () => {
		process.env.GITHUB_TOKEN = "ghp-env-token";
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("github");
		expect(result!.apiKey).toBe("ghp-env-token");
		expect(result!.model).toBe("gpt-4.1");
		expect(result!.source).toBe("GITHUB_TOKEN");
	});

	it("returns gemini for GEMINI_API_KEY", async () => {
		process.env.GEMINI_API_KEY = "gm-test-key";
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("gemini");
		expect(result!.apiKey).toBe("gm-test-key");
		expect(result!.source).toBe("GEMINI_API_KEY");
	});

	it("returns gemini for GOOGLE_API_KEY", async () => {
		process.env.GOOGLE_API_KEY = "goog-test-key";
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("gemini");
		expect(result!.apiKey).toBe("goog-test-key");
		expect(result!.source).toBe("GOOGLE_API_KEY");
	});

	it("returns groq for GROQ_API_KEY", async () => {
		process.env.GROQ_API_KEY = "groq-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("groq");
		expect(result!.apiKey).toBe("groq-test-key");
	});

	it("returns xai for XAI_API_KEY", async () => {
		process.env.XAI_API_KEY = "xai-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("xai");
		expect(result!.apiKey).toBe("xai-test-key");
		expect(result!.source).toBe("XAI_API_KEY");
	});

	it("returns deepseek for DEEPSEEK_API_KEY", async () => {
		process.env.DEEPSEEK_API_KEY = "ds-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("deepseek");
		expect(result!.apiKey).toBe("ds-test-key");
	});

	it("returns mistral for MISTRAL_API_KEY", async () => {
		process.env.MISTRAL_API_KEY = "mist-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("mistral");
		expect(result!.apiKey).toBe("mist-test-key");
	});

	it("returns together for TOGETHER_API_KEY", async () => {
		process.env.TOGETHER_API_KEY = "tog-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("together");
		expect(result!.apiKey).toBe("tog-test-key");
	});

	it("returns openrouter for OPENROUTER_API_KEY", async () => {
		process.env.OPENROUTER_API_KEY = "or-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("openrouter");
		expect(result!.apiKey).toBe("or-test-key");
	});

	it("returns alibaba for DASHSCOPE_API_KEY", async () => {
		process.env.DASHSCOPE_API_KEY = "dashscope-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("alibaba");
		expect(result!.apiKey).toBe("dashscope-test-key");
		expect(result!.source).toBe("DASHSCOPE_API_KEY");
	});

	it("returns bedrock for AWS_BEARER_TOKEN", async () => {
		process.env.AWS_BEARER_TOKEN = "aws-bearer-token";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("bedrock");
		expect(result!.apiKey).toBe("aws-bearer-token");
		expect(result!.source).toBe("AWS_BEARER_TOKEN");
	});

	it("returns zai for ZAI_API_KEY", async () => {
		process.env.ZAI_API_KEY = "zai-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("zai");
		expect(result!.apiKey).toBe("zai-test-key");
		expect(result!.source).toBe("ZAI_API_KEY");
	});

	it("returns zai for GLM_API_KEY", async () => {
		process.env.GLM_API_KEY = "glm-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("zai");
		expect(result!.apiKey).toBe("glm-test-key");
		expect(result!.source).toBe("GLM_API_KEY");
	});

	it("returns moonshot for KIMI_API_KEY", async () => {
		process.env.KIMI_API_KEY = "kimi-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("moonshot");
		expect(result!.apiKey).toBe("kimi-test-key");
		expect(result!.source).toBe("KIMI_API_KEY");
	});

	it("returns moonshot for MOONSHOT_API_KEY", async () => {
		process.env.MOONSHOT_API_KEY = "moonshot-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("moonshot");
		expect(result!.apiKey).toBe("moonshot-test-key");
		expect(result!.source).toBe("MOONSHOT_API_KEY");
	});

	it("returns minimax for MINIMAX_API_KEY", async () => {
		process.env.MINIMAX_API_KEY = "minimax-test-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("minimax");
		expect(result!.apiKey).toBe("minimax-test-key");
		expect(result!.source).toBe("MINIMAX_API_KEY");
	});

	it("does not infer a provider from a bare TAKUMI_API_KEY", async () => {
		process.env.TAKUMI_API_KEY = "tk-test-key";
		const result = await autoDetectAuth();
		expect(result).toBeNull();
	});

	it("surfaces openai in fast provider status when Codex API-key auth is present", async () => {
		process.env.CODEX_HOME = "/tmp/codex-home";
		mockExistsSync.mockImplementation((path: unknown) => String(path).endsWith("/auth.json"));
		mockReadFileSync.mockImplementation((path: unknown) => {
			if (String(path).endsWith("/auth.json")) {
				return JSON.stringify({
					auth_mode: "api_key",
					apiKey: "sk-codex-test",
				}) as never;
			}
			throw new Error("no such file");
		});

		const statuses = await collectFastProviderStatus();

		expect(statuses).toContainEqual({
			id: "openai",
			authenticated: true,
			credentialSource: "config",
			models: ["gpt-4.1"],
		});
	});

	it("returns github for gh CLI token with correct model and source", async () => {
		mockExecSync.mockImplementation((cmd: unknown) =>
			cmd === "gh auth token" ? ("ghp_cli_token_456\n" as any) : (() => { throw new Error(); })(),
		);
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("github");
		expect(result!.apiKey).toBe("ghp_cli_token_456");
		expect(result!.model).toBe("gpt-4.1");
		expect(result!.source).toMatch(/GitHub CLI/);
		expect(koshaAutoDetect).not.toHaveBeenCalled();
	});

	it("falls back to kosha when fast local detection finds nothing", async () => {
		koshaAutoDetect.mockResolvedValueOnce({
			provider: "anthropic",
			apiKey: "kosha-token",
			source: "Kosha: Claude",
		} as never);
		const result = await autoDetectAuth();
		expect(result).toMatchObject({
			provider: "anthropic",
			apiKey: "kosha-token",
			source: "Kosha: Claude",
		});
		expect(koshaAutoDetect).toHaveBeenCalledOnce();
	});

	it("returns ollama when the local server is running", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(ollamaResponse([{ name: "llama3:8b" }, { name: "mistral:7b" }])),
		);
		const result = await autoDetectAuth();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("ollama");
		expect(result!.apiKey).toBe("");
		expect(result!.model).toBe("llama3:8b"); // prefers llama
		expect(result!.source).toMatch(/Ollama/);
	});

	it("ollama: prefers mistral if no llama model present", async () => {
		// codestral does not match the llama|mistral|... regex, so mistral wins as first preferred
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(ollamaResponse([{ name: "codestral:7b" }, { name: "mistral:7b" }])),
		);
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("ollama");
		expect(result!.model).toBe("mistral:7b");
	});

	it("ollama: uses first model when none match preferred patterns", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(ollamaResponse([{ name: "codellama:13b" }, { name: "starcoder:7b" }])),
		);
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("ollama");
		expect(result!.model).toBe("codellama:13b");
	});

	// ── Priority tests ──────────────────────────────────────────────────────

	it("prefers ANTHROPIC_API_KEY over OPENAI_API_KEY", async () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant";
		process.env.OPENAI_API_KEY = "sk-oai";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("anthropic");
	});

	it("prefers OPENAI_API_KEY over GEMINI_API_KEY", async () => {
		process.env.OPENAI_API_KEY = "sk-oai";
		process.env.GEMINI_API_KEY = "gm-key";
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("openai");
	});

	it("prefers any env var over GitHub CLI token", async () => {
		process.env.OPENAI_API_KEY = "sk-oai";
		mockExecSync.mockImplementation((cmd: unknown) =>
			cmd === "gh auth token" ? ("ghp_token\n" as any) : (() => { throw new Error(); })(),
		);
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("openai");
	});

	it("prefers GitHub CLI over Ollama", async () => {
		mockExecSync.mockImplementation((cmd: unknown) =>
			cmd === "gh auth token" ? ("ghp_token\n" as any) : (() => { throw new Error(); })(),
		);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ollamaResponse([{ name: "llama3:8b" }])));
		const result = await autoDetectAuth();
		expect(result!.provider).toBe("github");
	});
});
