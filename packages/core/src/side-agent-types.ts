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
	| "done"
	| "failed"
	| "crashed";

// ── Agent Info ────────────────────────────────────────────────────────────────

export interface SideAgentInfo {
	id: string;
	description: string;
	state: SideAgentState;
	model: string;
	worktreePath: string | null;
	tmuxWindow: string | null;
	branch: string;
	pid: number | null;
	startedAt: number;
	updatedAt: number;
	error?: string;
}

// ── Events ────────────────────────────────────────────────────────────────────

export type SideAgentEvent =
	| { type: "agent_spawned"; agent: SideAgentInfo }
	| { type: "agent_state_changed"; id: string; from: SideAgentState; to: SideAgentState }
	| { type: "agent_output"; id: string; text: string }
	| { type: "agent_completed"; id: string; mergeResult: "success" | "conflict" | "error" }
	| { type: "agent_failed"; id: string; error: string };
