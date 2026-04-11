/**
 * Git helpers — structured access to git information.
 * All functions run git commands synchronously and parse the output.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

export interface GitStatus {
	branch: string;
	isClean: boolean;
	staged: string[];
	modified: string[];
	untracked: string[];
	ahead: number;
	behind: number;
}

export interface GitLogEntry {
	hash: string;
	shortHash: string;
	author: string;
	date: string;
	message: string;
}

export interface GitWorktreeAddOptions {
	/** Create and check out a fresh branch in the new worktree. */
	newBranch?: string;
}

/** Check if a directory is inside a git repository. */
export function isGitRepo(cwd: string): boolean {
	return existsSync(join(cwd, ".git")) || gitExec("rev-parse --git-dir", cwd) !== null;
}

/** Get the current branch name. */
export function gitBranch(cwd: string): string | null {
	return gitExec("rev-parse --abbrev-ref HEAD", cwd);
}

/** Get the main/master branch name. */
export function gitMainBranch(cwd: string): string | null {
	// Try common names
	for (const name of ["main", "master"]) {
		const result = gitExec(`rev-parse --verify ${name}`, cwd);
		if (result !== null) return name;
	}
	return null;
}

/** Get comprehensive git status. */
export function gitStatus(cwd: string): GitStatus | null {
	const branch = gitBranch(cwd);
	if (!branch) return null;

	const porcelain = gitExec("status --porcelain=v1", cwd);
	if (porcelain === null) return null;

	const staged: string[] = [];
	const modified: string[] = [];
	const untracked: string[] = [];

	for (const line of porcelain.split("\n")) {
		if (!line.trim()) continue;
		const indexStatus = line[0];
		const workStatus = line[1];
		const file = line.slice(3);

		if (indexStatus === "?" && workStatus === "?") {
			untracked.push(file);
		} else {
			if (indexStatus !== " " && indexStatus !== "?") {
				staged.push(file);
			}
			if (workStatus !== " " && workStatus !== "?") {
				modified.push(file);
			}
		}
	}

	// Ahead/behind
	let ahead = 0;
	let behind = 0;
	const abResult = gitExec(`rev-list --left-right --count HEAD...@{upstream}`, cwd);
	if (abResult) {
		const parts = abResult.split(/\s+/);
		ahead = Number.parseInt(parts[0], 10) || 0;
		behind = Number.parseInt(parts[1], 10) || 0;
	}

	return {
		branch,
		isClean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
		staged,
		modified,
		untracked,
		ahead,
		behind,
	};
}

/** Get git diff output (staged + unstaged by default). */
export function gitDiff(cwd: string, staged = false): string | null {
	const flag = staged ? "--staged" : "";
	return gitExec(`diff ${flag}`.trim(), cwd);
}

/** Get git diff against a specific ref. */
export function gitDiffRef(cwd: string, ref: string): string | null {
	return gitExec(`diff ${ref}...HEAD`, cwd);
}

/** Get recent commit log. */
export function gitLog(cwd: string, count = 10): GitLogEntry[] {
	const format = "%H%x1e%h%x1e%an%x1e%ai%x1e%s";
	const result = gitExec(`log -${count} --format="${format}"`, cwd);
	if (!result) return [];

	return result
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const [hash, shortHash, author, date, message] = line.split("\x1e");
			return { hash, shortHash, author, date, message };
		});
}

/** Get the git root directory. */
export function gitRoot(cwd: string): string | null {
	return gitExec("rev-parse --show-toplevel", cwd);
}

// ── Worktree helpers ──────────────────────────────────────────────────────────

/**
 * Create a linked git worktree at `path` checked out to `commitish` (default: HEAD).
 * When `options.newBranch` is set, Git creates and checks out that branch in the worktree.
 * Returns the resolved worktree path on success, or `null` on failure.
 *
 * @param repoRoot - Absolute path to the repository root.
 * @param path     - Destination directory for the new worktree.
 * @param commitish - Git ref to check out (default: `"HEAD"`).
 * @param options  - Optional worktree creation options.
 */
export function gitWorktreeAdd(
	repoRoot: string,
	path: string,
	commitish = "HEAD",
	options: GitWorktreeAddOptions = {},
): string | null {
	const args = ["worktree", "add"];
	if (options.newBranch?.trim()) {
		args.push("-b", options.newBranch.trim());
	}
	args.push(path, commitish);
	const result = gitExecArgs(args, repoRoot);
	if (result === null) return null;
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/**
 * Remove a linked git worktree created by {@link gitWorktreeAdd}.
 * Passes `--force` so the worktree is removed even if it has local modifications.
 *
 * @param repoRoot - Absolute path to the repository root.
 * @param path     - Path of the worktree to remove.
 */
export function gitWorktreeRemove(repoRoot: string, path: string): boolean {
	return gitExecArgs(["worktree", "remove", "--force", path], repoRoot) !== null;
}

/**
 * List all registered git worktrees, returning an array of their paths.
 *
 * @param repoRoot - Absolute path to the repository root.
 */
export function gitWorktreeList(repoRoot: string): string[] {
	const out = gitExecArgs(["worktree", "list", "--porcelain"], repoRoot);
	if (!out) return [];
	return out
		.split("\n")
		.filter((l) => l.startsWith("worktree "))
		.map((l) => l.slice("worktree ".length).trim());
}

// ── Internal ──────────────────────────────────────────────────────────────────

function gitExec(args: string, cwd: string): string | null {
	try {
		const result = execSync(`git ${args}`, {
			cwd,
			encoding: "utf-8",
			timeout: 10_000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return result.trim();
	} catch {
		return null;
	}
}

function gitExecArgs(args: string[], cwd: string): string | null {
	try {
		const result = execFileSync("git", args, {
			cwd,
			encoding: "utf-8",
			timeout: 10_000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return result.trim();
	} catch {
		return null;
	}
}
