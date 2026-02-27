/**
 * Tests for MCP tool discovery and forwarding.
 */

import { describe, expect, it, vi } from "vitest";
import type { McpConnection } from "../src/tools/mcp.js";
import { discoverMcpTools } from "../src/tools/mcp.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Create a mock MCP connection. */
function mockConnection(overrides?: Partial<McpConnection>): McpConnection {
	return {
		isConnected: true,
		call: vi.fn().mockResolvedValue({ tools: [] }),
		...overrides,
	};
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("discoverMcpTools", () => {
	it("returns empty when connection is not active", async () => {
		const conn = mockConnection({ isConnected: false });
		const result = await discoverMcpTools(conn);

		expect(result.definitions).toHaveLength(0);
		expect(result.handlers.size).toBe(0);
		expect(conn.call).not.toHaveBeenCalled();
	});

	it("discovers tools from MCP server", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({
				tools: [
					{
						name: "search",
						description: "Search docs",
						inputSchema: { type: "object", properties: { q: { type: "string" } } },
					},
					{ name: "fetch", description: "Fetch a URL" },
				],
			}),
		});

		const result = await discoverMcpTools(conn);

		expect(conn.call).toHaveBeenCalledWith("tools/list");
		expect(result.definitions).toHaveLength(2);
		expect(result.handlers.size).toBe(2);
	});

	it("prefixes tool names with default prefix", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({
				tools: [{ name: "search" }],
			}),
		});

		const result = await discoverMcpTools(conn);

		expect(result.definitions[0].name).toBe("mcp_search");
		expect(result.handlers.has("mcp_search")).toBe(true);
	});

	it("uses custom prefix when provided", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({
				tools: [{ name: "query" }],
			}),
		});

		const result = await discoverMcpTools(conn, "chitragupta_");

		expect(result.definitions[0].name).toBe("chitragupta_query");
		expect(result.handlers.has("chitragupta_query")).toBe(true);
	});

	it("sets reasonable defaults for missing tool fields", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({
				tools: [{ name: "bare_tool" }],
			}),
		});

		const result = await discoverMcpTools(conn);
		const def = result.definitions[0];

		expect(def.description).toContain("bare_tool");
		expect(def.inputSchema).toEqual({ type: "object", properties: {} });
		expect(def.requiresPermission).toBe(false);
		expect(def.category).toBe("interact");
	});

	it("preserves tool description and inputSchema from server", async () => {
		const schema = { type: "object", properties: { path: { type: "string" } } };
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({
				tools: [{ name: "read", description: "Read a file", inputSchema: schema }],
			}),
		});

		const result = await discoverMcpTools(conn);
		const def = result.definitions[0];

		expect(def.description).toBe("Read a file");
		expect(def.inputSchema).toEqual(schema);
	});

	it("handles empty tools list from server", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({ tools: [] }),
		});

		const result = await discoverMcpTools(conn);

		expect(result.definitions).toHaveLength(0);
		expect(result.handlers.size).toBe(0);
	});

	it("handles missing tools key in response", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({}),
		});

		const result = await discoverMcpTools(conn);

		expect(result.definitions).toHaveLength(0);
	});

	it("returns empty on call failure", async () => {
		const conn = mockConnection({
			call: vi.fn().mockRejectedValue(new Error("Connection refused")),
		});

		const result = await discoverMcpTools(conn);

		expect(result.definitions).toHaveLength(0);
		expect(result.handlers.size).toBe(0);
	});
});

describe("MCP tool handler execution", () => {
	it("calls MCP server with tool/call method", async () => {
		const callFn = vi
			.fn()
			.mockResolvedValueOnce({
				tools: [{ name: "echo" }],
			})
			.mockResolvedValueOnce({
				content: [{ type: "text", text: "hello world" }],
			});

		const conn = mockConnection({ call: callFn });
		const { handlers } = await discoverMcpTools(conn);
		const handler = handlers.get("mcp_echo")!;

		const result = await handler({ message: "hello" });

		expect(callFn).toHaveBeenCalledWith("tools/call", {
			name: "echo",
			arguments: { message: "hello" },
		});
		expect(result.output).toBe("hello world");
		expect(result.isError).toBe(false);
	});

	it("returns error when server is disconnected during call", async () => {
		const conn = mockConnection({
			call: vi.fn().mockResolvedValue({
				tools: [{ name: "test" }],
			}),
		});

		const { handlers } = await discoverMcpTools(conn);
		const handler = handlers.get("mcp_test")!;

		// Disconnect after discovery
		Object.defineProperty(conn, "isConnected", { value: false });

		const result = await handler({});
		expect(result.isError).toBe(true);
		expect(result.output).toContain("not connected");
	});

	it("returns error when MCP call throws", async () => {
		const callFn = vi
			.fn()
			.mockResolvedValueOnce({ tools: [{ name: "fail" }] })
			.mockRejectedValueOnce(new Error("Timeout"));

		const conn = mockConnection({ call: callFn });
		const { handlers } = await discoverMcpTools(conn);
		const handler = handlers.get("mcp_fail")!;

		const result = await handler({});
		expect(result.isError).toBe(true);
		expect(result.output).toContain("Timeout");
	});

	it("returns error text from MCP server", async () => {
		const callFn = vi
			.fn()
			.mockResolvedValueOnce({ tools: [{ name: "broken" }] })
			.mockResolvedValueOnce({
				content: [{ type: "text", text: "not found" }],
				isError: true,
			});

		const conn = mockConnection({ call: callFn });
		const { handlers } = await discoverMcpTools(conn);
		const handler = handlers.get("mcp_broken")!;

		const result = await handler({ id: "abc" });
		expect(result.isError).toBe(true);
		expect(result.output).toBe("not found");
	});

	it("handles aborted signal", async () => {
		const callFn = vi.fn().mockResolvedValue({
			tools: [{ name: "slow" }],
		});
		const conn = mockConnection({ call: callFn });
		const { handlers } = await discoverMcpTools(conn);
		const handler = handlers.get("mcp_slow")!;

		const controller = new AbortController();
		controller.abort();

		const result = await handler({}, controller.signal);
		expect(result.isError).toBe(true);
		expect(result.output).toBe("Aborted");
	});

	it("joins multiple content blocks", async () => {
		const callFn = vi
			.fn()
			.mockResolvedValueOnce({ tools: [{ name: "multi" }] })
			.mockResolvedValueOnce({
				content: [
					{ type: "text", text: "line 1" },
					{ type: "text", text: "line 2" },
					{ type: "image", url: "http://img" },
				],
			});

		const conn = mockConnection({ call: callFn });
		const { handlers } = await discoverMcpTools(conn);
		const handler = handlers.get("mcp_multi")!;

		const result = await handler({});
		expect(result.output).toContain("line 1");
		expect(result.output).toContain("line 2");
	});
});
