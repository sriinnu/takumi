import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

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

// Must import AFTER mock is declared
import { ChitraguptaClient } from "@takumi/bridge";
import { spawn } from "node:child_process";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Push a JSON-RPC response into the mock stdout. */
function sendResponse(id: number, result: unknown) {
	const line = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
	mockProc.stdout.push(line);
}

/** Push a JSON-RPC error response into the mock stdout. */
function sendError(id: number, code: number, message: string) {
	const line = JSON.stringify({
		jsonrpc: "2.0",
		id,
		error: { code, message },
	}) + "\n";
	mockProc.stdout.push(line);
}

/**
 * Connect the client by handling the initialize handshake automatically.
 * The first request will be "initialize" (id=1), which we respond to.
 */
async function connectClient(client: ChitraguptaClient): Promise<void> {
	const connectPromise = client.connect();
	// Wait a tick so the spawn + request are issued
	await vi.advanceTimersByTimeAsync(0);
	// Respond to the "initialize" request (id = 1)
	sendResponse(1, {
		protocolVersion: "2024-11-05",
		capabilities: {},
		serverInfo: { name: "chitragupta-mcp", version: "1.0.0" },
	});
	await connectPromise;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ChitraguptaClient", () => {
	let client: ChitraguptaClient;

	beforeEach(() => {
		vi.useFakeTimers();
		mockProc = createMockProcess();
		client = new ChitraguptaClient("chitragupta-mcp", ["--transport", "stdio"]);
	});

	afterEach(() => {
		client.disconnect();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// ── connect ──────────────────────────────────────────────────────────

	describe("connect()", () => {
		it("spawns process with correct binary and args", async () => {
			await connectClient(client);
			expect(spawn).toHaveBeenCalledWith(
				"chitragupta-mcp",
				["--transport", "stdio"],
				expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
			);
		});

		it("sends initialize request as the first message", async () => {
			const writeSpy = vi.spyOn(mockProc.stdin, "write");
			const connectPromise = client.connect();
			await vi.advanceTimersByTimeAsync(0);

			// First write should be the initialize request
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

			// Complete the handshake
			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await connectPromise;
		});

		it("sends initialized notification after receiving initialize response", async () => {
			const writeSpy = vi.spyOn(mockProc.stdin, "write");
			await connectClient(client);

			// Second write should be the notifications/initialized notification
			expect(writeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
			const notifCall = writeSpy.mock.calls[1]![0] as string;
			const parsed = JSON.parse(notifCall.toString().trim());
			expect(parsed.method).toBe("notifications/initialized");
			// Notifications have no id
			expect(parsed.id).toBeUndefined();
		});

		it("sets isConnected to true after successful connect", async () => {
			expect(client.isConnected()).toBe(false);
			await connectClient(client);
			expect(client.isConnected()).toBe(true);
		});

		it("is a no-op if already connected", async () => {
			await connectClient(client);
			const spawnCallCount = vi.mocked(spawn).mock.calls.length;
			await client.connect(); // should return immediately
			expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallCount);
		});
	});

	// ── callTool ─────────────────────────────────────────────────────────

	describe("callTool()", () => {
		it("sends correct JSON-RPC request for tools/call", async () => {
			await connectClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const resultPromise = client.callTool("test_tool", { key: "value" });
			await vi.advanceTimersByTimeAsync(0);

			// Find the tools/call write (after initialize + notification)
			const toolCallData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(toolCallData.toString().trim());
			expect(parsed.method).toBe("tools/call");
			expect(parsed.params).toEqual({ name: "test_tool", arguments: { key: "value" } });
			expect(parsed.id).toBe(2); // id=1 was initialize

			sendResponse(2, { content: [{ type: "text", text: "ok" }] });
			const result = await resultPromise;
			expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
		});
	});

	// ── listTools ────────────────────────────────────────────────────────

	describe("listTools()", () => {
		it("returns tools array from response", async () => {
			await connectClient(client);

			const toolsPromise = client.listTools();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, {
				tools: [
					{ name: "chitragupta_memory_search", description: "Search memory" },
					{ name: "chitragupta_session_list", description: "List sessions" },
				],
			});

			const tools = await toolsPromise;
			expect(tools).toHaveLength(2);
			expect(tools[0].name).toBe("chitragupta_memory_search");
		});

		it("returns empty array when response has no tools property", async () => {
			await connectClient(client);

			const toolsPromise = client.listTools();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, {});
			const tools = await toolsPromise;
			expect(tools).toEqual([]);
		});
	});

	// ── memorySearch ─────────────────────────────────────────────────────

	describe("memorySearch()", () => {
		it("calls chitragupta_memory_search with query", async () => {
			await connectClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = client.memorySearch("architecture decisions");
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.method).toBe("tools/call");
			expect(parsed.params.name).toBe("chitragupta_memory_search");
			expect(parsed.params.arguments).toEqual({ query: "architecture decisions" });

			sendResponse(2, { results: [] });
			await promise;
		});
	});

	// ── sessionList ──────────────────────────────────────────────────────

	describe("sessionList()", () => {
		it("calls chitragupta_session_list with limit", async () => {
			await connectClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = client.sessionList(5);
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.method).toBe("tools/call");
			expect(parsed.params.name).toBe("chitragupta_session_list");
			expect(parsed.params.arguments).toEqual({ limit: 5 });

			sendResponse(2, { sessions: [] });
			await promise;
		});

		it("passes undefined limit when not specified", async () => {
			await connectClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = client.sessionList();
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.arguments).toEqual({ limit: undefined });

			sendResponse(2, { sessions: [] });
			await promise;
		});
	});

	// ── handover ─────────────────────────────────────────────────────────

	describe("handover()", () => {
		it("calls chitragupta_handover with empty args", async () => {
			await connectClient(client);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = client.handover();
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.method).toBe("tools/call");
			expect(parsed.params.name).toBe("chitragupta_handover");
			expect(parsed.params.arguments).toEqual({});

			sendResponse(2, { summary: "handover complete" });
			const result = await promise;
			expect(result).toEqual({ summary: "handover complete" });
		});
	});

	// ── disconnect ───────────────────────────────────────────────────────

	describe("disconnect()", () => {
		it("kills the process and clears connected state", async () => {
			await connectClient(client);
			expect(client.isConnected()).toBe(true);

			client.disconnect();
			expect(mockProc.kill).toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);
		});

		it("is safe to call when not connected", () => {
			expect(() => client.disconnect()).not.toThrow();
			expect(client.isConnected()).toBe(false);
		});

		it("clears pending requests so they are not rejected on close", async () => {
			await connectClient(client);

			// Issue a request but don't respond to it.
			// We intentionally ignore the returned promise — disconnect() will
			// clear the pending map so neither the close handler nor the timeout
			// will be able to reject it. The promise becomes permanently pending,
			// which is the expected behaviour for disconnect().
			client.callTool("slow_tool", {}).catch(() => {
				/* swallow — prevents unhandled rejection if timeout fires */
			});
			await vi.advanceTimersByTimeAsync(0);

			client.disconnect();

			// After disconnect, a subsequent close event should NOT throw
			// because pendingRequests was cleared.
			expect(() => mockProc.emit("close", 0)).not.toThrow();

			// Flush the 30s timeout — it should be a no-op since the id
			// was already removed from pendingRequests.
			await vi.advanceTimersByTimeAsync(30_000);
		});
	});

	// ── isConnected ──────────────────────────────────────────────────────

	describe("isConnected()", () => {
		it("returns false before connect", () => {
			expect(client.isConnected()).toBe(false);
		});

		it("returns true after connect", async () => {
			await connectClient(client);
			expect(client.isConnected()).toBe(true);
		});

		it("returns false after disconnect", async () => {
			await connectClient(client);
			client.disconnect();
			expect(client.isConnected()).toBe(false);
		});
	});

	// ── JSON-RPC error responses ─────────────────────────────────────────

	describe("JSON-RPC error handling", () => {
		it("rejects with Error when server responds with error", async () => {
			await connectClient(client);

			const promise = client.callTool("bad_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			sendError(2, -32600, "Invalid Request");

			await expect(promise).rejects.toThrow("Invalid Request");

			// Flush orphaned timeout
			await vi.advanceTimersByTimeAsync(30_000);
		});

		it("rejects with the error message from the server", async () => {
			await connectClient(client);

			const promise = client.callTool("missing_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			sendError(2, -32601, "Method not found");

			await expect(promise).rejects.toThrow("Method not found");

			// Flush orphaned timeout
			await vi.advanceTimersByTimeAsync(30_000);
		});
	});

	// ── Process exit ─────────────────────────────────────────────────────

	describe("process exit handling", () => {
		it("rejects pending requests when process closes", async () => {
			await connectClient(client);

			const promise = client.callTool("pending_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			// Simulate process close
			mockProc.emit("close", 1);

			await expect(promise).rejects.toThrow("MCP process exited");

			// Flush the orphaned 30s timeout so it doesn't leak into other tests
			await vi.advanceTimersByTimeAsync(30_000);
		});

		it("sets connected to false on close", async () => {
			await connectClient(client);
			expect(client.isConnected()).toBe(true);

			mockProc.emit("close", 0);
			expect(client.isConnected()).toBe(false);
		});
	});

	// ── Process error event ──────────────────────────────────────────────

	describe("process error event", () => {
		it("sets connected to false on process error", async () => {
			await connectClient(client);
			expect(client.isConnected()).toBe(true);

			mockProc.emit("error", new Error("ENOENT"));
			expect(client.isConnected()).toBe(false);
		});
	});

	// ── Multiple concurrent requests ─────────────────────────────────────

	describe("concurrent requests", () => {
		it("routes responses to correct pending requests by id", async () => {
			await connectClient(client);

			// Fire off three concurrent requests
			const promise1 = client.callTool("tool_a", { n: 1 });
			const promise2 = client.callTool("tool_b", { n: 2 });
			const promise3 = client.callTool("tool_c", { n: 3 });
			await vi.advanceTimersByTimeAsync(0);

			// Respond out of order (3, 1, 2)
			sendResponse(4, { tool: "c", n: 3 });
			sendResponse(2, { tool: "a", n: 1 });
			sendResponse(3, { tool: "b", n: 2 });

			const [r1, r2, r3] = await Promise.all([promise1, promise2, promise3]);
			expect(r1).toEqual({ tool: "a", n: 1 });
			expect(r2).toEqual({ tool: "b", n: 2 });
			expect(r3).toEqual({ tool: "c", n: 3 });
		});
	});

	// ── Buffered/split responses ─────────────────────────────────────────

	describe("buffered / split response handling", () => {
		it("handles a response split across multiple data events", async () => {
			await connectClient(client);

			const promise = client.callTool("split_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			const fullLine = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } });
			// Split in the middle
			const mid = Math.floor(fullLine.length / 2);
			mockProc.stdout.push(fullLine.slice(0, mid));
			mockProc.stdout.push(fullLine.slice(mid) + "\n");

			const result = await promise;
			expect(result).toEqual({ ok: true });
		});

		it("handles multiple responses in a single data event", async () => {
			await connectClient(client);

			const promise1 = client.callTool("batch_a", {});
			const promise2 = client.callTool("batch_b", {});
			await vi.advanceTimersByTimeAsync(0);

			// Both responses in one chunk
			const combined =
				JSON.stringify({ jsonrpc: "2.0", id: 2, result: { a: 1 } }) +
				"\n" +
				JSON.stringify({ jsonrpc: "2.0", id: 3, result: { b: 2 } }) +
				"\n";
			mockProc.stdout.push(combined);

			const [r1, r2] = await Promise.all([promise1, promise2]);
			expect(r1).toEqual({ a: 1 });
			expect(r2).toEqual({ b: 2 });
		});

		it("ignores empty lines in the stream", async () => {
			await connectClient(client);

			const promise = client.callTool("empty_line_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			// Push response with extra blank lines
			const chunk =
				"\n\n" +
				JSON.stringify({ jsonrpc: "2.0", id: 2, result: { value: 42 } }) +
				"\n\n";
			mockProc.stdout.push(chunk);

			const result = await promise;
			expect(result).toEqual({ value: 42 });
		});
	});

	// ── Request timeout ──────────────────────────────────────────────────

	describe("request timeout", () => {
		it("rejects after 30 seconds if no response is received", async () => {
			await connectClient(client);

			const promise = client.callTool("slow_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			// Set up the rejection expectation BEFORE advancing time so
			// the rejection handler is attached before the timer fires.
			const expectation = expect(promise).rejects.toThrow("timed out");

			// Advance time past the 30-second timeout
			await vi.advanceTimersByTimeAsync(30_000);

			await expectation;
		});

		it("does not reject if response arrives before timeout", async () => {
			await connectClient(client);

			const promise = client.callTool("fast_tool", {});
			await vi.advanceTimersByTimeAsync(0);

			// Respond after 1 second
			await vi.advanceTimersByTimeAsync(1_000);
			sendResponse(2, { fast: true });

			const result = await promise;
			expect(result).toEqual({ fast: true });

			// Advance past the 30s mark — should not throw
			await vi.advanceTimersByTimeAsync(30_000);
		});
	});
});
