import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Attempts to resolve an API key or access token from existing CLI tools
 * installed on the user's system (e.g., gh, gcloud, claude).
 */
export function tryResolveCliToken(provider: string): string | undefined {
	try {
		// 1. GitHub CLI (gh) - useful for GitHub Models or Copilot
		if (provider === "github" || provider === "openai") {
			try {
				const token = execSync("gh auth token", {
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "ignore"],
					timeout: 2000,
				}).trim();
				if (token) return token;
			} catch {}
		}

		// 2. Google Cloud CLI (gcloud) - useful for Gemini / Vertex AI
		if (provider === "gemini" || provider === "google") {
			try {
				const token = execSync("gcloud auth print-access-token", {
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "ignore"],
					timeout: 2000,
				}).trim();
				if (token) return token;
			} catch {}
		}

		// 3. Claude Code CLI - useful for Anthropic
		if (provider === "anthropic" || provider === "claude") {
			const home = homedir();
			const paths = [
				join(home, ".claude.json"),
				join(home, ".config", "claude", "config.json"),
				join(home, ".anthropic", "config.json"),
			];
			for (const p of paths) {
				if (existsSync(p)) {
					try {
						const data = JSON.parse(readFileSync(p, "utf-8"));
						if (data.primaryApiKey) return data.primaryApiKey;
						if (data.apiKey) return data.apiKey;
						if (data.token) return data.token;
					} catch {}
				}
			}
		}
	} catch (err) {
		// Ignore errors, fallback to undefined
	}
	return undefined;
}
