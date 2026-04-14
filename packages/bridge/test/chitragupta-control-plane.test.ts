import { describe, expect, it, vi } from "vitest";
import { daemonBootstrap, daemonRouteLanesGet, daemonRouteLanesRefresh } from "../src/chitragupta-control-plane.js";

function buildLanePayload(key: string, role: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		key,
		role,
		laneId: `${key}-lane`,
		durableKey: `${key}-durable`,
		snapshotAt: 123,
		policy: {
			contractVersion: 1,
			role,
			preferLocal: null,
			allowCloud: true,
			maxCostClass: "medium",
			requireStreaming: true,
			hardProviderFamily: null,
			preferredProviderFamilies: ["gemini"],
			toolAccess: "inherit",
			privacyBoundary: "cloud-ok",
			fallbackStrategy: "same-provider",
			tags: ["baseline"],
		},
		requestedPolicy: {
			contractVersion: 1,
			role,
			preferLocal: key === "worker",
			allowCloud: key !== "worker",
			maxCostClass: key === "worker" ? "low" : "medium",
			requireStreaming: true,
			hardProviderFamily: key === "worker" ? "ollama" : null,
			preferredProviderFamilies: key === "worker" ? ["ollama"] : ["gemini"],
			toolAccess: "inherit",
			privacyBoundary: key === "worker" ? "strict-local" : "cloud-ok",
			fallbackStrategy: "same-provider",
			tags: ["requested"],
		},
		effectivePolicy: {
			contractVersion: 1,
			role,
			preferLocal: key === "worker",
			allowCloud: true,
			maxCostClass: "medium",
			requireStreaming: true,
			hardProviderFamily: null,
			preferredProviderFamilies: key === "worker" ? ["ollama", "gemini"] : ["gemini"],
			toolAccess: "inherit",
			privacyBoundary: key === "worker" ? "local-preferred" : "cloud-ok",
			fallbackStrategy: "capability-only",
			tags: ["effective"],
		},
		constraintsApplied: { requireStreaming: true },
		policyHash: `${key}-policy`,
		policyWarnings: key === "worker" ? ["worker lane relaxed"] : [],
		route: null,
		routingDecision: {
			authority: "chitragupta",
			source: "route.resolve",
			routeClass: "coding.patch-cheap",
			capability: "coding.patch-cheap",
			selectedCapabilityId: `cap-${key}`,
			provider: key === "worker" ? "ollama" : "gemini",
			model: key === "worker" ? "qwen2.5-coder:7b" : "gemini-2.5-pro",
			requestedBudget: null,
			effectiveBudget: null,
			degraded: false,
			reasonCode: "selected",
			reason: "Selected route",
			policyTrace: [],
			fallbackChain: [],
			discoverableOnly: false,
			requestId: "req-1",
			traceId: null,
			snapshotAt: 123,
			expiresAt: null,
			cacheScope: "request",
		},
		...overrides,
	};
}

describe("chitragupta control-plane helpers", () => {
	it("parses bootstrap lanes with requested and effective policy metadata intact", async () => {
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async () => ({
				contractVersion: 1,
				protocol: {
					name: "chitragupta-daemon-bridge",
					version: 1,
					minCompatibleVersion: 1,
					maxCompatibleVersion: 1,
				},
				connected: true,
				degraded: false,
				transport: "daemon-socket",
				authority: "daemon-bootstrap",
				warnings: [],
				auth: {
					authenticated: true,
					keyId: "key-1",
					tenantId: "daemon",
					scopes: ["bridge:bootstrap"],
				},
				binding: {
					mode: "exec",
					project: "/repo",
					consumer: "takumi",
					clientId: "client-1",
				},
				session: {
					id: "session-1",
					created: true,
					lineageKey: null,
					sessionReusePolicy: null,
				},
				inventory: {
					contractVersion: 1,
					snapshotAt: 123,
					discoverySnapshotAt: 120,
					localRuntimeSnapshotAt: 121,
					providerPriority: ["openrouter", "zai", "ollama"],
					lanePriority: ["cloud", "local"],
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
									capabilities: ["chat", "tools"],
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
					],
					stale: false,
					staleReason: null,
					warnings: [],
				},
				route: null,
				routingDecision: null,
				lanes: [buildLanePayload("worker", "worker"), buildLanePayload("primary", "primary")],
				capabilities: null,
			})),
		};

		const result = await daemonBootstrap(mockSocket as never, {
			mode: "exec",
			project: "/repo",
			consumer: "takumi",
		});

		expect(result?.lanes.map((lane) => lane.key)).toEqual(["worker", "primary"]);
		expect(result?.lanes[0]).toMatchObject({
			key: "worker",
			policyHash: "worker-policy",
			policyWarnings: ["worker lane relaxed"],
			requestedPolicy: {
				hardProviderFamily: "ollama",
				privacyBoundary: "strict-local",
			},
			effectivePolicy: {
				maxCostClass: "medium",
				privacyBoundary: "local-preferred",
			},
		});
		expect(result?.inventory.providers).toEqual([
			expect.objectContaining({
				id: "zai",
				authenticated: true,
				credentialSource: "env",
				models: [expect.objectContaining({ id: "glm-5" }), expect.objectContaining({ id: "glm-4.7-flash" })],
			}),
		]);
	});

	it("parses bootstrap continuity recovery plans", async () => {
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async () => ({
				contractVersion: 1,
				protocol: {
					name: "chitragupta-daemon-bridge",
					version: 1,
					minCompatibleVersion: 1,
					maxCompatibleVersion: 1,
				},
				connected: true,
				degraded: false,
				transport: "daemon-socket",
				authority: "daemon-bootstrap",
				warnings: [],
				auth: {
					authenticated: true,
					keyId: "key-1",
					tenantId: "daemon",
					scopes: ["bridge:bootstrap"],
				},
				binding: {
					mode: "exec",
					project: "/repo",
					consumer: "takumi",
					clientId: "client-1",
				},
				session: {
					id: "session-1",
					created: false,
					lineageKey: "lineage-1",
					sessionReusePolicy: "reuse-canonical",
				},
				vertical: {
					contractVersion: 1,
					id: "takumi",
					label: "Takumi",
					description: "Primary runtime",
					preferredTransport: "daemon-rpc",
					authMode: "daemon-bridge-token",
					allowedTransports: ["daemon-rpc"],
					bundleIds: ["takumi"],
					availableBundleIds: ["takumi"],
					requestedBundleIds: ["takumi"],
					deniedBundleIds: [],
					consumer: "takumi",
					surface: "cli",
					canonical: true,
					degraded: false,
					resolutionSource: "bound-profile",
				},
				inventory: {
					contractVersion: 1,
					snapshotAt: 124,
					discoverySnapshotAt: 120,
					localRuntimeSnapshotAt: null,
					providerPriority: ["gemini"],
					lanePriority: ["cloud"],
					providers: [
						{
							id: "gemini",
							name: "Gemini",
							lane: "cloud",
							transport: "remote-api",
							available: true,
							authenticated: true,
							credentialAvailable: true,
							credentialSource: "env",
							modelCount: 1,
							models: [
								{
									id: "gemini-2.5-pro",
									name: "Gemini 2.5 Pro",
									available: true,
									health: "healthy",
									capabilities: ["chat"],
									contextWindow: 1048576,
									maxOutputTokens: 8192,
									costClass: "medium",
									source: "discovery",
								},
							],
							issues: [],
							runtime: null,
						},
					],
					stale: false,
					staleReason: null,
					warnings: [],
				},
				continuity: {
					contractVersion: 1,
					tracked: true,
					reattached: true,
					activeElsewhere: false,
					record: {
						contractVersion: 1,
						identityKey: "identity-1",
						verticalId: "takumi",
						consumer: "takumi",
						surface: "cli",
						channel: "daemon-socket",
						project: "/repo",
						sessionId: "session-1",
						sessionReusePolicy: "reuse-canonical",
						clientKey: "client-1",
						sessionLineageKey: "lineage-1",
						attachedClientId: "client-1",
						authFamily: "daemon-bridge-token",
						status: "active",
						state: "reattachable",
						requiredAction: "reattach-via-bridge.bootstrap",
						source: "durable-record",
						lastSeenAt: 123,
						lastDetachedAt: 120,
						updatedAt: 124,
					},
					plan: {
						contractVersion: 1,
						action: "reattach-via-bridge.bootstrap",
						activeElsewhere: false,
						shouldBootstrap: true,
						shouldResubscribe: true,
						shouldReplay: true,
						steps: ["bridge.bootstrap", "resubscribe live lanes"],
					},
				},
				route: null,
				routingDecision: null,
				lanes: [],
				capabilities: null,
			})),
		};

		const result = await daemonBootstrap(mockSocket as never, {
			mode: "exec",
			project: "/repo",
			consumer: "takumi",
		});

		expect(result?.continuity).toMatchObject({
			tracked: true,
			record: {
				sessionId: "session-1",
				requiredAction: "reattach-via-bridge.bootstrap",
			},
			plan: {
				action: "reattach-via-bridge.bootstrap",
				shouldBootstrap: true,
				shouldResubscribe: true,
				shouldReplay: true,
				steps: ["bridge.bootstrap", "resubscribe live lanes"],
			},
		});
	});

	it("refreshes durable lane truth with exact daemon params and multi-lane parsing", async () => {
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async () => ({
				contractVersion: 1,
				sessionId: "session-1",
				project: "/repo",
				primaryLaneKey: "primary",
				laneCount: 2,
				lanes: [buildLanePayload("worker", "worker"), buildLanePayload("primary", "primary")],
			})),
		};

		const result = await daemonRouteLanesRefresh(mockSocket as never, {
			sessionId: "session-1",
			project: "/repo",
			consumer: "takumi",
			refreshReason: "takumi.connect",
		});

		expect(mockSocket.call).toHaveBeenCalledWith("route.lanes.refresh", {
			sessionId: "session-1",
			project: "/repo",
			consumer: "takumi",
			refreshReason: "takumi.connect",
		});
		expect(result?.lanes[0]).toMatchObject({
			key: "worker",
			requestedPolicy: {
				hardProviderFamily: "ollama",
			},
			effectivePolicy: {
				privacyBoundary: "local-preferred",
			},
		});
	});

	it("reads stored lane truth with exact daemon params", async () => {
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async () => ({
				contractVersion: 1,
				sessionId: "session-1",
				project: "/repo",
				primaryLaneKey: "primary",
				laneCount: 2,
				lanes: [buildLanePayload("worker", "worker"), buildLanePayload("primary", "primary")],
			})),
		};

		const result = await daemonRouteLanesGet(mockSocket as never, {
			sessionId: "session-1",
			project: "/repo",
		});

		expect(mockSocket.call).toHaveBeenCalledWith("route.lanes.get", {
			sessionId: "session-1",
			project: "/repo",
		});
		expect(result?.primaryLaneKey).toBe("primary");
		expect(result?.lanes).toHaveLength(2);
	});
});
