import { join } from "node:path";
import type { ToolRegistry } from "@takumi/agent";
import {
	reconcilePersistedSideAgents,
	registerSideAgentTools,
	SideAgentRegistry,
	TmuxOrchestrator,
	WorktreePoolManager,
} from "@takumi/agent";
import type { TakumiConfig } from "@takumi/core";
import { isGitRepo } from "@takumi/bridge";

function canRegisterTools(tools: ToolRegistry): tools is ToolRegistry & { register: (...args: unknown[]) => void } {
	return typeof (tools as { register?: unknown }).register === "function";
}

/**
 * I keep the side-agent bootstrap result structured so callers can surface only
 * actionable degradations instead of guessing from a boolean.
 */
export interface SideAgentBootstrapStatus {
	enabled: boolean;
	degraded: boolean;
	reason:
		| "enabled"
		| "unsupported_tools"
		| "not_git_repo"
		| "tmux_disabled"
		| "max_concurrent_disabled"
		| "tmux_unavailable"
		| "bootstrap_failed";
	summary: string;
	detail?: string;
}

function bootstrapStatus(input: SideAgentBootstrapStatus): SideAgentBootstrapStatus {
	return input;
}

/**
 * I keep the side-agent runtime state directory in one place so bootstrap,
 * doctor, and explicit repair commands do not drift.
 */
export function resolveSideAgentStateDir(cwd = process.cwd()): string {
	return join(cwd, ".takumi/side-agents");
}

/**
 * I probe the side-agent prerequisites without mutating tmux sessions,
 * worktrees, or registry state so diagnostics can reuse the same contract as
 * runtime bootstrap.
 */
export async function probeSideAgentBootstrap(
	config: TakumiConfig,
	cwd = process.cwd(),
): Promise<SideAgentBootstrapStatus> {
	if (!isGitRepo(cwd)) {
		return bootstrapStatus({
			enabled: false,
			degraded: false,
			reason: "not_git_repo",
			summary: "disabled outside a git repository",
		});
	}
	if (config.sideAgent?.tmux === false) {
		return bootstrapStatus({
			enabled: false,
			degraded: false,
			reason: "tmux_disabled",
			summary: "disabled by config",
		});
	}

	const maxConcurrent = config.sideAgent?.maxConcurrent ?? 2;
	if (maxConcurrent < 1) {
		return bootstrapStatus({
			enabled: false,
			degraded: false,
			reason: "max_concurrent_disabled",
			summary: "disabled because maxConcurrent < 1",
		});
	}
	if (!(await TmuxOrchestrator.isAvailable())) {
		return bootstrapStatus({
			enabled: false,
			degraded: true,
			reason: "tmux_unavailable",
			summary: "tmux is unavailable",
		});
	}

	return bootstrapStatus({
		enabled: true,
		degraded: false,
		reason: "enabled",
		summary: "preflight ready",
	});
}

/**
 * I format one compact startup line for operator-visible degraded states while
 * staying silent for intentional or expected disablement.
 */
export function formatSideAgentStartupLine(status: SideAgentBootstrapStatus): string | null {
	if (!status.degraded) return null;
	return `Side agents: ${status.summary}`;
}

/**
 * I register side-agent tools only after bootstrap has produced a trustworthy
 * runtime, and I return the reason when that is not possible.
 */
export async function registerOptionalSideAgentTools(
	tools: ToolRegistry,
	config: TakumiConfig,
	cwd = process.cwd(),
): Promise<SideAgentBootstrapStatus> {
	if (!canRegisterTools(tools)) {
		return bootstrapStatus({
			enabled: false,
			degraded: false,
			reason: "unsupported_tools",
			summary: "tool registry does not support side-agent registration",
		});
	}
	const preflight = await probeSideAgentBootstrap(config, cwd);
	if (!preflight.enabled || preflight.degraded) return preflight;

	const orchestrator = new TmuxOrchestrator("takumi-side-agents");
	const pool = new WorktreePoolManager(cwd, {
		baseDir: config.sideAgent?.worktreeDir,
		maxSlots: config.sideAgent?.maxConcurrent ?? 2,
	});
	const agents = new SideAgentRegistry({
		baseDir: resolveSideAgentStateDir(cwd),
		autoSave: true,
	});

	try {
		await agents.load();
		await reconcilePersistedSideAgents({
			agents,
			pool,
			tmux: orchestrator,
			repoRoot: cwd,
		});
		await agents.flushPersistence();
		await pool.cleanOrphans();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return bootstrapStatus({
			enabled: false,
			degraded: true,
			reason: "bootstrap_failed",
			summary: `bootstrap failed (${detail})`,
			detail,
		});
	}

	registerSideAgentTools(tools, {
		pool,
		tmux: orchestrator,
		agents,
		repoRoot: cwd,
		defaultModel: config.sideAgent?.defaultModel ?? config.model,
	});

	return bootstrapStatus({
		enabled: true,
		degraded: false,
		reason: "enabled",
		summary: "ready",
	});
}
