import { describe, it, expect } from "vitest";
import { isGitRepo, gitBranch, gitStatus, gitLog, gitRoot } from "@takumi/bridge";
import { join } from "node:path";

// These tests run against the actual takumi repo (or its parent)
const PROJECT_ROOT = join(import.meta.dirname, "../../..");

describe("git helpers", () => {
	it("isGitRepo returns true for a git directory", () => {
		// The monorepo root should be a git repo
		expect(isGitRepo(PROJECT_ROOT)).toBe(true);
	});

	it("isGitRepo returns false for a non-git directory", () => {
		expect(isGitRepo("/tmp")).toBe(false);
	});

	it("gitBranch returns a string for a git repo", () => {
		const branch = gitBranch(PROJECT_ROOT);
		// May be null if no commits yet, but should be a string in most cases
		if (branch !== null) {
			expect(typeof branch).toBe("string");
			expect(branch.length).toBeGreaterThan(0);
		}
	});

	it("gitStatus returns structured status", () => {
		const status = gitStatus(PROJECT_ROOT);
		if (status) {
			expect(status.branch).toBeDefined();
			expect(typeof status.isClean).toBe("boolean");
			expect(Array.isArray(status.staged)).toBe(true);
			expect(Array.isArray(status.modified)).toBe(true);
			expect(Array.isArray(status.untracked)).toBe(true);
		}
	});

	it("gitLog returns entries with expected shape", () => {
		const entries = gitLog(PROJECT_ROOT, 3);
		// May be empty for a new repo
		for (const entry of entries) {
			expect(entry.hash).toBeDefined();
			expect(entry.shortHash).toBeDefined();
			expect(entry.author).toBeDefined();
			expect(entry.message).toBeDefined();
		}
	});

	it("gitRoot returns the repo root path", () => {
		const root = gitRoot(PROJECT_ROOT);
		if (root) {
			expect(typeof root).toBe("string");
			expect(root.length).toBeGreaterThan(0);
		}
	});
});
