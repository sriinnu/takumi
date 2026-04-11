/**
 * Side-agent restart recovery.
 *
 * I keep recovery separate from the live tool handlers so CLI startup can
 * reconcile persisted lanes before any operator command touches them.
 */

import { gitBranch, gitWorktreeList } from "@takumi/bridge";
import type { SideAgentInfo, SideAgentState } from "@takumi/core";
import type { SideAgentRegistry } from "./side-agent-registry.js";
import type { TmuxOrchestrator } from "./tmux-orchestrator.js";
import { createNormalizedWorktreePathSet, normalizeWorktreePath } from "./worktree-paths.js";
import type { WorktreePoolManager } from "./worktree-pool.js";

const RECOVERABLE_STATES: ReadonlySet<SideAgentState> = new Set([
	"running",
	"waiting_user",
	"finishing",
	"waiting_merge_lock",
	"retrying_reconcile",
]);

const TERMINAL_STATES: ReadonlySet<SideAgentState> = new Set(["stopped", "done", "failed", "crashed"]);

export interface SideAgentRecoverySummary {
	adopted: string[];
	cleaned: string[];
	crashed: string[];
	cleanupFailed: string[];
}

export async function reconcilePersistedSideAgents(options: {
	agents: SideAgentRegistry;
	pool: WorktreePoolManager;
	tmux: TmuxOrchestrator;
	repoRoot: string;
}): Promise<SideAgentRecoverySummary> {
	const summary: SideAgentRecoverySummary = { adopted: [], cleaned: [], crashed: [], cleanupFailed: [] };
	const knownWorktrees = createNormalizedWorktreePathSet(gitWorktreeList(options.repoRoot));

	for (const agent of options.agents.getAll()) {
		if (!TERMINAL_STATES.has(agent.state)) {
			continue;
		}
		const cleanupResult = await cleanupTerminalAgent(agent, options, knownWorktrees);
		if (cleanupResult === "cleaned") {
			summary.cleaned.push(agent.id);
		}
		if (cleanupResult === "failed") {
			summary.cleanupFailed.push(agent.id);
		}
	}

	for (const agent of options.agents.getAll()) {
		if (TERMINAL_STATES.has(agent.state)) {
			continue;
		}
		const crashReason = await recoverPersistedAgent(agent, options, knownWorktrees);
		if (crashReason) {
			options.agents.transition(agent.id, "crashed", crashReason);
			summary.crashed.push(agent.id);
			continue;
		}
		summary.adopted.push(agent.id);
	}

	return summary;
}

async function recoverPersistedAgent(
	agent: SideAgentInfo,
	options: {
		agents: SideAgentRegistry;
		pool: WorktreePoolManager;
		tmux: TmuxOrchestrator;
	},
	knownWorktrees: ReadonlySet<string>,
): Promise<string | null> {
	if (!RECOVERABLE_STATES.has(agent.state)) {
		return "Side-agent was mid-startup during restart and could not be reattached safely.";
	}
	const slotId = agent.slotId ?? deriveSlotId(agent.worktreePath);
	const tmuxLocator = buildTmuxLocator(agent);
	if (!slotId || !agent.worktreePath || !tmuxLocator) {
		return "Side-agent metadata is incomplete and could not be reattached after restart.";
	}
	const normalizedWorktreePath = normalizeWorktreePath(agent.worktreePath);
	if (!knownWorktrees.has(normalizedWorktreePath)) {
		return "Side-agent worktree is missing and could not be reattached after restart.";
	}
	const currentBranch = gitBranch(normalizedWorktreePath);
	if (!currentBranch || currentBranch !== agent.branch) {
		return `Side-agent worktree branch drifted to "${currentBranch ?? "<unknown>"}" and could not be reattached safely.`;
	}

	let adoptedWindow: unknown;
	try {
		adoptedWindow = await options.tmux.adoptWindow(agent.id, tmuxLocator);
	} catch (error) {
		return `Side-agent tmux window could not be reattached after restart: ${formatError(error)}`;
	}
	if (!adoptedWindow) {
		return "Side-agent tmux window is missing and could not be reattached after restart.";
	}

	try {
		options.pool.adopt({
			id: slotId,
			path: normalizedWorktreePath,
			branch: agent.branch,
			inUse: true,
			agentId: agent.id,
			createdAt: agent.startedAt,
		});
	} catch (error) {
		let detail = formatError(error);
		if (adoptedWindow) {
			try {
				await options.tmux.killWindow(agent.id);
			} catch (cleanupError) {
				detail += ` Cleanup also failed: ${formatError(cleanupError)}`;
			}
		}
		return `Side-agent worktree slot could not be reattached after restart: ${detail}`;
	}

	if (isTmuxWindow(adoptedWindow)) {
		options.agents.update(agent.id, {
			slotId,
			worktreePath: normalizedWorktreePath,
			tmuxWindow: adoptedWindow.windowName,
			tmuxSessionName: adoptedWindow.sessionName,
			tmuxWindowId: adoptedWindow.windowId,
			tmuxPaneId: adoptedWindow.paneId,
		});
	}

	return null;
}

async function cleanupTerminalAgent(
	agent: SideAgentInfo,
	options: {
		agents: SideAgentRegistry;
		pool: WorktreePoolManager;
		tmux: TmuxOrchestrator;
	},
	knownWorktrees: Set<string>,
): Promise<"cleaned" | "failed" | "skipped"> {
	const patch: Partial<Omit<SideAgentInfo, "id" | "state">> = {};
	const cleanupErrors: string[] = [];
	let touched = false;

	const tmuxLocator = buildTmuxLocator(agent);
	if (tmuxLocator) {
		touched = true;
		try {
			const adopted = await options.tmux.adoptWindow(agent.id, tmuxLocator);
			if (adopted) {
				await options.tmux.killWindow(agent.id);
			}
			patch.tmuxWindow = null;
			patch.tmuxSessionName = null;
			patch.tmuxWindowId = null;
			patch.tmuxPaneId = null;
		} catch (error) {
			cleanupErrors.push(`tmux cleanup failed: ${formatError(error)}`);
		}
	}

	const slotId = agent.slotId ?? deriveSlotId(agent.worktreePath);
	if (slotId || agent.worktreePath) {
		touched = true;
		const normalizedWorktreePath = agent.worktreePath ? normalizeWorktreePath(agent.worktreePath) : null;
		if (slotId && agent.worktreePath && normalizedWorktreePath && knownWorktrees.has(normalizedWorktreePath)) {
			try {
				options.pool.adopt({
					id: slotId,
					path: normalizedWorktreePath,
					branch: agent.branch,
					inUse: true,
					agentId: agent.id,
					createdAt: agent.startedAt,
				});
				await options.pool.release(slotId);
				knownWorktrees.delete(normalizedWorktreePath);
				patch.slotId = null;
				patch.worktreePath = null;
			} catch (error) {
				cleanupErrors.push(`worktree cleanup failed: ${formatError(error)}`);
			}
		} else {
			patch.slotId = null;
			patch.worktreePath = null;
		}
	}

	if (!touched) {
		return "skipped";
	}

	if (cleanupErrors.length > 0) {
		patch.error = appendError(agent.error, `Residual cleanup failed after restart. ${cleanupErrors.join(" ")}`);
		options.agents.update(agent.id, patch);
		return "failed";
	}

	options.agents.update(agent.id, patch);
	return "cleaned";
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function buildTmuxLocator(agent: SideAgentInfo): {
	sessionName?: string | null;
	windowName?: string | null;
	windowId?: string | null;
	paneId?: string | null;
} | null {
	if (!agent.tmuxWindow && !agent.tmuxSessionName && !agent.tmuxWindowId && !agent.tmuxPaneId) {
		return null;
	}
	return {
		sessionName: agent.tmuxSessionName,
		windowName: agent.tmuxWindow,
		windowId: agent.tmuxWindowId,
		paneId: agent.tmuxPaneId,
	};
}

function deriveSlotId(worktreePath: string | null): string | null {
	if (!worktreePath) {
		return null;
	}
	const match = /(?:^|[\\/])(wt-\d+)$/.exec(worktreePath.trim());
	return match?.[1] ?? null;
}

function appendError(existing: string | undefined, message: string): string {
	return existing?.trim() ? `${existing} ${message}` : message;
}

function isTmuxWindow(
	value: unknown,
): value is { sessionName: string; windowId: string; windowName: string; paneId: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"sessionName" in value &&
		typeof value.sessionName === "string" &&
		"windowId" in value &&
		typeof value.windowId === "string" &&
		"windowName" in value &&
		typeof value.windowName === "string" &&
		"paneId" in value &&
		typeof value.paneId === "string"
	);
}
