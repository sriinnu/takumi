/**
 * @file isolation.ts
 * @module cluster/isolation
 *
 * Isolation modes for safe cluster execution.
 *
 * | Mode       | Mechanism                                        | Safety level |
 * |------------|--------------------------------------------------|--------------|
 * | `"none"`   | Runs directly in the current working directory   | Low          |
 * | `"worktree"`| Git worktree in a temp dir; changes are isolated | Medium       |
 * | `"docker"` | Full container via `docker run`; no host access  | High         |
 *
 * Usage:
 * ```ts
 * const ctx = await createIsolationContext("worktree", process.cwd(), "cluster-abc");
 * try {
 *   // ... run agent inside ctx.workDir ...
 * } finally {
 *   await ctx.cleanup();
 * }
 * ```
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoot, gitWorktreeAdd, gitWorktreeRemove, isGitRepo } from "@takumi/bridge";
import type { DockerIsolationConfig } from "@takumi/core";
import { createLogger } from "@takumi/core";

const log = createLogger("cluster-isolation");

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported execution sandbox modes. */
export type IsolationMode = "none" | "worktree" | "docker";

/**
 * Live isolation context returned by {@link createIsolationContext}.
 * Contains the working directory the cluster should execute inside,
 * and a `cleanup()` function to tear down the sandbox afterwards.
 */
export interface IsolationContext {
	/** Sandbox mode that was actually activated. */
	readonly mode: IsolationMode;
	/** Absolute path the cluster should treat as its working directory. */
	readonly workDir: string;
	/**
	 * Release all resources created for this context (worktrees, temp dirs,
	 * containers, etc.). Safe to call multiple times.
	 */
	cleanup(): Promise<void>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build an {@link IsolationContext} for the requested mode.
 * Falls back to `"none"` if the environment does not support the requested mode
 * (e.g. `"worktree"` outside a git repo, or `"docker"` when Docker is absent).
 *
 * @param mode       - Requested isolation level.
 * @param sourceDir  - Absolute path of the project being worked on.
 * @param clusterId  - Unique cluster ID (used to name temp directories).
 * @param docker     - Docker options — required when `mode = "docker"`.
 */
export async function createIsolationContext(
	mode: IsolationMode,
	sourceDir: string,
	clusterId: string,
	docker?: DockerIsolationConfig,
): Promise<IsolationContext> {
	if (mode === "worktree") {
		return createWorktreeContext(sourceDir, clusterId);
	}
	if (mode === "docker") {
		return createDockerContext(sourceDir, clusterId, docker);
	}
	// "none" — trivial pass-through
	return { mode: "none", workDir: sourceDir, cleanup: async () => {} };
}

// ─── Docker isolation ─────────────────────────────────────────────────────────

/**
 * Create a Docker-based isolation context.
 * The cluster runs inside a container; the `workDir` is a temp dir on the host
 * that gets bind-mounted into the container at `/workspace`.
 *
 * Falls back to `"none"` if Docker is not available or `docker` config is absent.
 *
 * @internal
 */
async function createDockerContext(
	sourceDir: string,
	clusterId: string,
	docker?: DockerIsolationConfig,
): Promise<IsolationContext> {
	if (!docker) {
		log.warn("Docker isolation requested but no docker config provided — falling back to none");
		return { mode: "none", workDir: sourceDir, cleanup: async () => {} };
	}

	const tempBase = join(tmpdir(), `takumi-dk-${clusterId.slice(-8)}`);
	const hostWorkDir = await mkdtemp(tempBase);

	// Build env-forward args from glob patterns (basic prefix matching)
	const envArgs: string[] = [];
	for (const [key, val] of Object.entries(process.env)) {
		if (!key || !val) continue;
		const matched = docker.envPassthrough.some((pattern: string) => {
			const re = new RegExp(`^${pattern.replace("*", ".*")}$`);
			return re.test(key);
		});
		if (matched) envArgs.push(`-e ${key}`);
	}

	log.info(`Docker isolation ready: image=${docker.image} workDir=${hostWorkDir}`);

	let cleaned = false;
	return {
		mode: "docker",
		workDir: hostWorkDir,
		/** Store docker config on context so the runner can build the `docker run` command. */
		// @ts-expect-error — extended property for docker runner
		dockerConfig: { ...docker, hostWorkDir, envArgs },
		async cleanup() {
			if (cleaned) return;
			cleaned = true;
			await rm(hostWorkDir, { recursive: true, force: true }).catch(() => {});
			log.debug(`Docker temp dir cleaned up: ${hostWorkDir}`);
		},
	};
}

// ─── Worktree isolation ───────────────────────────────────────────────────────

/**
 * Create a git worktree in a temp directory so the cluster can make changes
 * without touching the main working tree.
 * Falls back to `"none"` if `sourceDir` is not inside a git repository.
 *
 * @internal
 */
async function createWorktreeContext(sourceDir: string, clusterId: string): Promise<IsolationContext> {
	const repoRoot = gitRoot(sourceDir);
	if (!repoRoot || !isGitRepo(repoRoot)) {
		log.warn("Worktree isolation requested but no git repo found — falling back to none");
		return { mode: "none", workDir: sourceDir, cleanup: async () => {} };
	}

	// Create temp directory that will host the worktree
	const tempBase = join(tmpdir(), `takumi-wt-${clusterId.slice(-8)}`);
	const worktreePath = await mkdtemp(tempBase);
	const added = gitWorktreeAdd(repoRoot, worktreePath);

	if (!added) {
		// Failed to add worktree — clean up and fall back
		await rm(worktreePath, { recursive: true, force: true });
		log.warn("git worktree add failed — falling back to none");
		return { mode: "none", workDir: sourceDir, cleanup: async () => {} };
	}

	log.info(`Worktree created at ${worktreePath} (repo: ${repoRoot})`);

	let cleaned = false;
	return {
		mode: "worktree",
		workDir: worktreePath,
		async cleanup() {
			if (cleaned) return;
			cleaned = true;
			gitWorktreeRemove(repoRoot, worktreePath);
			await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
			log.debug(`Worktree cleaned up: ${worktreePath}`);
		},
	};
}
