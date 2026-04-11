import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadMergedEnv } from "@takumi/core";
import { koshaAutoDetect } from "./kosha-bridge.js";

/** I let tests and strict operators disable local runtime discovery explicitly. */
function isLocalProviderDiscoveryDisabled(): boolean {
	return process.env.TAKUMI_DISABLE_LOCAL_PROVIDER_DISCOVERY === "1";
}

/** Read and JSON-parse a file, returning undefined on any error. */
function readJsonSafe(path: string): any | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}

/** Read a dotenv-style file and return the value for `key`, or undefined. */
function readEnvFile(path: string, key: string): string | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const content = readFileSync(path, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
			const eqIdx = trimmed.indexOf("=");
			const k = trimmed.slice(0, eqIdx).trim();
			if (k !== key) continue;
			let v = trimmed.slice(eqIdx + 1).trim();
			// strip surrounding quotes
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1);
			}
			if (v) return v;
		}
	} catch {}
	return undefined;
}

/** Run a shell command and return trimmed stdout, or undefined on failure. */
function execSafe(cmd: string): string | undefined {
	try {
		const out = execSync(cmd, {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1200,
		}).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Attempts to resolve an API key or access token from existing CLI tools
 * installed on the user's system (e.g., gh, gcloud, claude, copilot, codex).
 */
export function tryResolveCliToken(provider: string): string | undefined {
	try {
		const home = homedir();

		// ── Anthropic / Claude Code ──────────────────────────────────
		if (provider === "anthropic" || provider === "claude") {
			// 1. Claude Code OAuth credentials (primary location)
			const credPath = join(home, ".claude", ".credentials.json");
			const creds = readJsonSafe(credPath);
			if (creds?.claudeAiOauth?.accessToken) return creds.claudeAiOauth.accessToken;

			// 2. Legacy / alternative config locations
			const legacyPaths = [
				join(home, ".claude.json"),
				join(home, ".config", "claude", "config.json"),
				join(home, ".anthropic", "config.json"),
			];
			for (const p of legacyPaths) {
				const data = readJsonSafe(p);
				if (!data) continue;
				if (data.primaryApiKey) return data.primaryApiKey;
				if (data.apiKey) return data.apiKey;
				if (data.token) return data.token;
			}
		}

		// ── GitHub Copilot ──────────────────────────────────────────
		if (provider === "copilot" || provider === "github") {
			// VS Code / CLI variant
			const hostsPath = join(home, ".config", "github-copilot", "hosts.json");
			const hosts = readJsonSafe(hostsPath);
			if (hosts?.["github.com"]?.oauth_token) return hosts["github.com"].oauth_token;

			// JetBrains variant
			const appsPath = join(home, ".config", "github-copilot", "apps.json");
			const apps = readJsonSafe(appsPath);
			if (apps?.["github.com"]?.oauth_token) return apps["github.com"].oauth_token;

			// Fall through to gh CLI
			const ghToken = execSafe("gh auth token");
			if (ghToken) return ghToken;
		}

		// ── GitHub CLI (gh) — for GitHub Models ─────────────────────
		if (provider === "github") {
			const ghToken = execSafe("gh auth token");
			if (ghToken) return ghToken;
		}

		// ── OpenAI / Codex CLI ──────────────────────────────────────
		if (provider === "codex" || provider === "openai") {
			const codexHome = process.env.CODEX_HOME || join(home, ".codex");
			const authPath = join(codexHome, "auth.json");
			const data = readJsonSafe(authPath);
			if (data) {
				// Codex CLI stores various key formats
				const key = data.apiKey || data.api_key || data.token || data.openai_api_key;
				if (key) return key;
			}
		}

		// ── Gemini CLI ──────────────────────────────────────────────
		if (provider === "gemini" || provider === "google") {
			// 1. Gemini CLI dotenv file (fast, no subprocess)
			const geminiEnvPath = join(home, ".gemini", ".env");
			const geminiKey = readEnvFile(geminiEnvPath, "GEMINI_API_KEY");
			if (geminiKey) return geminiKey;

			// 2. gcloud CLI (slower, requires subprocess)
			const gcloudToken = execSafe("gcloud auth print-access-token");
			if (gcloudToken) return gcloudToken;
		}
	} catch {
		// Ignore errors, fallback to undefined
	}
	return undefined;
}

/**
 * Probes the local Ollama server (http://localhost:11434).
 * Returns the list of installed model names, or an empty array if not running.
 */
export async function probeOllama(): Promise<string[]> {
	if (isLocalProviderDiscoveryDisabled()) return [];
	try {
		const res = await fetch("http://localhost:11434/api/tags", {
			signal: AbortSignal.timeout(500),
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { models?: Array<{ name: string }> };
		return (data.models ?? []).map((m) => m.name).filter(Boolean);
	} catch {
		return [];
	}
}

export interface AutoDetectedAuth {
	provider: string;
	apiKey: string;
	model?: string;
	/** Human-readable description of where the credential came from. */
	source: string;
}

export interface FastProviderStatus {
	id: string;
	authenticated: boolean;
	credentialSource: "env" | "cli" | "config" | "oauth" | "none";
	models: string[];
}

/**
 * I resolve direct environment credentials before I touch slower discovery
 * surfaces so common CLI startup stays cheap.
 */
function detectEnvironmentAuth(): AutoDetectedAuth | null {
	const env = loadMergedEnv();
	if (env.ANTHROPIC_API_KEY) {
		return { provider: "anthropic", apiKey: env.ANTHROPIC_API_KEY, source: "ANTHROPIC_API_KEY" };
	}
	if (env.CLAUDE_CODE_OAUTH_TOKEN) {
		return { provider: "anthropic", apiKey: env.CLAUDE_CODE_OAUTH_TOKEN, source: "CLAUDE_CODE_OAUTH_TOKEN" };
	}
	if (env.OPENAI_API_KEY) {
		return { provider: "openai", apiKey: env.OPENAI_API_KEY, source: "OPENAI_API_KEY" };
	}
	if (env.GITHUB_TOKEN) {
		return { provider: "github", apiKey: env.GITHUB_TOKEN, model: "gpt-4.1", source: "GITHUB_TOKEN" };
	}
	if (env.GEMINI_API_KEY) {
		return { provider: "gemini", apiKey: env.GEMINI_API_KEY, source: "GEMINI_API_KEY" };
	}
	if (env.GOOGLE_API_KEY) {
		return { provider: "gemini", apiKey: env.GOOGLE_API_KEY, source: "GOOGLE_API_KEY" };
	}
	if (env.GROQ_API_KEY) {
		return { provider: "groq", apiKey: env.GROQ_API_KEY, source: "GROQ_API_KEY" };
	}
	if (env.XAI_API_KEY) {
		return { provider: "xai", apiKey: env.XAI_API_KEY, source: "XAI_API_KEY" };
	}
	if (env.GROK_API_KEY) {
		return { provider: "xai", apiKey: env.GROK_API_KEY, source: "GROK_API_KEY" };
	}
	if (env.DEEPSEEK_API_KEY) {
		return { provider: "deepseek", apiKey: env.DEEPSEEK_API_KEY, source: "DEEPSEEK_API_KEY" };
	}
	if (env.MISTRAL_API_KEY) {
		return { provider: "mistral", apiKey: env.MISTRAL_API_KEY, source: "MISTRAL_API_KEY" };
	}
	if (env.TOGETHER_API_KEY) {
		return { provider: "together", apiKey: env.TOGETHER_API_KEY, source: "TOGETHER_API_KEY" };
	}
	if (env.OPENROUTER_API_KEY) {
		return { provider: "openrouter", apiKey: env.OPENROUTER_API_KEY, source: "OPENROUTER_API_KEY" };
	}
	if (env.ALIBABA_API_KEY) {
		return { provider: "alibaba", apiKey: env.ALIBABA_API_KEY, source: "ALIBABA_API_KEY" };
	}
	if (env.DASHSCOPE_API_KEY) {
		return { provider: "alibaba", apiKey: env.DASHSCOPE_API_KEY, source: "DASHSCOPE_API_KEY" };
	}
	if (env.BEDROCK_API_KEY) {
		return { provider: "bedrock", apiKey: env.BEDROCK_API_KEY, source: "BEDROCK_API_KEY" };
	}
	if (env.AWS_BEARER_TOKEN) {
		return { provider: "bedrock", apiKey: env.AWS_BEARER_TOKEN, source: "AWS_BEARER_TOKEN" };
	}
	if (env.ZAI_API_KEY) {
		return { provider: "zai", apiKey: env.ZAI_API_KEY, source: "ZAI_API_KEY" };
	}
	if (env.KIMI_API_KEY) {
		return { provider: "zai", apiKey: env.KIMI_API_KEY, source: "KIMI_API_KEY" };
	}
	if (env.MOONSHOT_API_KEY) {
		return { provider: "zai", apiKey: env.MOONSHOT_API_KEY, source: "MOONSHOT_API_KEY" };
	}
	if (env.TAKUMI_API_KEY) {
		return { provider: "anthropic", apiKey: env.TAKUMI_API_KEY, source: "TAKUMI_API_KEY" };
	}
	return null;
}

/**
 * I resolve file-backed CLI credentials before I pay for subprocess-based
 * discovery. This keeps common startup paths fast on machines that already
 * have local auth files.
 */
function detectFileBackedCliAuth(): AutoDetectedAuth | null {
	const claudeToken = tryResolveCliToken("anthropic");
	if (claudeToken) {
		return { provider: "anthropic", apiKey: claudeToken, source: "Claude CLI (~/.claude/)" };
	}

	const geminiEnvToken = readEnvFile(join(homedir(), ".gemini", ".env"), "GEMINI_API_KEY");
	if (geminiEnvToken) {
		return { provider: "gemini", apiKey: geminiEnvToken, source: "Gemini CLI (~/.gemini/)" };
	}

	const codexToken = tryResolveCliToken("codex");
	if (codexToken) {
		return { provider: "openai", apiKey: codexToken, source: "Codex CLI (~/.codex/)" };
	}

	const copilotToken = readGitHubCopilotToken();
	if (copilotToken) {
		return {
			provider: "github",
			apiKey: copilotToken,
			model: "gpt-4.1",
			source: "GitHub Copilot (~/.config/github-copilot/)",
		};
	}

	return null;
}

/**
 * I isolate GitHub Copilot token lookup so fast auth detection can use the
 * local file path without spawning `gh`.
 */
function readGitHubCopilotToken(): string | undefined {
	const home = homedir();
	const hosts = readJsonSafe(join(home, ".config", "github-copilot", "hosts.json"));
	if (hosts?.["github.com"]?.oauth_token) return hosts["github.com"].oauth_token;

	const apps = readJsonSafe(join(home, ".config", "github-copilot", "apps.json"));
	if (apps?.["github.com"]?.oauth_token) return apps["github.com"].oauth_token;
	return undefined;
}

/**
 * I add one provider snapshot only once, preserving the first successful
 * source so the fast inventory stays stable and cheap.
 */
function addFastProviderStatus(
	map: Map<string, FastProviderStatus>,
	id: string,
	credentialSource: FastProviderStatus["credentialSource"],
	models: string[] = [],
): void {
	if (map.has(id)) return;
	map.set(id, {
		id,
		authenticated: true,
		credentialSource,
		models,
	});
}

/**
 * I keep subprocess-backed auth checks behind a second tier so I only pay for
 * them when fast env/file probes did not already settle the provider.
 */
function detectCommandBackedCliAuth(): AutoDetectedAuth | null {
	const geminiCliToken = tryResolveCliToken("gemini");
	if (geminiCliToken) {
		return { provider: "gemini", apiKey: geminiCliToken, source: "Gemini CLI (~/.gemini/)" };
	}

	const ghToken = execSafe("gh auth token");
	if (ghToken) {
		return {
			provider: "github",
			apiKey: ghToken,
			model: "gpt-4.1",
			source: "GitHub CLI (gh auth token → GitHub Models)",
		};
	}

	return null;
}

/**
 * I collect a fast provider status snapshot for CLI entrypoints that need
 * readiness signals, not the full Kosha registry build.
 */
export async function collectFastProviderStatus(): Promise<FastProviderStatus[]> {
	const providers = new Map<string, FastProviderStatus>();
	const env = loadMergedEnv();

	if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) {
		addFastProviderStatus(providers, "anthropic", "env");
	}
	if (env.OPENAI_API_KEY) {
		addFastProviderStatus(providers, "openai", "env");
	}
	if (env.GITHUB_TOKEN) {
		addFastProviderStatus(providers, "github", "env", ["gpt-4.1"]);
	}
	if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
		addFastProviderStatus(providers, "gemini", "env");
	}
	if (env.GROQ_API_KEY) {
		addFastProviderStatus(providers, "groq", "env");
	}
	if (env.XAI_API_KEY || env.GROK_API_KEY) {
		addFastProviderStatus(providers, "xai", "env");
	}
	if (env.DEEPSEEK_API_KEY) {
		addFastProviderStatus(providers, "deepseek", "env");
	}
	if (env.MISTRAL_API_KEY) {
		addFastProviderStatus(providers, "mistral", "env");
	}
	if (env.TOGETHER_API_KEY) {
		addFastProviderStatus(providers, "together", "env");
	}
	if (env.OPENROUTER_API_KEY) {
		addFastProviderStatus(providers, "openrouter", "env");
	}
	if (env.ALIBABA_API_KEY || env.DASHSCOPE_API_KEY) {
		addFastProviderStatus(providers, "alibaba", "env");
	}
	if (env.BEDROCK_API_KEY || env.AWS_BEARER_TOKEN) {
		addFastProviderStatus(providers, "bedrock", "env");
	}
	if (env.ZAI_API_KEY || env.KIMI_API_KEY || env.MOONSHOT_API_KEY) {
		addFastProviderStatus(providers, "zai", "env");
	}
	if (env.TAKUMI_API_KEY) {
		addFastProviderStatus(providers, "anthropic", "env");
	}

	if (tryResolveCliToken("anthropic")) {
		addFastProviderStatus(providers, "anthropic", "cli");
	}
	const geminiEnvToken = readEnvFile(join(homedir(), ".gemini", ".env"), "GEMINI_API_KEY");
	if (geminiEnvToken) {
		addFastProviderStatus(providers, "gemini", "cli");
	}
	if (tryResolveCliToken("codex")) {
		addFastProviderStatus(providers, "openai", "cli");
	}
	if (readGitHubCopilotToken()) {
		addFastProviderStatus(providers, "github", "oauth", ["gpt-4.1"]);
	}

	if (providers.size > 0) {
		return [...providers.values()].sort((a, b) => a.id.localeCompare(b.id));
	}

	const commandDetected = detectCommandBackedCliAuth();
	if (commandDetected) {
		addFastProviderStatus(
			providers,
			commandDetected.provider,
			"cli",
			commandDetected.model ? [commandDetected.model] : [],
		);
		return [...providers.values()];
	}

	const ollamaModels = await probeOllama();
	if (ollamaModels.length > 0) {
		addFastProviderStatus(providers, "ollama", "none", ollamaModels);
	}

	return [...providers.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Tries every available credential source in priority order and returns the
 * first one that yields a usable key/token. Returns null if nothing is found.
 *
 * **Primary path**: delegates to **kosha-discovery** which scans CLI tools,
 * env vars, config files, and local runtimes for every supported provider.
 *
 * **Fallback**: if kosha fails (e.g. network timeout during Ollama probe),
 * the legacy hand-rolled detection chain runs as a safety net.
 *
 * Priority (via kosha):
 *   1. CLI credential files → env vars → config → OAuth → local
 */
export async function autoDetectAuth(): Promise<AutoDetectedAuth | null> {
	const fast = detectEnvironmentAuth() ?? detectFileBackedCliAuth() ?? detectCommandBackedCliAuth();
	if (fast) {
		return fast;
	}

	// ── Fallback: kosha-discovery ────────────────────────────────────────────
	try {
		const detected = await koshaAutoDetect();
		if (detected) {
			return {
				provider: detected.provider,
				apiKey: detected.apiKey,
				model: detected.model,
				source: detected.source,
			};
		}
	} catch {
		// kosha failed — fall through to legacy detection
	}

	// ── Fallback: legacy detection chain ─────────────────────────────────────
	return legacyAutoDetect();
}

/**
 * Legacy auto-detect — the original hand-rolled credential detection.
 * Kept as a fallback if kosha-discovery is unavailable or fails.
 */
async function legacyAutoDetect(): Promise<AutoDetectedAuth | null> {
	const direct = detectEnvironmentAuth() ?? detectFileBackedCliAuth() ?? detectCommandBackedCliAuth();
	if (direct) {
		return direct;
	}

	// ── 4. Ollama local server ───────────────────────────────────────────────
	if (isLocalProviderDiscoveryDisabled()) return null;
	const ollamaModels = await probeOllama();
	if (ollamaModels.length > 0) {
		const preferred =
			ollamaModels.find((m) => /llama|mistral|qwen|gemma|phi/i.test(m)) ?? ollamaModels[0];
		return {
			provider: "ollama",
			apiKey: "",
			model: preferred,
			source: `Ollama (${ollamaModels.length} model${ollamaModels.length > 1 ? "s" : ""} at localhost:11434)`,
		};
	}

	return null;
}
