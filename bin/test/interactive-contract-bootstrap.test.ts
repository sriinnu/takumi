import { describe, expect, it, vi } from "vitest";
import type { ExecBootstrapResult } from "@takumi/agent";
import type { DaemonBridgeBootstrapLane, DaemonBridgeLaneSnapshotResult, RoutingDecision } from "@takumi/bridge";
import type { TakumiConfig } from "@takumi/core";
import { bootstrapInteractiveContract } from "../cli/interactive-contract-bootstrap.js";

type TestBridge = NonNullable<ExecBootstrapResult["bridge"]>;

const baseConfig: TakumiConfig = {
	apiKey: "",
	model: "claude-sonnet-4-20250514",
	maxTokens: 16384,
	thinking: false,
	thinkingBudget: 10000,
	systemPrompt: "",
	workingDirectory: process.cwd(),
	proxyUrl: "",
	provider: "anthropic",
	endpoint: "",
	permissions: [],
	theme: "default",
	logLevel: "info",
	maxTurns: 100,
	experimental: {},
	orchestration: {
		enabled: true,
		defaultMode: "multi",
		complexityThreshold: "STANDARD",
		maxValidationRetries: 3,
		isolationMode: "none",
		ensemble: { enabled: false, workerCount: 3, temperature: 0.9, parallel: true },
		weightedVoting: { minConfidenceThreshold: 0.1 },
		reflexion: { enabled: false, maxHistorySize: 3, useAkasha: true },
		moA: { enabled: false, rounds: 2, validatorCount: 3, allowCrossTalk: true, temperatures: [0.2, 0.1, 0.05] },
		progressiveRefinement: {
			enabled: false,
			maxIterations: 3,
			minImprovement: 0.05,
			useCriticModel: true,
			targetScore: 9.0,
		},
		adaptiveTemperature: { enabled: true },
		mesh: {
			defaultTopology: "hierarchical",
			lucyAdaptiveTopology: true,
			scarlettAdaptiveTopology: true,
			sabhaEscalation: { enabled: true, integrityThreshold: "critical", minValidationAttempts: 1 },
		},
	},
	statusBar: {
		left: ["model", "mesh", "cluster"],
		center: ["status"],
		right: ["authority", "metrics", "context", "scarlett", "keybinds"],
	},
	plugins: [],
	packages: [],
};

function makeBridge(socketMode: boolean) {
	const routeLanesGet = vi.fn<TestBridge["routeLanesGet"]>(
		async (): Promise<DaemonBridgeLaneSnapshotResult | null> => null,
	);
	const routeLanesRefresh = vi.fn<TestBridge["routeLanesRefresh"]>(
		async (): Promise<DaemonBridgeLaneSnapshotResult | null> => null,
	);

	return {
		connect: vi.fn<TestBridge["connect"]>(async () => undefined),
		disconnect: vi.fn<TestBridge["disconnect"]>(async () => undefined),
		artifactImportBatch: vi.fn<TestBridge["artifactImportBatch"]>(async () => null),
		artifactListImported: vi.fn<TestBridge["artifactListImported"]>(async () => null),
		bootstrap: vi.fn<TestBridge["bootstrap"]>(async () => null),
		routeLanesGet,
		routeLanesRefresh,
		requestProviderCredential: vi.fn<TestBridge["requestProviderCredential"]>(async () => null),
		unifiedRecall: vi.fn<TestBridge["unifiedRecall"]>(async () => []),
		vasanaTendencies: vi.fn<TestBridge["vasanaTendencies"]>(async () => []),
		healthStatus: vi.fn<TestBridge["healthStatus"]>(async () => null),
		sessionCreate: vi.fn<TestBridge["sessionCreate"]>(async () => ({ id: "canon-1", created: true })),
		sessionMetaUpdate: vi.fn<TestBridge["sessionMetaUpdate"]>(async () => ({ updated: true })),
		turnAdd: vi.fn<TestBridge["turnAdd"]>(async () => ({ added: true })),
		turnMaxNumber: vi.fn<TestBridge["turnMaxNumber"]>(async () => 0),
		verticalRuntimeContract: vi.fn<TestBridge["verticalRuntimeContract"]>(async () => null),
		isConnected: true,
		isSocketMode: socketMode,
	} satisfies TestBridge;
}

function makeBootstrapResult(bridge: ReturnType<typeof makeBridge>): ExecBootstrapResult {
	return {
		bridge,
		connected: true,
		degraded: false,
		transport: bridge.isSocketMode ? "daemon-socket" : "mcp-stdio",
		memoryEntries: 2,
		vasanaCount: 1,
		hasHealth: true,
		summary: "connected",
		memoryContext: "Remember the latest daemon context.",
		health: null,
		tendencies: [],
		recall: [],
	};
}

function makeBootstrapLane(overrides: Partial<DaemonBridgeBootstrapLane> = {}): DaemonBridgeBootstrapLane {
	return {
		key: overrides.key ?? "primary",
		role: overrides.role ?? "primary",
		laneId: overrides.laneId ?? "lane-1",
		durableKey: overrides.durableKey ?? "durable-1",
		snapshotAt: overrides.snapshotAt ?? Date.now(),
		policy: overrides.policy ?? {
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
		requestedPolicy: overrides.requestedPolicy ?? {
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
		effectivePolicy: overrides.effectivePolicy ?? {
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
		constraintsApplied: overrides.constraintsApplied ?? { requireStreaming: true },
		policyHash: overrides.policyHash ?? "policy-1",
		policyWarnings: overrides.policyWarnings ?? [],
		route: overrides.route ?? null,
		routingDecision:
			overrides.routingDecision ??
			{
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
				snapshotAt: Date.now(),
				expiresAt: null,
				cacheScope: "request",
			},
	};
}

function makeRoutingDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-1",
			capability: "coding.patch-cheap",
		},
		selected: {
			id: "llm.gemini.gemini-2.5-pro",
			kind: "llm",
			label: "Gemini 2.5 Pro",
			capabilities: ["coding.patch-cheap"],
			costClass: "medium",
			trust: "cloud",
			health: "healthy",
			invocation: {
				id: "gemini-chat",
				transport: "http",
				entrypoint: "https://example.invalid/gemini",
				requestShape: "ChatRequest",
				responseShape: "ChatResponse",
				timeoutMs: 30_000,
				streaming: true,
			},
			tags: ["coding"],
			providerFamily: "gemini",
			metadata: { model: "gemini-2.5-pro" },
		},
		reason: "Selected Gemini for startup",
		fallbackChain: [],
		policyTrace: ["selected:llm.gemini.gemini-2.5-pro"],
		degraded: false,
		...overrides,
	};
}

describe("bootstrapInteractiveContract", () => {
	it("creates a canonical session and honors an exact provider/model route", async () => {
		const bridge = makeBridge(true);
		const routeResolve = vi.fn(async () => makeRoutingDecision());

		const result = await bootstrapInteractiveContract(baseConfig, makeBootstrapResult(bridge), {
			cwd: "/tmp/takumi-demo",
			detectBranch: async () => "feature/interactive-startup",
			createObserver: () => ({ routeResolve }),
		});

		expect(bridge.sessionCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				project: "/tmp/takumi-demo",
				agent: "takumi",
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				branch: "feature/interactive-startup",
			}),
		);
		expect(routeResolve).toHaveBeenCalledWith(
			expect.objectContaining({
				consumer: "takumi",
				sessionId: "canon-1",
				capability: "coding.patch-cheap",
			}),
		);
		expect(result.canonicalSessionId).toBe("canon-1");
		expect(result.preferredProvider).toBe("gemini");
		expect(result.preferredModel).toBe("gemini-2.5-pro");
		expect(result.strictPreferredRoute).toBe(true);
		expect(result.warnings).toEqual([]);
	});

	it("infers an exact provider from model metadata when the engine only returns an openai-compatible family", async () => {
		const bridge = makeBridge(true);
		const routeResolve = vi.fn(async () =>
			makeRoutingDecision({
				selected: {
					...makeRoutingDecision().selected!,
					id: "llm.openai.gpt-4.1",
					label: "GPT-4.1",
					providerFamily: "openai-compat",
					metadata: { model: "gpt-4.1" },
				},
				reason: "Selected GPT-4.1 for startup",
			}),
		);

		const result = await bootstrapInteractiveContract(
			{ ...baseConfig, provider: "anthropic", model: "claude-sonnet-4-20250514" },
			makeBootstrapResult(bridge),
			{
				cwd: "/tmp/takumi-demo",
				detectBranch: async () => "main",
				createObserver: () => ({ routeResolve }),
			},
		);

		expect(result.preferredProvider).toBe("openai");
		expect(result.preferredModel).toBe("gpt-4.1");
		expect(result.strictPreferredRoute).toBe(true);
	});

	it("keeps the canonical session bootstrap but warns when routing transport is mcp-stdio", async () => {
		const bridge = makeBridge(false);
		const routeResolve = vi.fn(async () => makeRoutingDecision());

		const result = await bootstrapInteractiveContract(baseConfig, makeBootstrapResult(bridge), {
			cwd: "/tmp/takumi-demo",
			detectBranch: async () => "main",
			createObserver: () => ({ routeResolve }),
		});

		expect(result.canonicalSessionId).toBe("canon-1");
		expect(result.routingDecision).toBeUndefined();
		expect(result.strictPreferredRoute).toBe(false);
		expect(result.warnings[0]).toContain("daemon-socket mode");
		expect(routeResolve).not.toHaveBeenCalled();
	});

	it("prefers authoritative lane refresh over local route resolution", async () => {
		const bridge = makeBridge(true);
		bridge.routeLanesRefresh.mockResolvedValueOnce({
			contractVersion: 1,
			sessionId: "canon-1",
			project: "/tmp/takumi-demo",
			primaryLaneKey: "primary",
			laneCount: 1,
			lanes: [makeBootstrapLane()],
		});
		const routeResolve = vi.fn(async () => makeRoutingDecision());

		const result = await bootstrapInteractiveContract(baseConfig, makeBootstrapResult(bridge), {
			cwd: "/tmp/takumi-demo",
			detectBranch: async () => "main",
			createObserver: () => ({ routeResolve }),
		});

		expect(bridge.routeLanesRefresh).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "canon-1",
				project: "/tmp/takumi-demo",
				consumer: "takumi",
			}),
		);
		expect(routeResolve).not.toHaveBeenCalled();
		expect(result.preferredProvider).toBe("gemini");
		expect(result.preferredModel).toBe("gemini-2.5-pro");
		expect(result.primaryLane?.effectivePolicy.maxCostClass).toBe("medium");
		expect(result.startupLanes?.[0]?.constraintsApplied).toEqual({ requireStreaming: true });
		expect(result.laneAuthority).toBe("route.lanes.refresh");
		expect(result.strictPreferredRoute).toBe(true);
	});

	it("keeps multi-lane refresh truth stable and selects the primary lane by key", async () => {
		const bridge = makeBridge(true);
		const secondaryLane = makeBootstrapLane({
			key: "worker",
			role: "worker",
			laneId: "lane-2",
			durableKey: "durable-2",
			requestedPolicy: {
				contractVersion: 1,
				role: "worker",
				preferLocal: true,
				allowCloud: false,
				maxCostClass: "low",
				requireStreaming: true,
				hardProviderFamily: "ollama",
				preferredProviderFamilies: ["ollama"],
				toolAccess: "allow",
				privacyBoundary: "strict-local",
				fallbackStrategy: "same-provider",
				tags: ["worker-requested"],
			},
			effectivePolicy: {
				contractVersion: 1,
				role: "worker",
				preferLocal: true,
				allowCloud: true,
				maxCostClass: "medium",
				requireStreaming: true,
				hardProviderFamily: null,
				preferredProviderFamilies: ["ollama", "gemini"],
				toolAccess: "allow",
				privacyBoundary: "local-preferred",
				fallbackStrategy: "capability-only",
				tags: ["worker-effective"],
			},
			policyHash: "policy-worker",
			policyWarnings: ["worker lane relaxed to cloud fallback"],
		});
		bridge.routeLanesRefresh.mockResolvedValueOnce({
			contractVersion: 1,
			sessionId: "canon-1",
			project: "/tmp/takumi-demo",
			primaryLaneKey: "primary",
			laneCount: 2,
			lanes: [secondaryLane, makeBootstrapLane()],
		});
		const routeResolve = vi.fn(async () => makeRoutingDecision());

		const result = await bootstrapInteractiveContract(baseConfig, makeBootstrapResult(bridge), {
			cwd: "/tmp/takumi-demo",
			detectBranch: async () => "main",
			createObserver: () => ({ routeResolve }),
		});

		expect(routeResolve).not.toHaveBeenCalled();
		expect(result.laneAuthority).toBe("route.lanes.refresh");
		expect(result.startupLanes?.map((lane) => lane.key)).toEqual(["worker", "primary"]);
		expect(result.primaryLane?.key).toBe("primary");
		expect(result.primaryLane?.laneId).toBe("lane-1");
		expect(result.startupLanes?.[0]).toMatchObject({
			key: "worker",
			policyHash: "policy-worker",
			policyWarnings: ["worker lane relaxed to cloud fallback"],
			requestedPolicy: {
				hardProviderFamily: "ollama",
				privacyBoundary: "strict-local",
			},
			effectivePolicy: {
				maxCostClass: "medium",
				privacyBoundary: "local-preferred",
			},
		});
	});

	it("falls back to stored authoritative lanes when lane refresh fails", async () => {
		const bridge = makeBridge(true);
		bridge.routeLanesRefresh.mockRejectedValueOnce(new Error("refresh failed"));
		bridge.routeLanesGet.mockResolvedValueOnce({
			contractVersion: 1,
			sessionId: "canon-1",
			project: "/tmp/takumi-demo",
			primaryLaneKey: "primary",
			laneCount: 1,
			lanes: [makeBootstrapLane()],
		});
		const routeResolve = vi.fn(async () => makeRoutingDecision());

		const result = await bootstrapInteractiveContract(baseConfig, makeBootstrapResult(bridge), {
			cwd: "/tmp/takumi-demo",
			detectBranch: async () => "main",
			createObserver: () => ({ routeResolve }),
		});

		expect(bridge.routeLanesGet).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "canon-1",
				project: "/tmp/takumi-demo",
			}),
		);
		expect(result.warnings).toContain("Interactive startup lane refresh failed: refresh failed");
		expect(result.laneAuthority).toBe("route.lanes.get");
		expect(routeResolve).not.toHaveBeenCalled();
	});
});
