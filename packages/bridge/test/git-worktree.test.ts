import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove } from "@takumi/bridge";
import { describe, expect, it } from "vitest";

function createRepo(): string {
	const repoRoot = mkdtempSync(join(tmpdir(), "takumi-bridge-git-"));
	execSync("git init", { cwd: repoRoot });
	execSync('git config user.email "test@test.com"', { cwd: repoRoot });
	execSync('git config user.name "Test"', { cwd: repoRoot });
	execSync("git config commit.gpgsign false", { cwd: repoRoot });
	execSync("git config tag.gpgsign false", { cwd: repoRoot });
	writeFileSync(join(repoRoot, "README.md"), "# test\n");
	execSync("git add .", { cwd: repoRoot });
	execSync('git commit -m "init"', { cwd: repoRoot });
	return repoRoot;
}

describe("git worktree helpers", () => {
	it("creates a worktree on the requested new branch", () => {
		const repoRoot = createRepo();
		const worktreePath = mkdtempSync(join(tmpdir(), "takumi-bridge-wt-"));
		const branchName = "takumi/test-side-lane";

		try {
			rmSync(worktreePath, { recursive: true, force: true });
			const added = gitWorktreeAdd(repoRoot, worktreePath, "HEAD", { newBranch: branchName });
			const canonicalWorktreePath = realpathSync(worktreePath);
			expect(added).toBe(canonicalWorktreePath);
			expect(canonicalizePaths(gitWorktreeList(repoRoot))).toContain(canonicalWorktreePath);

			const currentBranch = execSync("git branch --show-current", {
				cwd: worktreePath,
				encoding: "utf-8",
			}).trim();
			expect(currentBranch).toBe(branchName);

			expect(gitWorktreeRemove(repoRoot, worktreePath)).toBe(true);
			expect(canonicalizePaths(gitWorktreeList(repoRoot))).not.toContain(canonicalWorktreePath);
		} finally {
			rmSync(worktreePath, { recursive: true, force: true });
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});

function canonicalizePaths(paths: string[]): string[] {
	return paths.map((path) => {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	});
}
