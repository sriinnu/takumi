import { describe, expect, it } from "vitest";
import { buildDegradedLocalModeStatus, formatDiscoveredProviderSummary } from "../cli/degraded-local-mode.js";

describe("degraded local mode", () => {
	it("formats discovered providers for operator-facing summaries", () => {
		const summary = formatDiscoveredProviderSummary([
			{ id: "github", authenticated: true, credentialSource: "oauth", models: ["gpt-4.1"] },
			{ id: "ollama", authenticated: true, credentialSource: "none", models: ["llama3:8b", "qwen2.5-coder:7b"] },
		]);

		expect(summary).toContain("GitHub Models (oauth: gpt-4.1)");
		expect(summary).toContain("Ollama (2 local models: llama3:8b, qwen2.5-coder:7b)");
	});

	it("describes degraded control-plane execution against the current runtime", () => {
		const status = buildDegradedLocalModeStatus({
			chitraguptaDegraded: true,
			currentProvider: "github",
			currentModel: "gpt-4.1",
			providerStatuses: [{ id: "github", authenticated: true, credentialSource: "oauth", models: ["gpt-4.1"] }],
		});

		expect(status).toMatchObject({
			active: true,
			providerCount: 1,
			currentTarget: "github / gpt-4.1",
			requiresOperatorConsent: true,
		});
		expect(status?.summary).toContain("Degraded local mode:");
		expect(status?.summary).toContain("Current runtime: github / gpt-4.1");
		expect(status?.summary).toContain("GitHub Models (oauth: gpt-4.1)");
	});

	it("returns null when Chitragupta is healthy", () => {
		expect(
			buildDegradedLocalModeStatus({
				chitraguptaDegraded: false,
				currentProvider: "github",
				currentModel: "gpt-4.1",
				providerStatuses: [],
			}),
		).toBeNull();
	});
});