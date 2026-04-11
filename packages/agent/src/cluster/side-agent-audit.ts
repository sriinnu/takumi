import { gitBranch, gitWorktreeList } from "@takumi/bridge";
import type { SideAgentInfo, SideAgentState } from "@takumi/core";
import {
	inspectPersistedSideAgentRegistry,
	type PersistedSideAgentRecord,
	type SideAgentRegistrySnapshot,
} from "./side-agent-registry-io.js";
import { TmuxOrchestrator, type TmuxWindow, type TmuxWindowLocator } from "./tmux-orchestrator.js";
import { createNormalizedWorktreePathSet, normalizeWorktreePath } from "./worktree-paths.js";
import { WorktreePoolManager } from "./worktree-pool.js";

export type SideAgentAuditSeverity = "warn" | "fail";

export type SideAgentAuditCode =
	| "registry_read_failed"
	| "registry_parse_failed"
	| "registry_entry_malformed"
	| "registry_entry_normalized"
	| "live_metadata_incomplete"
	| "live_worktree_missing"
	| "live_tmux_missing"
	| "live_branch_drift"
	| "terminal_worktree_residual"
	| "terminal_tmux_residual"
	| "orphaned_worktree";

/**
 * I keep side-agent audit issues structured so doctor and future UIs can group
 * them without reparsing rendered text.
 */
export interface SideAgentAuditIssue {
	code: SideAgentAuditCode;
	severity: SideAgentAuditSeverity;
	agentId?: string;
	detail: string;
}

/**
 * I summarize persisted side-agent drift in a read-only way.
 */
export interface SideAgentRuntimeAudit {
	registry: SideAgentRegistrySnapshot;
	activeAgents: number;
	terminalAgents: number;
	orphanedWorktrees: string[];
	tmuxInspected: boolean;
	issues: SideAgentAuditIssue[];
}

const DEFAULT_TMUX_SESSION_NAME = "takumi-side-agents";
const TERMINAL_STATES: ReadonlySet<SideAgentState> = new Set(["stopped", "done", "failed", "crashed"]);
const SIDE_AGENT_STATES: ReadonlySet<SideAgentState> = new Set([
	"allocating_worktree",
	"spawning_tmux",
	"starting",
	"running",
	"waiting_user",
	"finishing",
	"waiting_merge_lock",
	"retrying_reconcile",
	"stopped",
	"done",
	"failed",
	"crashed",
]);

/**
 * I audit the persisted side-agent runtime without reconciling, deleting, or
 * adopting anything.
 */
export async function auditSideAgentRuntime(options: {
	repoRoot: string;
	registryBaseDir: string;
	worktreeBaseDir?: string;
	defaultTmuxSessionName?: string;
	tmuxAvailable?: boolean;
}): Promise<SideAgentRuntimeAudit> {
	const registry = await inspectPersistedSideAgentRegistry(options.registryBaseDir);
	const retainedRecords = registry.records.filter(isRetainedRecord);
	const activeAgents = retainedRecords.filter(isPersistedLiveRecord).length;
	const terminalAgents = retainedRecords.length - activeAgents;
	const allWorktrees = gitWorktreeList(options.repoRoot);
	const knownWorktrees = createNormalizedWorktreePathSet(allWorktrees);
	const pool = new WorktreePoolManager(options.repoRoot, { baseDir: options.worktreeBaseDir });
	const trackedWorktrees = retainedRecords
		.map((record) => record.agent.worktreePath)
		.filter((path): path is string => typeof path === "string" && path.length > 0);
	const orphanedWorktrees = pool.findOrphans(trackedWorktrees, allWorktrees);
	const { inspected: tmuxInspected, windowsBySession: knownTmuxWindows } = await loadTmuxWindowIndex(
		retainedRecords.map((record) => record.agent),
		options.defaultTmuxSessionName,
		options.tmuxAvailable,
	);
	const issues = buildAuditIssues(
		registry,
		orphanedWorktrees,
		knownWorktrees,
		tmuxInspected,
		knownTmuxWindows,
		options.defaultTmuxSessionName ?? DEFAULT_TMUX_SESSION_NAME,
	);
	return {
		registry,
		activeAgents,
		terminalAgents,
		orphanedWorktrees,
		tmuxInspected,
		issues,
	};
}

async function loadTmuxWindowIndex(
	agents: SideAgentInfo[],
	defaultSessionName: string | undefined,
	tmuxAvailable: boolean | undefined,
): Promise<{ inspected: boolean; windowsBySession: Map<string, TmuxWindow[]> }> {
	if (agents.length === 0) {
		return { inspected: false, windowsBySession: new Map() };
	}
	const available = typeof tmuxAvailable === "boolean" ? tmuxAvailable : await TmuxOrchestrator.isAvailable();
	if (!available) {
		return { inspected: false, windowsBySession: new Map() };
	}
	const sessions = new Set<string>();
	for (const agent of agents) {
		const locator = buildTmuxLocator(agent, defaultSessionName);
		if (locator?.sessionName) {
			sessions.add(locator.sessionName);
		}
	}
	const windowsBySession = new Map<string, TmuxWindow[]>();
	for (const sessionName of sessions) {
		windowsBySession.set(sessionName, await TmuxOrchestrator.listWindows(sessionName));
	}
	return { inspected: true, windowsBySession };
}

function buildAuditIssues(
	registry: SideAgentRegistrySnapshot,
	orphanedWorktrees: string[],
	knownWorktrees: ReadonlySet<string>,
	tmuxInspected: boolean,
	knownTmuxWindows: ReadonlyMap<string, TmuxWindow[]>,
	defaultSessionName: string,
): SideAgentAuditIssue[] {
	const issues: SideAgentAuditIssue[] = [];
	if (registry.readError) {
		issues.push({
			code: "registry_read_failed",
			severity: "warn",
			detail: `Persisted side-agent registry could not be read: ${registry.readError}`,
		});
	}
	if (registry.parseError) {
		issues.push({
			code: "registry_parse_failed",
			severity: "warn",
			detail: `Persisted side-agent registry could not be parsed: ${registry.parseError}`,
		});
	}
	if (registry.malformedEntries > 0) {
		issues.push({
			code: "registry_entry_malformed",
			severity: "warn",
			detail: `Persisted side-agent registry contains ${registry.malformedEntries} malformed or duplicate entr${registry.malformedEntries === 1 ? "y" : "ies"}.`,
		});
	}
	if (registry.normalizedEntries > 0) {
		issues.push({
			code: "registry_entry_normalized",
			severity: "warn",
			detail: `Persisted side-agent registry contains ${registry.normalizedEntries} normalized entr${registry.normalizedEntries === 1 ? "y" : "ies"}.`,
		});
	}
	for (const worktreePath of orphanedWorktrees) {
		issues.push({
			code: "orphaned_worktree",
			severity: "warn",
			detail: `Orphaned side-agent worktree detected: ${worktreePath}`,
		});
	}
	for (const record of registry.records.filter(isRetainedRecord)) {
		const agent = record.agent;
		const locator = buildTmuxLocator(agent, defaultSessionName);
		const normalizedWorktreePath =
			typeof agent.worktreePath === "string" && agent.worktreePath.length > 0
				? normalizeWorktreePath(agent.worktreePath)
				: null;
		const knownWorktree = normalizedWorktreePath !== null && knownWorktrees.has(normalizedWorktreePath);
		if (record.incompleteLive) {
			issues.push({
				code: "live_metadata_incomplete",
				severity: "fail",
				agentId: agent.id,
				detail: `Persisted live side agent "${agent.id}" could not be recovered safely because its worktree or tmux metadata is incomplete.`,
			});
			continue;
		}
		if (!isPersistedLiveRecord(record)) {
			if (knownWorktree) {
				issues.push({
					code: "terminal_worktree_residual",
					severity: "warn",
					agentId: agent.id,
					detail: `Terminal side agent "${agent.id}" still owns worktree ${agent.worktreePath}.`,
				});
			}
			if (tmuxInspected && locator && hasTmuxWindow(knownTmuxWindows, locator)) {
				issues.push({
					code: "terminal_tmux_residual",
					severity: "warn",
					agentId: agent.id,
					detail: `Terminal side agent "${agent.id}" still has a live tmux window.`,
				});
			}
			continue;
		}
		if (!agent.worktreePath) {
			issues.push({
				code: "live_metadata_incomplete",
				severity: "fail",
				agentId: agent.id,
				detail: `Live side agent "${agent.id}" is missing worktree metadata.`,
			});
			continue;
		}
		if (!normalizedWorktreePath || !knownWorktrees.has(normalizedWorktreePath)) {
			issues.push({
				code: "live_worktree_missing",
				severity: "fail",
				agentId: agent.id,
				detail: `Live side agent "${agent.id}" points at worktree ${agent.worktreePath}, but it is no longer tracked by git.`,
			});
			continue;
		}
		const currentBranch = gitBranch(normalizedWorktreePath);
		if (!currentBranch || currentBranch !== agent.branch) {
			issues.push({
				code: "live_branch_drift",
				severity: "fail",
				agentId: agent.id,
				detail: `Live side agent "${agent.id}" drifted to branch "${currentBranch ?? "<unknown>"}" instead of "${agent.branch}".`,
			});
		}
		if (!locator) {
			issues.push({
				code: "live_metadata_incomplete",
				severity: "fail",
				agentId: agent.id,
				detail: `Live side agent "${agent.id}" is missing tmux locator metadata.`,
			});
			continue;
		}
		if (tmuxInspected && !hasTmuxWindow(knownTmuxWindows, locator)) {
			issues.push({
				code: "live_tmux_missing",
				severity: "fail",
				agentId: agent.id,
				detail: `Live side agent "${agent.id}" is missing its tmux window.`,
			});
		}
	}
	return issues;
}

function isRetainedRecord(
	record: PersistedSideAgentRecord,
): record is PersistedSideAgentRecord & { agent: SideAgentInfo } {
	return record.retained && record.agent !== null;
}

function isPersistedLiveRecord(record: PersistedSideAgentRecord): boolean {
	if (!record.agent) {
		return false;
	}
	if (record.incompleteLive) {
		return true;
	}
	if (record.rawState && SIDE_AGENT_STATES.has(record.rawState as SideAgentState)) {
		return !TERMINAL_STATES.has(record.rawState as SideAgentState);
	}
	return !TERMINAL_STATES.has(record.agent.state);
}

function hasTmuxWindow(windowsBySession: ReadonlyMap<string, TmuxWindow[]>, locator: TmuxWindowLocator): boolean {
	const sessionName = locator.sessionName;
	if (!sessionName) return false;
	const windows = windowsBySession.get(sessionName) ?? [];
	if (locator.windowId) {
		return windows.some((window) => window.windowId === locator.windowId);
	}
	if (locator.windowName) {
		return windows.some((window) => window.windowName === locator.windowName);
	}
	if (locator.paneId) {
		return windows.some((window) => window.paneId === locator.paneId);
	}
	return false;
}

function buildTmuxLocator(agent: SideAgentInfo, defaultSessionName: string | undefined): TmuxWindowLocator | null {
	const sessionName = agent.tmuxSessionName ?? defaultSessionName ?? null;
	if (!sessionName && !agent.tmuxWindow && !agent.tmuxWindowId && !agent.tmuxPaneId) {
		return null;
	}
	if (!agent.tmuxWindow && !agent.tmuxWindowId && !agent.tmuxPaneId) {
		return null;
	}
	return {
		sessionName,
		windowName: agent.tmuxWindow,
		windowId: agent.tmuxWindowId,
		paneId: agent.tmuxPaneId,
	};
}
