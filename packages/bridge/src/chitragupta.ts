/**
 * ChitraguptaBridge -- High-level bridge to the Chitragupta memory system.
 *
 * Connection strategy (Docker daemon pattern):
 *   1. Probe the chitragupta daemon Unix socket.
 *   2. If alive → connect directly via JSON-RPC 2.0 (socket mode, fast path).
 *   3. Otherwise → spawn chitragupta-mcp subprocess via stdio (MCP mode, fallback).
 *
 * Socket mode eliminates the 5-8 s cold-start per session when the daemon is
 * already running in the background.
 */

import { createLogger, TELEMETRY_DIR } from "@takumi/core";
import * as ops from "./chitragupta-ops.js";
import * as queries from "./chitragupta-queries.js";
import type {
	AgentTelemetry,
	AkashaTrace,
	ChitraguptaBridgeOptions,
	ChitraguptaHealth,
	ChitraguptaProjectInfo,
	ChitraguptaSessionInfo,
	ConsolidationResult,
	DaemonStatus,
	DaySearchResult,
	ExtractedFact,
	HandoverSummary,
	MemoryResult,
	MemoryScope,
	SessionCreateOptions,
	SessionCreateResult,
	SessionDetail,
	SessionMetaUpdates,
	TelemetrySnapshot,
	Turn,
	TurnAddResult,
	UnifiedRecallResult,
	VasanaTendency,
	VidhiInfo,
	VidhiMatch,
} from "./chitragupta-types.js";
import { DaemonSocketClient, probeSocket, resolveSocketPath } from "./daemon-socket.js";
import { McpClient, type McpClientOptions } from "./mcp-client.js";
import { telemetryCleanup, telemetryHeartbeat, telemetrySnapshot } from "./telemetry.js";

const log = createLogger("chitragupta-bridge");

// ── MCP tool response wrappers ───────────────────────────────────────────────

interface ToolCallResult {
	content?: Array<{ type: string; text?: string }>;
}

// ── ChitraguptaBridge ────────────────────────────────────────────────────────

export class ChitraguptaBridge {
	private client: McpClient;
	private _socket: DaemonSocketClient | null = null;
	private _socketMode = false;
	private readonly options: ChitraguptaBridgeOptions;
	private telemetryCache: Partial<AgentTelemetry> = {};

	constructor(options?: ChitraguptaBridgeOptions) {
		this.options = options ?? {};
		const command = options?.command ?? "chitragupta-mcp";
		const args = options?.args ?? ["--transport", "stdio"];

		const mcpOptions: McpClientOptions = {
			command,
			args,
			startupTimeoutMs: options?.startupTimeoutMs ?? 5_000,
			requestTimeoutMs: options?.requestTimeoutMs ?? 10_000,
		};

		if (options?.projectPath) {
			mcpOptions.env = { CHITRAGUPTA_PROJECT: options.projectPath };
		}

		this.client = new McpClient(mcpOptions);

		// Forward MCP events for observability (only fires in MCP mode)
		this.client.on("disconnected", (code) => {
			log.warn(`Chitragupta MCP disconnected (exit code ${code})`);
		});
		this.client.on("error", (err) => {
			log.error(`Chitragupta MCP error: ${(err as Error).message}`);
		});
		this.client.on("connected", () => {
			log.info("Chitragupta MCP connected");
		});
	}

	/**
	 * Connect to Chitragupta.
	 *
	 * Tries daemon socket first (zero cold-start if daemon is running), then
	 * falls back to spawning the chitragupta-mcp subprocess via stdio.
	 */
	async connect(): Promise<void> {
		// socketPath === "" means socket mode explicitly disabled
		const socketPath = this.options.socketPath !== "" ? (this.options.socketPath ?? resolveSocketPath()) : null;

		if (socketPath) {
			const daemonUp = await probeSocket(socketPath);
			if (daemonUp) {
				this._socket = new DaemonSocketClient(socketPath, this.options.requestTimeoutMs);
				await this._socket.connect();
				this._socketMode = true;
				log.info("Chitragupta connected via daemon socket (fast path)");
				return;
			}
			log.debug("Chitragupta daemon not running — falling back to MCP subprocess");
		}

		await this.client.start();
	}

	/** Disconnect from Chitragupta. In socket mode, leaves the daemon running. */
	async disconnect(): Promise<void> {
		if (this._socketMode) {
			this._socket?.disconnect();
			this._socket = null;
			this._socketMode = false;
			return;
		}
		await this.client.stop();
	}

	/** Search project memory via GraphRAG or daemon FTS5. */
	async memorySearch(query: string, limit?: number): Promise<MemoryResult[]> {
		return queries.memorySearch(
			this._socket,
			this._socketMode,
			this.callTool.bind(this),
			this.parseResults.bind(this),
			query,
			limit,
			this.options.projectPath,
		);
	}

	/** Unified recall: search across sessions, day files, and memory markdown. */
	async unifiedRecall(query: string, limit?: number, project?: string): Promise<UnifiedRecallResult[]> {
		return queries.unifiedRecall(
			this._socket,
			this._socketMode,
			this.callTool.bind(this),
			this.parseResults.bind(this),
			query,
			limit,
			project,
			this.options.projectPath,
		);
	}

	/** List available day consolidation files. */
	async dayList(): Promise<string[]> {
		return ops.dayList(this._socket, this._socketMode);
	}

	/** Display content of a specific day file. */
	async dayShow(date: string): Promise<{ date: string; content: string | null }> {
		return ops.dayShow(this._socket, this._socketMode, date);
	}

	/** Search across day consolidation files. */
	async daySearch(query: string, limit?: number): Promise<DaySearchResult[]> {
		return ops.daySearch(this._socket, this._socketMode, query, limit);
	}

	/** Load and assemble provider context for a project. */
	async contextLoad(project: string): Promise<{ assembled: string; itemCount: number }> {
		return ops.contextLoad(this._socket, this._socketMode, project);
	}

	/** List recent sessions for this project. */
	async sessionList(limit?: number): Promise<ChitraguptaSessionInfo[]> {
		return queries.sessionList(
			this._socket,
			this._socketMode,
			this.callTool.bind(this),
			this.parseResults.bind(this),
			this.options.projectPath,
			limit,
		);
	}

	/** Show the full contents of a specific session. */
	async sessionShow(sessionId: string): Promise<SessionDetail> {
		return queries.sessionShow(
			this._socket,
			this._socketMode,
			this.callTool.bind(this),
			this.parseResults.bind(this),
			sessionId,
			this.options.projectPath,
		);
	}

	/** Get a work-state handover summary for context continuity. */
	async handover(): Promise<HandoverSummary> {
		if (this._socketMode) {
			// Daemon doesn't expose a handover method — return empty summary
			log.debug("Handover not available in socket mode — returning empty summary");
			return { originalRequest: "", filesModified: [], filesRead: [], decisions: [], errors: [], recentContext: "" };
		}
		const raw = await this.callTool("chitragupta_handover", {});
		return (
			this.parseResults<HandoverSummary>(raw) ?? {
				originalRequest: "",
				filesModified: [],
				filesRead: [],
				decisions: [],
				errors: [],
				recentContext: "",
			}
		);
	}

	/** Deposit a knowledge trace into the Akasha shared field. */
	async akashaDeposit(content: string, type: string, topics: string[]): Promise<void> {
		if (this._socketMode && this._socket) {
			// Best-effort: append to project memory as a tagged entry
			const entry = `[akasha:${type}] topics=${topics.join(",")} — ${content}`;
			await this._socket
				.call("memory.append", { scopeType: "project", scopePath: this.options.projectPath, entry })
				.catch(() => {
					/* best-effort */
				});
			return;
		}
		await this.callTool("akasha_deposit", { content, type, topics });
	}

	/** Query knowledge traces from the Akasha shared field. */
	async akashaTraces(query: string, limit?: number): Promise<AkashaTrace[]> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ results: Array<Record<string, unknown>> }>("memory.file_search", {
				query,
			});
			return (resp.results ?? []).slice(0, limit ?? 10).map((r) => ({
				content: String(r.content ?? r.text ?? ""),
				type: "memory",
				topics: [],
				strength: 0.5,
			}));
		}

		const params: Record<string, unknown> = { query };
		if (limit !== undefined) params.limit = limit;

		const raw = await this.callTool("akasha_traces", params);
		return this.parseResults<AkashaTrace[]>(raw) ?? [];
	}

	/**
	 * Retrieve crystallized behavioral tendencies (Vasanas) from Chitragupta's
	 * smriti layer. These represent stable patterns observed across sessions.
	 */
	async vasanaTendencies(limit?: number): Promise<VasanaTendency[]> {
		if (this._socketMode) {
			// Vasana extraction is MCP-only (requires @chitragupta/tantra)
			return [];
		}
		const params: Record<string, unknown> = {};
		if (limit !== undefined) params.limit = limit;
		const raw = await this.callTool("vasana_tendencies", params);
		return this.parseResults<VasanaTendency[]>(raw) ?? [];
	}

	/**
	 * Fetch an aggregate health snapshot from Chitragupta (Pancha-Kosha scoring,
	 * memory usage, active sessions, per-package grades).
	 * In socket mode returns a stub derived from daemon process stats.
	 */
	async healthStatus(): Promise<ChitraguptaHealth | null> {
		return queries.healthStatus(this._socket, this._socketMode, this.callTool.bind(this), this.parseResults.bind(this));
	}
	/** List learned procedures (vidhis) for a project. */
	async vidhiList(project: string, limit = 20): Promise<VidhiInfo[]> {
		return ops.vidhiList(this._socket, this._socketMode, this.callTool.bind(this), project, limit);
	}
	/** Match a learned procedure (vidhi) against a query. */
	async vidhiMatch(project: string, query: string): Promise<VidhiMatch | null> {
		return ops.vidhiMatch(this._socket, this._socketMode, this.callTool.bind(this), project, query);
	}
	/** Run memory consolidation for a project. */
	async consolidationRun(project: string, sessionCount = 20): Promise<ConsolidationResult> {
		if (this._socketMode && this._socket) {
			return await this._socket.call<ConsolidationResult>("consolidation.run", { project, sessionCount });
		}
		const result = await this.callTool("consolidation_run", { project, session_count: sessionCount });
		const content = result.content?.[0]?.text;
		if (!content) throw new Error("Consolidation failed");
		return JSON.parse(content) as ConsolidationResult;
	}
	/** Extract structured facts from text. */
	async factExtract(text: string, projectPath?: string): Promise<ExtractedFact[]> {
		return ops.factExtract(this._socket, this._socketMode, this.callTool.bind(this), text, projectPath);
	}

	// ── Phase 16: Session Write & Turn Tracking ─────────────────────────────

	/** Create a new session. */
	async sessionCreate(opts: SessionCreateOptions): Promise<SessionCreateResult> {
		return ops.sessionCreate(this._socket, this._socketMode, this.client, opts);
	}

	/** Update session metadata. */
	async sessionMetaUpdate(sessionId: string, updates: SessionMetaUpdates): Promise<{ updated: boolean }> {
		return ops.sessionMetaUpdate(this._socket, this._socketMode, this.client, sessionId, updates);
	}

	/** Add a turn to a session. */
	async turnAdd(sessionId: string, project: string, turn: Turn): Promise<TurnAddResult> {
		return ops.turnAdd(this._socket, this._socketMode, this.client, sessionId, project, turn);
	}

	/** Get the maximum turn number for a session. */
	async turnMaxNumber(sessionId: string): Promise<number> {
		return ops.turnMaxNumber(this._socket, this._socketMode, this.client, sessionId);
	}

	/** Check connection status. */
	get isConnected(): boolean {
		return this._socketMode ? (this._socket?.isConnected ?? false) : this.client.isConnected;
	}

	/** True when connected directly to the daemon socket (not via MCP subprocess). */
	get isSocketMode(): boolean {
		return this._socketMode;
	}

	/** Access the underlying McpClient (for advanced use / event forwarding). */
	get mcpClient(): McpClient {
		return this.client;
	}

	/** Access the underlying DaemonSocketClient (for notification subscriptions). */
	get daemonSocket(): DaemonSocketClient | null {
		return this._socket;
	}

	// ── Phase 17: Session Query & Turn Listing ────────────────────────────

	/** List all dates that have sessions. */
	async sessionDates(project?: string): Promise<string[]> {
		return ops.sessionDates(this._socket, this._socketMode, this.callTool.bind(this), project);
	}

	/** List all projects that have sessions. */
	async sessionProjects(): Promise<ChitraguptaProjectInfo[]> {
		return ops.sessionProjects(this._socket, this._socketMode, this.callTool.bind(this));
	}

	/** Query sessions modified since a timestamp. */
	async sessionModifiedSince(timestamp: number, project?: string): Promise<ChitraguptaSessionInfo[]> {
		return ops.sessionModifiedSince(this._socket, this._socketMode, this.callTool.bind(this), timestamp, project);
	}

	/** Delete a session by ID. */
	async sessionDelete(sessionId: string): Promise<{ deleted: boolean }> {
		return ops.sessionDelete(this._socket, this._socketMode, this.callTool.bind(this), sessionId);
	}

	/** List all turns in a session. */
	async turnList(sessionId: string): Promise<Turn[]> {
		return ops.turnList(this._socket, this._socketMode, this.callTool.bind(this), sessionId);
	}

	/** Query turns created since a timestamp. */
	async turnSince(timestamp: number, sessionId?: string): Promise<Turn[]> {
		return ops.turnSince(this._socket, this._socketMode, this.callTool.bind(this), timestamp, sessionId);
	}

	// ── Phase 18: Advanced Memory Features ───────────────────────────────

	/** List available memory scopes. */
	async memoryScopes(): Promise<MemoryScope[]> {
		return ops.memoryScopes(this._socket, this._socketMode, this.callTool.bind(this));
	}

	/** Get detailed daemon status and health metrics. */
	async daemonStatus(): Promise<DaemonStatus | null> {
		return ops.daemonStatus(this._socket, this._socketMode, this.callTool.bind(this));
	}

	// ── Phase 20.2: Telemetry Heartbeat Emission ─────────────────────────

	/**
	 * Emit telemetry heartbeat to local JSON file.
	 * Merges with cached data and writes atomically.
	 *
	 * @param data - Partial telemetry data to merge
	 * @param telemetryDir - Optional override for telemetry directory (for testing)
	 */
	async telemetryHeartbeat(data: Partial<AgentTelemetry>, telemetryDir = TELEMETRY_DIR): Promise<void> {
		this.telemetryCache = await telemetryHeartbeat(this.telemetryCache, data, telemetryDir);
	}

	/**
	 * Cleanup telemetry file for a specific PID.
	 * Safe to call even if file doesn't exist.
	 *
	 * @param pid - Process ID to cleanup
	 * @param telemetryDir - Optional override for telemetry directory (for testing)
	 */
	async telemetryCleanup(pid = process.pid, telemetryDir = TELEMETRY_DIR): Promise<void> {
		await telemetryCleanup(pid, telemetryDir);
	}

	/**
	 * Aggregate telemetry snapshot from all active instances.
	 * Filters stale instances based on heartbeat timestamp.
	 *
	 * @param staleMs - Milliseconds to consider instance stale (default: 10s)
	 * @param telemetryDir - Optional override for telemetry directory (for testing)
	 * @returns TelemetrySnapshot with aggregated stats
	 */
	async telemetrySnapshot(staleMs = 10000, telemetryDir = TELEMETRY_DIR): Promise<TelemetrySnapshot> {
		return await telemetrySnapshot(staleMs, telemetryDir);
	}

	// ── Internal helpers ──────────────────────────────────────────────────

	private async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
		return this.client.call<ToolCallResult>("tools/call", {
			name,
			arguments: args,
		});
	}

	/**
	 * Parse the MCP tool result.
	 * MCP tool responses come as { content: [{ type: "text", text: "..." }] }.
	 * The text field contains the JSON payload we need to parse.
	 */
	private parseResults<T>(raw: ToolCallResult): T | null {
		try {
			const textBlock = raw?.content?.find((c) => c.type === "text");
			if (textBlock?.text) {
				return JSON.parse(textBlock.text) as T;
			}
			// Fallback: try to use the raw result directly if it has the right shape
			return raw as unknown as T;
		} catch {
			log.warn("Failed to parse tool result");
			return null;
		}
	}
}
