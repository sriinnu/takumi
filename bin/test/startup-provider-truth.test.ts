import { describe, expect, it } from "vitest";
import { deriveStartupProviderTruth } from "../cli/startup-provider-truth.js";

describe("startup provider truth", () => {
	it("prefers daemon inventory over the static startup catalog when inventory is present", () => {
		const truth = deriveStartupProviderTruth(
			{
				openrouter: ["openai/gpt-4o"],
				moonshot: ["kimi-latest"],
			},
			[
				{ id: "openrouter", authenticated: true, credentialSource: "env", models: ["openai/gpt-4o"] },
				{ id: "moonshot", authenticated: true, credentialSource: "env", models: ["kimi-latest"] },
			],
			{
				inventory: {
					contractVersion: 1,
					snapshotAt: 123,
					discoverySnapshotAt: 120,
					localRuntimeSnapshotAt: null,
					providerPriority: ["zai", "openrouter", "codex-cli"],
					lanePriority: ["cloud"],
					providers: [
						{
							id: "zai",
							name: "Z.AI",
							lane: "cloud",
							transport: "remote-api",
							available: true,
							authenticated: true,
							credentialAvailable: true,
							credentialSource: "env",
							modelCount: 2,
							models: [
								{
									id: "glm-5",
									name: "GLM-5",
									available: true,
									health: "healthy",
									capabilities: ["chat"],
									contextWindow: 128000,
									maxOutputTokens: 8192,
									costClass: "medium",
									source: "discovery",
								},
								{
									id: "glm-4.7-flash",
									name: "GLM-4.7 Flash",
									available: true,
									health: "healthy",
									capabilities: ["chat"],
									contextWindow: 128000,
									maxOutputTokens: 8192,
									costClass: "low",
									source: "discovery",
								},
							],
							issues: [],
							runtime: null,
						},
						{
							id: "openrouter",
							name: "OpenRouter",
							lane: "cloud",
							transport: "remote-api",
							available: true,
							authenticated: true,
							credentialAvailable: true,
							credentialSource: "env",
							modelCount: 1,
							models: [
								{
									id: "openrouter/z-ai/glm-4.5",
									name: "GLM 4.5",
									available: true,
									health: "healthy",
									capabilities: ["chat"],
									contextWindow: 128000,
									maxOutputTokens: 8192,
									costClass: "medium",
									source: "discovery",
								},
							],
							issues: [],
							runtime: null,
						},
						{
							id: "moonshot",
							name: "Moonshot",
							lane: "cloud",
							transport: "remote-api",
							available: true,
							authenticated: false,
							credentialAvailable: false,
							credentialSource: "none",
							modelCount: 1,
							models: [
								{
									id: "kimi-k2.5",
									name: "Kimi K2.5",
									available: true,
									health: "healthy",
									capabilities: ["chat"],
									contextWindow: 128000,
									maxOutputTokens: 8192,
									costClass: "medium",
									source: "discovery",
								},
							],
							issues: [],
							runtime: null,
						},
						{
							id: "codex-cli",
							name: "Codex CLI",
							lane: "cli",
							transport: "local-cli",
							available: true,
							authenticated: true,
							credentialAvailable: true,
							credentialSource: "cli",
							modelCount: 1,
							models: [
								{
									id: "codex-cli",
									name: "Codex CLI",
									available: true,
									health: "healthy",
									capabilities: ["coding"],
									contextWindow: 0,
									maxOutputTokens: 0,
									costClass: "low",
									source: "cli",
								},
							],
							issues: [],
							runtime: {
								transport: "local-cli",
								endpoint: null,
								command: "codex",
								commandPath: "/usr/local/bin/codex",
								configured: true,
								reachable: true,
								preferred: false,
								lastError: null,
							},
						},
					],
					stale: false,
					staleReason: null,
					warnings: [],
				},
			} as never,
		);

		expect(truth.providerCatalogAuthority).toBe("strict");
		expect(truth.providerStatuses.map((provider) => provider.id)).toEqual(["zai", "openrouter"]);
		expect(truth.providerModels).toEqual({
			zai: ["glm-5", "glm-4.7-flash"],
			openrouter: ["openrouter/z-ai/glm-4.5"],
		});
	});
});
