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
		expect(res.json()).toEqual({ changes: false });
	});

	it("should serve GET /latest/:pid", async () => {
		bridge = new HttpBridgeServer({ port: 0, host: "127.0.0.1" });
		await bridge.start();

		const app = (bridge as any).server;
		const res = await app.inject({
			method: "GET",
			url: "/latest/12345",
		});

		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ content: "placeholder for 12345" });
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
});
