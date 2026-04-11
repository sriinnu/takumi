import {
	ChitraguptaBridge,
	resolveVerticalRuntimeContract,
	VERTICAL_PROFILE_AUTH_MODES,
	type VerticalRegistryAuthContract,
	type VerticalRegistryContract,
} from "@takumi/bridge";
import { describe, expect, it, vi } from "vitest";

function buildVerticalRegistry(): VerticalRegistryContract {
	return {
		contractVersion: 1,
		bundles: [
			{
				id: "bootstrap-routing",
				label: "Bootstrap + routing",
				description: "Daemon-first bootstrap and routing surfaces.",
				methods: ["bridge.bootstrap", "route.resolve"],
			},
		],
		auth: {
			contractVersion: 1,
			daemonBearer: {
				presentation: "bearer",
				tokenSource: "~/.chitragupta/daemon.api-key",
				hashedAtRest: true,
				rawTokenOnDisk: true,
			},
			servePairing: {
				serveOnly: true,
				methods: ["qr", "numeric-code"],
				sessionToken: "jwt",
				notForDaemonRuntimeStartup: true,
			},
			verticalTokens: {
				verifierTenantPrefix: "vertical_verifier",
				bindingTenantPrefix: "vertical_binding",
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
				defaultBindingTtlMs: 3_600_000,
			},
		},
		profiles: [
			{
				id: "takumi",
				label: "Takumi",
				description: "Takumi runtime profile",
				preferredTransport: "daemon-rpc",
				authMode: "daemon-bridge-token",
				bundleIds: ["bootstrap-routing"],
			},
		],
		bindSubscribe: {
			contractVersion: 1,
			bind: {
				bootstrapMethod: "bridge.bootstrap",
				identifyMethod: "client.identify",
				sessionReuseMetadata: ["consumer", "project"],
			},
			subscribe: {
				transport: "daemon-rpc",
				notifierAvailable: true,
				notificationMethods: ["turn.added"],
				replay: {
					strategy: "token-and-cursor",
					tokenField: "replayToken",
					tokenSourceEndpoint: "/telemetry/watch",
					watchEndpoint: "/telemetry/watch",
					timelineEndpoint: "/telemetry/timeline",
					turnCursorMethod: "turn.list",
					turnCursorField: "cursor",
				},
				unsubscribe: {
					daemonRpc: "notifications.unsubscribe",
					httpWatch: "close-socket",
				},
				pullFallback: {
					httpWatch: "/telemetry/watch",
					httpTimeline: "/telemetry/timeline",
					httpInstances: "/telemetry/instances",
				},
				missedEventRecovery: {
					steps: ["reattach", "inspect timeline", "backfill turns"],
				},
				reattach: {
					resumeViaBootstrap: true,
					sessionIdentityKeys: ["sessionId", "consumer", "project"],
				},
			},
		},
	};
}

describe("Chitragupta vertical contract bridge", () => {
	it("exports the generated auth-mode guidance for vertical consumers", () => {
		expect(VERTICAL_PROFILE_AUTH_MODES).toContain("daemon-bridge-token");
		expect(VERTICAL_PROFILE_AUTH_MODES).toContain("serve-pairing-jwt");
	});

	it("reads the daemon-owned vertical registry in socket mode", async () => {
		const registry = buildVerticalRegistry();
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async () => registry),
		};
		const bridge = new ChitraguptaBridge({
			socketPath: "/tmp/test-chitragupta.sock",
		});

		// @ts-expect-error I am deliberately replacing the internal socket for a focused test.
		bridge._socket = mockSocket;
		// @ts-expect-error I am deliberately forcing socket mode for a focused test.
		bridge._socketMode = true;

		await expect(bridge.verticalRegistry()).resolves.toEqual(registry);
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.registry", {});
	});

	it("reads the daemon-owned vertical auth contract in socket mode", async () => {
		const auth = buildVerticalRegistry().auth satisfies VerticalRegistryAuthContract;
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async () => auth),
		};
		const bridge = new ChitraguptaBridge({
			socketPath: "/tmp/test-chitragupta.sock",
		});

		// @ts-expect-error I am deliberately replacing the internal socket for a focused test.
		bridge._socket = mockSocket;
		// @ts-expect-error I am deliberately forcing socket mode for a focused test.
		bridge._socketMode = true;

		await expect(bridge.verticalAuthDescribe()).resolves.toEqual(auth);
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.describe", {});
	});

	it("collapses registry plus auth into one actionable runtime contract", () => {
		const registry = buildVerticalRegistry();
		const runtime = resolveVerticalRuntimeContract(registry, registry.auth, "takumi");

		expect(runtime).toMatchObject({
			verticalId: "takumi",
			profile: expect.objectContaining({ authMode: "daemon-bridge-token" }),
			bundles: [expect.objectContaining({ id: "bootstrap-routing" })],
			runtime: expect.objectContaining({
				usesDaemonBridgeToken: true,
				allowsServePairing: false,
				daemonRuntimeStartupAllowed: true,
				supportsBindingTokens: true,
				supportsRotation: true,
				supportsRevocation: true,
				supportsIntrospection: true,
				supportsReplayRecovery: true,
				supportsReattach: true,
			}),
		});
	});

	it("reads one actionable vertical runtime contract in socket mode", async () => {
		const registry = buildVerticalRegistry();
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async (method: string) => (method === "vertical.auth.describe" ? registry.auth : registry)),
		};
		const bridge = new ChitraguptaBridge({
			socketPath: "/tmp/test-chitragupta.sock",
		});

		// @ts-expect-error I am deliberately replacing the internal socket for a focused test.
		bridge._socket = mockSocket;
		// @ts-expect-error I am deliberately forcing socket mode for a focused test.
		bridge._socketMode = true;

		await expect(bridge.verticalRuntimeContract("takumi")).resolves.toMatchObject({
			verticalId: "takumi",
			runtime: expect.objectContaining({
				usesDaemonBridgeToken: true,
				allowsServePairing: false,
			}),
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.registry", {});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.describe", {});
	});

	it("exposes the full vertical token lifecycle through bridge methods", async () => {
		const tokenRecord = {
			id: "key-1",
			key: "chg_test_masked",
			name: "takumi verifier",
			tenantId: "vertical:takumi",
			scopes: ["read", "write"],
			createdAt: 123,
			expiresAt: 456,
		};
		const mockSocket = {
			isConnected: true,
			call: vi.fn(async (method: string) => {
				switch (method) {
					case "vertical.auth.issue":
						return { kind: "verifier", verticalId: "takumi", key: "verifier-secret", record: tokenRecord };
					case "vertical.auth.exchange":
						return {
							kind: "binding",
							verticalId: "takumi",
							key: "binding-secret",
							record: { ...tokenRecord, id: "key-2", tenantId: "vertical-binding:takumi" },
							issuedForKeyId: "key-1",
							expiresAt: 789,
						};
					case "vertical.auth.rotate":
						return {
							kind: "verifier",
							verticalId: "takumi",
							key: "rotated-secret",
							record: { ...tokenRecord, id: "key-3" },
							replacedKeyId: "key-1",
							revokedPrevious: true,
						};
					case "vertical.auth.list":
						return { tokens: [{ kind: "verifier", verticalId: "takumi", record: tokenRecord }] };
					case "vertical.auth.introspect":
						return { found: true, token: { kind: "verifier", verticalId: "takumi", record: tokenRecord } };
					case "vertical.auth.revoke":
						return {
							revoked: true,
							keyId: "key-1",
							token: { kind: "verifier", verticalId: "takumi", record: tokenRecord },
						};
					default:
						throw new Error(`unexpected method ${method}`);
				}
			}),
		};
		const bridge = new ChitraguptaBridge({
			socketPath: "/tmp/test-chitragupta.sock",
		});

		// @ts-expect-error I am deliberately replacing the internal socket for a focused test.
		bridge._socket = mockSocket;
		// @ts-expect-error I am deliberately forcing socket mode for a focused test.
		bridge._socketMode = true;

		await expect(bridge.verticalAuthIssue("takumi", { name: "runtime verifier" })).resolves.toMatchObject({
			kind: "verifier",
			verticalId: "takumi",
			record: expect.objectContaining({ id: "key-1" }),
		});
		await expect(bridge.verticalAuthExchange({ ttlMs: 60_000 })).resolves.toMatchObject({
			kind: "binding",
			issuedForKeyId: "key-1",
		});
		await expect(bridge.verticalAuthRotate("key-1", { revokePrevious: true })).resolves.toMatchObject({
			replacedKeyId: "key-1",
			revokedPrevious: true,
		});
		await expect(bridge.verticalAuthList("takumi")).resolves.toMatchObject({
			tokens: [expect.objectContaining({ kind: "verifier", verticalId: "takumi" })],
		});
		await expect(bridge.verticalAuthIntrospect("key-1")).resolves.toMatchObject({
			found: true,
			token: expect.objectContaining({ verticalId: "takumi" }),
		});
		await expect(bridge.verticalAuthRevoke("key-1")).resolves.toMatchObject({
			revoked: true,
			keyId: "key-1",
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.issue", {
			verticalId: "takumi",
			name: "runtime verifier",
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.exchange", {
			ttlMs: 60_000,
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.rotate", {
			keyId: "key-1",
			revokePrevious: true,
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.list", {
			verticalId: "takumi",
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.introspect", {
			keyId: "key-1",
		});
		expect(mockSocket.call).toHaveBeenCalledWith("vertical.auth.revoke", {
			keyId: "key-1",
		});
	});
});
