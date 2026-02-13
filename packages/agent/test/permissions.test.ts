import { describe, it, expect, vi } from "vitest";
import { PermissionEngine } from "../src/safety/permissions.js";
import type { PermissionRule, PermissionDecision } from "@takumi/core";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeRule(overrides: Partial<PermissionRule> & { tool: string }): PermissionRule {
	return {
		pattern: "*",
		allow: true,
		scope: "session",
		...overrides,
	};
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("PermissionEngine", () => {
	/* ---- constructor ----------------------------------------------------- */

	describe("constructor", () => {
		it("starts with no rules by default", () => {
			const engine = new PermissionEngine();
			expect(engine.getRules()).toHaveLength(0);
		});

		it("accepts initial rules", () => {
			const rules: PermissionRule[] = [
				makeRule({ tool: "read_file", pattern: "*", allow: true }),
				makeRule({ tool: "exec", pattern: "*", allow: false }),
			];
			const engine = new PermissionEngine(rules);
			expect(engine.getRules()).toHaveLength(2);
		});

		it("does not share a reference with the initial rules array", () => {
			const rules: PermissionRule[] = [makeRule({ tool: "read_file" })];
			const engine = new PermissionEngine(rules);
			rules.push(makeRule({ tool: "extra" }));
			expect(engine.getRules()).toHaveLength(1);
		});
	});

	/* ---- check: no rules, no callback ----------------------------------- */

	describe("check — no rules, no callback", () => {
		it("denies by default when there are no rules and no callback", async () => {
			const engine = new PermissionEngine();
			const decision = await engine.check("read_file", { path: "/tmp/x" });

			expect(decision.allowed).toBe(false);
			expect(decision.reason).toBeDefined();
		});
	});

	/* ---- check: grant rules --------------------------------------------- */

	describe("check — grant rules", () => {
		it("allows when a matching grant rule exists", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "*", allow: true }));

			const decision = await engine.check("read_file", { file_path: "/any/path" });
			expect(decision.allowed).toBe(true);
			expect(decision.rule).toBeDefined();
			expect(decision.rule!.tool).toBe("read_file");
		});

		it("does not match a grant rule for a different tool", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "*" }));

			const decision = await engine.check("write_file", { file_path: "/foo" });
			expect(decision.allowed).toBe(false);
		});
	});

	/* ---- check: deny rules ---------------------------------------------- */

	describe("check — deny rules", () => {
		it("denies when a matching deny rule exists", async () => {
			const engine = new PermissionEngine();
			engine.deny(makeRule({ tool: "exec", pattern: "*" }));

			const decision = await engine.check("exec", { command: "rm -rf /" });
			expect(decision.allowed).toBe(false);
			expect(decision.rule).toBeDefined();
			expect(decision.rule!.allow).toBe(false);
		});
	});

	/* ---- check: wildcard tool (*) --------------------------------------- */

	describe("check — wildcard tool", () => {
		it("matches any tool when the rule uses tool='*'", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "*", pattern: "*" }));

			expect((await engine.check("read_file", {})).allowed).toBe(true);
			expect((await engine.check("write_file", {})).allowed).toBe(true);
			expect((await engine.check("exec", {})).allowed).toBe(true);
			expect((await engine.check("anything", {})).allowed).toBe(true);
		});

		it("wildcard tool with specific pattern still restricts on pattern", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "*", pattern: "/safe/**" }));

			expect((await engine.check("read_file", { file_path: "/safe/dir/file.txt" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "/unsafe/file.txt" })).allowed).toBe(false);
		});
	});

	/* ---- check: wildcard pattern (*) ------------------------------------ */

	describe("check — wildcard pattern", () => {
		it("pattern='*' matches any args", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "*" }));

			expect((await engine.check("read_file", { file_path: "/any/path" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "relative.txt" })).allowed).toBe(true);
			expect((await engine.check("read_file", {})).allowed).toBe(true);
		});
	});

	/* ---- check: glob pattern matching ----------------------------------- */

	describe("check — glob pattern matching", () => {
		it("** matches any path depth", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "/home/**" }));

			expect((await engine.check("read_file", { file_path: "/home/user/file" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "/home/user/deep/nested/file" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "/etc/passwd" })).allowed).toBe(false);
		});

		it("* matches a single path segment (no slashes)", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "*.ts" }));

			expect((await engine.check("read_file", { file_path: "foo.ts" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "bar.ts" })).allowed).toBe(true);
			// * should NOT match across path separators
			expect((await engine.check("read_file", { file_path: "dir/foo.ts" })).allowed).toBe(false);
		});

		it("combined **/pattern matches deep files", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "/project/**/src/*.ts" }));

			expect((await engine.check("read_file", { file_path: "/project/pkg/src/index.ts" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "/project/a/b/src/main.ts" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "/project/pkg/src/deep/file.ts" })).allowed).toBe(false);
		});

		it("exact path pattern matches only that path", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "/etc/hosts" }));

			expect((await engine.check("read_file", { file_path: "/etc/hosts" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "/etc/hostname" })).allowed).toBe(false);
			expect((await engine.check("read_file", { file_path: "/etc/hosts/extra" })).allowed).toBe(false);
		});
	});

	/* ---- check: arg field matching -------------------------------------- */

	describe("check — arg field matching", () => {
		it("matches against file_path arg", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "/allowed/**" }));

			const decision = await engine.check("read_file", { file_path: "/allowed/dir/f.txt" });
			expect(decision.allowed).toBe(true);
		});

		it("matches against command arg", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "exec", pattern: "ls *" }));

			const decision = await engine.check("exec", { command: "ls foo" });
			expect(decision.allowed).toBe(true);
		});

		it("matches against path arg", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "search", pattern: "/workspace/**" }));

			const decision = await engine.check("search", { path: "/workspace/src/file.ts" });
			expect(decision.allowed).toBe(true);
		});

		it("file_path takes precedence over command and path", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "tool", pattern: "/fp/**" }));

			// file_path is checked first; command and path are ignored when file_path is present
			const decision = await engine.check("tool", {
				file_path: "/fp/match.txt",
				command: "/nomatch/x",
				path: "/nomatch/y",
			});
			expect(decision.allowed).toBe(true);
		});

		it("falls back to empty string when no target arg exists", async () => {
			const engine = new PermissionEngine();
			// A specific pattern (not wildcard *) with no target arg => no match
			engine.grant(makeRule({ tool: "read_file", pattern: "/specific/path" }));

			const decision = await engine.check("read_file", { other_arg: "irrelevant" });
			expect(decision.allowed).toBe(false);
		});
	});

	/* ---- check: prompt callback ----------------------------------------- */

	describe("check — prompt callback", () => {
		it("falls through to the prompt callback when no rule matches", async () => {
			const engine = new PermissionEngine();
			const promptFn = vi.fn(async (): Promise<PermissionDecision> => ({
				allowed: true,
				reason: "User approved",
			}));
			engine.setPromptCallback(promptFn);

			const decision = await engine.check("write_file", { file_path: "/tmp/x" });

			expect(promptFn).toHaveBeenCalledOnce();
			expect(promptFn).toHaveBeenCalledWith("write_file", { file_path: "/tmp/x" });
			expect(decision.allowed).toBe(true);
			expect(decision.reason).toBe("User approved");
		});

		it("does not invoke the callback if a rule matches", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "*" }));

			const promptFn = vi.fn(async (): Promise<PermissionDecision> => ({
				allowed: false,
				reason: "Should not be called",
			}));
			engine.setPromptCallback(promptFn);

			const decision = await engine.check("read_file", {});
			expect(decision.allowed).toBe(true);
			expect(promptFn).not.toHaveBeenCalled();
		});

		it("prompt callback can deny access", async () => {
			const engine = new PermissionEngine();
			engine.setPromptCallback(async () => ({
				allowed: false,
				reason: "User denied",
			}));

			const decision = await engine.check("dangerous_tool", {});
			expect(decision.allowed).toBe(false);
			expect(decision.reason).toBe("User denied");
		});
	});

	/* ---- grant ----------------------------------------------------------- */

	describe("grant", () => {
		it("adds a rule to the engine", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "*" }));

			const rules = engine.getRules();
			expect(rules).toHaveLength(1);
			expect(rules[0].tool).toBe("read_file");
			expect(rules[0].allow).toBe(true);
		});

		it("replaces a conflicting rule with same tool, pattern, and scope", () => {
			const engine = new PermissionEngine();
			// First deny, then grant the same tool/pattern/scope
			engine.deny(makeRule({ tool: "exec", pattern: "/bin/*", scope: "session" }));
			expect(engine.getRules()[0].allow).toBe(false);

			engine.grant(makeRule({ tool: "exec", pattern: "/bin/*", scope: "session" }));
			const rules = engine.getRules();
			expect(rules).toHaveLength(1);
			expect(rules[0].allow).toBe(true);
		});

		it("does not replace rules with different scopes", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "exec", pattern: "*", scope: "global" }));
			engine.grant(makeRule({ tool: "exec", pattern: "*", scope: "session" }));

			expect(engine.getRules()).toHaveLength(2);
		});

		it("inserted rule takes priority (prepended)", async () => {
			const engine = new PermissionEngine([
				makeRule({ tool: "exec", pattern: "*", allow: false, scope: "global" }),
			]);

			// Grant with session scope — should be prepended and win
			engine.grant(makeRule({ tool: "exec", pattern: "*", scope: "session" }));
			const decision = await engine.check("exec", { command: "ls" });
			expect(decision.allowed).toBe(true);
		});
	});

	/* ---- deny ------------------------------------------------------------ */

	describe("deny", () => {
		it("adds a deny rule to the engine", () => {
			const engine = new PermissionEngine();
			engine.deny(makeRule({ tool: "exec", pattern: "rm *" }));

			const rules = engine.getRules();
			expect(rules).toHaveLength(1);
			expect(rules[0].allow).toBe(false);
		});

		it("replaces a conflicting grant rule with same tool, pattern, and scope", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "exec", pattern: "*", scope: "session" }));
			engine.deny(makeRule({ tool: "exec", pattern: "*", scope: "session" }));

			const rules = engine.getRules();
			expect(rules).toHaveLength(1);
			expect(rules[0].allow).toBe(false);
		});

		it("denied rule takes effect immediately", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "exec", pattern: "*", scope: "project" }));
			engine.deny(makeRule({ tool: "exec", pattern: "*", scope: "session" }));

			// The deny is prepended, so it wins
			const decision = await engine.check("exec", { command: "anything" });
			expect(decision.allowed).toBe(false);
		});
	});

	/* ---- reset ----------------------------------------------------------- */

	describe("reset", () => {
		it("removes session-scoped rules", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "a", pattern: "*", scope: "session" }));
			engine.grant(makeRule({ tool: "b", pattern: "*", scope: "session" }));

			engine.reset();
			expect(engine.getRules()).toHaveLength(0);
		});

		it("keeps project-scoped rules", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "a", pattern: "*", scope: "project" }));
			engine.grant(makeRule({ tool: "b", pattern: "*", scope: "session" }));

			engine.reset();
			const rules = engine.getRules();
			expect(rules).toHaveLength(1);
			expect(rules[0].tool).toBe("a");
			expect(rules[0].scope).toBe("project");
		});

		it("keeps global-scoped rules", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "a", pattern: "*", scope: "global" }));
			engine.grant(makeRule({ tool: "b", pattern: "*", scope: "session" }));

			engine.reset();
			const rules = engine.getRules();
			expect(rules).toHaveLength(1);
			expect(rules[0].scope).toBe("global");
		});

		it("keeps both project and global rules while removing session rules", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "g", pattern: "*", scope: "global" }));
			engine.grant(makeRule({ tool: "p", pattern: "*", scope: "project" }));
			engine.grant(makeRule({ tool: "s1", pattern: "*", scope: "session" }));
			engine.grant(makeRule({ tool: "s2", pattern: "*", scope: "session" }));

			engine.reset();
			const rules = engine.getRules();
			expect(rules).toHaveLength(2);
			expect(rules.every((r) => r.scope !== "session")).toBe(true);
		});
	});

	/* ---- resetAll -------------------------------------------------------- */

	describe("resetAll", () => {
		it("removes all rules including project and global scopes", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "a", pattern: "*", scope: "global" }));
			engine.grant(makeRule({ tool: "b", pattern: "*", scope: "project" }));
			engine.grant(makeRule({ tool: "c", pattern: "*", scope: "session" }));

			engine.resetAll();
			expect(engine.getRules()).toHaveLength(0);
		});

		it("engine denies everything after resetAll (no callback)", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "*", pattern: "*", scope: "global" }));
			engine.resetAll();

			const decision = await engine.check("read_file", {});
			expect(decision.allowed).toBe(false);
		});
	});

	/* ---- getRules -------------------------------------------------------- */

	describe("getRules", () => {
		it("returns the current set of rules", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "a", pattern: "*" }));
			engine.deny(makeRule({ tool: "b", pattern: "/secret/**" }));

			const rules = engine.getRules();
			expect(rules).toHaveLength(2);
		});

		it("returns an empty array when no rules exist", () => {
			const engine = new PermissionEngine();
			expect(engine.getRules()).toHaveLength(0);
		});

		it("returns a read-only array (typed as ReadonlyArray)", () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "tool", pattern: "*" }));
			const rules = engine.getRules();

			// TypeScript ensures this is ReadonlyArray; at runtime we just verify it exists
			expect(Array.isArray(rules)).toBe(true);
		});

		it("reflects dynamically added rules", () => {
			const engine = new PermissionEngine();
			expect(engine.getRules()).toHaveLength(0);

			engine.grant(makeRule({ tool: "x", pattern: "*" }));
			expect(engine.getRules()).toHaveLength(1);

			engine.grant(makeRule({ tool: "y", pattern: "*" }));
			expect(engine.getRules()).toHaveLength(2);
		});
	});

	/* ---- rule priority (first match wins) ------------------------------- */

	describe("rule priority", () => {
		it("first matching rule wins (rules are checked in order)", async () => {
			const engine = new PermissionEngine();
			// Deny all exec first, then grant specific — deny should be checked first
			engine.deny(makeRule({ tool: "exec", pattern: "*", scope: "session" }));

			// The grant is prepended, so it goes to the front
			engine.grant(makeRule({ tool: "exec", pattern: "ls *", scope: "session" }));

			// "ls foo" should be allowed because grant was prepended after deny
			const decision = await engine.check("exec", { command: "ls foo" });
			expect(decision.allowed).toBe(true);
		});

		it("initial rules are checked in array order", async () => {
			const engine = new PermissionEngine([
				makeRule({ tool: "exec", pattern: "*", allow: false }),
				makeRule({ tool: "exec", pattern: "ls *", allow: true }),
			]);

			// The deny-all rule comes first, so "ls foo" is denied
			const decision = await engine.check("exec", { command: "ls foo" });
			expect(decision.allowed).toBe(false);
		});
	});

	/* ---- edge cases ----------------------------------------------------- */

	describe("edge cases", () => {
		it("handles empty tool name", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "", pattern: "*" }));

			const decision = await engine.check("", {});
			expect(decision.allowed).toBe(true);
		});

		it("handles special regex characters in patterns", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "/path/to/file.test.ts" }));

			// The dots should be escaped — "file_test_ts" should NOT match
			const decisionGood = await engine.check("read_file", { file_path: "/path/to/file.test.ts" });
			expect(decisionGood.allowed).toBe(true);

			const decisionBad = await engine.check("read_file", { file_path: "/path/to/fileTtestTts" });
			expect(decisionBad.allowed).toBe(false);
		});

		it("handles ? wildcard matching a single character", async () => {
			const engine = new PermissionEngine();
			engine.grant(makeRule({ tool: "read_file", pattern: "file?.ts" }));

			expect((await engine.check("read_file", { file_path: "fileA.ts" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "file1.ts" })).allowed).toBe(true);
			expect((await engine.check("read_file", { file_path: "file.ts" })).allowed).toBe(false);
			expect((await engine.check("read_file", { file_path: "fileAB.ts" })).allowed).toBe(false);
		});
	});
});
