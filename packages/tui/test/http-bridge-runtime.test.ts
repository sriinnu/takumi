import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { ExtensionUiStore } from "../src/extension-ui-store.js";
import {
	buildAgentStateSnapshot,
	buildFleetSummary,
	buildOperatorAlerts,
	buildSessionSummary,
	startDesktopBridge,
} from "../src/http-bridge/http-bridge-runtime.js";
import { AppState } from "../src/state.js";

async function reserveLoopbackPort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to reserve loopback port"));
				return;
			}
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

function createState(): AppState {
	const state = new AppState();
	state.sessionId.value = "session-build-window";
	state.canonicalSessionId.value = "canon-build-window";
	state.provider.value = "anthropic";
	state.model.value = "claude-sonnet-4-20250514";
	state.totalInputTokens.value = 1_000;
	state.totalOutputTokens.value = 500;
	state.totalCost.value = 0.12;
	state.turnCount.value = 7;
	state.contextPercent.value = 88;
	state.contextPressure.value = "near_limit";
	state.chitraguptaConnected.value = true;
	state.messages.value = [
		{
			id: "user-1",
			role: "user",
			content: [{ type: "text", text: "Fix the regression" }],
			timestamp: 1000,
			sessionTurn: true,
		},
		{
			id: "assistant-1",
			role: "assistant",
			content: [{ type: "text", text: "Working on it." }],
			timestamp: 2000,
			sessionTurn: true,
		},
		{
			id: "user-2",
			role: "user",
			content: [{ type: "text", text: "Also update the docs" }],
			timestamp: 3000,
			sessionTurn: true,
		},
	];
	state.chitraguptaSync.value = {
		status: "failed",
		lastSyncedMessageId: "assistant-1",
		lastSyncedMessageTimestamp: 2000,
		lastSyncedAt: 2500,
		lastError: "bridge unavailable during replay",
		lastAttemptedMessageId: "user-2",
		lastAttemptedMessageTimestamp: 3000,
		lastFailedMessageId: "user-2",
		lastFailedMessageTimestamp: 3000,
	};
	state.routingDecisions.value = [
		{
			request: { consumer: "takumi", sessionId: "session-build-window", capability: "coding.patch-cheap" },
			selected: { id: "lane-main", providerFamily: "anthropic" } as never,
			reason: "Selected primary lane",
			fallbackChain: ["lane-fallback"],
			policyTrace: ["selected primary lane"],
			degraded: false,
		},
	] as never;
	return state;
}

describe("http-bridge-runtime helpers", () => {
	it("buildAgentStateSnapshot includes routing and approval metadata", () => {
		const state = createState();
		const extensionUiStore = new ExtensionUiStore();
		const tokmeter = {
			source: "tokmeter-core" as const,
			projectQuery: "takumi",
			refreshedAt: Date.now(),
			matchedProjects: ["takumi"],
			totalTokens: 4_200,
			totalCostUsd: 1.24,
			todayTokens: 1_200,
			todayCostUsd: 0.28,
			activeDays: 5,
			totalRecords: 9,
			topModels: [],
			topProviders: [],
			recentDaily: [],
			note: null,
		};
		state.pendingPermission.value = {
			tool: "write_file",
			args: { filePath: "README.md" },
			resolve: () => undefined,
		};
		state.continuityGrants.value = [
			{
				grantId: "grant-1",
				canonicalSessionId: "canon-build-window",
				issuerRuntimeId: "runtime-a",
				kind: "phone",
				initialRole: "observer",
				nonce: "nonce-1",
				expiresAt: Date.now() + 60_000,
				transportRef: "http://127.0.0.1:3100/continuity",
			},
		];
		state.continuityLease.value = {
			canonicalSessionId: "canon-build-window",
			epoch: 3,
			state: "active",
			holderRuntimeId: "runtime-a",
			reason: null,
		};
		void extensionUiStore.requestPick(
			[
				{ label: "Alpha", value: "a" },
				{ label: "Beta", value: "b" },
			],
			"Select task",
		);
		extensionUiStore.setWidget("status", () => ["ready", "steady"]);

		const snapshot = buildAgentStateSnapshot(state, extensionUiStore, tokmeter);
		expect(snapshot.bridgeConnected).toBe(true);
		expect(snapshot.contextPressure).toBe("near_limit");
		expect(snapshot.routing).toMatchObject({
			capability: "coding.patch-cheap",
			authority: "engine",
			enforcement: "same-provider",
			laneCount: 1,
		});
		expect(snapshot.approval).toMatchObject({
			pendingCount: 1,
			tool: "write_file",
		});
		expect(snapshot.sync).toMatchObject({
			canonicalSessionId: "canon-build-window",
			status: "failed",
			pendingLocalTurns: 1,
			lastSyncError: "bridge unavailable during replay",
			lastSyncedMessageId: "assistant-1",
			lastSyncedMessageTimestamp: 2000,
			lastAttemptedMessageId: "user-2",
			lastAttemptedMessageTimestamp: 3000,
			lastFailedMessageId: "user-2",
			lastFailedMessageTimestamp: 3000,
			lastSyncedAt: 2500,
		});
		expect(snapshot.usage).toMatchObject({
			turnCount: 7,
			totalTokens: 1_500,
			totalCostUsd: 0.12,
		});
		expect(snapshot.extensionUi).toMatchObject({
			prompt: {
				kind: "pick",
				title: "Select task",
				optionCount: 2,
				options: [
					{ index: 0, label: "Alpha" },
					{ index: 1, label: "Beta" },
				],
			},
			widgets: [{ key: "status", previewLines: ["ready", "steady"], truncated: false }],
		});
		expect(snapshot.tokmeter).toMatchObject({
			projectQuery: "takumi",
			totalCostUsd: 1.24,
			todayCostUsd: 0.28,
		});
		expect(snapshot.continuity).toMatchObject({
			grantCount: 1,
			attachedPeerCount: 0,
			lease: {
				state: "active",
				epoch: 3,
				holderRuntimeId: "runtime-a",
			},
		});
		expect(snapshot.continuity?.peers).toBeUndefined();
		expect(snapshot.continuity?.events).toBeUndefined();
	});

	it("startDesktopBridge exposes the live continuity endpoint", async () => {
		const state = createState();
		state.continuityGrants.value = [
			{
				grantId: "grant-live",
				canonicalSessionId: "canon-build-window",
				issuerRuntimeId: "runtime-a",
				kind: "phone",
				initialRole: "observer",
				nonce: "nonce-live",
				expiresAt: Date.now() + 60_000,
				transportRef: "http://127.0.0.1:3100/continuity/redeem",
			},
		];

		const originalPort = process.env.TAKUMI_BRIDGE_PORT;
		const originalToken = process.env.TAKUMI_BRIDGE_TOKEN;
		const port = await reserveLoopbackPort();
		process.env.TAKUMI_BRIDGE_PORT = String(port);
		delete process.env.TAKUMI_BRIDGE_TOKEN;

		const bridge = await startDesktopBridge(state, null, undefined, {
			tokmeterOptions: {
				createCore: async () => {
					throw new Error("no tokmeter in test");
				},
			},
		});
		try {
			expect(bridge).not.toBeNull();
			const response = await fetch(`http://127.0.0.1:${port}/continuity`);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				continuity: {
					grantCount: 1,
					attachedPeerCount: 0,
					grants: [
						{
							grantId: "grant-live",
							kind: "phone",
							initialRole: "observer",
						},
					],
					lease: null,
				},
			});
		} finally {
			await bridge?.stop();
			if (originalPort === undefined) delete process.env.TAKUMI_BRIDGE_PORT;
			else process.env.TAKUMI_BRIDGE_PORT = originalPort;
			if (originalToken === undefined) delete process.env.TAKUMI_BRIDGE_TOKEN;
			else process.env.TAKUMI_BRIDGE_TOKEN = originalToken;
		}
	});

	it("redeems and detaches companions through the live bridge while /latest stays summary-only", async () => {
		const state = createState();
		state.continuityGrants.value = [
			{
				grantId: "grant-peer",
				canonicalSessionId: "canon-build-window",
				issuerRuntimeId: "runtime-a",
				kind: "phone",
				initialRole: "observer",
				nonce: "nonce-peer",
				expiresAt: Date.now() + 60_000,
				transportRef: "http://127.0.0.1:3100/continuity/redeem",
			},
		];

		const originalPort = process.env.TAKUMI_BRIDGE_PORT;
		const originalToken = process.env.TAKUMI_BRIDGE_TOKEN;
		const port = await reserveLoopbackPort();
		process.env.TAKUMI_BRIDGE_PORT = String(port);
		delete process.env.TAKUMI_BRIDGE_TOKEN;

		const bridge = await startDesktopBridge(state, null, undefined, {
			tokmeterOptions: {
				createCore: async () => {
					throw new Error("no tokmeter in test");
				},
			},
		});
		try {
			expect(bridge).not.toBeNull();

			const redeemResponse = await fetch(`http://127.0.0.1:${port}/continuity/redeem`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ grantId: "grant-peer", nonce: "nonce-peer", kind: "phone" }),
			});
			expect(redeemResponse.status).toBe(200);
			const redeemed = (await redeemResponse.json()) as {
				peer: { peerId: string };
				companionSession: { token: string };
			};
			expect(redeemed.peer.peerId).toBeTruthy();
			expect(redeemed.companionSession.token).toBeTruthy();

			const detailResponse = await fetch(`http://127.0.0.1:${port}/continuity`);
			expect(detailResponse.status).toBe(200);
			const detail = (await detailResponse.json()) as {
				continuity: {
					attachedPeerCount: number;
					peers?: Array<{ peerId: string }>;
					events?: Array<{ kind: string }>;
				};
			};
			expect(detail.continuity.attachedPeerCount).toBe(1);
			expect(detail.continuity.peers?.[0]?.peerId).toBe(redeemed.peer.peerId);
			expect(detail.continuity.events?.[0]?.kind).toBe("grant-redeemed");

			const latestResponse = await fetch(`http://127.0.0.1:${port}/latest/${process.pid}`);
			expect(latestResponse.status).toBe(200);
			const latest = (await latestResponse.json()) as {
				continuity?: {
					attachedPeerCount: number;
					peers?: unknown[];
					events?: unknown[];
				};
			};
			expect(latest.continuity?.attachedPeerCount).toBe(1);
			expect(latest.continuity?.peers).toBeUndefined();
			expect(latest.continuity?.events).toBeUndefined();

			const heartbeatResponse = await fetch(
				`http://127.0.0.1:${port}/continuity/peers/${redeemed.peer.peerId}/heartbeat`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ companionToken: redeemed.companionSession.token }),
				},
			);
			expect(heartbeatResponse.status).toBe(200);

			const detachResponse = await fetch(`http://127.0.0.1:${port}/continuity/peers/${redeemed.peer.peerId}/detach`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ companionToken: redeemed.companionSession.token }),
			});
			expect(detachResponse.status).toBe(200);
			const detached = (await detachResponse.json()) as {
				continuity?: { attachedPeerCount: number; events?: Array<{ kind: string }> };
			};
			expect(detached.continuity?.attachedPeerCount).toBe(0);
			expect(detached.continuity?.events?.[0]?.kind).toBe("peer-detached");
		} finally {
			await bridge?.stop();
			if (originalPort === undefined) delete process.env.TAKUMI_BRIDGE_PORT;
			else process.env.TAKUMI_BRIDGE_PORT = originalPort;
			if (originalToken === undefined) delete process.env.TAKUMI_BRIDGE_TOKEN;
			else process.env.TAKUMI_BRIDGE_TOKEN = originalToken;
		}
	});

	it("buildSessionSummary maps state to observability summary", () => {
		const state = createState();
		const summary = buildSessionSummary(state);
		expect(summary.sessionId).toBe("session-build-window");
		expect(summary.contextPercent).toBe(88);
		expect(summary.pressure).toBe("near_limit");
		expect(summary.provider).toBe("anthropic");
		expect(summary.costUsd).toBe(0.12);
	});

	it("buildOperatorAlerts emits approval, context, sync, and anomaly alerts", () => {
		const state = createState();
		state.pendingPermission.value = {
			tool: "shell",
			args: { command: "rm -rf /tmp/test" },
			resolve: () => undefined,
		};
		state.chitraguptaAnomaly.value = {
			severity: "critical",
			details: "Repeated tool failures detected",
			suggestion: "Review recent commands",
			at: Date.now(),
		};

		const alerts = buildOperatorAlerts(state);
		expect(alerts.some((alert) => alert.kind === "approval_pressure")).toBe(true);
		expect(alerts.some((alert) => alert.kind === "context_pressure")).toBe(true);
		expect(alerts).toContainEqual(
			expect.objectContaining({
				id: "sync-failed",
				kind: "sync_failure",
				severity: "warning",
				source: "session-build-window",
			}),
		);
		expect(alerts.find((alert) => alert.id === "sync-failed")?.message).toContain("stalled on user-2");
		expect(alerts.some((alert) => alert.source === "session-build-window")).toBe(true);
	});

	it("buildOperatorAlerts emits cost alerts for burn-rate and budget pressure", () => {
		const state = createState();
		state.setCostSnapshot({
			totalUsd: 0.12,
			totalInputTokens: 1000,
			totalOutputTokens: 500,
			turns: [],
			ratePerMinute: 0.15,
			projectedUsd: 1.62,
			budgetFraction: 0.92,
			alertLevel: "critical",
			avgCostPerTurn: 0.12,
			elapsedSeconds: 45,
		});

		const alerts = buildOperatorAlerts(state);
		expect(alerts).toContainEqual(
			expect.objectContaining({
				id: "cost-spike-critical",
				kind: "cost_spike",
				severity: "critical",
				source: "session-build-window",
			}),
		);
		expect(alerts.find((alert) => alert.id === "cost-spike-critical")?.message).toContain("92% budget");
	});

	it("preserves degraded operator truth after route and sync surfaces recover", () => {
		const state = createState();
		state.routingDecisions.value = [
			{
				request: { consumer: "takumi", sessionId: "session-build-window", capability: "coding.patch-cheap" },
				selected: { id: "lane-main", providerFamily: "anthropic" } as never,
				reason: "Primary lane recovered",
				fallbackChain: [],
				policyTrace: ["selected primary lane"],
				degraded: false,
			},
		] as never;
		state.chitraguptaSync.value = {
			status: "ready",
			lastSyncedMessageId: "user-2",
			lastSyncedMessageTimestamp: 3000,
			lastSyncedAt: 3500,
		};
		state.degradedExecutionContext.value = {
			firstDetectedAt: 1000,
			lastUpdatedAt: 3500,
			sources: [
				{
					kind: "route_degraded",
					reason: "Primary lane fell back to degraded routing",
					firstDetectedAt: 1000,
					lastDetectedAt: 2000,
					capability: "coding.patch-cheap",
					authority: "engine",
					fallbackChain: ["lane-fallback"],
				},
				{
					kind: "sync_failure",
					reason: "bridge unavailable during replay",
					firstDetectedAt: 2500,
					lastDetectedAt: 3000,
					status: "failed",
					lastFailedMessageId: "user-2",
					pendingLocalTurns: 1,
				},
			],
		};

		const snapshot = buildAgentStateSnapshot(state);
		const alerts = buildOperatorAlerts(state);
		const session = buildSessionSummary(state);

		expect(snapshot.routing).toMatchObject({ authority: "engine", degraded: false });
		expect(session.degraded).toBe(true);
		expect(alerts.find((alert) => alert.id === "routing-degraded")?.message).toContain(
			"Primary lane fell back to degraded routing",
		);
		expect(alerts.find((alert) => alert.id === "sync-failed")?.message).toContain("stalled on user-2");
	});

	it("buildFleetSummary aggregates active session state", () => {
		const state = createState();
		const fleet = buildFleetSummary(state);
		expect(fleet.totalAgents).toBe(1);
		expect(fleet.totalCostUsd).toBeCloseTo(0.12);
		expect(fleet.sessions).toHaveLength(1);
		expect(fleet.sessions[0]?.sessionId).toBe("session-build-window");
	});
});
