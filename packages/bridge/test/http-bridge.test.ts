import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpBridgeServer } from "../src/http-bridge.js";

describe("HttpBridgeServer", () => {
	let bridge: HttpBridgeServer;

	afterEach(async () => {
		if (bridge) {
			await bridge.stop();
		}
	});

	it("should start and stop the server smoothly", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();
		expect((bridge as any).server).toBeDefined();
		await bridge.stop();
		expect((bridge as any).server).toBeNull();
	});

	it("should serve GET /status", async () => {
		const getStatus = vi.fn().mockResolvedValue({ status: "all good" });
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getStatus });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/status",
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: "all good" });
		expect(getStatus).toHaveBeenCalled();
	});

	it("should serve GET /continuity", async () => {
		const getContinuityState = vi.fn().mockResolvedValue({
			grantCount: 1,
			attachedPeerCount: 0,
			grants: [
				{
					grantId: "grant-1",
					kind: "phone",
					initialRole: "observer",
					expiresAt: 123456,
					transportRef: "http://127.0.0.1:3100/continuity",
				},
			],
			lease: null,
		});
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getContinuityState });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/continuity",
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({
			continuity: {
				grantCount: 1,
				attachedPeerCount: 0,
				grants: [
					{
						grantId: "grant-1",
						kind: "phone",
						initialRole: "observer",
						expiresAt: 123456,
						transportRef: "http://127.0.0.1:3100/continuity",
					},
				],
				lease: null,
			},
		});
		expect(getContinuityState).toHaveBeenCalledOnce();
	});

	it("should return 501 for GET /continuity when not configured", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/continuity",
		});

		expect(res.statusCode).toBe(501);
		expect(res.json().error).toContain("Continuity state not configured");
	});

	it("should allow companion continuity redemption without the bridge bearer token", async () => {
		const redeemContinuityGrant = vi.fn().mockResolvedValue({
			success: true,
			peer: {
				peerId: "peer-1",
				kind: "phone",
				role: "observer",
				attachedAt: 123400,
				lastSeenAt: 123400,
			},
			continuity: {
				grantCount: 0,
				attachedPeerCount: 1,
				grants: [],
				lease: null,
				peers: [
					{
						peerId: "peer-1",
						kind: "phone",
						role: "observer",
						attachedAt: 123400,
						lastSeenAt: 123400,
					},
				],
			},
			companionSession: {
				token: "companion-token",
				expiresAt: 124000,
			},
		});
		bridge = new HttpBridgeServer({
			port: 0,
			host: "127.0.0.1",
			bearerToken: "secret",
			cidrAllowlist: ["192.168.1.5/32", "127.0.0.1/32"],
			redeemContinuityGrant,
		});
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "POST",
			url: "/continuity/redeem",
			remoteAddress: "192.168.1.5",
			payload: { grantId: "grant-1", nonce: "nonce-1", kind: "phone" },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json().peer.peerId).toBe("peer-1");
		expect(res.json().companionSession.token).toBe("companion-token");
		expect(redeemContinuityGrant).toHaveBeenCalledWith({ grantId: "grant-1", nonce: "nonce-1", kind: "phone" });
	});

	it("should heartbeat and detach continuity peers through dedicated routes", async () => {
		const heartbeatContinuityPeer = vi.fn().mockResolvedValue({
			success: true,
			peer: {
				peerId: "peer-1",
				kind: "phone",
				role: "observer",
				attachedAt: 123400,
				lastSeenAt: 123430,
			},
		});
		const detachContinuityPeer = vi.fn().mockResolvedValue({
			success: true,
			continuity: {
				grantCount: 0,
				attachedPeerCount: 0,
				grants: [],
				lease: null,
				events: [
					{
						eventId: "evt-1",
						kind: "peer-detached",
						occurredAt: 123500,
						peerId: "peer-1",
					},
				],
			},
		});
		bridge = new HttpBridgeServer({
			port: 0,
			host: "127.0.0.1",
			heartbeatContinuityPeer,
			detachContinuityPeer,
		});
		await bridge.start();

		const app = (bridge as any).server;
		let res = await app.inject({
			method: "POST",
			url: "/continuity/peers/peer-1/heartbeat",
			payload: { companionToken: "companion-token" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().peer.lastSeenAt).toBe(123430);
		expect(heartbeatContinuityPeer).toHaveBeenCalledWith({ peerId: "peer-1", companionToken: "companion-token" });

		res = await app.inject({
			method: "POST",
			url: "/continuity/peers/peer-1/detach",
			payload: { companionToken: "companion-token" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().continuity.attachedPeerCount).toBe(0);
		expect(detachContinuityPeer).toHaveBeenCalledWith({ peerId: "peer-1", companionToken: "companion-token" });
	});

	it("should serve POST /send", async () => {
		const onSend = vi.fn().mockResolvedValue(undefined);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", onSend });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "POST",
			url: "/send",
			payload: { text: "hello" },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ success: true });
		expect(onSend).toHaveBeenCalledWith("hello");
	});

	it("should return 400 for bad POST /send body", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "POST",
			url: "/send",
			payload: { notText: "hello" },
		});

		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/Missing text property/);
	});

	it("should serve GET /watch", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/watch?timeout_ms=10", // Fast timeout for test
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ changes: false, fingerprint: 0 });
	});

	it("should serve GET /latest/:pid without callback", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/latest/12345",
		});

		expect(res.statusCode).toBe(501);
		expect(res.json().error).toContain("not configured");
	});

	it("should enforce bearer token for non-loopback IPs", async () => {
		bridge = new HttpBridgeServer({
			port: 0,
			host: "127.0.0.1",
			bearerToken: "secret",
			cidrAllowlist: ["192.168.1.5/32", "127.0.0.1/32"],
		});
		await bridge.start();

		const app = (bridge as any).server;

		// Without token
		let res = await app.inject({
			method: "GET",
			url: "/status",
			remoteAddress: "192.168.1.5",
		});
		expect(res.statusCode).toBe(401);
		expect(res.json().error).toMatch(/Missing or invalid token/);

		// With invalid token
		res = await app.inject({
			method: "GET",
			url: "/status",
			remoteAddress: "192.168.1.5",
			headers: { authorization: "Bearer wrong" },
		});
		expect(res.statusCode).toBe(401);
		expect(res.json().error).toMatch(/Invalid token/);

		// With valid token
		res = await app.inject({
			method: "GET",
			url: "/status",
			remoteAddress: "192.168.1.5",
			headers: { authorization: "Bearer secret" },
		});
		expect(res.statusCode).toBe(200);
	});

	it("should deny IPs not in allowlist", async () => {
		bridge = new HttpBridgeServer({
			port: 0,
			host: "127.0.0.1",
			cidrAllowlist: ["10.0.0.0/8"],
		});
		await bridge.start();

		const app = (bridge as any).server;

		const res = await app.inject({
			method: "GET",
			url: "/status",
			remoteAddress: "192.168.1.5",
		});
		expect(res.statusCode).toBe(403);
		expect(res.json().error).toMatch(/IP not in allowlist/);
	});

	// ── /watch long-polling ───────────────────────────────────────────────

	it("should return changes: false on /watch timeout", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/watch?timeout_ms=50&fingerprint=0",
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.changes).toBe(false);
		expect(typeof body.fingerprint).toBe("number");
	});

	it("should return changes: true on /watch when state changes", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;

		// Notify state change — this bumps the fingerprint
		bridge.notifyStateChange();

		const res = await app.inject({
			method: "GET",
			url: "/watch?fingerprint=0",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().changes).toBe(true);
	});

	// ── /agents ───────────────────────────────────────────────────────────

	it("should return agent list from listAgents callback", async () => {
		const listAgents = vi.fn().mockResolvedValue([1234, 5678]);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", listAgents });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/agents" });
		expect(res.statusCode).toBe(200);
		expect(res.json().agents).toEqual([1234, 5678]);
	});

	it("should fallback to current PID when listAgents not provided", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/agents" });
		expect(res.statusCode).toBe(200);
		expect(res.json().agents).toEqual([process.pid]);
	});

	// ── /latest/:pid ──────────────────────────────────────────────────────

	it("should return agent state from getAgentState callback", async () => {
		const state = {
			pid: 1234,
			activity: "working",
			model: "claude-sonnet",
			sessionId: "abc",
			lastAssistantText: "Editing file...",
			toolsInFlight: ["write_file"],
			contextPercent: 42,
			extensionUi: {
				prompt: {
					kind: "confirm",
					title: "Confirm",
					message: "Proceed?",
				},
				widgets: [{ key: "status", previewLines: ["ready"], truncated: false }],
			},
			updatedAt: Date.now(),
		};
		const getAgentState = vi.fn().mockResolvedValue(state);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getAgentState });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/latest/1234" });
		expect(res.statusCode).toBe(200);
		expect(res.json().activity).toBe("working");
		expect(res.json().extensionUi.prompt.message).toBe("Proceed?");
		expect(getAgentState).toHaveBeenCalledWith(1234);
	});

	it("should resolve extension prompts through the bridge", async () => {
		const respondExtensionPrompt = vi.fn().mockResolvedValue({ success: true });
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", respondExtensionPrompt });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "POST",
			url: "/extension-ui/respond",
			payload: { action: "pick", index: 1 },
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ success: true });
		expect(respondExtensionPrompt).toHaveBeenCalledWith({ action: "pick", index: 1 });
	});

	it("should return 404 when agent not found", async () => {
		const getAgentState = vi.fn().mockResolvedValue(null);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getAgentState });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/latest/9999" });
		expect(res.statusCode).toBe(404);
	});

	it("should return 501 when getAgentState not configured", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/latest/1234" });
		expect(res.statusCode).toBe(501);
	});

	it("should return 400 for invalid PID", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/latest/notanumber" });
		expect(res.statusCode).toBe(400);
	});

	// ── /sessions ─────────────────────────────────────────────────────────

	it("should return session summaries from getSessionList callback", async () => {
		const getSessionList = vi.fn().mockResolvedValue([
			{ id: "sess-1", title: "Fix auth", timestamp: 123456, turns: 8 },
			{ id: "sess-2", title: "Review docs", timestamp: 123999, turns: 4 },
		]);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getSessionList });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/sessions?limit=10" });
		expect(res.statusCode).toBe(200);
		expect(res.json().sessions).toHaveLength(2);
		expect(getSessionList).toHaveBeenCalledWith(10);
	});

	it("should return 501 when getSessionList is not configured", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/sessions" });
		expect(res.statusCode).toBe(501);
	});

	it("should return session detail from getSessionDetail callback", async () => {
		const getSessionDetail = vi.fn().mockResolvedValue({
			id: "sess-1",
			title: "Fix auth",
			turns: [{ role: "user", content: "debug login", timestamp: 123456 }],
		});
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getSessionDetail });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/sessions/sess-1" });
		expect(res.statusCode).toBe(200);
		expect(res.json().title).toBe("Fix auth");
		expect(getSessionDetail).toHaveBeenCalledWith("sess-1");
	});

	it("should return 404 when session detail is missing", async () => {
		const getSessionDetail = vi.fn().mockResolvedValue(null);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getSessionDetail });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/sessions/missing" });
		expect(res.statusCode).toBe(404);
	});

	// ── /approvals ───────────────────────────────────────────────────────

	it("should return approvals from getPendingApprovals callback", async () => {
		const getPendingApprovals = vi.fn().mockResolvedValue([
			{
				id: "apr-1",
				tool: "write_file",
				argsSummary: '{"filePath":"README.md"}',
				createdAt: 123456,
				active: true,
			},
		]);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getPendingApprovals });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/approvals" });
		expect(res.statusCode).toBe(200);
		expect(res.json().approvals).toHaveLength(1);
		expect(getPendingApprovals).toHaveBeenCalledOnce();
	});

	it("should submit approval decisions", async () => {
		const decideApproval = vi.fn().mockResolvedValue(true);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", decideApproval });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "POST", url: "/approvals/apr-1/approve" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ success: true });
		expect(decideApproval).toHaveBeenCalledWith("apr-1", "approved");
	});

	it("should reject invalid approval decisions", async () => {
		const decideApproval = vi.fn().mockResolvedValue(true);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", decideApproval });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "POST", url: "/approvals/apr-1/maybe" });
		expect(res.statusCode).toBe(400);
	});

	// ── /artifacts ───────────────────────────────────────────────────────

	it("should return artifacts from getArtifacts callback", async () => {
		const getArtifacts = vi.fn().mockResolvedValue([
			{
				artifactId: "art-1",
				kind: "summary",
				producer: "takumi.tui",
				summary: "Completed task",
				createdAt: new Date(123456).toISOString(),
				promoted: false,
				sessionId: "sess-1",
			},
		]);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getArtifacts });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/artifacts?sessionId=sess-1&limit=5" });
		expect(res.statusCode).toBe(200);
		expect(res.json().artifacts).toHaveLength(1);
		expect(getArtifacts).toHaveBeenCalledWith("sess-1", undefined, 5);
	});

	it("should return artifact detail from getArtifact callback", async () => {
		const getArtifact = vi.fn().mockResolvedValue({
			artifactId: "art-1",
			kind: "diff",
			producer: "takumi.tui",
			summary: "Patch preview",
			createdAt: new Date(123456).toISOString(),
			promoted: false,
			body: "diff --git a/a.ts b/a.ts",
		});
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getArtifact });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/artifacts/art-1" });
		expect(res.statusCode).toBe(200);
		expect(res.json().artifactId).toBe("art-1");
		expect(getArtifact).toHaveBeenCalledWith("art-1");
	});

	it("should update artifact promotion state", async () => {
		const setArtifactPromoted = vi.fn().mockResolvedValue(true);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", setArtifactPromoted });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "POST",
			url: "/artifacts/art-1/promote",
			payload: { promoted: true },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ success: true, promoted: true });
		expect(setArtifactPromoted).toHaveBeenCalledWith("art-1", true);
	});

	it("should return repo diff snapshot from getRepoDiff callback", async () => {
		const getRepoDiff = vi.fn().mockResolvedValue({
			branch: "main",
			isClean: false,
			stagedFiles: ["a.ts"],
			modifiedFiles: ["b.ts"],
			untrackedFiles: [],
			stagedDiff: "diff --git a/a.ts b/a.ts",
			workingDiff: "diff --git a/b.ts b/b.ts",
		});
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getRepoDiff });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/repo/diff" });
		expect(res.statusCode).toBe(200);
		expect(res.json().branch).toBe("main");
		expect(getRepoDiff).toHaveBeenCalledOnce();
	});

	it("should interrupt and refresh agents via callbacks", async () => {
		const onInterrupt = vi.fn().mockResolvedValue(true);
		const onRefresh = vi.fn().mockResolvedValue(true);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", onInterrupt, onRefresh });
		await bridge.start();

		const app = (bridge as any).server;
		let res = await app.inject({ method: "POST", url: "/agent/1234/interrupt" });
		expect(res.statusCode).toBe(200);
		expect(onInterrupt).toHaveBeenCalledWith(1234);

		res = await app.inject({ method: "POST", url: "/agent/1234/refresh" });
		expect(res.statusCode).toBe(200);
		expect(onRefresh).toHaveBeenCalledWith(1234);
	});

	it("should manage runtime lifecycle routes", async () => {
		const runtime = {
			runtimeId: "rt-1",
			pid: 4321,
			state: "running",
			startedAt: 123456,
			cwd: "/tmp/project",
			logFile: "/tmp/project/runtime.log",
		};
		const listRuntimes = vi.fn().mockResolvedValue([runtime]);
		const onStartRuntime = vi.fn().mockResolvedValue(runtime);
		const stopRuntime = vi.fn().mockResolvedValue(true);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", listRuntimes, onStartRuntime, stopRuntime });
		await bridge.start();

		const app = (bridge as any).server;
		let res = await app.inject({ method: "GET", url: "/runtime/list" });
		expect(res.statusCode).toBe(200);
		expect(res.json().runtimes).toHaveLength(1);

		res = await app.inject({
			method: "POST",
			url: "/runtime/start",
			payload: { sessionId: "sess-1", provider: "anthropic", model: "claude-sonnet" },
		});
		expect(res.statusCode).toBe(201);
		expect(onStartRuntime).toHaveBeenCalledWith({ sessionId: "sess-1", provider: "anthropic", model: "claude-sonnet" });

		res = await app.inject({ method: "POST", url: "/runtime/rt-1/stop" });
		expect(res.statusCode).toBe(200);
		expect(stopRuntime).toHaveBeenCalledWith("rt-1");
	});

	// ── /watch waiter cap (DoS protection) ────────────────────────────────

	it("should return 503 when /watch waiter cap is exceeded", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;

		// Directly fill the watchWaiters array to simulate cap reached,
		// avoiding 100 real HTTP calls that would trip Fastify rate limiter.
		const fakeWaiters: Array<{ resolve: (v: boolean) => void; timer: ReturnType<typeof setTimeout> }> = [];
		for (let i = 0; i < 100; i++) {
			const timer = setTimeout(() => {}, 60000);
			fakeWaiters.push({ resolve: () => {}, timer });
		}
		(bridge as any).watchWaiters = fakeWaiters;

		// The next request should get 503
		const res = await app.inject({
			method: "GET",
			url: "/watch?timeout_ms=100&fingerprint=0",
		});
		expect(res.statusCode).toBe(503);
		expect(res.json().error).toMatch(/Too many concurrent watchers/);

		// Clean up timers
		for (const w of fakeWaiters) clearTimeout(w.timer);
	});
});
