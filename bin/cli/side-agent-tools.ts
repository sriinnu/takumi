import type { ToolRegistry } from "@takumi/agent";
import {
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

export async function registerOptionalSideAgentTools(
	tools: ToolRegistry,
	config: TakumiConfig,
	cwd = process.cwd(),
): Promise<boolean> {
	if (!canRegisterTools(tools)) return false;
	if (!isGitRepo(cwd)) return false;
	if (config.sideAgent?.tmux === false) return false;

	const maxConcurrent = config.sideAgent?.maxConcurrent ?? 2;
	if (maxConcurrent < 1) return false;
	if (!(await TmuxOrchestrator.isAvailable())) return false;

	const orchestrator = new TmuxOrchestrator("takumi-side-agents");
	const pool = new WorktreePoolManager(cwd, {
		baseDir: config.sideAgent?.worktreeDir,
		maxSlots: maxConcurrent,
	});
	const agents = new SideAgentRegistry();

	registerSideAgentTools(tools, {
		pool,
		tmux: orchestrator,
		agents,
		repoRoot: cwd,
		defaultModel: config.sideAgent?.defaultModel ?? config.model,
	});

	return true;
}