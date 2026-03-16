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
			updatedAt: Date.now(),
		};
		const getAgentState = vi.fn().mockResolvedValue(state);
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1", getAgentState });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({ method: "GET", url: "/latest/1234" });
		expect(res.statusCode).toBe(200);
		expect(res.json().activity).toBe("working");
		expect(getAgentState).toHaveBeenCalledWith(1234);
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
