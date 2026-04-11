/**
 * Tests for Semantic Diff Review (Phase 32).
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { reviewDiff } from "../src/tools/diff-review.js";

const TEST_DIR = join(tmpdir(), "takumi-diff-review-test");

beforeAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(TEST_DIR, { recursive: true });

	// Init a git repo with an initial commit
	execSync(
		"git init && git config user.email 'test@test.com' && git config user.name 'Test' && git config commit.gpgsign false && git config tag.gpgsign false",
		{
			cwd: TEST_DIR,
		},
	);
	writeFileSync(join(TEST_DIR, "index.ts"), "export const x = 1;\n");
	execSync("git add . && git commit -m 'init'", { cwd: TEST_DIR });
});

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("reviewDiff", () => {
	it("returns empty findings for no changes", () => {
		const result = reviewDiff({ cwd: TEST_DIR, diffTarget: "staged" });
		expect(result.findings).toHaveLength(0);
		expect(result.passed).toBe(true);
	});

	it("detects console.log in staged changes", () => {
		writeFileSync(join(TEST_DIR, "debug.ts"), 'console.log("oops");\n');
		execSync("git add debug.ts", { cwd: TEST_DIR });

		const result = reviewDiff({ cwd: TEST_DIR, diffTarget: "staged" });
		const debugFindings = result.findings.filter((f) => f.rule === "no-debug");
		expect(debugFindings.length).toBeGreaterThan(0);
		expect(debugFindings[0].message).toContain("console.log");

		// Cleanup
		execSync("git reset HEAD debug.ts && rm -f debug.ts", { cwd: TEST_DIR });
	});

	it("detects TODO/FIXME in added lines", () => {
		writeFileSync(join(TEST_DIR, "todo.ts"), "// TODO: fix this later\n");
		execSync("git add todo.ts", { cwd: TEST_DIR });

		const result = reviewDiff({ cwd: TEST_DIR, diffTarget: "staged" });
		const todoFindings = result.findings.filter((f) => f.rule === "todo-tracking");
		expect(todoFindings.length).toBeGreaterThan(0);

		// Cleanup
		execSync("git reset HEAD todo.ts && rm -f todo.ts", { cwd: TEST_DIR });
	});

	it("detects any type in added lines", () => {
		writeFileSync(join(TEST_DIR, "typed.ts"), "const x: any = 42;\n");
		execSync("git add typed.ts", { cwd: TEST_DIR });

		const result = reviewDiff({ cwd: TEST_DIR, diffTarget: "staged" });
		const anyFindings = result.findings.filter((f) => f.rule === "no-any");
		expect(anyFindings.length).toBeGreaterThan(0);

		// Cleanup
		execSync("git reset HEAD typed.ts && rm -f typed.ts", { cwd: TEST_DIR });
	});

	it("respects checkDebugStatements=false config", () => {
		writeFileSync(join(TEST_DIR, "debug2.ts"), 'console.log("ok");\n');
		execSync("git add debug2.ts", { cwd: TEST_DIR });

		const result = reviewDiff({
			cwd: TEST_DIR,
			diffTarget: "staged",
			checkDebugStatements: false,
		});
		const debugFindings = result.findings.filter((f) => f.rule === "no-debug");
		expect(debugFindings).toHaveLength(0);

		// Cleanup
		execSync("git reset HEAD debug2.ts && rm -f debug2.ts", { cwd: TEST_DIR });
	});

	it("produces a summary string", () => {
		writeFileSync(join(TEST_DIR, "sum.ts"), 'console.log("test");\n// FIXME broken\n');
		execSync("git add sum.ts", { cwd: TEST_DIR });

		const result = reviewDiff({ cwd: TEST_DIR, diffTarget: "staged" });
		expect(result.summary).toContain("Diff Review");
		expect(result.filesReviewed).toBeGreaterThan(0);

		// Cleanup
		execSync("git reset HEAD sum.ts && rm -f sum.ts", { cwd: TEST_DIR });
	});

	it("handles non-git directory gracefully", () => {
		const nonGitDir = join(tmpdir(), "takumi-no-git-review");
		mkdirSync(nonGitDir, { recursive: true });

		const result = reviewDiff({ cwd: nonGitDir });
		expect(result.passed).toBe(true);
		expect(result.findings).toHaveLength(0);

		rmSync(nonGitDir, { recursive: true, force: true });
	});

	it("does not emit git noise for non-git directories", () => {
		const nonGitDir = join(tmpdir(), "takumi-no-git-review-quiet");
		mkdirSync(nonGitDir, { recursive: true });

		const stderrSpy = vi.spyOn(process.stderr, "write");
		const result = reviewDiff({ cwd: nonGitDir });

		expect(result.passed).toBe(true);
		expect(stderrSpy).not.toHaveBeenCalled();

		stderrSpy.mockRestore();
		rmSync(nonGitDir, { recursive: true, force: true });
	});
});
