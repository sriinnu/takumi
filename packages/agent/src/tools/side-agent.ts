/**
 * Side Agent Tool API — Phase 21.5
 *
 * Exposes 4 tools that let the main agent spawn, monitor, communicate with,
 * and await side agents running in isolated worktrees + tmux windows.
 *
 * Tools:
 * - takumi_agent_start  — spawn a new side agent
 * - takumi_agent_check  — check status + recent output
 * - takumi_agent_wait_any — wait for any agent to reach a target state
 * - takumi_agent_send   — send a message/prompt to a running agent
 */

import type { SideAgentInfo, SideAgentState, ToolDefinition } from "@takumi/core";
import type { SideAgentRegistry } from "../cluster/side-agent-registry.js";
import type { TmuxOrchestrator } from "../cluster/tmux-orchestrator.js";
import type { WorktreePoolManager } from "../cluster/worktree-pool.js";
import type { ToolHandler, ToolRegistry } from "./registry.js";

// ── Dependency bundle ─────────────────────────────────────────────────────────

export interface SideAgentToolDeps {
	pool: WorktreePoolManager;
	tmux: TmuxOrchestrator;
	agents: SideAgentRegistry;
	repoRoot: string;
	defaultModel?: string;
}

// ── Default wait targets ──────────────────────────────────────────────────────

const DEFAULT_WAIT_STATES: SideAgentState[] = ["done", "failed", "crashed", "waiting_user"];
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
			model: {
				type: "string",
				description: "LLM model to use for the side agent (uses default if omitted).",
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
		const model = (input.model as string | undefined) ?? deps.defaultModel ?? "claude-sonnet";

		if (!description) {
			return { output: "Error: description is required", isError: true };
		}

		// Check pool capacity before allocating
		if (!deps.pool.hasCapacity()) {
			return {
				output: "Error: worktree pool is at capacity. Wait for an existing agent to finish or release a slot.",
				isError: true,
			};
		}

		const id = deps.agents.nextId();
		const now = Date.now();

		// Allocate worktree
		const slot = await deps.pool.allocate(id);

		const agent: SideAgentInfo = {
			id,
			description,
			state: "allocating_worktree",
			model,
			worktreePath: slot.path,
			tmuxWindow: null,
			branch: slot.branch,
			pid: null,
			startedAt: now,
			updatedAt: now,
		};

		deps.agents.register(agent);
		deps.agents.transition(id, "spawning_tmux");

		// Create tmux window
		const win = await deps.tmux.createWindow(id, slot.path);
		deps.agents.transition(id, "starting");

		const result = {
			id,
			status: "starting",
			worktree: slot.path,
			branch: slot.branch,
			tmuxWindow: win.windowName,
		};

		return { output: JSON.stringify(result, null, "\t"), isError: false };
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

		let recentOutput = "";
		try {
			recentOutput = await deps.tmux.captureOutput(id, DEFAULT_CAPTURE_LINES);
		} catch {
			recentOutput = "<no output available>";
		}

		const result = {
			id: agent.id,
			state: agent.state,
			description: agent.description,
			model: agent.model,
			branch: agent.branch,
			error: agent.error ?? null,
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
		'Default target states: ["done", "failed", "crashed", "waiting_user"]. ' +
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

		// Wait via event listener
		const watchSet = new Set(ids);

		return new Promise<{ output: string; isError: boolean }>((resolve) => {
			const timeout = setTimeout(() => {
				unsub();
				resolve({ output: "Error: wait timed out after 5 minutes", isError: true });
			}, WAIT_TIMEOUT_MS);

			const unsub = deps.agents.on((event) => {
				if (event.type !== "agent_state_changed") return;
				if (!watchSet.has(event.id)) return;
				if (!targetSet.has(event.to)) return;

				clearTimeout(timeout);
				unsub();
				resolve({
					output: JSON.stringify({ id: event.id, state: event.to }, null, "\t"),
					isError: false,
				});
			});

			// Respect abort signal
			signal?.addEventListener("abort", () => {
				clearTimeout(timeout);
				unsub();
				resolve({ output: "Error: wait aborted", isError: true });
			});
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

		await deps.tmux.sendKeys(id, prompt);

		return {
			output: JSON.stringify({ id, sent: true, agentState: agent.state }, null, "\t"),
			isError: false,
		};
	};
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register all 4 side-agent tools in the given ToolRegistry.
 */
export function registerSideAgentTools(registry: ToolRegistry, deps: SideAgentToolDeps): void {
	registry.register(agentStartDefinition, createAgentStartHandler(deps));
	registry.register(agentCheckDefinition, createAgentCheckHandler(deps));
	registry.register(agentWaitAnyDefinition, createAgentWaitAnyHandler(deps));
	registry.register(agentSendDefinition, createAgentSendHandler(deps));
}
