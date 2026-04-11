import { describe, expect, it } from "vitest";
import { bootstrapChitraguptaForExec } from "../src/exec-bootstrap.js";

describe("exec bootstrap", () => {
	it("returns connected daemon bootstrap metadata and memory context", async () => {
		const result = await bootstrapChitraguptaForExec({
			cwd: "/repo/takumi",
			createBridge: () => ({
				isConnected: true,
				isSocketMode: true,
				connect: async () => undefined,
				disconnect: async () => undefined,
				bootstrap: async () => ({
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
					requestId: "req-1",
					traceId: null,
					taskId: "task-1",
					laneId: "lane-1",
					warnings: [],
					auth: {
						authenticated: true,
						keyId: "key-1",
						tenantId: "daemon",
						scopes: ["read", "write"],
					},
					binding: {
						mode: "exec",
						project: "/repo/takumi",
						consumer: "takumi",
						clientId: "client-1",
					},
					session: {
						id: "session-1",
						created: true,
						lineageKey: null,
						sessionReusePolicy: null,
					},
					route: null,
					routingDecision: {
						authority: "chitragupta",
						source: "route.resolve",
						routeClass: "coding.default",
						capability: "coding.general",
						selectedCapabilityId: "cap-1",
						provider: "openai",
						model: "gpt-4.1",
						requestedBudget: null,
						effectiveBudget: null,
						degraded: false,
						reasonCode: "",
						reason: null,
						policyTrace: [],
						fallbackChain: [],
						discoverableOnly: false,
						requestId: "req-1",
						traceId: null,
						snapshotAt: Date.now(),
						expiresAt: null,
						cacheScope: "request",
					},
					lanes: [
						{
							key: "primary",
							role: "primary",
							laneId: "lane-1",
							durableKey: "durable-1",
							snapshotAt: Date.now(),
							policy: {
								contractVersion: 1,
								role: "primary",
								preferLocal: null,
								allowCloud: true,
								maxCostClass: "medium",
								requireStreaming: true,
								hardProviderFamily: null,
								preferredProviderFamilies: ["openai"],
								toolAccess: "inherit",
								privacyBoundary: "cloud-ok",
								fallbackStrategy: "same-provider",
								tags: [],
							},
							requestedPolicy: {
								contractVersion: 1,
								role: "primary",
								preferLocal: null,
								allowCloud: true,
								maxCostClass: "medium",
								requireStreaming: true,
								hardProviderFamily: null,
								preferredProviderFamilies: ["openai"],
								toolAccess: "inherit",
								privacyBoundary: "cloud-ok",
								fallbackStrategy: "same-provider",
								tags: [],
							},
							effectivePolicy: {
								contractVersion: 1,
								role: "primary",
								preferLocal: null,
								allowCloud: true,
								maxCostClass: "medium",
								requireStreaming: true,
								hardProviderFamily: null,
								preferredProviderFamilies: ["openai"],
								toolAccess: "inherit",
								privacyBoundary: "cloud-ok",
								fallbackStrategy: "same-provider",
								tags: [],
							},
							constraintsApplied: { requireStreaming: true },
							policyHash: "policy-1",
							policyWarnings: [],
							route: null,
							routingDecision: {
								authority: "chitragupta",
								source: "route.resolve",
								routeClass: "coding.default",
								capability: "coding.general",
								selectedCapabilityId: "cap-1",
								provider: "openai",
								model: "gpt-4.1",
								requestedBudget: null,
								effectiveBudget: null,
								degraded: false,
								reasonCode: "",
								reason: null,
								policyTrace: [],
								fallbackChain: [],
								discoverableOnly: false,
								requestId: "req-1",
								traceId: null,
								snapshotAt: Date.now(),
								expiresAt: null,
								cacheScope: "request",
							},
						},
					],
				}),
				routeLanesGet: async () => null,
				routeLanesRefresh: async () => null,
				requestProviderCredential: async () => null,
				verticalRuntimeContract: async () => ({
					verticalId: "takumi",
					profile: {
						id: "takumi",
						label: "Takumi",
						description: "Takumi runtime profile",
						preferredTransport: "daemon-rpc",
						authMode: "daemon-bridge-token",
						bundleIds: ["runtime.bootstrap-routing"],
					},
					bundles: [
						{
							id: "runtime.bootstrap-routing",
							label: "Bootstrap And Routing",
							description: "Bootstrap surfaces",
							methods: ["bridge.bootstrap", "route.resolve"],
						},
					],
					auth: {
						contractVersion: 1,
						daemonBearer: {
							presentation: "Authorization: Bearer <token>",
							tokenSource: "~/.chitragupta/daemon.api-key",
							hashedAtRest: true,
							rawTokenOnDisk: true,
						},
						servePairing: {
							serveOnly: true,
							methods: ["qr"],
							sessionToken: "jwt",
							notForDaemonRuntimeStartup: true,
						},
						verticalTokens: {
							verifierTenantPrefix: "vertical:",
							bindingTenantPrefix: "vertical-binding:",
							issueMethod: "vertical.auth.issue",
							exchangeMethod: "vertical.auth.exchange",
							rotateMethod: "vertical.auth.rotate",
							listMethod: "vertical.auth.list",
							introspectMethod: "vertical.auth.introspect",
							revokeMethod: "vertical.auth.revoke",
							hashedAtRest: true,
							supportsRotation: true,
							supportsRevocation: true,
							supportsIntrospection: true,
							defaultBindingTtlMs: 900000,
						},
					},
					bindSubscribe: {
						contractVersion: 1,
						bind: {
							bootstrapMethod: "bridge.bootstrap",
							identifyMethod: "client.identify",
							sessionReuseMetadata: ["clientKey"],
						},
						subscribe: {
							transport: "daemon-rpc-notifier",
							notifierAvailable: true,
							notificationMethods: ["pattern_detected"],
							replay: {
								strategy: "token",
								tokenField: "fingerprint",
								tokenSourceEndpoint: "/telemetry/instances",
								watchEndpoint: "/telemetry/watch",
								timelineEndpoint: "/telemetry/timeline",
								turnCursorMethod: "turn.since",
								turnCursorField: "cursor",
							},
							unsubscribe: {
								daemonRpc: "returned-unsubscribe-callback",
								httpWatch: "abort",
							},
							pullFallback: {
								httpWatch: "/telemetry/watch",
								httpTimeline: "/telemetry/timeline",
								httpInstances: "/telemetry/instances",
							},
							missedEventRecovery: {
								steps: ["reattach-via-bridge.bootstrap"],
							},
							reattach: {
								resumeViaBootstrap: true,
								sessionIdentityKeys: ["clientKey"],
							},
						},
					},
					runtime: {
						usesDaemonBridgeToken: true,
						allowsServePairing: false,
						daemonRuntimeStartupAllowed: true,
						supportsBindingTokens: true,
						supportsRotation: true,
						supportsRevocation: true,
						supportsIntrospection: true,
						subscribeTransport: "daemon-rpc-notifier",
						supportsReplayRecovery: true,
						supportsReattach: true,
					},
				}),
				unifiedRecall: async () => [{ content: "Prefer NodeNext", score: 0.98, source: "memory", type: "fact" }],
				vasanaTendencies: async () => [
					{
						tendency: "prefers-tight-feedback",
						valence: "positive",
						strength: 0.91,
						stability: 0.88,
						predictiveAccuracy: 0.8,
						reinforcementCount: 4,
						description: "Runs focused tests after edits",
					},
				],
				healthStatus: async () => ({
					state: { sattva: 0.7, rajas: 0.2, tamas: 0.1 },
					dominant: "sattva",
					trend: { sattva: "stable", rajas: "falling", tamas: "falling" },
					alerts: [],
					history: [],
				}),
			}),
		});

		expect(result.connected).toBe(true);
		expect(result.transport).toBe("daemon-socket");
		expect(result.memoryEntries).toBe(1);
		expect(result.vasanaCount).toBe(1);
		expect(result.hasHealth).toBe(true);
		expect(result.memoryContext).toContain("Prefer NodeNext");
		expect(result.memoryContext).toContain("prefers-tight-feedback");
		expect(result.verticalContract?.profile.id).toBe("takumi");
		expect(result.warnings).toEqual([]);
	});

	it("degrades gracefully when the bridge cannot connect", async () => {
		const result = await bootstrapChitraguptaForExec({
			cwd: "/repo/takumi",
			createBridge: () => ({
				isConnected: false,
				isSocketMode: false,
				connect: async () => {
					throw new Error("spawn chitragupta-mcp ENOENT");
				},
				disconnect: async () => undefined,
				bootstrap: async () => null,
				routeLanesGet: async () => null,
				routeLanesRefresh: async () => null,
				requestProviderCredential: async () => null,
				verticalRuntimeContract: async () => null,
				unifiedRecall: async () => [],
				vasanaTendencies: async () => [],
				healthStatus: async () => null,
			}),
		});

		expect(result.connected).toBe(false);
		expect(result.degraded).toBe(true);
		expect(result.transport).toBe("unavailable");
		expect(result.summary).toContain("unavailable");
		expect(result.error?.message).toContain("ENOENT");
	});

	it("warns when the daemon-published vertical profile does not allow daemon startup", async () => {
		let bootstrapCalls = 0;
		let disconnectCalls = 0;
		const result = await bootstrapChitraguptaForExec({
			cwd: "/repo/takumi",
			createBridge: () => ({
				isConnected: true,
				isSocketMode: true,
				connect: async () => undefined,
				disconnect: async () => {
					disconnectCalls += 1;
				},
				bootstrap: async () => {
					bootstrapCalls += 1;
					return null;
				},
				routeLanesGet: async () => null,
				routeLanesRefresh: async () => null,
				requestProviderCredential: async () => null,
				verticalRuntimeContract: async () => ({
					verticalId: "takumi",
					profile: {
						id: "takumi",
						label: "Takumi",
						description: "Takumi runtime profile",
						preferredTransport: "http-attachment",
						authMode: "serve-pairing-jwt",
						bundleIds: [],
					},
					bundles: [],
					auth: {
						contractVersion: 1,
						daemonBearer: {
							presentation: "Authorization: Bearer <token>",
							tokenSource: "~/.chitragupta/daemon.api-key",
							hashedAtRest: true,
							rawTokenOnDisk: true,
						},
						servePairing: {
							serveOnly: true,
							methods: ["qr"],
							sessionToken: "jwt",
							notForDaemonRuntimeStartup: true,
						},
						verticalTokens: {
							verifierTenantPrefix: "vertical:",
							bindingTenantPrefix: "vertical-binding:",
							issueMethod: "vertical.auth.issue",
							exchangeMethod: "vertical.auth.exchange",
							rotateMethod: "vertical.auth.rotate",
							listMethod: "vertical.auth.list",
							introspectMethod: "vertical.auth.introspect",
							revokeMethod: "vertical.auth.revoke",
							hashedAtRest: true,
							supportsRotation: true,
							supportsRevocation: true,
							supportsIntrospection: true,
							defaultBindingTtlMs: 900000,
						},
					},
					bindSubscribe: {
						contractVersion: 1,
						bind: {
							bootstrapMethod: "bridge.bootstrap",
							identifyMethod: "client.identify",
							sessionReuseMetadata: [],
						},
						subscribe: {
							transport: "http-watch",
							notifierAvailable: false,
							notificationMethods: [],
							replay: {
								strategy: "token",
								tokenField: "fingerprint",
								tokenSourceEndpoint: "/telemetry/instances",
								watchEndpoint: "/telemetry/watch",
								timelineEndpoint: "/telemetry/timeline",
								turnCursorMethod: "turn.since",
								turnCursorField: "cursor",
							},
							unsubscribe: {
								daemonRpc: "returned-unsubscribe-callback",
								httpWatch: "abort",
							},
							pullFallback: {
								httpWatch: "/telemetry/watch",
								httpTimeline: "/telemetry/timeline",
								httpInstances: "/telemetry/instances",
							},
							missedEventRecovery: {
								steps: ["backfill-turns-via-turn.since"],
							},
							reattach: {
								resumeViaBootstrap: true,
								sessionIdentityKeys: [],
							},
						},
					},
					runtime: {
						usesDaemonBridgeToken: false,
						allowsServePairing: true,
						daemonRuntimeStartupAllowed: false,
						supportsBindingTokens: true,
						supportsRotation: true,
						supportsRevocation: true,
						supportsIntrospection: true,
						subscribeTransport: "http-watch",
						supportsReplayRecovery: true,
						supportsReattach: true,
					},
				}),
				unifiedRecall: async () => [],
				vasanaTendencies: async () => [],
				healthStatus: async () => null,
			}),
		});

		expect(bootstrapCalls).toBe(0);
		expect(disconnectCalls).toBe(1);
		expect(result.connected).toBe(false);
		expect(result.degraded).toBe(true);
		expect(result.transport).toBe("unavailable");
		expect(result.summary).toContain("requires serve pairing");
		expect(result.warnings).toContain("Vertical profile takumi does not allow daemon runtime startup.");
		expect(result.warnings).toContain("Vertical profile takumi does not advertise daemon bridge-token auth.");
	});
});
