import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock node:net — socket probe always fails instantly in tests ──────────────

vi.mock("node:net", () => {
	const createConnection = vi.fn(() => {
		const sock = new EventEmitter() as EventEmitter & { destroy: () => void };
		sock.destroy = vi.fn();
		// Emit error synchronously so probeSocket resolves false without hanging
		process.nextTick(() => sock.emit("error", new Error("ENOENT: no daemon in tests")));
		return sock;
	});
	return { default: { createConnection }, createConnection };
});

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

		it("prefers daemon-native session.handover in socket mode", async () => {
			const mockSocket = {
				isConnected: true,
				call: vi.fn().mockResolvedValue({
					sessionId: "sess-123",
					project: "/tmp/project",
					title: "Takumi interactive",
					turnCount: 4,
					cursor: 4,
					filesModified: ["src/foo.ts"],
					filesRead: ["src/bar.ts"],
					decisions: ["The fix is to persist the route envelope."],
					errors: [],
					commands: ["pnpm build"],
					recentContext: [{ turn: 4, preview: "Persist the lane envelope into session metadata." }],
				}),
			};

			const socketBridge = new ChitraguptaBridge({
				socketPath: "/tmp/test-chitragupta.sock",
				projectPath: "/tmp/project",
			});
			// @ts-expect-error — testing internals
			socketBridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			socketBridge._socketMode = true;

			const result = await socketBridge.handover();
			expect(mockSocket.call).toHaveBeenCalledWith("session.handover", { project: "/tmp/project" });
			expect(result).toMatchObject({
				originalRequest: "Takumi interactive",
				filesModified: ["src/foo.ts"],
				filesRead: ["src/bar.ts"],
				sessionId: "sess-123",
				project: "/tmp/project",
				title: "Takumi interactive",
				turnCount: 4,
				cursor: 4,
				commands: ["pnpm build"],
			});
			expect(result.recentContext).toContain("Persist the lane envelope");
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

	// ── vasanaTendencies ─────────────────────────────────────────────────

	describe("vasanaTendencies()", () => {
		it("calls vasana_tendencies and returns parsed tendencies", async () => {
			await connectBridge(bridge);

			const expected = [
				{
					tendency: "prefers-small-commits",
					valence: "positive",
					strength: 0.9,
					stability: 0.85,
					predictiveAccuracy: 0.78,
					reinforcementCount: 14,
					description: "Commits frequently with small focused diffs",
				},
			];

			const promise = bridge.vasanaTendencies();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("passes limit parameter when provided", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.vasanaTendencies(5);
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.name).toBe("vasana_tendencies");
			expect(parsed.params.arguments).toEqual({ limit: 5 });

			sendResponse(2, toolResult([]));
			await promise;
		});

		it("omits limit when not provided", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.vasanaTendencies();
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.arguments).not.toHaveProperty("limit");

			sendResponse(2, toolResult([]));
			await promise;
		});

		it("returns empty array when response content is malformed", async () => {
			await connectBridge(bridge);

			const promise = bridge.vasanaTendencies();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, { content: [{ type: "text", text: "NOT_JSON" }] });
			const result = await promise;
			expect(result).toEqual([]);
		});

		it("prefers daemon-native vasana.tendencies in socket mode", async () => {
			const expected = [
				{
					tendency: "prefers-small-commits",
					valence: "positive",
					strength: 0.9,
					stability: 0.85,
					predictiveAccuracy: 0.78,
					reinforcementCount: 14,
					description: "Commits frequently with small focused diffs",
				},
			];
			const mockSocket = {
				isConnected: true,
				call: vi.fn().mockResolvedValue({ tendencies: expected }),
			};

			const socketBridge = new ChitraguptaBridge({
				socketPath: "/tmp/test-chitragupta.sock",
				projectPath: "/tmp/project",
			});
			// @ts-expect-error — testing internals
			socketBridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			socketBridge._socketMode = true;

			const result = await socketBridge.vasanaTendencies(7);
			expect(mockSocket.call).toHaveBeenCalledWith("vasana.tendencies", {
				project: "/tmp/project",
				limit: 7,
			});
			expect(result).toEqual(expected);
		});
	});

	// ── healthStatus ─────────────────────────────────────────────────────

	describe("healthStatus()", () => {
		it("calls health_status and returns parsed health snapshot", async () => {
			await connectBridge(bridge);

			const expected = {
				state: { sattva: 0.7, rajas: 0.2, tamas: 0.1 },
				dominant: "sattva",
				trend: { sattva: "rising", rajas: "stable", tamas: "falling" },
				alerts: [],
				history: [
					{
						timestamp: 1_700_000_000,
						state: { sattva: 0.65, rajas: 0.25, tamas: 0.1 },
						dominant: "sattva",
					},
				],
			};

			const promise = bridge.healthStatus();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, toolResult(expected));
			const result = await promise;
			expect(result).toEqual(expected);
		});

		it("sends no arguments to health_status tool", async () => {
			await connectBridge(bridge);
			const writeSpy = vi.spyOn(mockProc.stdin, "write");

			const promise = bridge.healthStatus();
			await vi.advanceTimersByTimeAsync(0);

			const callData = writeSpy.mock.calls[writeSpy.mock.calls.length - 1]![0] as string;
			const parsed = JSON.parse(callData.toString().trim());
			expect(parsed.params.name).toBe("health_status");
			expect(parsed.params.arguments).toEqual({});

			sendResponse(2, toolResult(null));
			await promise;
		});

		it("returns null when response content is malformed", async () => {
			await connectBridge(bridge);

			const promise = bridge.healthStatus();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, { content: [{ type: "text", text: "BAD" }] });
			const result = await promise;
			expect(result).toBeNull();
		});

		it("returns null when result is null", async () => {
			await connectBridge(bridge);

			const promise = bridge.healthStatus();
			await vi.advanceTimersByTimeAsync(0);

			sendResponse(2, toolResult(null));
			const result = await promise;
			expect(result).toBeNull();
		});
	});

	// ── Phase 15: Vidhi, Consolidation, Fact Extraction ──────────────────

	describe("Phase 15 features", () => {
		const MOCK_SOCKET_PATH = "/tmp/test-chitragupta.sock";
		function createMockSocket() {
			return {
				isConnected: true,
				request: vi.fn(),
				call: vi.fn(),
			};
		}

		it("vidhiList returns vidhis in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				vidhis: [
					{
						id: "v1",
						name: "Test Vidhi",
						pattern: "test*",
						action: "run test",
						confidence: 0.9,
						usageCount: 5,
						createdAt: "2026-03-01",
					},
				],
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const vidhis = await bridge.vidhiList("test-project", 10);
			expect(vidhis).toHaveLength(1);
			expect(vidhis[0].name).toBe("Test Vidhi");
			expect(mockSocket.call).toHaveBeenCalledWith("vidhi.list", { project: "test-project", limit: 10 });
		});

		it("vidhiMatch returns match in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				match: {
					vidhi: {
						id: "v1",
						name: "Test Vidhi",
						pattern: "test*",
						action: "run test",
						confidence: 0.9,
						usageCount: 5,
						createdAt: "2026-03-01",
					},
					score: 0.85,
					context: "test context",
				},
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const match = await bridge.vidhiMatch("test-project", "run test");
			expect(match).not.toBeNull();
			expect(match!.score).toBe(0.85);
			expect(match!.vidhi.name).toBe("Test Vidhi");
		});

		it("consolidationRun returns result in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				sessionCount: 20,
				vidhisExtracted: 5,
				factsExtracted: 42,
				daysSaved: 3,
				elapsed: 2500,
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const result = await bridge.consolidationRun("test-project", 20);
			expect(result.sessionCount).toBe(20);
			expect(result.vidhisExtracted).toBe(5);
			expect(result.factsExtracted).toBe(42);
		});

		it("factExtract returns facts in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				facts: [
					{
						id: "f1",
						text: "User prefers TypeScript",
						type: "preference",
						confidence: 0.95,
						source: "session",
						createdAt: "2026-03-01",
					},
				],
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const facts = await bridge.factExtract("User prefers TypeScript", "/test/project");
			expect(facts).toHaveLength(1);
			expect(facts[0].text).toBe("User prefers TypeScript");
			expect(facts[0].type).toBe("preference");
		});
	});

	describe("Phase 16 — Session Write & Turn Tracking", () => {
		const MOCK_SOCKET_PATH = "/tmp/test-chitragupta.sock";
		function createMockSocket() {
			return {
				isConnected: true,
				request: vi.fn(),
				call: vi.fn(),
			};
		}

		it("sessionCreate creates session in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				id: "sess-123",
				created: true,
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const result = await bridge.sessionCreate({
				project: "/test/project",
				title: "Test Session",
				agent: "takumi",
				model: "claude-sonnet-4",
			});

			expect(result.id).toBe("sess-123");
			expect(result.created).toBe(true);
			expect(mockSocket.call).toHaveBeenCalledWith("session.create", {
				project: "/test/project",
				title: "Test Session",
				agent: "takumi",
				model: "claude-sonnet-4",
			});
		});

		it("sessionMetaUpdate updates metadata in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				updated: true,
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const result = await bridge.sessionMetaUpdate("sess-123", {
				title: "Updated Title",
				completed: true,
				costUsd: 0.05,
			});

			expect(result.updated).toBe(true);
			expect(mockSocket.call).toHaveBeenCalledWith("session.meta.update", {
				id: "sess-123",
				updates: {
					title: "Updated Title",
					completed: true,
					costUsd: 0.05,
				},
			});
		});

		it("turnAdd adds turn in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				added: true,
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const turn = {
				number: 1,
				role: "user" as const,
				content: "Hello, world!",
				timestamp: Date.now(),
			};

			const result = await bridge.turnAdd("sess-123", "/test/project", turn);

			expect(result.added).toBe(true);
			expect(mockSocket.call).toHaveBeenCalledWith("turn.add", {
				sessionId: "sess-123",
				project: "/test/project",
				turn,
			});
		});

		it("turnMaxNumber returns max turn in socket mode", async () => {
			const mockSocket = createMockSocket();
			mockSocket.call = vi.fn().mockResolvedValue({
				maxTurn: 42,
			});

			const bridge = new ChitraguptaBridge({ socketPath: MOCK_SOCKET_PATH });
			// @ts-expect-error — testing internals
			bridge._socket = mockSocket;
			// @ts-expect-error — testing internals
			bridge._socketMode = true;

			const maxTurn = await bridge.turnMaxNumber("sess-123");

			expect(maxTurn).toBe(42);
			expect(mockSocket.call).toHaveBeenCalledWith("turn.max_number", {
				sessionId: "sess-123",
			});
		});
	});
});
