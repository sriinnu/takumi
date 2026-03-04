/**
 * Tests for worktree tools (Phase 27).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { worktreeCreateHandler, worktreeDestroyHandler, worktreeExecHandler } from "../src/tools/worktree.js";

// Set up a temporary git repo for testing
const REPO_DIR = join(tmpdir(), "takumi-worktree-test-repo");

beforeAll(() => {
	rmSync(REPO_DIR, { recursive: true, force: true });
	mkdirSync(REPO_DIR, { recursive: true });
	execSync("git init", { cwd: REPO_DIR });
	execSync('git config user.email "test@test.com"', { cwd: REPO_DIR });
	execSync('git config user.name "Test"', { cwd: REPO_DIR });
	writeFileSync(join(REPO_DIR, "hello.ts"), "export const hello = 'world';");
	execSync("git add . && git commit -m 'init'", { cwd: REPO_DIR });
	// Ensure the original process cwd points to our test repo
	process.chdir(REPO_DIR);
});

afterAll(() => {
	// Clean up any remaining worktrees
	try {
		execSync("git worktree prune", { cwd: REPO_DIR });
	} catch {
		/* ok */
	}
	rmSync(REPO_DIR, { recursive: true, force: true });
});

describe("worktree_create", () => {
	it("creates a worktree in /tmp", async () => {
		const result = await worktreeCreateHandler({ branch: "HEAD", label: "test-a" });
		expect(result.isError).toBe(false);

		const parsed = JSON.parse(result.output);
		expect(parsed.path).toContain("takumi-speculative-test-a");
		expect(parsed.branch).toBe("HEAD");
		expect(existsSync(parsed.path)).toBe(true);

		// Cleanup
		await worktreeDestroyHandler({ worktree_path: parsed.path });
	});

	it("errors on duplicate label", async () => {
		const r1 = await worktreeCreateHandler({ branch: "HEAD", label: "dup-test" });
		expect(r1.isError).toBe(false);
		const path = JSON.parse(r1.output).path;

		const r2 = await worktreeCreateHandler({ branch: "HEAD", label: "dup-test" });
		expect(r2.isError).toBe(true);

		await worktreeDestroyHandler({ worktree_path: path });
	});
});

describe("worktree_exec", () => {
	it("runs a command inside the worktree", async () => {
		const createResult = await worktreeCreateHandler({ branch: "HEAD", label: "exec-test" });
		const path = JSON.parse(createResult.output).path;

		const result = await worktreeExecHandler({
			worktree_path: path,
			command: "cat hello.ts",
		});

		expect(result.isError).toBe(false);
		expect(result.output).toContain("hello");

		await worktreeDestroyHandler({ worktree_path: path });
	});

	it("errors on missing worktree", async () => {
		const result = await worktreeExecHandler({
			worktree_path: "/tmp/nonexistent-worktree-xyz",
			command: "ls",
		});
		expect(result.isError).toBe(true);
	});
});

describe("worktree_destroy", () => {
	it("removes the worktree cleanly", async () => {
		const createResult = await worktreeCreateHandler({ branch: "HEAD", label: "destroy-test" });
		const path = JSON.parse(createResult.output).path;
		expect(existsSync(path)).toBe(true);

		const result = await worktreeDestroyHandler({ worktree_path: path });
		expect(result.isError).toBe(false);
		expect(existsSync(path)).toBe(false);
	});

	it("handles already-removed path gracefully", async () => {
		const result = await worktreeDestroyHandler({
			worktree_path: "/tmp/takumi-speculative-ghost",
		});
		// Should not error — force cleanup
		expect(result.isError).toBe(false);
	});
});
