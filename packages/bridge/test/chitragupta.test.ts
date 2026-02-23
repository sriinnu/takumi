import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock child_process ───────────────────────────────────────────────────────

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
import {
	type AkashaTrace,
	ChitraguptaBridge,
	type ChitraguptaSessionInfo,
	type HandoverSummary,
	type MemoryResult,
	type SessionDetail,
} from "@takumi/bridge";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Push a JSON-RPC response into the mock stdout. */
function sendResponse(id: number, result: unknown) {
	const line = `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
	mockProc.stdout.push(line);
}

/** Build an MCP tool result with text content. */
function toolResult(data: unknown) {
	return {
		content: [{ type: "text", text: JSON.stringify(data) }],
	};
}

/**
 * Connect the bridge by handling the initialize handshake automatically.
 */
async function connectBridge(bridge: ChitraguptaBridge): Promise<void> {
	const connectPromise = bridge.connect();
	await vi.advanceTimersByTimeAsync(0);
	// Respond to initialize (id=1)
	sendResponse(1, {
		protocolVersion: "2024-11-05",
		capabilities: {},
		serverInfo: { name: "chitragupta-mcp", version: "1.0.0" },
	});
	await connectPromise;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ChitraguptaBridge", () => {
	let bridge: ChitraguptaBridge;

	beforeEach(() => {
		vi.useFakeTimers();
		mockProc = createMockProcess();
		bridge = new ChitraguptaBridge({
			command: "chitragupta-mcp",
			args: ["--transport", "stdio"],
			requestTimeoutMs: 10_000,
			startupTimeoutMs: 5_000,
		});
	});

	afterEach(async () => {
		await bridge.disconnect();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	// ── connect / disconnect ──────────────────────────────────────────────

	describe("connect()", () => {
		it("spawns the chitragupta-mcp process", async () => {
			await connectBridge(bridge);
			expect(spawn).toHaveBeenCalledWith(
				"chitragupta-mcp",
				["--transport", "stdio"],
				expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
			);
		});

		it("sets isConnected to true", async () => {
			expect(bridge.isConnected).toBe(false);
			await connectBridge(bridge);
			expect(bridge.isConnected).toBe(true);
		});
	});

	describe("disconnect()", () => {
		it("kills the process and sets connected to false", async () => {
			await connectBridge(bridge);
			expect(bridge.isConnected).toBe(true);
			await bridge.disconnect();
			expect(bridge.isConnected).toBe(false);
		});

		it("is safe to call when not connected", async () => {
			await expect(bridge.disconnect()).resolves.toBeUndefined();
		});
	});

	// ── constructor options ─────────────────────────────────────────────

	describe("constructor options", () => {
		it("uses default command and args when not specified", async () => {
			const defaultBridge = new ChitraguptaBridge();
			mockProc = createMockProcess();

			const startPromise = defaultBridge.connect();
			await vi.advanceTimersByTimeAsync(0);
			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await startPromise;

			expect(spawn).toHaveBeenCalledWith("chitragupta-mcp", ["--transport", "stdio"], expect.any(Object));

			await defaultBridge.disconnect();
		});

		it("passes projectPath as CHITRAGUPTA_PROJECT env var", async () => {
			const projBridge = new ChitraguptaBridge({
				projectPath: "/my/project",
			});
			mockProc = createMockProcess();

			const startPromise = projBridge.connect();
			await vi.advanceTimersByTimeAsync(0);
			sendResponse(1, { protocolVersion: "2024-11-05", capabilities: {} });
			await startPromise;

			expect(spawn).toHaveBeenCalledWith(
				"chitragupta-mcp",
				["--transport", "stdio"],
				expect.objectContaining({
					env: expect.objectContaining({ CHITRAGUPTA_PROJECT: "/my/project" }),
				}),
			);

			await projBridge.disconnect();
		});
	});

	// ── memorySearch ─────────────────────────────────────────────────────

	describe("memorySearch()", () => {
		it("calls chitragupta_memory_search and returns parsed results", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const expected: MemoryResult[] = [{ content: "architecture uses SQLite", relevance: 0.95, source: "session-1" }];
			const promise = bridge.memorySearch("architecture");
			await vi.advanceTimersByTimeAsync(0);

			// Verify the request
			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.method).toBe("tools/call");
			expect(parsed.params.name).toBe("chitragupta_memory_search");
			expect(parsed.params.arguments).toEqual({ query: "architecture" });

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("passes limit parameter when provided", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.memorySearch("test", 5);
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.arguments).toEqual({ query: "test", limit: 5 });

			sendResponse(2, toolResult([]));
			const result = await promise;
			expect(result).toEqual([]);
		});

		it("returns empty array when result is unparseable", async () => {
			await connectBridge(bridge);

			const promise = bridge.memorySearch("bad");
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, { content: [{ type: "text", text: "NOT JSON" }] });
			const result = await promise;
			expect(result).toEqual([]);
		});
	});

	// ── sessionList ─────────────────────────────────────────────────────

	describe("sessionList()", () => {
		it("calls chitragupta_session_list and returns sessions", async () => {
			await connectBridge(bridge);

			const expected: ChitraguptaSessionInfo[] = [
				{ id: "session-2026-01-01-abcd", title: "Refactor bridge", timestamp: 1000, turns: 5 },
			];
			const promise = bridge.sessionList(10);
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("does not include limit param when not provided", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.sessionList();
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.arguments).toEqual({});

			sendResponse(2, toolResult([]));
			await promise;
		});
	});

	// ── sessionShow ─────────────────────────────────────────────────────

	describe("sessionShow()", () => {
		it("calls chitragupta_session_show and returns session detail", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const expected: SessionDetail = {
				id: "session-2026-01-01-abcd",
				title: "Test session",
				turns: [
					{ role: "user", content: "hello", timestamp: 1000 },
					{ role: "assistant", content: "hi there", timestamp: 1001 },
				],
			};
			const promise = bridge.sessionShow("session-2026-01-01-abcd");
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.name).toBe("chitragupta_session_show");
			expect(parsed.params.arguments).toEqual({ sessionId: "session-2026-01-01-abcd" });

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("returns default empty session on parse failure", async () => {
			await connectBridge(bridge);

			const promise = bridge.sessionShow("bad-id");
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, { content: [{ type: "text", text: "INVALID" }] });
			const result = await promise;
			expect(result).toEqual({ id: "bad-id", title: "", turns: [] });
		});
	});

	// ── handover ─────────────────────────────────────────────────────────

	describe("handover()", () => {
		it("calls chitragupta_handover and returns summary", async () => {
			await connectBridge(bridge);

			const expected: HandoverSummary = {
				originalRequest: "implement mcp client",
				filesModified: ["mcp-client.ts"],
				filesRead: ["chitragupta.ts"],
				decisions: ["Use EventEmitter"],
				errors: [],
				recentContext: "Working on bridge package",
			};
			const promise = bridge.handover();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("returns default empty summary on parse failure", async () => {
			await connectBridge(bridge);

			const promise = bridge.handover();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, { content: [{ type: "text", text: "BAD" }] });
			const result = await promise;
			expect(result).toEqual({
				originalRequest: "",
				filesModified: [],
				filesRead: [],
				decisions: [],
				errors: [],
				recentContext: "",
			});
		});
	});

	// ── akashaDeposit ───────────────────────────────────────────────────

	describe("akashaDeposit()", () => {
		it("calls akasha_deposit with correct parameters", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.akashaDeposit("Use EventEmitter for MCP client", "solution", ["mcp", "architecture"]);
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.name).toBe("akasha_deposit");
			expect(parsed.params.arguments).toEqual({
				content: "Use EventEmitter for MCP client",
				type: "solution",
				topics: ["mcp", "architecture"],
			});

			sendResponse(2, toolResult(null));
			await promise;
		});
	});

	// ── akashaTraces ────────────────────────────────────────────────────

	describe("akashaTraces()", () => {
		it("calls akasha_traces and returns parsed traces", async () => {
			await connectBridge(bridge);

			const expected: AkashaTrace[] = [
				{
					content: "McpClient pattern",
					type: "pattern",
					topics: ["mcp"],
					strength: 0.8,
				},
			];
			const promise = bridge.akashaTraces("mcp");
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("passes limit parameter when provided", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.akashaTraces("test", 3);
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.arguments).toEqual({ query: "test", limit: 3 });

			sendResponse(2, toolResult([]));
			await promise;
		});

		it("returns empty array on failure", async () => {
			await connectBridge(bridge);

			const promise = bridge.akashaTraces("bad");
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, { content: [{ type: "text", text: "BAD" }] });
			const result = await promise;
			expect(result).toEqual([]);
		});
	});

	// ── isConnected ──────────────────────────────────────────────────────

	describe("isConnected", () => {
		it("returns false before connect", () => {
			expect(bridge.isConnected).toBe(false);
		});

		it("returns true after connect", async () => {
			await connectBridge(bridge);
			expect(bridge.isConnected).toBe(true);
		});

		it("returns false after disconnect", async () => {
			await connectBridge(bridge);
			await bridge.disconnect();
			expect(bridge.isConnected).toBe(false);
		});
	});

	// ── mcpClient getter ────────────────────────────────────────────────

	describe("mcpClient", () => {
		it("exposes the underlying McpClient", () => {
			expect(bridge.mcpClient).toBeDefined();
			expect(bridge.mcpClient.isConnected).toBe(false);
		});
	});
});
