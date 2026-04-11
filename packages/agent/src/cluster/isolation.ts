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

import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
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
	/** Docker runtime details used by future container execution paths. */
	readonly dockerConfig?: DockerIsolationConfig & {
		hostWorkDir: string;
		envArgs: string[];
		containerWorkDir: string;
	};
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
	const absoluteSourceDir = resolve(sourceDir);
	if (mode === "worktree") {
		return createWorktreeContext(absoluteSourceDir, clusterId);
	}
	if (mode === "docker") {
		return createDockerContext(absoluteSourceDir, clusterId, docker);
	}
	// "none" — trivial pass-through
	return createPassthroughContext(absoluteSourceDir);
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
		return createPassthroughContext(sourceDir);
	}

	const sourceLayout = resolveSourceLayout(sourceDir);
	const tempBase = join(tmpdir(), `takumi-dk-${clusterId.slice(-8)}-`);
	const tempRootDir = await mkdtemp(tempBase);
	const hostWorkDir = join(tempRootDir, "workspace");
	let stagedAsWorktree = false;

	try {
		if (sourceLayout.repoRoot) {
			const added = gitWorktreeAdd(sourceLayout.repoRoot, hostWorkDir);
			if (!added) {
				throw new Error("git worktree add failed while preparing docker isolation");
			}
			stagedAsWorktree = true;
		} else {
			await cp(sourceLayout.sourceRoot, hostWorkDir, { recursive: true });
		}
	} catch (error) {
		await rm(tempRootDir, { recursive: true, force: true }).catch(() => {});
		log.warn("Docker isolation staging failed — falling back to none", error);
		return createPassthroughContext(sourceDir);
	}

	const envArgs = buildDockerEnvArgs(docker.envPassthrough);
	const workDir = resolveNestedWorkDir(hostWorkDir, sourceLayout.relativeWorkDir);
	const containerWorkDir = toContainerWorkDir(sourceLayout.relativeWorkDir);

	log.info(`Docker isolation ready: image=${docker.image} workDir=${workDir}`);

	let cleaned = false;
	return {
		mode: "docker",
		workDir,
		dockerConfig: { ...docker, hostWorkDir, envArgs, containerWorkDir },
		async cleanup() {
			if (cleaned) return;
			cleaned = true;
			if (stagedAsWorktree && sourceLayout.repoRoot) {
				gitWorktreeRemove(sourceLayout.repoRoot, hostWorkDir);
			}
			await rm(tempRootDir, { recursive: true, force: true }).catch(() => {});
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
		return createPassthroughContext(sourceDir);
	}
	const relativeWorkDir = getRelativeWorkDir(repoRoot, sourceDir);

	// Create temp directory that will host the worktree
	const tempBase = join(tmpdir(), `takumi-wt-${clusterId.slice(-8)}-`);
	const worktreePath = await mkdtemp(tempBase);
	const added = gitWorktreeAdd(repoRoot, worktreePath);

	if (!added) {
		// Failed to add worktree — clean up and fall back
		await rm(worktreePath, { recursive: true, force: true });
		log.warn("git worktree add failed — falling back to none");
		return createPassthroughContext(sourceDir);
	}

	const workDir = resolveNestedWorkDir(worktreePath, relativeWorkDir);
	log.info(`Worktree created at ${worktreePath} (repo: ${repoRoot})`);

	let cleaned = false;
	return {
		mode: "worktree",
		workDir,
		async cleanup() {
			if (cleaned) return;
			cleaned = true;
			gitWorktreeRemove(repoRoot, worktreePath);
			await rm(worktreePath, { recursive: true, force: true }).catch(() => {});
			log.debug(`Worktree cleaned up: ${worktreePath}`);
		},
	};
}

function createPassthroughContext(sourceDir: string): IsolationContext {
	return { mode: "none", workDir: sourceDir, cleanup: async () => {} };
}

function resolveSourceLayout(sourceDir: string): {
	sourceRoot: string;
	relativeWorkDir: string;
	repoRoot: string | null;
} {
	const repoRoot = gitRoot(sourceDir);
	if (repoRoot && isGitRepo(repoRoot)) {
		return {
			sourceRoot: repoRoot,
			relativeWorkDir: getRelativeWorkDir(repoRoot, sourceDir),
			repoRoot,
		};
	}
	return { sourceRoot: sourceDir, relativeWorkDir: "", repoRoot: null };
}

function getRelativeWorkDir(rootDir: string, sourceDir: string): string {
	const nestedPath = relative(rootDir, sourceDir);
	if (!nestedPath || nestedPath === ".") {
		return "";
	}
	if (nestedPath.startsWith("..") || isAbsolute(nestedPath)) {
		return "";
	}
	return nestedPath;
}

function resolveNestedWorkDir(rootDir: string, relativeWorkDir: string): string {
	return relativeWorkDir ? join(rootDir, relativeWorkDir) : rootDir;
}

function toContainerWorkDir(relativeWorkDir: string): string {
	const suffix = relativeWorkDir.replace(/\\/g, "/");
	return suffix ? `/workspace/${suffix}` : "/workspace";
}

function buildDockerEnvArgs(patterns: readonly string[]): string[] {
	const envArgs: string[] = [];
	for (const [key, val] of Object.entries(process.env)) {
		if (!key || !val) continue;
		if (patterns.some((pattern) => matchesEnvPattern(key, pattern))) {
			envArgs.push(`-e ${key}`);
		}
	}
	return envArgs;
}

function matchesEnvPattern(key: string, pattern: string): boolean {
	const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escapedPattern}$`).test(key);
}
