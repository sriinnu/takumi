/**
 * Side Agent Tool API — Phase 21.5
 * Tool surface for spawning, monitoring, messaging, and querying side agents
 * running in isolated worktrees + tmux windows.
 */

import type { SideAgentInfo, SideAgentState, ToolDefinition } from "@takumi/core";
import type { MuxAdapter } from "../cluster/mux-adapter.js";
import type { SideAgentRegistry } from "../cluster/side-agent-registry.js";
import type { WorktreePoolManager } from "../cluster/worktree-pool.js";
import type { ToolHandler, ToolRegistry } from "./registry.js";
import { agentQueryDefinition, createAgentQueryHandler } from "./side-agent-query.js";
import { resolveSideAgentRouting } from "./side-agent-routing.js";
import {
	buildInitialSideAgentPrompt,
	buildSideAgentWorkerLaunchCommand,
	dispatchSideAgentWork,
	isTmuxWindowPending,
	reconcileMissingWindow,
	rollbackFailedStart,
	syncSideAgentRuntimeFromOutput,
	waitForSideAgentReady,
} from "./side-agent-runtime.js";
import { agentStopDefinition, createAgentStopHandler } from "./side-agent-stop.js";

export { agentQueryDefinition, createAgentQueryHandler } from "./side-agent-query.js";
export { agentStopDefinition, createAgentStopHandler } from "./side-agent-stop.js";

export interface SideAgentToolDeps {
	pool: WorktreePoolManager;
	mux: MuxAdapter;
	agents: SideAgentRegistry;
	repoRoot: string;
	defaultModel?: string;
}

const DEFAULT_WAIT_STATES: SideAgentState[] = ["stopped", "done", "failed", "crashed", "waiting_user"];
const DEFAULT_CAPTURE_LINES = 50;
const _WAIT_POLL_MS = 250;
const WAIT_TIMEOUT_MS = 300_000; // 5 minutes

// ── takumi_agent_start ────────────────────────────────────────────────────────

export const agentStartDefinition: ToolDefinition = {
	name: "takumi_agent_start",
	description:
		"Spawn a new side agent in an isolated worktree with its own tmux window. " +
		"Returns the agent ID and initial status. The side agent will work in parallel " +
		"on the described task.",
	inputSchema: {
		type: "object",
		properties: {
			description: {
				type: "string",
				description: "A clear description of the task for the side agent to perform.",
			},
			initialPrompt: {
				type: "string",
				description: "Optional prompt to send immediately after the side-agent lane boots.",
			},
			model: {
				type: "string",
				description: "LLM model to use for the side agent (uses default if omitted).",
			},
			preferredModel: {
				type: "string",
				description:
					"Optional preferred fallback model for the side agent. Topic-aware routing still takes precedence.",
			},
			topic: {
				type: "string",
				description:
					"Optional task topic for topic-aware model routing (for example: code-review, debugging, testing).",
			},
			complexity: {
				type: "string",
				description: "Optional task complexity hint: TRIVIAL, SIMPLE, STANDARD, or CRITICAL.",
			},
		},
		required: ["description"],
	},
	requiresPermission: true,
	category: "execute",
};

export function createAgentStartHandler(deps: SideAgentToolDeps): ToolHandler {
	return async (input) => {
		const description = input.description as string;
		const initialPrompt = input.initialPrompt as string | undefined;
		const routing = resolveSideAgentRouting({
			description,
			model: input.model,
			topic: input.topic,
			complexity: input.complexity,
			preferredModel: input.preferredModel,
			defaultModel: deps.defaultModel,
		});
		const model = routing.model;

		if (!description) {
			return { output: "Error: description is required", isError: true };
		}

		if (!deps.pool.hasCapacity()) {
			return {
				output: "Error: worktree pool is at capacity. Wait for an existing agent to finish or release a slot.",
				isError: true,
			};
		}

		const id = deps.agents.nextId();
		const now = Date.now();

		let slotId: string | null = null;
		try {
			const slot = await deps.pool.allocate(id);
			slotId = slot.id;

			const agent: SideAgentInfo = {
				id,
				description,
				state: "allocating_worktree",
				model,
				slotId: slot.id,
				worktreePath: slot.path,
				tmuxWindow: null,
				tmuxSessionName: null,
				tmuxWindowId: null,
				tmuxPaneId: null,
				branch: slot.branch,
				pid: null,
				startedAt: now,
				updatedAt: now,
				dispatchSequence: 0,
				reuseCount: 0,
				leaseOwner: null,
				leaseExpiresAt: null,
				lastHeartbeatAt: null,
				lastDispatchAt: null,
				lastDispatchKind: null,
				lastRunStartedAt: null,
				lastRunFinishedAt: null,
				lastRunExitCode: null,
				lastRunRequestId: null,
			};

			deps.agents.register(agent);
			deps.agents.transition(id, "spawning_tmux");

			const win = await deps.mux.createWindow(id, slot.path);
			deps.agents.update(id, {
				tmuxWindow: win.name,
				tmuxWindowId: win.id,
				tmuxSessionName: null,
				tmuxPaneId: null,
			});
			deps.agents.transition(id, "starting");

			const workerLaunch = buildSideAgentWorkerLaunchCommand({
				id,
				model,
				repoRoot: deps.repoRoot,
				worktreePath: slot.path,
			});
			await deps.mux.sendKeys(id, workerLaunch);
			await waitForSideAgentReady({ id, mux: deps.mux });

			const initialTask = buildInitialSideAgentPrompt(description, initialPrompt);
			const dispatched = await dispatchSideAgentWork({
				id,
				kind: "start",
				prompt: initialTask,
				agents: deps.agents,
				mux: deps.mux,
			});
			return {
				output: JSON.stringify(
					{
						id,
						status: "running",
						model,
						topic: routing.topic ?? null,
						routingSource: routing.source,
						worktree: slot.path,
						branch: slot.branch,
						tmuxWindow: win.name,
						dispatchSequence: dispatched.sequence,
					},
					null,
					"\t",
				),
				isError: false,
			};
		} catch (error) {
			const startupDetail = error instanceof Error ? error.message : String(error);
			const cleanup = await rollbackFailedStart({ id, slotId, agents: deps.agents, pool: deps.pool, mux: deps.mux });
			const cleanupDetail =
				cleanup.cleanupErrors.length > 0 ? ` Cleanup also failed: ${cleanup.cleanupErrors.join(" ")}` : "";
			if (cleanup.cleanupErrors.length > 0 && deps.agents.get(id)) {
				deps.agents.transition(
					id,
					"failed",
					`Failed to start side agent "${id}": ${startupDetail} Residual cleanup failed after startup error. ${cleanup.cleanupErrors.join(" ")}`,
				);
			}
			return {
				output: `Error: Failed to start side agent "${id}": ${startupDetail}${cleanupDetail}`,
				isError: true,
			};
		}
	};
}

// ── takumi_agent_check ────────────────────────────────────────────────────────

export const agentCheckDefinition: ToolDefinition = {
	name: "takumi_agent_check",
	description:
		"Check the status and recent terminal output of a side agent. " +
		"Returns the agent state and the last N lines of output.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "The side agent ID to check." },
		},
		required: ["id"],
	},
	requiresPermission: false,
	category: "read",
};

export function createAgentCheckHandler(deps: SideAgentToolDeps): ToolHandler {
	return async (input) => {
		const id = input.id as string;

		if (!id) {
			return { output: "Error: id is required", isError: true };
		}

		const agent = deps.agents.get(id);
		if (!agent) {
			return { output: `Error: unknown agent "${id}"`, isError: true };
		}

		let current = agent;
		let recentOutput = "";
		if (await deps.mux.isWindowAlive(id)) {
			try {
				recentOutput = await deps.mux.captureOutput(id, DEFAULT_CAPTURE_LINES);
				current = syncSideAgentRuntimeFromOutput({ current, agents: deps.agents, output: recentOutput });
			} catch {
				recentOutput = "<no output available>";
			}
		} else if (isTmuxWindowPending(agent)) {
			recentOutput = "<tmux window pending>";
		} else {
			reconcileMissingWindow({ id, agents: deps.agents });
			current = deps.agents.get(id) ?? { ...agent, state: "crashed", error: "tmux window missing" };
			recentOutput = "<tmux window missing>";
		}

		const result = {
			id: current.id,
			state: current.state,
			description: current.description,
			model: current.model,
			branch: current.branch,
			error: current.error ?? null,
			dispatchSequence: current.dispatchSequence ?? 0,
			reuseCount: current.reuseCount ?? 0,
			leaseOwner: current.leaseOwner ?? null,
			leaseExpiresAt: current.leaseExpiresAt ?? null,
			lastHeartbeatAt: current.lastHeartbeatAt ?? null,
			lastDispatchAt: current.lastDispatchAt ?? null,
			lastDispatchKind: current.lastDispatchKind ?? null,
			lastRunStartedAt: current.lastRunStartedAt ?? null,
			lastRunFinishedAt: current.lastRunFinishedAt ?? null,
			lastRunExitCode: current.lastRunExitCode ?? null,
			lastRunRequestId: current.lastRunRequestId ?? null,
			recentOutput,
		};

		return { output: JSON.stringify(result, null, "\t"), isError: false };
	};
}

// ── takumi_agent_wait_any ─────────────────────────────────────────────────────

export const agentWaitAnyDefinition: ToolDefinition = {
	name: "takumi_agent_wait_any",
	description:
		"Wait for any of the specified side agents to reach one of the target states. " +
		'Default target states: ["stopped", "done", "failed", "crashed", "waiting_user"]. ' +
		"Returns which agent changed and its new state.",
	inputSchema: {
		type: "object",
		properties: {
			ids: {
				type: "array",
				items: { type: "string" },
				description: "Array of side agent IDs to watch.",
			},
			states: {
				type: "array",
				items: { type: "string" },
				description: "Target states to wait for. Defaults to terminal + waiting_user states.",
			},
		},
		required: ["ids"],
	},
	requiresPermission: false,
	category: "interact",
};

export function createAgentWaitAnyHandler(deps: SideAgentToolDeps): ToolHandler {
	return async (input, signal) => {
		const ids = input.ids as string[];
		const states = (input.states as SideAgentState[] | undefined) ?? DEFAULT_WAIT_STATES;

		if (!ids || ids.length === 0) {
			return { output: "Error: ids array is required and must not be empty", isError: true };
		}

		const targetSet = new Set(states);

		// Check if any agent is already in a target state
		for (const id of ids) {
			const agent = deps.agents.get(id);
			if (!agent) continue;
			if (targetSet.has(agent.state)) {
				return {
					output: JSON.stringify({ id: agent.id, state: agent.state }, null, "\t"),
					isError: false,
				};
			}
		}

		if (signal?.aborted) {
			return { output: "Error: wait aborted", isError: true };
		}

		const watchSet = new Set(ids);

		return new Promise<{ output: string; isError: boolean }>((resolve) => {
			let settled = false;
			let unsub = () => {};
			const onAbort = () => {
				finish({ output: "Error: wait aborted", isError: true });
			};
			const finish = (result: { output: string; isError: boolean }) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				unsub();
				signal?.removeEventListener("abort", onAbort);
				resolve(result);
			};
			const timeout = setTimeout(() => {
				finish({ output: "Error: wait timed out after 5 minutes", isError: true });
			}, WAIT_TIMEOUT_MS);

			unsub = deps.agents.on((event) => {
				if (event.type !== "agent_state_changed") return;
				if (!watchSet.has(event.id)) return;
				if (!targetSet.has(event.to)) return;

				finish({
					output: JSON.stringify({ id: event.id, state: event.to }, null, "\t"),
					isError: false,
				});
			});

			signal?.addEventListener("abort", onAbort, { once: true });
		});
	};
}

// ── takumi_agent_send ─────────────────────────────────────────────────────────

export const agentSendDefinition: ToolDefinition = {
	name: "takumi_agent_send",
	description:
		"Send a message or prompt to a running side agent's tmux window. " +
		"The agent must be in a 'running' or 'waiting_user' state.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "The side agent ID to send a message to." },
			prompt: { type: "string", description: "The text to send to the agent's terminal." },
		},
		required: ["id", "prompt"],
	},
	requiresPermission: true,
	category: "interact",
};

export function createAgentSendHandler(deps: SideAgentToolDeps): ToolHandler {
	return async (input) => {
		const id = input.id as string;
		const prompt = input.prompt as string;

		if (!id || !prompt) {
			return { output: "Error: id and prompt are required", isError: true };
		}

		const agent = deps.agents.get(id);
		if (!agent) {
			return { output: `Error: unknown agent "${id}"`, isError: true };
		}

		const sendableStates: SideAgentState[] = ["running", "waiting_user"];
		if (!sendableStates.includes(agent.state)) {
			return {
				output: `Error: agent "${id}" is in state "${agent.state}" — can only send to running or waiting_user agents`,
				isError: true,
			};
		}
		if (!(await deps.mux.isWindowAlive(id))) {
			reconcileMissingWindow({ id, agents: deps.agents });
			return { output: `Error: agent "${id}" tmux window is missing`, isError: true };
		}

		const dispatched = await dispatchSideAgentWork({
			id,
			kind: "send",
			prompt,
			agents: deps.agents,
			mux: deps.mux,
		});

		return {
			output: JSON.stringify(
				{
					id,
					sent: true,
					agentState: deps.agents.get(id)?.state ?? agent.state,
					dispatchSequence: dispatched.sequence,
				},
				null,
				"\t",
			),
			isError: false,
		};
	};
}

export function registerSideAgentTools(registry: ToolRegistry, deps: SideAgentToolDeps): void {
	registry.register(agentStartDefinition, createAgentStartHandler(deps));
	registry.register(agentCheckDefinition, createAgentCheckHandler(deps));
	registry.register(agentWaitAnyDefinition, createAgentWaitAnyHandler(deps));
	registry.register(agentSendDefinition, createAgentSendHandler(deps));
	registry.register(agentStopDefinition, createAgentStopHandler(deps));
	registry.register(agentQueryDefinition, createAgentQueryHandler(deps));
}
