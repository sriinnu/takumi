/**
 * MCP tool — forwards tool calls to an MCP server.
 *
 * Bridges the agent tool interface to connected MCP servers
 * (e.g. chitragupta-mcp). Discovers available tools via the
 * MCP `tools/list` method and delegates execution via `tools/call`.
 */

import type { ToolDefinition, ToolResult } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

const log = createLogger("mcp-tool");

// ── MCP tool list/call types (JSON-RPC payloads) ──────────────────────────────

interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

interface McpToolCallResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

/**
 * Minimal MCP client interface — only the two methods we need.
 * This avoids coupling to the concrete McpClient class.
 */
export interface McpConnection {
	call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
	readonly isConnected: boolean;
}

// ── Discover MCP tools ────────────────────────────────────────────────────────

/**
 * Query the MCP server for its available tools and convert them
 * to Takumi ToolDefinitions.
 */
export async function discoverMcpTools(
	conn: McpConnection,
	prefix = "mcp_",
): Promise<{ definitions: ToolDefinition[]; handlers: Map<string, ToolHandler> }> {
	if (!conn.isConnected) {
		log.warn("MCP connection is not active; skipping tool discovery");
		return { definitions: [], handlers: new Map() };
	}

	let tools: McpToolInfo[];
	try {
		const result = (await conn.call("tools/list")) as { tools?: McpToolInfo[] };
		tools = result.tools ?? [];
	} catch (err) {
		log.error(`Failed to discover MCP tools: ${(err as Error).message}`);
		return { definitions: [], handlers: new Map() };
	}

	log.info(`Discovered ${tools.length} MCP tools`);

	const definitions: ToolDefinition[] = [];
	const handlers = new Map<string, ToolHandler>();

	for (const tool of tools) {
		const name = `${prefix}${tool.name}`;

		const def: ToolDefinition = {
			name,
			description: tool.description ?? `MCP tool: ${tool.name}`,
			inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
			requiresPermission: false,
			category: "interact",
		};

		definitions.push(def);
		handlers.set(name, createMcpHandler(conn, tool.name));
	}

	return { definitions, handlers };
}

// ── Execute an MCP tool ───────────────────────────────────────────────────────

/**
 * Create a ToolHandler that forwards execution to the MCP server.
 */
function createMcpHandler(conn: McpConnection, mcpToolName: string): ToolHandler {
	return async (input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> => {
		if (!conn.isConnected) {
			return { output: "MCP server is not connected", isError: true };
		}

		if (signal?.aborted) {
			return { output: "Aborted", isError: true };
		}

		log.info(`Calling MCP tool: ${mcpToolName}`, { input: summarize(input) });

		try {
			const result = await conn.call<McpToolCallResult>("tools/call", {
				name: mcpToolName,
				arguments: input,
			});

			const text = extractText(result);
			const isError = result.isError ?? false;

			if (isError) {
				log.warn(`MCP tool ${mcpToolName} returned error: ${text.slice(0, 200)}`);
			}

			return { output: text, isError };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.error(`MCP tool ${mcpToolName} failed: ${message}`);
			return { output: `MCP error: ${message}`, isError: true };
		}
	};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract text content from an MCP tool-call response. */
function extractText(result: McpToolCallResult): string {
	if (!result.content || !Array.isArray(result.content)) {
		return JSON.stringify(result);
	}

	return result.content
		.map((block) => {
			if (block.type === "text" && block.text) return block.text;
			return JSON.stringify(block);
		})
		.join("\n");
}

/** Summarize tool input for logging (avoid dumping large payloads). */
function summarize(input: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(input)) {
		const s = typeof v === "string" ? v : JSON.stringify(v);
		out[k] = s.length > 100 ? `${s.slice(0, 97)}...` : s;
	}
	return out;
}
