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

import { createLogger } from "@takumi/core";
import type {
	AkashaTrace,
	ChitraguptaBridgeOptions,
	ChitraguptaHealth,
	ChitraguptaSessionInfo,
	DaySearchResult,
	HandoverSummary,
	MemoryResult,
	SessionDetail,
	UnifiedRecallResult,
	VasanaTendency,
} from "./chitragupta-types.js";
import { DaemonSocketClient, probeSocket, resolveSocketPath } from "./daemon-socket.js";
import { McpClient, type McpClientOptions } from "./mcp-client.js";

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
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ results: Array<Record<string, unknown>> }>("memory.recall", {
				query,
				limit: limit ?? 5,
				project: this.options.projectPath,
			});
			return (resp.results ?? []).map((r, i) => ({
				content: String(r.content ?? ""),
				relevance: +(1 - i / Math.max(resp.results.length, 1)).toFixed(3),
				source: String(r.session_id ?? ""),
			}));
		}

		const params: Record<string, unknown> = { query };
		if (limit !== undefined) params.limit = limit;

		const raw = await this.callTool("chitragupta_memory_search", params);
		return this.parseResults<MemoryResult[]>(raw) ?? [];
	}

	/** Unified recall: search across sessions, day files, and memory markdown. */
	async unifiedRecall(query: string, limit?: number, project?: string): Promise<UnifiedRecallResult[]> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ results: Array<Record<string, unknown>> }>("memory.unified_recall", {
				query,
				limit: limit ?? 5,
				project: project ?? this.options.projectPath,
			});
			return (resp.results ?? []).map((r) => ({
				content: String(r.content ?? ""),
				score: Number(r.score ?? 0),
				source: String(r.source ?? ""),
				type: String(r.type ?? "session"),
			}));
		}
		// MCP fallback: use legacy memory search
		const legacy = await this.memorySearch(query, limit);
		return legacy.map((r) => ({
			content: r.content,
			score: r.relevance,
			source: r.source ?? "",
			type: "session",
		}));
	}

	/** List available day consolidation files. */
	async dayList(): Promise<string[]> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ dates: string[] }>("day.list", {});
			return resp.dates ?? [];
		}
		// MCP fallback: no day files available
		return [];
	}

	/** Display content of a specific day file. */
	async dayShow(date: string): Promise<{ date: string; content: string | null }> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ date: string; content: string | null }>("day.show", { date });
			return { date: resp.date ?? date, content: resp.content ?? null };
		}
		// MCP fallback: no day files available
		return { date, content: null };
	}

	/** Search across day consolidation files. */
	async daySearch(query: string, limit?: number): Promise<DaySearchResult[]> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ results: Array<Record<string, unknown>> }>("day.search", {
				query,
				limit: limit ?? 10,
			});
			return (resp.results ?? []).map((r) => ({
				date: String(r.date ?? ""),
				content: String(r.content ?? ""),
				score: Number(r.score ?? 0),
			}));
		}
		// MCP fallback: no day files available
		return [];
	}

	/** Load and assemble provider context for a project. */
	async contextLoad(project: string): Promise<{ assembled: string; itemCount: number }> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ assembled: string; itemCount: number }>("context.load", { project });
			return { assembled: resp.assembled ?? "", itemCount: resp.itemCount ?? 0 };
		}
		// MCP fallback: no context assembly available
		return { assembled: "", itemCount: 0 };
	}

	/** List recent sessions for this project. */
	async sessionList(limit?: number): Promise<ChitraguptaSessionInfo[]> {
		if (this._socketMode && this._socket) {
			const resp = await this._socket.call<{ sessions: Array<Record<string, unknown>> }>("session.list", {
				project: this.options.projectPath,
			});
			const slice = limit ? (resp.sessions ?? []).slice(0, limit) : (resp.sessions ?? []);
			return slice.map((s) => {
				const m = (s.meta ?? s) as Record<string, unknown>;
				return {
					id: String(m.id ?? ""),
					title: String(m.title ?? "Untitled"),
					timestamp: Number(m.updatedAt ?? m.createdAt ?? 0),
					turns: Number(m.turnCount ?? 0),
				};
			});
		}

		const params: Record<string, unknown> = {};
		if (limit !== undefined) params.limit = limit;

		const raw = await this.callTool("chitragupta_session_list", params);
		return this.parseResults<ChitraguptaSessionInfo[]>(raw) ?? [];
	}

	/** Show the full contents of a specific session. */
	async sessionShow(sessionId: string): Promise<SessionDetail> {
		if (this._socketMode && this._socket) {
			try {
				const resp = await this._socket.call<Record<string, unknown>>("session.show", {
					id: sessionId,
					project: this.options.projectPath ?? "",
				});
				const m = (resp.meta ?? resp) as Record<string, unknown>;
				const rawTurns = (resp.turns ?? []) as Array<Record<string, unknown>>;
				return {
					id: String(m.id ?? sessionId),
					title: String(m.title ?? "Untitled"),
					turns: rawTurns.map((t) => ({
						role: String(t.role ?? "user"),
						content: String(t.content ?? ""),
						timestamp: Number(t.timestamp ?? t.createdAt ?? 0),
					})),
				};
			} catch {
				return { id: sessionId, title: "", turns: [] };
			}
		}

		const raw = await this.callTool("chitragupta_session_show", { sessionId });
		return this.parseResults<SessionDetail>(raw) ?? { id: sessionId, title: "", turns: [] };
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
		if (this._socketMode && this._socket) {
			try {
				const resp = await this._socket.call<Record<string, unknown>>("daemon.health");
				const conns = Number(resp.connections ?? 0);
				const rajas = Math.min(0.8, conns / 5);
				const sattva = Number(resp.uptime ?? 0) > 3600 ? 0.75 : 0.55;
				const tamas = Math.max(0, 1 - sattva - rajas);
				return {
					state: { sattva, rajas, tamas },
					dominant: rajas > 0.4 ? "rajas" : "sattva",
					trend: { sattva: "stable", rajas: "stable", tamas: "stable" },
					alerts: [],
					history: [],
				};
			} catch {
				return null;
			}
		}
		const raw = await this.callTool("health_status", {});
		return this.parseResults<ChitraguptaHealth>(raw);
	}

	/** Check connection status. */
	get isConnected(): boolean {
		if (this._socketMode) return this._socket?.isConnected ?? false;
		return this.client.isConnected;
	}

	/** True when connected directly to the daemon socket (not via MCP subprocess). */
	get isSocketMode(): boolean {
		return this._socketMode;
	}

	/** Access the underlying McpClient (for advanced use / event forwarding). */
	get mcpClient(): McpClient {
		return this.client;
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
