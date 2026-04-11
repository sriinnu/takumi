import { join } from "node:path";
import {
	agentCheckDefinition,
	agentQueryDefinition,
	agentSendDefinition,
	agentStartDefinition,
	agentStopDefinition,
	agentWaitAnyDefinition,
	createAgentCheckHandler,
	createAgentQueryHandler,
	createAgentSendHandler,
	createAgentStartHandler,
	createAgentStopHandler,
	createAgentWaitAnyHandler,
	reconcilePersistedSideAgents,
	SideAgentRegistry,
	type SideAgentToolDeps,
	TmuxOrchestrator,
	type ToolHandler,
	type ToolRegistry,
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
		| "worker_runtime"
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

interface SideAgentRuntimeHandle {
	ensureRuntime(): Promise<SideAgentToolDeps>;
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
 * I keep the heavy side-agent runtime bootstrap behind the first real tool
 * invocation so interactive startup does not pay for reconciliation work that
 * the session may never use.
 */
function createSideAgentRuntimeHandle(config: TakumiConfig, cwd: string): SideAgentRuntimeHandle {
	const tmux = new TmuxOrchestrator("takumi-side-agents");
	const pool = new WorktreePoolManager(cwd, {
		baseDir: config.sideAgent?.worktreeDir,
		maxSlots: config.sideAgent?.maxConcurrent ?? 2,
	});
	const agents = new SideAgentRegistry({
		baseDir: resolveSideAgentStateDir(cwd),
		autoSave: true,
	});
	const runtime: SideAgentToolDeps = {
		pool,
		tmux,
		agents,
		repoRoot: cwd,
		defaultModel: config.sideAgent?.defaultModel ?? config.model,
	};
	let initPromise: Promise<SideAgentToolDeps> | null = null;

	return {
		async ensureRuntime(): Promise<SideAgentToolDeps> {
			if (!initPromise) {
				initPromise = (async () => {
					await agents.load();
					await reconcilePersistedSideAgents({
						agents,
						pool,
						tmux,
						repoRoot: cwd,
					});
					await agents.flushPersistence();
					await pool.cleanOrphans();
					return runtime;
				})().catch((error) => {
					initPromise = null;
					throw error;
				});
			}
			return initPromise;
		},
	};
}

/**
 * I bind one side-agent tool lazily so the first real invocation pays for
 * runtime bootstrap, while every later call reuses the hydrated handler.
 */
function createLazySideAgentHandler(
	createHandler: (deps: SideAgentToolDeps) => ToolHandler,
	runtime: SideAgentRuntimeHandle,
): ToolHandler {
	let boundHandler: ToolHandler | null = null;

	return async (input, signal) => {
		try {
			const deps = await runtime.ensureRuntime();
			if (!boundHandler) {
				boundHandler = createHandler(deps);
			}
			return await boundHandler(input, signal);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				output: `Error: side-agent runtime bootstrap failed: ${detail}. Run \`takumi doctor\` or \`takumi side-agents inspect\` for details.`,
				isError: true,
			};
		}
	};
}

/**
 * I register the side-agent tool surface immediately, but I keep the runtime
 * hydration lazy so startup stays responsive without hiding later failures.
 */
function registerLazySideAgentTools(registry: ToolRegistry, config: TakumiConfig, cwd: string): void {
	const runtime = createSideAgentRuntimeHandle(config, cwd);
	registry.register(agentStartDefinition, createLazySideAgentHandler(createAgentStartHandler, runtime));
	registry.register(agentCheckDefinition, createLazySideAgentHandler(createAgentCheckHandler, runtime));
	registry.register(agentWaitAnyDefinition, createLazySideAgentHandler(createAgentWaitAnyHandler, runtime));
	registry.register(agentSendDefinition, createLazySideAgentHandler(createAgentSendHandler, runtime));
	registry.register(agentStopDefinition, createLazySideAgentHandler(createAgentStopHandler, runtime));
	registry.register(agentQueryDefinition, createLazySideAgentHandler(createAgentQueryHandler, runtime));
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
	registerLazySideAgentTools(tools, config, cwd);

	return bootstrapStatus({
		enabled: true,
		degraded: false,
		reason: "enabled",
		summary: "ready (lazy bootstrap)",
	});
}
