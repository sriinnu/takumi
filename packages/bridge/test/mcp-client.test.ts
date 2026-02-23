import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock child_process ───────────────────────────────────────────────────────

/** Minimal mock ChildProcess with stdin (writable), stdout (readable), stderr (readable). */
function createMockProcess() {
	const proc = new EventEmitter() as EventEmitter & {
		stdin: Writable;
		stdout: Readable;
		stderr: Readable;
		kill: ReturnType<typeof vi.fn>;
		pid: number;
	};

	proc.stdin = new Writable({
		write(_chunk, _enc, cb) {
			cb();
		},
	});
	proc.stdout = new Readable({ read() {} });
	proc.stderr = new Readable({ read() {} });
	proc.kill = vi.fn();
	proc.pid = 12345;

	return proc;
}

let mockProc: ReturnType<typeof createMockProcess>;

vi.mock("node:child_process", () => ({
	spawn: vi.fn(() => mockProc),
}));

import { spawn } from "node:child_process";
// Must import AFTER mock is declared
import { McpClient } from "@takumi/bridge";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Push a JSON-RPC response into the mock stdout. */
function sendResponse(id: number, result: unknown) {
	const line = `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
	mockProc.stdout.push(line);
}

/** Push a JSON-RPC error response into the mock stdout. */
function sendError(id: number, code: number, message: string) {
	const line = `${JSON.stringify({
		jsonrpc: "2.0",
		id,
		error: { code, message },
	})}\n`;
	mockProc.stdout.push(line);
}

/** Push a server-initiated notification into the mock stdout. */
function sendNotification(method: string, params?: Record<string, unknown>) {
	const line = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
	mockProc.stdout.push(line);
}

/**
 * Start the client by handling the initialize handshake automatically.
 * The first request will be "initialize" (id=1), which we respond to.
 */
async function startClient(client: McpClient): Promise<void> {
	const startPromise = client.start();
	// Wait a tick so the spawn + request are issued
	await vi.advanceTimersByTimeAsync(0);
	// Respond to the "initialize" request (id = 1)
	sendResponse(1, {
		protocolVersion: "2024-11-05",
		capabilities: {},
		serverInfo: { name: "test-mcp", version: "1.0.0" },
	});
	await startPromise;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("McpClient", () => {
	let client: McpClient;

	beforeEach(() => {
		vi.useFakeTimers();
		mockProc = createMockProcess();
		client = new McpClient({
			command: "test-mcp",
			args: ["--stdio"],
			requestTimeoutMs: 10_000,
			startupTimeoutMs: 5_000,
		});
	});

	afterEach(async () => {
		await client.stop();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// ── start ─────────────────────────────────────────────────────────────

	describe("start()", () => {
		it("spawns process with correct command and args", async () => {
			await startClient(client);
			expect(spawn).toHaveBeenCalledWith(
				"test-mcp",
				["--stdio"],
				expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
			);
		});

		it("sends initialize request as the first message", async () => {
			const writeSpy = vi.spyOn(mockProc.stdin, "write");
			const startPromise = client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(writeSpy).toHaveBeenCalled();
			const firstCall = writeSpy.mock.calls[0]![0] as string;
			const parsed = JSON.parse(firstCall.toString().trim());
			expect(parsed.method).toBe("initialize");
			expect(parsed.id).toBe(1);
			expect(parsed.jsonrpc).toBe("2.0");
			expect(parsed.params).toMatchObject({
				protocolVersion: "2024-11-05",
				clientInfo: { name: "takumi", version: "0.1.0" },
			});

			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await startPromise;
		});

		it("sends initialized notification after receiving initialize response", async () => {
			const writeSpy = vi.spyOn(mockProc.stdin, "write");
			await startClient(client);

			expect(writeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
			const notifCall = writeSpy.mock.calls[1]![0] as string;
			const parsed = JSON.parse(notifCall.toString().trim());
			expect(parsed.method).toBe("notifications/initialized");
			expect(parsed.id).toBeUndefined();
		});

		it("sets isConnected to true after successful start", async () => {
			expect(client.isConnected).toBe(false);
			await startClient(client);
			expect(client.isConnected).toBe(true);
		});

		it("is a no-op if already connected", async () => {
			await startClient(client);
			const spawnCallCount = vi.mocked(spawn).mock.calls.length;
			await client.start();
			expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallCount);
		});

		it("passes custom env variables to the child process", async () => {
			const envClient = new McpClient({
				command: "test-mcp",
				args: [],
				env: { MY_VAR: "hello" },
			});
			mockProc = createMockProcess();
			const startPromise = envClient.start();
			await vi.advanceTimersByTimeAsync(0);
			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await startPromise;

			expect(spawn).toHaveBeenCalledWith(
				"test-mcp",
				[],
				expect.objectContaining({
					env: expect.objectContaining({ MY_VAR: "hello" }),
				}),
			);

			await envClient.stop();
		});

		it("passes cwd to child process when specified", async () => {
			const cwdClient = new McpClient({
				command: "test-mcp",
				args: [],
				cwd: "/tmp/project",
			});
			mockProc = createMockProcess();
			const startPromise = cwdClient.start();
			await vi.advanceTimersByTimeAsync(0);
			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await startPromise;

			expect(spawn).toHaveBeenCalledWith("test-mcp", [], expect.objectContaining({ cwd: "/tmp/project" }));

			await cwdClient.stop();
		});
	});

	// ── call ──────────────────────────────────────────────────────────────

	describe("call()", () => {
		it("sends correct JSON-RPC request and returns result", async () => {
			await startClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const resultPromise = client.call("tools/call", {
				name: "test_tool",
				arguments: { key: "value" },
			});
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.method).toBe("tools/call");
			expect(parsed.params).toEqual({ name: "test_tool", arguments: { key: "value" } });
			expect(parsed.id).toBe(2);

			sendResponse(2, { content: [{ type: "text", text: "ok" }] });
			const result = await resultPromise;
			expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
		});

		it("throws if not connected", async () => {
			await expect(client.call("tools/list")).rejects.toThrow("McpClient is not connected");
		});

		it("rejects with error message from server", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "bad_tool" });
			await vi.advanceTimersByTimeAsync(0);

			sendError(2, -32600, "Invalid Request");
			await expect(promise).rejects.toThrow("Invalid Request");
		});

		it("rejects after request timeout", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "slow_tool" });
			await vi.advanceTimersByTimeAsync(0);

			const expectation = expect(promise).rejects.toThrow("timed out");
			await vi.advanceTimersByTimeAsync(10_000);
			await expectation;
		});

		it("does not reject if response arrives before timeout", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "fast_tool" });
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(1_000);
			sendResponse(2, { fast: true });

			const result = await promise;
			expect(result).toEqual({ fast: true });

			// Advance past timeout -- should not throw
			await vi.advanceTimersByTimeAsync(10_000);
		});

		it("correlates concurrent requests by id correctly", async () => {
			await startClient(client);

			const p1 = client.call("tools/call", { name: "tool_a" });
			const p2 = client.call("tools/call", { name: "tool_b" });
			const p3 = client.call("tools/call", { name: "tool_c" });
			await vi.advanceTimersByTimeAsync(0);

			// Respond out of order
			sendResponse(4, { tool: "c" });
			sendResponse(2, { tool: "a" });
			sendResponse(3, { tool: "b" });

			const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
			expect(r1).toEqual({ tool: "a" });
			expect(r2).toEqual({ tool: "b" });
			expect(r3).toEqual({ tool: "c" });
		});
	});

	// ── notify ────────────────────────────────────────────────────────────

	describe("notify()", () => {
		it("sends a notification without id", async () => {
			await startClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			client.notify("notifications/test", { key: "value" });

			const lastCall = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(lastCall.toString().trim());
			expect(parsed.method).toBe("notifications/test");
			expect(parsed.params).toEqual({ key: "value" });
			expect(parsed.id).toBeUndefined();
			expect(parsed.jsonrpc).toBe("2.0");
		});

		it("is a no-op when not connected", () => {
			// Should not throw
			expect(() => client.notify("test/method")).not.toThrow();
		});
	});

	// ── stop ──────────────────────────────────────────────────────────────

	describe("stop()", () => {
		it("kills the process and clears connected state", async () => {
			await startClient(client);
			expect(client.isConnected).toBe(true);

			await client.stop();
			expect(mockProc.kill).toHaveBeenCalled();
			expect(client.isConnected).toBe(false);
		});

		it("is safe to call when not connected", async () => {
			await expect(client.stop()).resolves.toBeUndefined();
			expect(client.isConnected).toBe(false);
		});

		it("rejects pending requests when stopping", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "pending_tool" });
			await vi.advanceTimersByTimeAsync(0);

			const stopPromise = client.stop();

			await expect(promise).rejects.toThrow("McpClient stopped");

			// Emit close to resolve the stop promise's wait
			mockProc.emit("close", 0);
			await stopPromise;
		});
	});

	// ── isConnected ──────────────────────────────────────────────────────

	describe("isConnected", () => {
		it("returns false before start", () => {
			expect(client.isConnected).toBe(false);
		});

		it("returns true after start", async () => {
			await startClient(client);
			expect(client.isConnected).toBe(true);
		});

		it("returns false after stop", async () => {
			await startClient(client);
			await client.stop();
			expect(client.isConnected).toBe(false);
		});
	});

	// ── restart ──────────────────────────────────────────────────────────

	describe("restart()", () => {
		it("stops and starts the client", async () => {
			await startClient(client);
			expect(client.isConnected).toBe(true);

			// Create a fresh mock process for the restart
			const oldProc = mockProc;
			mockProc = createMockProcess();

			const restartPromise = client.restart();

			// The old process emits close
			oldProc.emit("close", 0);

			// Wait for the new process to spawn
			await vi.advanceTimersByTimeAsync(600);

			// Respond to the new initialize request (id restarts at 1)
			sendResponse(1, {
				protocolVersion: "2024-11-05",
				capabilities: {},
			});

			await restartPromise;
			expect(client.isConnected).toBe(true);
		});
	});

	// ── Process exit / crash recovery ─────────────────────────────────────

	describe("process exit handling", () => {
		it("rejects pending requests when process closes", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "pending" });
			await vi.advanceTimersByTimeAsync(0);

			mockProc.emit("close", 1);

			await expect(promise).rejects.toThrow("MCP process exited");
		});

		it("sets connected to false on close", async () => {
			await startClient(client);
			expect(client.isConnected).toBe(true);

			mockProc.emit("close", 0);
			expect(client.isConnected).toBe(false);
		});

		it("emits disconnected event on unexpected close", async () => {
			await startClient(client);

			const handler = vi.fn();
			client.on("disconnected", handler);

			mockProc.emit("close", 1);
			expect(handler).toHaveBeenCalledWith(1);
		});

		it("auto-restarts after crash (up to 3 attempts)", async () => {
			await startClient(client);
			const spawnCountBefore = vi.mocked(spawn).mock.calls.length;

			// Simulate crash
			const oldProc = mockProc;
			mockProc = createMockProcess();
			oldProc.emit("close", 1);

			expect(client.isConnected).toBe(false);

			// Wait for the restart delay
			await vi.advanceTimersByTimeAsync(RESTART_DELAY);

			// The spawn should have been called once more
			expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCountBefore + 1);

			// Complete the handshake for the new process
			await vi.advanceTimersByTimeAsync(0);
			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await vi.advanceTimersByTimeAsync(0);

			expect(client.isConnected).toBe(true);
		});

		it("does not auto-restart after stop()", async () => {
			await startClient(client);
			const spawnCount = vi.mocked(spawn).mock.calls.length;

			await client.stop();
			mockProc.emit("close", 0);

			await vi.advanceTimersByTimeAsync(2_000);

			// No additional spawn calls
			expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCount);
		});
	});

	// ── Process error event ──────────────────────────────────────────────

	describe("process error event", () => {
		it("sets connected to false on process error", async () => {
			await startClient(client);
			expect(client.isConnected).toBe(true);

			// Must attach an error listener — EventEmitter throws if "error" is
			// emitted with no listener.
			client.on("error", () => {});

			mockProc.emit("error", new Error("ENOENT"));
			expect(client.isConnected).toBe(false);
		});

		it("emits error event", async () => {
			await startClient(client);

			const handler = vi.fn();
			client.on("error", handler);

			const err = new Error("spawn failed");
			mockProc.emit("error", err);
			expect(handler).toHaveBeenCalledWith(err);
		});
	});

	// ── Server-initiated notifications ───────────────────────────────────

	describe("server notifications", () => {
		it("emits notification event for server-initiated messages", async () => {
			await startClient(client);

			const handler = vi.fn();
			client.on("notification", handler);

			sendNotification("notifications/resources/updated", { uri: "file:///test" });

			expect(handler).toHaveBeenCalledWith("notifications/resources/updated", {
				uri: "file:///test",
			});
		});
	});

	// ── Buffered / split responses ───────────────────────────────────────

	describe("buffered / split response handling", () => {
		it("handles a response split across multiple data events", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "split_tool" });
			await vi.advanceTimersByTimeAsync(0);

			const fullLine = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } });
			const mid = Math.floor(fullLine.length / 2);
			mockProc.stdout.push(fullLine.slice(0, mid));
			mockProc.stdout.push(`${fullLine.slice(mid)}\n`);

			const result = await promise;
			expect(result).toEqual({ ok: true });
		});

		it("handles multiple responses in a single data event", async () => {
			await startClient(client);

			const p1 = client.call("tools/call", { name: "batch_a" });
			const p2 = client.call("tools/call", { name: "batch_b" });
			await vi.advanceTimersByTimeAsync(0);

			const combined =
				JSON.stringify({ jsonrpc: "2.0", id: 2, result: { a: 1 } }) +
				"\n" +
				JSON.stringify({ jsonrpc: "2.0", id: 3, result: { b: 2 } }) +
				"\n";
			mockProc.stdout.push(combined);

			const [r1, r2] = await Promise.all([p1, p2]);
			expect(r1).toEqual({ a: 1 });
			expect(r2).toEqual({ b: 2 });
		});

		it("ignores empty lines in the stream", async () => {
			await startClient(client);

			const promise = client.call("tools/call", { name: "empty_line_tool" });
			await vi.advanceTimersByTimeAsync(0);

			const chunk = `\n\n${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { value: 42 } })}\n\n`;
			mockProc.stdout.push(chunk);

			const result = await promise;
			expect(result).toEqual({ value: 42 });
		});

		it("handles malformed JSON gracefully (does not crash)", async () => {
			await startClient(client);

			// Push garbage followed by a valid response
			const promise = client.call("tools/call", { name: "after_garbage" });
			await vi.advanceTimersByTimeAsync(0);

			mockProc.stdout.push("NOT VALID JSON\n");
			mockProc.stdout.push(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { recovered: true } })}\n`);

			const result = await promise;
			expect(result).toEqual({ recovered: true });
		});
	});

	// ── Events ───────────────────────────────────────────────────────────

	describe("events", () => {
		it("emits connected event on successful start", async () => {
			const handler = vi.fn();
			client.on("connected", handler);

			await startClient(client);
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});
});

// Constant used in tests
const RESTART_DELAY = 1000;
