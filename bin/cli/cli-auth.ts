import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
			timeout: 3000,
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
