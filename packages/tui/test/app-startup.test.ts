import { describe, expect, it } from "vitest";
import { formatStartupSummary, mapBootstrapLanesToSessionState } from "../src/app-startup.js";

describe("formatStartupSummary", () => {
	it("surfaces requested and resolved startup model state", () => {
		const summary = formatStartupSummary({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			source: "Kosha policy (claude → anthropic / claude-sonnet-4-20250514)",
			requestedModel: {
				provider: "anthropic",
				model: "claude",
				allow: ["claude", "gpt-4.1"],
				prefer: ["claude"],
			},
			resolvedIntent: "claude",
			resolvedVersion: "20250514",
			localModels: ["llama3:8b"],
		});

		expect(summary).toContain("Requested: anthropic / claude (allow: claude, gpt-4.1; prefer: claude)");
		expect(summary).toContain("Resolved: anthropic / claude-sonnet-4-20250514 (intent: claude; version: 20250514)");
		expect(summary).toContain("Source: Kosha policy (claude → anthropic / claude-sonnet-4-20250514)");
	});

	it("maps requested and effective lane policy metadata into session state", () => {
		const lanes = mapBootstrapLanesToSessionState(
			[
				{
					key: "primary",
					role: "primary",
					laneId: "lane-1",
					durableKey: "durable-1",
					snapshotAt: 123,
					policy: {
						contractVersion: 1,
						role: "primary",
						preferLocal: null,
						allowCloud: true,
						maxCostClass: "medium",
						requireStreaming: true,
						hardProviderFamily: null,
						preferredProviderFamilies: ["gemini"],
						toolAccess: "inherit",
						privacyBoundary: "cloud-ok",
						fallbackStrategy: "same-provider",
						tags: ["startup"],
					},
					requestedPolicy: {
						contractVersion: 1,
						role: "primary",
						preferLocal: true,
						allowCloud: false,
						maxCostClass: "low",
						requireStreaming: true,
						hardProviderFamily: "ollama",
						preferredProviderFamilies: ["ollama"],
						toolAccess: "allow",
						privacyBoundary: "strict-local",
						fallbackStrategy: "same-provider",
						tags: ["requested"],
					},
					effectivePolicy: {
						contractVersion: 1,
						role: "primary",
						preferLocal: true,
						allowCloud: false,
						maxCostClass: "medium",
						requireStreaming: true,
						hardProviderFamily: null,
						preferredProviderFamilies: ["ollama", "gemini"],
						toolAccess: "allow",
						privacyBoundary: "local-preferred",
						fallbackStrategy: "capability-only",
						tags: ["effective"],
					},
					constraintsApplied: { requireStreaming: true },
					policyHash: "policy-1",
					policyWarnings: ["maxCostClass relaxed"],
					route: null,
					routingDecision: {
						authority: "chitragupta",
						source: "route.resolve",
						routeClass: "coding.patch-cheap",
						capability: "coding.patch-cheap",
						selectedCapabilityId: "llm.gemini.gemini-2.5-pro",
						provider: "gemini",
						model: "gemini-2.5-pro",
						requestedBudget: null,
						effectiveBudget: null,
						degraded: false,
						reasonCode: "selected",
						reason: "Selected Gemini for startup",
						policyTrace: ["selected:llm.gemini.gemini-2.5-pro"],
						fallbackChain: [],
						discoverableOnly: false,
						requestId: "req-1",
						traceId: null,
						snapshotAt: 123,
						expiresAt: null,
						cacheScope: "request",
					},
				},
			],
			"route.lanes.refresh",
		);

		expect(lanes[0]).toMatchObject({
			policyHash: "policy-1",
			policyWarnings: ["maxCostClass relaxed"],
			authoritySource: "route.lanes.refresh",
			requestedPolicy: {
				hardProviderFamily: "ollama",
			},
			effectivePolicy: {
				maxCostClass: "medium",
				privacyBoundary: "local-preferred",
			},
		});
	});
});
