/**
 * Side Agent Bus Tool — takumi_agent_bus_publish
 *
 * Lets the main agent publish structured messages directly onto the shared
 * AgentBus so it can coordinate with running side agents and announce
 * discoveries without going through tmux.
 *
 * Registered separately from the core side-agent tools to keep
 * side-agent.ts within the 450-line LOC guard.
 */

import type { ToolDefinition } from "@takumi/core";
import type { AgentBus } from "../cluster/agent-bus.js";
import { buildTaskRequest } from "../cluster/agent-bus.js";
import { AgentMessagePriority } from "../cluster/types.js";
import type { ToolHandler, ToolRegistry } from "./registry.js";

// ── Dependency bundle ────────────────────────────────────────────────────────

export interface SideAgentBusDeps {
	bus: AgentBus;
	/** ID used as the `from` field when publishing (default: "main"). */
	agentId?: string;
}

// ── takumi_agent_bus_publish ─────────────────────────────────────────────────

export const agentBusPublishDefinition: ToolDefinition = {
	name: "takumi_agent_bus_publish",
	description:
		"Publish a structured message onto the shared agent bus. " +
		"Other agents subscribed to the bus will receive the message immediately. " +
		"Supports three message types: " +
		"'task_request' (delegate work to a specific agent or broadcast), " +
		"'discovery_share' (broadcast knowledge / a finding), " +
		"'help_request' (ask other agents for assistance with a subtask).",
	inputSchema: {
		type: "object",
		properties: {
			type: {
				type: "string",
				enum: ["task_request", "discovery_share", "help_request"],
				description: "Type of message to publish on the bus.",
			},
			description: {
				type: "string",
				description:
					"For task_request / help_request: the task or help description. " +
					"For discovery_share: a human-readable summary of the finding.",
			},
			topic: {
				type: "string",
				description: "For discovery_share: the knowledge topic (e.g. 'security', 'test-results').",
			},
			payload: {
				type: "object",
				description: "For discovery_share: structured data to share (arbitrary JSON object).",
			},
			to: {
				type: "string",
				description: "For task_request: target agent ID. Omit to broadcast to all agents.",
			},
			priority: {
				type: "string",
				enum: ["LOW", "NORMAL", "HIGH", "CRITICAL"],
				description:
					"Message priority for task_request. Defaults to NORMAL. " +
					"HIGH/CRITICAL messages bypass priority filters in bridge observers.",
			},
			requiredCapabilities: {
				type: "array",
				items: { type: "string" },
				description: "For help_request: list of capabilities needed (e.g. ['typescript', 'testing']).",
			},
		},
		required: ["type", "description"],
	},
	requiresPermission: false,
	category: "interact",
};

export function createAgentBusPublishHandler(deps: SideAgentBusDeps): ToolHandler {
	const from = deps.agentId ?? "main";

	return async (input) => {
		const type = input.type as "task_request" | "discovery_share" | "help_request";
		const description = input.description as string;

		if (!description) {
			return { output: "Error: description is required", isError: true };
		}

		switch (type) {
			case "task_request": {
				const to = (input.to as string | undefined) ?? null;
				const priorityKey = (input.priority as string | undefined) ?? "NORMAL";
				const priorityMap: Record<string, AgentMessagePriority> = {
					LOW: AgentMessagePriority.LOW,
					NORMAL: AgentMessagePriority.NORMAL,
					HIGH: AgentMessagePriority.HIGH,
					CRITICAL: AgentMessagePriority.CRITICAL,
				};
				const priority = priorityMap[priorityKey] ?? AgentMessagePriority.NORMAL;
				const msg = buildTaskRequest(from, to, description, { priority });
				deps.bus.publish(msg);
				return {
					output: JSON.stringify({ published: true, id: msg.id, type, to, priority: priorityKey }, null, "\t"),
					isError: false,
				};
			}

			case "discovery_share": {
				const topic = (input.topic as string | undefined) ?? "general";
				const payload = (input.payload as Record<string, unknown> | undefined) ?? { summary: description };
				const msg = {
					type: "discovery_share" as const,
					id: `disc-${Date.now()}`,
					from,
					topic,
					payload,
					timestamp: Date.now(),
				};
				deps.bus.publish(msg);
				return {
					output: JSON.stringify({ published: true, id: msg.id, type, topic }, null, "\t"),
					isError: false,
				};
			}

			case "help_request": {
				const requiredCapabilities = (input.requiredCapabilities as string[] | undefined) ?? [];
				const msg = {
					type: "help_request" as const,
					id: `help-${Date.now()}`,
					from,
					description,
					requiredCapabilities,
					timestamp: Date.now(),
				};
				deps.bus.publish(msg);
				return {
					output: JSON.stringify({ published: true, id: msg.id, type, requiredCapabilities }, null, "\t"),
					isError: false,
				};
			}

			default:
				return { output: `Error: unknown message type "${type}"`, isError: true };
		}
	};
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Register the bus publish tool in the given ToolRegistry. */
export function registerSideAgentBusTools(registry: ToolRegistry, deps: SideAgentBusDeps): void {
	registry.register(agentBusPublishDefinition, createAgentBusPublishHandler(deps));
}
