/**
 * kosha-bridge.test.ts — Tests for the kosha-discovery bridge layer.
 *
 * Mocks kosha-discovery's createKosha to avoid real network calls while
 * verifying the bridge correctly maps kosha types → Takumi types.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock kosha-discovery ──────────────────────────────────────────────────────

const mockProvidersList = vi.fn();
const mockModels = vi.fn();
const mockModel = vi.fn();
const mockProvider = vi.fn();
const mockResolve = vi.fn();

vi.mock("kosha-discovery", () => ({
	createKosha: vi.fn(async () => ({
		providers_list: mockProvidersList,
		models: mockModels,
		model: mockModel,
		provider: mockProvider,
		resolve: mockResolve,
	})),
}));

// Mock cli-auth to avoid filesystem/subprocess calls in resolveApiKey
vi.mock("../cli/cli-auth.js", () => ({
	tryResolveCliToken: vi.fn(() => null),
	autoDetectAuth: vi.fn(async () => null),
	probeOllama: vi.fn(async () => null),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
	getKosha,
	koshaAutoDetect,
	koshaEndpoint,
	koshaListProviderModels,
	koshaModel,
	koshaProviderModels,
	koshaProviders,
	koshaResolveAlias,
	resetKosha,
} from "../cli/kosha-bridge.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(id: string, authenticated: boolean, source: string, models: any[] = []) {
	return {
		id,
		name: id.charAt(0).toUpperCase() + id.slice(1),
		baseUrl: `https://api.${id}.com`,
		authenticated,
		credentialSource: source as any,
		models,
		lastRefreshed: Date.now(),
	};
}

function makeModel(id: string, provider: string, mode = "chat") {
	return {
		id,
		name: id,
		provider,
		mode,
		capabilities: ["chat"],
		contextWindow: 128000,
		maxOutputTokens: 4096,
		aliases: [],
		discoveredAt: Date.now(),
		source: "api" as const,
	};
}

const origEnv = { ...process.env };

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	resetKosha();

	// Strip credential env vars
	for (const key of [
		"ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
		"GOOGLE_API_KEY", "TAKUMI_API_KEY", "OPENROUTER_API_KEY",
	]) {
		delete process.env[key];
	}
});

afterEach(() => {
	// Restore env
	for (const key of Object.keys(process.env)) {
		if (!(key in origEnv)) delete process.env[key];
	}
	Object.assign(process.env, origEnv);
});

// ── getKosha singleton ───────────────────────────────────────────────────────

describe("getKosha", () => {
	it("returns the same registry instance on repeated calls", async () => {
		const a = await getKosha();
		const b = await getKosha();
		expect(a).toBe(b);
	});

	it("returns a fresh instance after resetKosha()", async () => {
		const a = await getKosha();
		resetKosha();
		const b = await getKosha();
		// Since mock always creates a new object, they should be different refs
		expect(a).not.toBe(b);
	});
});

// ── koshaAutoDetect ──────────────────────────────────────────────────────────

describe("koshaAutoDetect", () => {
	it("returns null when no providers are authenticated", async () => {
		mockProvidersList.mockReturnValue([
			makeProvider("anthropic", false, "none"),
			makeProvider("openai", false, "none"),
		]);
		const result = await koshaAutoDetect();
		expect(result).toBeNull();
	});

	it("returns CLI-sourced provider over env-sourced", async () => {
		process.env.OPENAI_API_KEY = "sk-test";
		mockProvidersList.mockReturnValue([
			makeProvider("openai", true, "env", [makeModel("gpt-4o", "openai")]),
			makeProvider("anthropic", true, "cli", [makeModel("claude-sonnet-4-20250514", "anthropic")]),
		]);
		const result = await koshaAutoDetect();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("anthropic");
		expect(result!.source).toContain("Kosha");
	});

	it("maps google → gemini for Takumi provider name", async () => {
		process.env.GOOGLE_API_KEY = "test-key";
		mockProvidersList.mockReturnValue([
			makeProvider("google", true, "env", [makeModel("gemini-2.5-pro", "google")]),
		]);
		const result = await koshaAutoDetect();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("gemini");
	});

	it("resolves API key from env var", async () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		mockProvidersList.mockReturnValue([
			makeProvider("anthropic", true, "env", [makeModel("claude-sonnet-4-20250514", "anthropic")]),
		]);
		const result = await koshaAutoDetect();
		expect(result!.apiKey).toBe("sk-ant-test");
	});

	it("returns ollama only if it has models", async () => {
		mockProvidersList.mockReturnValue([
			makeProvider("ollama", false, "none", [makeModel("llama3:8b", "ollama")]),
		]);
		const result = await koshaAutoDetect();
		expect(result).not.toBeNull();
		expect(result!.provider).toBe("ollama");
		expect(result!.apiKey).toBe("");
	});

	it("skips ollama without models", async () => {
		mockProvidersList.mockReturnValue([
			makeProvider("ollama", false, "none", []),
		]);
		const result = await koshaAutoDetect();
		expect(result).toBeNull();
	});

	it("skips local runtimes when local provider discovery is disabled", async () => {
		process.env.TAKUMI_DISABLE_LOCAL_PROVIDER_DISCOVERY = "1";
		mockProvidersList.mockReturnValue([
			makeProvider("ollama", false, "none", [makeModel("llama3:8b", "ollama")]),
		]);
		const result = await koshaAutoDetect();
		expect(result).toBeNull();
	});
});

// ── koshaProviders ───────────────────────────────────────────────────────────

describe("koshaProviders", () => {
	it("returns the list of providers from kosha", async () => {
		const providers = [
			makeProvider("anthropic", true, "env"),
			makeProvider("openai", true, "cli"),
		];
		mockProvidersList.mockReturnValue(providers);
		const result = await koshaProviders();
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe("anthropic");
	});
});

// ── koshaListProviderModels ──────────────────────────────────────────────────

describe("koshaListProviderModels", () => {
	it("filters models by provider and mode", async () => {
		mockModels.mockReturnValue([
			makeModel("claude-sonnet-4-20250514", "anthropic", "chat"),
			makeModel("claude-opus-4-20250918", "anthropic", "chat"),
		]);
		const models = await koshaListProviderModels("anthropic");
		expect(models).toEqual(["claude-sonnet-4-20250514", "claude-opus-4-20250918"]);
		expect(mockModels).toHaveBeenCalledWith({ provider: "anthropic", mode: "chat" });
	});
});

// ── koshaProviderModels ──────────────────────────────────────────────────────

describe("koshaProviderModels", () => {
	it("returns provider → model[] map for chat models", async () => {
		mockProvidersList.mockReturnValue([
			makeProvider("anthropic", true, "env", [
				makeModel("claude-sonnet-4-20250514", "anthropic", "chat"),
				makeModel("text-embedding-3-small", "anthropic", "embedding"),
			]),
			makeProvider("openai", true, "env", [
				makeModel("gpt-4o", "openai", "chat"),
			]),
		]);

		const result = await koshaProviderModels();
		expect(result.anthropic).toEqual(["claude-sonnet-4-20250514"]);
		expect(result.openai).toEqual(["gpt-4o"]);
	});

	it("maps google → gemini in provider names", async () => {
		mockProvidersList.mockReturnValue([
			makeProvider("google", true, "env", [
				makeModel("gemini-2.5-pro", "google", "chat"),
			]),
		]);
		const result = await koshaProviderModels();
		expect(result.gemini).toBeDefined();
		expect(result.google).toBeUndefined();
	});
});

// ── koshaEndpoint ────────────────────────────────────────────────────────────

describe("koshaEndpoint", () => {
	it("returns chat completions path for OpenAI-compatible providers", async () => {
		mockProvider.mockReturnValue({ baseUrl: "https://api.openai.com" });
		const endpoint = await koshaEndpoint("openai");
		expect(endpoint).toBe("https://api.openai.com/v1/chat/completions");
	});

	it("returns bare URL for anthropic", async () => {
		mockProvider.mockReturnValue({ baseUrl: "https://api.anthropic.com" });
		const endpoint = await koshaEndpoint("anthropic");
		expect(endpoint).toBe("https://api.anthropic.com");
	});

	it("returns ollama with /v1/chat/completions", async () => {
		mockProvider.mockReturnValue({ baseUrl: "http://localhost:11434" });
		const endpoint = await koshaEndpoint("ollama");
		expect(endpoint).toBe("http://localhost:11434/v1/chat/completions");
	});

	it("returns empty string when provider not found", async () => {
		mockProvider.mockReturnValue(undefined);
		const endpoint = await koshaEndpoint("unknown");
		expect(endpoint).toBe("");
	});
});

// ── koshaResolveAlias ────────────────────────────────────────────────────────

describe("koshaResolveAlias", () => {
	it("delegates to kosha resolve()", async () => {
		mockResolve.mockReturnValue("claude-sonnet-4-20250514");
		const resolved = await koshaResolveAlias("sonnet");
		expect(resolved).toBe("claude-sonnet-4-20250514");
		expect(mockResolve).toHaveBeenCalledWith("sonnet");
	});
});

// ── koshaModel ───────────────────────────────────────────────────────────────

describe("koshaModel", () => {
	it("returns model card by ID", async () => {
		const card = makeModel("claude-sonnet-4-20250514", "anthropic");
		mockModel.mockReturnValue(card);
		const result = await koshaModel("sonnet");
		expect(result).toEqual(card);
		expect(mockModel).toHaveBeenCalledWith("sonnet");
	});

	it("returns undefined for unknown model", async () => {
		mockModel.mockReturnValue(undefined);
		const result = await koshaModel("nonexistent");
		expect(result).toBeUndefined();
	});
});
