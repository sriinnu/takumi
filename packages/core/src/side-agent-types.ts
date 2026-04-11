/**
 * Side Agent Types — Phase 21: Side Agents & Validator Isolation
 *
 * Defines configuration, state machine, info, and event types
 * for spawning and managing side agents in isolated worktrees.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

export interface SideAgentConfig {
	/** Maximum concurrent side agents */
	maxConcurrent: number;
	/** Default model for side agents */
	defaultModel?: string;
	/** Worktree base directory (default: .takumi/worktrees) */
	worktreeDir?: string;
	/** Auto-cleanup completed worktrees after N seconds */
	autoCleanupAfterSec?: number;
	/** Enable tmux integration (requires tmux to be available) */
	tmux: boolean;
}

// ── State Machine ─────────────────────────────────────────────────────────────

export type SideAgentState =
	| "allocating_worktree"
	| "spawning_tmux"
	| "starting"
	| "running"
	| "waiting_user"
	| "finishing"
	| "waiting_merge_lock"
	| "retrying_reconcile"
	| "stopped"
	| "done"
	| "failed"
	| "crashed";

export type SideAgentDispatchKind = "start" | "send" | "query";

// ── Agent Info ────────────────────────────────────────────────────────────────

export interface SideAgentInfo {
	id: string;
	description: string;
	state: SideAgentState;
	model: string;
	slotId: string | null;
	worktreePath: string | null;
	tmuxWindow: string | null;
	tmuxSessionName: string | null;
	tmuxWindowId: string | null;
	tmuxPaneId: string | null;
	branch: string;
	pid: number | null;
	startedAt: number;
	updatedAt: number;
	dispatchSequence?: number;
	reuseCount?: number;
	leaseOwner?: string | null;
	leaseExpiresAt?: number | null;
	lastHeartbeatAt?: number | null;
	lastDispatchAt?: number | null;
	lastDispatchKind?: SideAgentDispatchKind | null;
	lastRunStartedAt?: number | null;
	lastRunFinishedAt?: number | null;
	lastRunExitCode?: number | null;
	lastRunRequestId?: string | null;
	error?: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

export type SideAgentEvent =
	| { type: "agent_spawned"; agent: SideAgentInfo }
	| { type: "agent_state_changed"; id: string; from: SideAgentState; to: SideAgentState }
	| { type: "agent_output"; id: string; text: string }
	| { type: "agent_completed"; id: string; mergeResult: "success" | "conflict" | "error" }
	| { type: "agent_stopped"; id: string; reason: string }
	| { type: "agent_failed"; id: string; error: string };
