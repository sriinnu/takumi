import type { SideAgentState, ToolDefinition } from "@takumi/core";
import type { ToolHandler } from "./registry.js";
import type { SideAgentToolDeps } from "./side-agent.js";
import {
	buildStructuredQueryPrompt,
	dispatchSideAgentWork,
	extractStructuredQueryResponse,
	reconcileMissingWindow,
	syncSideAgentRuntimeFromOutput,
} from "./side-agent-runtime.js";

const DEFAULT_CAPTURE_LINES = 50;
const QUERYABLE_STATES: SideAgentState[] = ["running", "waiting_user"];
const QUERY_POLL_INTERVAL_MS = 500;
const QUERY_TIMEOUT_MS = 60_000;

export const agentQueryDefinition: ToolDefinition = {
	name: "takumi_agent_query",
	description:
		"Send a structured query to a side agent and receive a structured JSON response. " +
		"Unlike takumi_agent_send (raw text), this returns parsed JSON results. " +
		"The side agent must be in a 'running' or 'waiting_user' state.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "The side agent ID to query." },
			query: { type: "string", description: "The question or request to send." },
			format: {
				type: "string",
				description: "Expected response format hint (e.g., 'json', 'summary', 'files'). Default: 'json'.",
			},
		},
		required: ["id", "query"],
	},
	requiresPermission: false,
	category: "interact",
};

export function createAgentQueryHandler(deps: SideAgentToolDeps): ToolHandler {
	return async (input, signal) => {
		const id = input.id as string;
		const query = input.query as string;
		const format = (input.format as string | undefined) ?? "json";

		if (!id || !query) {
			return { output: "Error: id and query are required", isError: true };
		}

		const agent = deps.agents.get(id);
		if (!agent) {
			return { output: `Error: unknown agent "${id}"`, isError: true };
		}

		if (!QUERYABLE_STATES.includes(agent.state)) {
			return {
				output: `Error: agent "${id}" is in state "${agent.state}" — can only query running or waiting_user agents`,
				isError: true,
			};
		}
		if (!(await deps.tmux.isWindowAlive(id))) {
			reconcileMissingWindow({ id, agents: deps.agents });
			return { output: `Error: agent "${id}" tmux window is missing`, isError: true };
		}

		const requestId = `${id}-${Date.now().toString(36)}`;
		const wrappedQuery = buildStructuredQueryPrompt(query, format, requestId);

		await dispatchSideAgentWork({
			id,
			kind: "query",
			prompt: wrappedQuery,
			requestId,
			format,
			agents: deps.agents,
			tmux: deps.tmux,
		});

		/**
		 * If the orchestrator supports tmux channels, I wait for the worker to
		 * signal rather than polling capture-pane every 500 ms. One blocking fork
		 * replaces ~120 capture-pane forks over the 60 s timeout window.
		 */
		if (deps.tmux.waitForChannel) {
			const _signaled = await deps.tmux.waitForChannel(
				`takumi-query-${requestId}`,
				QUERY_TIMEOUT_MS,
				signal ?? undefined,
			);
			if (signal?.aborted) {
				return { output: "Error: query aborted", isError: true };
			}
			// Whether signaled or timed out, do one capture-pane read.
			// Closes the race where signal fires just before we start waiting.
			let output = "";
			try {
				output = await deps.tmux.captureOutput(id, 100);
			} catch {
				/* fall through to raw timeout path */
			}
			syncSideAgentRuntimeFromOutput({ current: deps.agents.get(id) ?? agent, agents: deps.agents, output });
			try {
				const parsed = extractStructuredQueryResponse(output, requestId);
				if (parsed) {
					return {
						output: JSON.stringify(
							{ id, query, requestId, format, response: parsed, responseType: "structured" },
							null,
							"\t",
						),
						isError: false,
					};
				}
			} catch {
				/* JSON not valid, fall through */
			}
		} else {
			const startedAt = Date.now();
			while (Date.now() - startedAt < QUERY_TIMEOUT_MS) {
				if (signal?.aborted) {
					return { output: "Error: query aborted", isError: true };
				}

				await new Promise((resolve) => setTimeout(resolve, QUERY_POLL_INTERVAL_MS));

				let output = "";
				try {
					output = await deps.tmux.captureOutput(id, 100);
				} catch {
					continue;
				}
				syncSideAgentRuntimeFromOutput({ current: deps.agents.get(id) ?? agent, agents: deps.agents, output });

				try {
					const parsed = extractStructuredQueryResponse(output, requestId);
					if (parsed) {
						return {
							output: JSON.stringify(
								{ id, query, requestId, format, response: parsed, responseType: "structured" },
								null,
								"\t",
							),
							isError: false,
						};
					}
				} catch {
					// JSON not valid yet, keep polling
				}
			}
		}

		let rawOutput = "";
		try {
			rawOutput = await deps.tmux.captureOutput(id, DEFAULT_CAPTURE_LINES);
			syncSideAgentRuntimeFromOutput({ current: deps.agents.get(id) ?? agent, agents: deps.agents, output: rawOutput });
		} catch {
			rawOutput = "<no output available>";
		}

		return {
			output: JSON.stringify(
				{
					id,
					query,
					format,
					response: rawOutput,
					responseType: "raw",
					warning: "Timed out waiting for structured response",
				},
				null,
				"\t",
			),
			isError: false,
		};
	};
}
