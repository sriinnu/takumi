/**
 * Side-agent stop tool — operator-driven lane teardown.
 *
 * I keep stop semantics in a dedicated module so the main side-agent tool file
 * stays under the repo guardrail while the stop contract remains explicit.
 */

import type { SideAgentState, ToolDefinition } from "@takumi/core";
import type { ToolHandler } from "./registry.js";
import type { SideAgentToolDeps } from "./side-agent.js";

const OPERATOR_STOP_REASON = "Stopped by operator";

export const agentStopDefinition: ToolDefinition = {
	name: "takumi_agent_stop",
	description:
		"Stop a running or waiting side agent, close its tmux window, and release its worktree slot. " +
		"Use this when an exploratory lane is no longer needed.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "The side agent ID to stop." },
		},
		required: ["id"],
	},
	requiresPermission: true,
	category: "execute",
};

export function createAgentStopHandler(deps: SideAgentToolDeps): ToolHandler {
	return async (input) => {
		const id = input.id as string;

		if (!id) {
			return { output: "Error: id is required", isError: true };
		}

		const agent = deps.agents.get(id);
		if (!agent) {
			return { output: `Error: unknown agent "${id}"`, isError: true };
		}

		// I treat terminal agents as idempotent stops so the operator surface stays predictable.
		if (agent.state === "stopped" || agent.state === "done" || agent.state === "failed" || agent.state === "crashed") {
			return {
				output: JSON.stringify({ id, state: agent.state, alreadyStopped: true }, null, "\t"),
				isError: false,
			};
		}

		const stoppableStates: SideAgentState[] = [
			"allocating_worktree",
			"spawning_tmux",
			"starting",
			"running",
			"waiting_user",
			"finishing",
			"waiting_merge_lock",
			"retrying_reconcile",
		];
		if (!stoppableStates.includes(agent.state)) {
			return {
				output: `Error: agent "${id}" is in state "${agent.state}" — can only stop live side agents`,
				isError: true,
			};
		}

		deps.agents.transition(id, "stopped", OPERATOR_STOP_REASON);
		const cleanupErrors: string[] = [];
		let clearedTmux = false;
		let clearedWorktree = false;
		try {
			if (await deps.tmux.isWindowAlive(id)) {
				await deps.tmux.killWindow(id);
			}
			clearedTmux = true;
		} catch (error) {
			cleanupErrors.push(`tmux cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (agent.slotId) {
			try {
				await deps.pool.release(agent.slotId);
				clearedWorktree = true;
			} catch (error) {
				cleanupErrors.push(`worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		deps.agents.update(id, {
			tmuxWindow: clearedTmux ? null : agent.tmuxWindow,
			tmuxSessionName: clearedTmux ? null : agent.tmuxSessionName,
			tmuxWindowId: clearedTmux ? null : agent.tmuxWindowId,
			tmuxPaneId: clearedTmux ? null : agent.tmuxPaneId,
			slotId: clearedWorktree ? null : agent.slotId,
			worktreePath: clearedWorktree ? null : agent.worktreePath,
			error: cleanupErrors.length > 0 ? `${OPERATOR_STOP_REASON}. ${cleanupErrors.join(" ")}` : agent.error,
		});

		return {
			output: JSON.stringify(
				{
					id,
					state: "stopped",
					reason: OPERATOR_STOP_REASON,
					closedWindow: Boolean(agent.tmuxWindow),
					releasedWorktree: Boolean(agent.slotId),
					cleanupErrors: cleanupErrors.length > 0 ? cleanupErrors : undefined,
				},
				null,
				"\t",
			),
			isError: cleanupErrors.length > 0,
		};
	};
}
