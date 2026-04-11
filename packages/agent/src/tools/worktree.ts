/**
 * Worktree tool — speculative execution via ephemeral git worktrees.
 *
 * Spins up a linked worktree in /tmp, runs a verification command
 * (e.g. `tsc --noEmit`, `pnpm test`), and reports pass/fail.
 * Enables speculative multi-branch execution where the agent can
 * trial changes in isolation before merging into the live tree.
 */

import { exec as nodeExec } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition } from "@takumi/core";
import { LIMITS } from "@takumi/core";
import type { ToolHandler } from "./registry.js";

/** Promisified exec — lazy-init to avoid breaking test mocks that omit `exec`. */
type ExecFn = (cmd: string, opts: object) => Promise<{ stdout: string; stderr: string }>;
let _execAsync: ExecFn | undefined;
function getExecAsync(): ExecFn {
	_execAsync ??= promisify(nodeExec) as unknown as ExecFn;
	return _execAsync;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WORKTREE_PREFIX = "takumi-speculative-";
const DEFAULT_VERIFY_TIMEOUT = 120_000;

// ── Tool: worktree_create ────────────────────────────────────────────────────

export const worktreeCreateDefinition: ToolDefinition = {
	name: "worktree_create",
	description:
		"Create an ephemeral git worktree in /tmp for speculative execution. " +
		"Returns the worktree path. Use worktree_exec to run commands inside it, " +
		"and worktree_destroy to clean up when done.",
	inputSchema: {
		type: "object",
		properties: {
			branch: {
				type: "string",
				description: "Branch or commitish to check out (default: HEAD)",
				default: "HEAD",
			},
			label: {
				type: "string",
				description: "Short label for the worktree directory (e.g. 'trial-a')",
			},
		},
		required: [],
	},
	requiresPermission: true,
	category: "execute",
};

export const worktreeCreateHandler: ToolHandler = async (input) => {
	const branch = (input.branch as string) || "HEAD";
	const label = (input.label as string) || `${Date.now()}`;
	const worktreeName = `${WORKTREE_PREFIX}${label}`;
	const worktreePath = join(tmpdir(), worktreeName);

	try {
		await access(worktreePath);
		return { output: `Worktree already exists at ${worktreePath}`, isError: true };
	} catch {
		// Expected — directory doesn't exist yet
	}

	try {
		await mkdir(worktreePath, { recursive: true });
		await rm(worktreePath, { recursive: true });

		await getExecAsync()(`git worktree add "${worktreePath}" ${branch}`, {
			timeout: 30_000,
			encoding: "utf-8",
		});

		return {
			output: JSON.stringify({ path: worktreePath, branch, label }),
			isError: false,
		};
	} catch (err: any) {
		return {
			output: `Failed to create worktree: ${err.stderr?.toString() ?? err.message}`,
			isError: true,
		};
	}
};

// ── Tool: worktree_exec ──────────────────────────────────────────────────────

export const worktreeExecDefinition: ToolDefinition = {
	name: "worktree_exec",
	description:
		"Execute a command inside a speculative worktree. " +
		"Use this to run tsc, vitest, or any verification command in isolation.",
	inputSchema: {
		type: "object",
		properties: {
			worktree_path: {
				type: "string",
				description: "Absolute path to the worktree (from worktree_create)",
			},
			command: {
				type: "string",
				description: "Shell command to execute inside the worktree",
			},
			timeout: {
				type: "number",
				description: "Timeout in milliseconds (default: 120000)",
				default: DEFAULT_VERIFY_TIMEOUT,
			},
		},
		required: ["worktree_path", "command"],
	},
	requiresPermission: true,
	category: "execute",
};

export const worktreeExecHandler: ToolHandler = async (input) => {
	const worktreePath = input.worktree_path as string;
	const command = input.command as string;
	const timeout = Math.min((input.timeout as number) || DEFAULT_VERIFY_TIMEOUT, 600_000);

	try {
		await access(worktreePath);
	} catch {
		return { output: `Worktree not found: ${worktreePath}`, isError: true };
	}

	try {
		const { stdout } = await getExecAsync()(command, {
			cwd: worktreePath,
			timeout,
			maxBuffer: LIMITS.MAX_BASH_OUTPUT,
			encoding: "utf-8",
			env: { ...process.env },
		});

		return {
			output: (typeof stdout === "string" ? stdout : "") || "(no output)",
			isError: false,
			metadata: { worktreePath, exitCode: 0 },
		};
	} catch (err: any) {
		const stderr = err.stderr?.toString() ?? "";
		const stdout = err.stdout?.toString() ?? "";
		const exitCode = err.status ?? 1;
		return {
			output: [stdout, stderr, `Exit code: ${exitCode}`].filter(Boolean).join("\n"),
			isError: true,
			metadata: { worktreePath, exitCode },
		};
	}
};

// ── Tool: worktree_merge ─────────────────────────────────────────────────────

export const worktreeMergeDefinition: ToolDefinition = {
	name: "worktree_merge",
	description:
		"Apply changes from a speculative worktree back to the main working directory. " +
		"Creates a patch from the worktree and applies it. Merge only after verification passes.",
	inputSchema: {
		type: "object",
		properties: {
			worktree_path: {
				type: "string",
				description: "Path to the worktree whose changes to apply",
			},
		},
		required: ["worktree_path"],
	},
	requiresPermission: true,
	category: "write",
};

export const worktreeMergeHandler: ToolHandler = async (input) => {
	const worktreePath = input.worktree_path as string;

	try {
		await access(worktreePath);
	} catch {
		return { output: `Worktree not found: ${worktreePath}`, isError: true };
	}

	try {
		// Generate patch from worktree changes
		const { stdout: diff } = await getExecAsync()("git diff HEAD", {
			cwd: worktreePath,
			encoding: "utf-8",
			maxBuffer: LIMITS.MAX_BASH_OUTPUT,
		});

		if (!diff.trim()) {
			return { output: "No changes to merge from worktree.", isError: false };
		}

		// Apply patch to main working directory
		await getExecAsync()("git apply --3way -", {
			encoding: "utf-8",
			timeout: 30_000,
		});

		return {
			output: `Successfully merged changes from ${worktreePath}`,
			isError: false,
		};
	} catch (err: any) {
		return {
			output: `Merge failed: ${err.stderr?.toString() ?? err.message}`,
			isError: true,
		};
	}
};

// ── Tool: worktree_destroy ───────────────────────────────────────────────────

export const worktreeDestroyDefinition: ToolDefinition = {
	name: "worktree_destroy",
	description: "Remove an ephemeral worktree and clean up git metadata.",
	inputSchema: {
		type: "object",
		properties: {
			worktree_path: {
				type: "string",
				description: "Path to the worktree to remove",
			},
		},
		required: ["worktree_path"],
	},
	requiresPermission: true,
	category: "execute",
};

export const worktreeDestroyHandler: ToolHandler = async (input) => {
	const worktreePath = input.worktree_path as string;

	try {
		await getExecAsync()(`git worktree remove --force "${worktreePath}"`, {
			encoding: "utf-8",
			timeout: 15_000,
		});

		// Clean up remaining directory if git didn't fully remove it
		try {
			await access(worktreePath);
			await rm(worktreePath, { recursive: true, force: true });
		} catch {
			// Already gone — expected
		}

		return { output: `Destroyed worktree: ${worktreePath}`, isError: false };
	} catch (_err: any) {
		// Force cleanup even on git error
		try {
			await rm(worktreePath, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
		return {
			output: `Worktree removed (forced): ${worktreePath}`,
			isError: false,
		};
	}
};
