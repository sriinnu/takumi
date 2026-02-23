import type { ChitraguptaBridge } from "@takumi/bridge";
import type { ToolDefinition, ToolResult } from "@takumi/core";

export const akashaDepositDefinition: ToolDefinition = {
	name: "akasha_deposit",
	description:
		"Deposit a knowledge trace into the Akasha shared field. Use this to share context, intermediate results, or important findings with other agents in the cluster.",
	inputSchema: {
		type: "object",
		properties: {
			content: {
				type: "string",
				description: "The knowledge or context to share.",
			},
			type: {
				type: "string",
				description: "The type of knowledge (e.g., 'finding', 'plan', 'error', 'summary').",
			},
			topics: {
				type: "array",
				items: { type: "string" },
				description: "List of topics or tags related to this knowledge.",
			},
		},
		required: ["content", "type", "topics"],
	},
	requiresPermission: false,
	category: "write",
};

export const akashaTracesDefinition: ToolDefinition = {
	name: "akasha_traces",
	description:
		"Query knowledge traces from the Akasha shared field. Use this to retrieve context or findings shared by other agents.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "The search query to find relevant traces.",
			},
			limit: {
				type: "number",
				description: "Maximum number of traces to return (default: 5).",
			},
		},
		required: ["query"],
	},
	requiresPermission: false,
	category: "read",
};

export function createAkashaHandlers(
	bridge: ChitraguptaBridge,
	onDeposit?: () => void,
	onTraceQuery?: () => void,
) {
	return {
		deposit: async (input: Record<string, unknown>): Promise<ToolResult> => {
			try {
				const content = String(input.content);
				const type = String(input.type);
				const topics = Array.isArray(input.topics) ? input.topics.map(String) : [];

				await bridge.akashaDeposit(content, type, topics);
				
				// Notify state of deposit
				onDeposit?.();
				
				return {
					output: "Successfully deposited trace into Akasha.",
					isError: false,
				};
			} catch (err) {
				return {
					output: `Failed to deposit trace: ${err instanceof Error ? err.message : String(err)}`,
					isError: true,
				};
			}
		},
		traces: async (input: Record<string, unknown>): Promise<ToolResult> => {
			try {
				const query = String(input.query);
				const limit = typeof input.limit === "number" ? input.limit : 5;

				const traces = await bridge.akashaTraces(query, limit);
				
				// Notify state of trace query activity
				onTraceQuery?.();
				
				if (traces.length === 0) {
					return {
						output: "No relevant traces found in Akasha.",
						isError: false,
					};
				}

				const formatted = traces.map((t) => `[${t.type}] (Topics: ${t.topics.join(", ")})\n${t.content}`).join("\n\n");
				return {
					output: `Found ${traces.length} traces:\n\n${formatted}`,
					isError: false,
				};
			} catch (err) {
				return {
					output: `Failed to query traces: ${err instanceof Error ? err.message : String(err)}`,
					isError: true,
				};
			}
		},
	};
}
