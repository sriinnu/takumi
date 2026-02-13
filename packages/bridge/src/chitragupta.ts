/**
 * ChitraguptaBridge -- High-level bridge to the Chitragupta MCP memory server.
 * Wraps McpClient with typed methods for each Chitragupta tool.
 */

import { createLogger } from "@takumi/core";
import { McpClient, type McpClientOptions } from "./mcp-client.js";

const log = createLogger("chitragupta-bridge");

// ── Return types ─────────────────────────────────────────────────────────────

export interface MemoryResult {
	content: string;
	relevance: number;
	source?: string;
}

export interface ChitraguptaSessionInfo {
	id: string;
	title: string;
	timestamp: number;
	turns: number;
}

export interface SessionDetail {
	id: string;
	title: string;
	turns: Array<{ role: string; content: string; timestamp: number }>;
}

export interface HandoverSummary {
	originalRequest: string;
	filesModified: string[];
	filesRead: string[];
	decisions: string[];
	errors: string[];
	recentContext: string;
}

export interface AkashaTrace {
	content: string;
	type: string;
	topics: string[];
	strength: number;
}

// ── MCP tool response wrappers ───────────────────────────────────────────────

interface ToolCallResult {
	content?: Array<{ type: string; text?: string }>;
}

// ── Bridge options ───────────────────────────────────────────────────────────

export interface ChitraguptaBridgeOptions {
	/** Path to the chitragupta-mcp binary. Default: "chitragupta-mcp". */
	command?: string;
	/** Arguments for the binary. Default: ["--transport", "stdio"]. */
	args?: string[];
	/** Project path passed as environment variable. */
	projectPath?: string;
	/** Startup timeout in ms. Default: 5000. */
	startupTimeoutMs?: number;
	/** Per-request timeout in ms. Default: 10000. */
	requestTimeoutMs?: number;
}

// ── ChitraguptaBridge ────────────────────────────────────────────────────────

export class ChitraguptaBridge {
	private client: McpClient;

	constructor(options?: ChitraguptaBridgeOptions) {
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

		// Forward events for observability
		this.client.on("disconnected", (code) => {
			log.warn(`Chitragupta disconnected (exit code ${code})`);
		});
		this.client.on("error", (err) => {
			log.error(`Chitragupta error: ${(err as Error).message}`);
		});
		this.client.on("connected", () => {
			log.info("Chitragupta connected");
		});
	}

	/** Start the Chitragupta MCP server and establish the connection. */
	async connect(): Promise<void> {
		await this.client.start();
	}

	/** Disconnect from Chitragupta. */
	async disconnect(): Promise<void> {
		await this.client.stop();
	}

	/** Search project memory via GraphRAG. */
	async memorySearch(query: string, limit?: number): Promise<MemoryResult[]> {
		const params: Record<string, unknown> = { query };
		if (limit !== undefined) params.limit = limit;

		const raw = await this.callTool("chitragupta_memory_search", params);
		return this.parseResults<MemoryResult[]>(raw) ?? [];
	}

	/** List recent sessions for this project. */
	async sessionList(limit?: number): Promise<ChitraguptaSessionInfo[]> {
		const params: Record<string, unknown> = {};
		if (limit !== undefined) params.limit = limit;

		const raw = await this.callTool("chitragupta_session_list", params);
		return this.parseResults<ChitraguptaSessionInfo[]>(raw) ?? [];
	}

	/** Show the full contents of a specific session. */
	async sessionShow(sessionId: string): Promise<SessionDetail> {
		const raw = await this.callTool("chitragupta_session_show", { sessionId });
		return this.parseResults<SessionDetail>(raw) ?? { id: sessionId, title: "", turns: [] };
	}

	/** Get a work-state handover summary for context continuity. */
	async handover(): Promise<HandoverSummary> {
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
		await this.callTool("akasha_deposit", { content, type, topics });
	}

	/** Query knowledge traces from the Akasha shared field. */
	async akashaTraces(query: string, limit?: number): Promise<AkashaTrace[]> {
		const params: Record<string, unknown> = { query };
		if (limit !== undefined) params.limit = limit;

		const raw = await this.callTool("akasha_traces", params);
		return this.parseResults<AkashaTrace[]>(raw) ?? [];
	}

	/** Check connection status. */
	get isConnected(): boolean {
		return this.client.isConnected;
	}

	/** Access the underlying McpClient (for advanced use). */
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
