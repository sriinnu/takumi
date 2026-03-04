/**
 * Tests for Self-Healing Agent Loop (Phase 37).
 *
 * Covers: all built-in strategies, custom strategies, priority ordering,
 * edge cases, wildcard matching, and HealResult shape.
 */

import { describe, expect, it } from "vitest";
import { type HealStrategy, SelfHealer } from "../src/self-heal.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { filePath: "/tmp/foo.ts", content: "hello world", ...overrides };
}

// ── Built-in strategy tests ──────────────────────────────────────────────────

describe("SelfHealer", () => {
	describe("constructor", () => {
		it("initialises with built-in strategies by default", () => {
			const healer = new SelfHealer();
			expect(healer.strategyCount).toBeGreaterThanOrEqual(7);
		});

		it("accepts custom strategies array", () => {
			const custom: HealStrategy = {
				name: "custom",
				tool: "foo",
				errorPattern: /bar/,
				action: { type: "skip", message: "skipped" },
			};
			const healer = new SelfHealer([custom]);
			expect(healer.strategyCount).toBe(1);
		});

		it("accepts empty strategies array", () => {
			const healer = new SelfHealer([]);
			expect(healer.strategyCount).toBe(0);
		});
	});

	describe("register", () => {
		it("appends a new strategy", () => {
			const healer = new SelfHealer([]);
			healer.register({
				name: "test",
				tool: "x",
				errorPattern: /y/,
				action: { type: "skip", message: "m" },
			});
			expect(healer.strategyCount).toBe(1);
		});

		it("registerFirst inserts at the front", () => {
			const low: HealStrategy = {
				name: "low",
				tool: "t",
				errorPattern: /err/,
				action: { type: "skip", message: "low" },
			};
			const high: HealStrategy = {
				name: "high",
				tool: "t",
				errorPattern: /err/,
				action: { type: "skip", message: "high" },
			};
			const healer = new SelfHealer([low]);
			healer.registerFirst(high);

			const result = healer.heal("t", {}, "err");
			expect(result).not.toBeNull();
			expect(result!.strategy).toBe("high");
		});
	});

	describe("diagnose", () => {
		it("returns null when no strategies match", () => {
			const healer = new SelfHealer([]);
			expect(healer.diagnose("write", "some error")).toBeNull();
		});

		it("returns null when tool matches but error does not", () => {
			const healer = new SelfHealer();
			expect(healer.diagnose("write", "random unrelated error xyz")).toBeNull();
		});

		it("returns matching strategy for write + EEXIST", () => {
			const healer = new SelfHealer();
			const strategy = healer.diagnose("write", "EEXIST: file already exists");
			expect(strategy).not.toBeNull();
			expect(strategy!.name).toBe("write→edit fallback");
		});

		it("returns matching strategy for edit + no match found", () => {
			const healer = new SelfHealer();
			const strategy = healer.diagnose("edit", "no match found for oldString");
			expect(strategy).not.toBeNull();
			expect(strategy!.name).toBe("edit→write fallback");
		});
	});

	// ── Built-in: write → edit fallback ─────────────────────────────────

	describe("write→edit fallback", () => {
		it("heals write EEXIST with fallback to edit", () => {
			const healer = new SelfHealer();
			const result = healer.heal("write", { filePath: "/a.ts", content: "code" }, "EEXIST: file already exists");
			expect(result).not.toBeNull();
			expect(result!.healed).toBe(true);
			expect(result!.action).toBe("fallback_tool");
			expect(result!.strategy).toBe("write→edit fallback");
		});

		it("matches case-insensitive 'File Exists'", () => {
			const healer = new SelfHealer();
			const result = healer.heal("write", makeInput(), "File Exists — cannot overwrite");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("fallback_tool");
		});

		it("inputMapper extracts filePath and content", () => {
			const strategies = SelfHealer.builtinStrategies();
			const writeStrat = strategies.find((s) => s.name === "write→edit fallback")!;
			expect(writeStrat.action.type).toBe("fallback_tool");
			if (writeStrat.action.type === "fallback_tool") {
				const mapped = writeStrat.action.inputMapper({ filePath: "/x.ts", content: "hi" });
				expect(mapped).toHaveProperty("filePath", "/x.ts");
				expect(mapped).toHaveProperty("newString", "hi");
			}
		});

		it("inputMapper falls back to path and text keys", () => {
			const strategies = SelfHealer.builtinStrategies();
			const writeStrat = strategies.find((s) => s.name === "write→edit fallback")!;
			if (writeStrat.action.type === "fallback_tool") {
				const mapped = writeStrat.action.inputMapper({ path: "/y.ts", text: "data" });
				expect(mapped).toHaveProperty("filePath", "/y.ts");
				expect(mapped).toHaveProperty("newString", "data");
			}
		});
	});

	// ── Built-in: edit → write fallback ─────────────────────────────────

	describe("edit→write fallback", () => {
		it("heals edit no match with fallback to write", () => {
			const healer = new SelfHealer();
			const result = healer.heal(
				"edit",
				{ filePath: "/b.ts", oldString: "abc", newString: "xyz" },
				"no match found for oldString",
			);
			expect(result).not.toBeNull();
			expect(result!.healed).toBe(true);
			expect(result!.action).toBe("fallback_tool");
			expect(result!.strategy).toBe("edit→write fallback");
		});

		it("matches 'oldString not found' variant", () => {
			const healer = new SelfHealer();
			const result = healer.heal("edit", makeInput(), "oldString not found in file");
			expect(result).not.toBeNull();
			expect(result!.strategy).toBe("edit→write fallback");
		});

		it("inputMapper maps newString to content", () => {
			const strategies = SelfHealer.builtinStrategies();
			const strat = strategies.find((s) => s.name === "edit→write fallback")!;
			if (strat.action.type === "fallback_tool") {
				const mapped = strat.action.inputMapper({ filePath: "/z.ts", newString: "new code" });
				expect(mapped).toHaveProperty("content", "new code");
				expect(mapped).toHaveProperty("filePath", "/z.ts");
			}
		});
	});

	// ── Built-in: bash timeout retry ────────────────────────────────────

	describe("bash timeout retry", () => {
		it("heals bash timeout with doubled timeout", () => {
			const healer = new SelfHealer();
			const result = healer.heal("bash", { command: "sleep 100", timeout: 30000 }, "command timed out");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("retry_with_modified_input");
			expect(result!.strategy).toBe("bash timeout retry");
		});

		it("matches ETIMEDOUT", () => {
			const healer = new SelfHealer();
			const result = healer.heal("bash", { command: "curl http://slow" }, "ETIMEDOUT");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("retry_with_modified_input");
		});

		it("transform doubles timeout capped at 300_000", () => {
			const strategies = SelfHealer.builtinStrategies();
			const strat = strategies.find((s) => s.name === "bash timeout retry")!;
			if (strat.action.type === "retry_with_modified_input") {
				const modified = strat.action.transform({ command: "x", timeout: 200_000 });
				expect(modified.timeout).toBe(300_000);
			}
		});

		it("transform uses default 30_000 when no timeout specified", () => {
			const strategies = SelfHealer.builtinStrategies();
			const strat = strategies.find((s) => s.name === "bash timeout retry")!;
			if (strat.action.type === "retry_with_modified_input") {
				const modified = strat.action.transform({ command: "x" });
				expect(modified.timeout).toBe(60_000);
			}
		});
	});

	// ── Built-in: edit conflict split ───────────────────────────────────

	describe("edit conflict split", () => {
		it("heals ambiguous match with split suggestion", () => {
			const healer = new SelfHealer();
			const result = healer.heal("edit", makeInput(), "ambiguous match — matched 3 locations");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("split_edit");
			expect(result!.detail).toContain("20");
		});

		it("matches 'multiple matches' error", () => {
			const healer = new SelfHealer();
			const result = healer.heal("edit", makeInput(), "multiple matches in file");
			expect(result).not.toBeNull();
			expect(result!.strategy).toBe("edit conflict split");
		});

		it("matches 'matched N locations' error", () => {
			const healer = new SelfHealer();
			const result = healer.heal("edit", makeInput(), "matched 5 locations in the file");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("split_edit");
		});
	});

	// ── Built-in: permission denied skip ────────────────────────────────

	describe("permission denied skip", () => {
		it("skips on EACCES", () => {
			const healer = new SelfHealer();
			const result = healer.heal("bash", { command: "rm -rf /" }, "EACCES: permission denied");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("skip");
			expect(result!.detail).toContain("permission");
		});

		it("skips on 'not allowed'", () => {
			const healer = new SelfHealer();
			const result = healer.heal("some_tool", {}, "Operation not allowed by security policy");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("skip");
		});

		it("wildcard matches any tool name", () => {
			const healer = new SelfHealer();
			const r1 = healer.heal("write", {}, "blocked by policy");
			const r2 = healer.heal("arbitrary_tool", {}, "forbidden");
			expect(r1).not.toBeNull();
			expect(r2).not.toBeNull();
			expect(r1!.action).toBe("skip");
			expect(r2!.action).toBe("skip");
		});
	});

	// ── Built-in: file not found create ─────────────────────────────────

	describe("file not found create", () => {
		it("heals read ENOENT with write fallback", () => {
			const healer = new SelfHealer();
			const result = healer.heal("read", { filePath: "/missing.ts" }, "ENOENT: no such file or directory");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("fallback_tool");
			expect(result!.strategy).toBe("file not found create");
		});

		it("heals edit ENOENT with write fallback", () => {
			const healer = new SelfHealer();
			const result = healer.heal("edit", { filePath: "/missing.ts", newString: "new" }, "ENOENT: file does not exist");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("fallback_tool");
			expect(result!.strategy).toBe("edit file not found create");
		});

		it("matches 'file not found' case-insensitively", () => {
			const healer = new SelfHealer();
			const result = healer.heal("read", { path: "/x" }, "File Not Found at path /x");
			expect(result).not.toBeNull();
		});
	});

	// ── HealResult shape ────────────────────────────────────────────────

	describe("HealResult shape", () => {
		it("contains all required fields", () => {
			const healer = new SelfHealer();
			const result = healer.heal("write", makeInput(), "file already exists");
			expect(result).not.toBeNull();
			expect(result).toHaveProperty("healed");
			expect(result).toHaveProperty("strategy");
			expect(result).toHaveProperty("originalError");
			expect(result).toHaveProperty("action");
			expect(result).toHaveProperty("detail");
		});

		it("originalError preserves the full error string", () => {
			const error = "EEXIST: file already exists, open '/tmp/foo.ts'";
			const healer = new SelfHealer();
			const result = healer.heal("write", makeInput(), error);
			expect(result!.originalError).toBe(error);
		});
	});

	// ── Custom strategies ───────────────────────────────────────────────

	describe("custom strategies", () => {
		it("custom skip strategy works", () => {
			const healer = new SelfHealer([]);
			healer.register({
				name: "custom skip",
				tool: "deploy",
				errorPattern: /rate limit/i,
				action: { type: "skip", message: "Rate limited, skipping deploy" },
			});
			const result = healer.heal("deploy", {}, "Rate limit exceeded");
			expect(result).not.toBeNull();
			expect(result!.strategy).toBe("custom skip");
			expect(result!.action).toBe("skip");
		});

		it("custom retry strategy transforms input", () => {
			const healer = new SelfHealer([]);
			healer.register({
				name: "retry with flag",
				tool: "api_call",
				errorPattern: /503/,
				action: {
					type: "retry_with_modified_input",
					transform: (input) => ({ ...input, retryAttempt: true }),
				},
			});
			const result = healer.heal("api_call", { url: "/foo" }, "HTTP 503 Service Unavailable");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("retry_with_modified_input");
		});

		it("custom fallback tool strategy maps input", () => {
			const healer = new SelfHealer([]);
			healer.register({
				name: "grep→ripgrep",
				tool: "grep",
				errorPattern: /not installed/,
				action: {
					type: "fallback_tool",
					toolName: "ripgrep",
					inputMapper: (input) => ({ pattern: input.query, path: input.directory }),
				},
			});
			const result = healer.heal("grep", { query: "foo", directory: "/src" }, "grep: not installed");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("fallback_tool");
			expect(result!.detail).toContain("ripgrep");
		});

		it("custom split_edit strategy sets maxChunkLines", () => {
			const healer = new SelfHealer([]);
			healer.register({
				name: "big edit split",
				tool: "patch",
				errorPattern: /too large/,
				action: { type: "split_edit", maxChunkLines: 10 },
			});
			const result = healer.heal("patch", {}, "Patch too large to apply atomically");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("split_edit");
			expect(result!.detail).toContain("10");
		});
	});

	// ── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("returns null for empty error string", () => {
			const healer = new SelfHealer();
			expect(healer.heal("write", {}, "")).toBeNull();
		});

		it("returns null for unknown tool", () => {
			const healer = new SelfHealer([]);
			expect(healer.heal("unknown_tool", {}, "some error")).toBeNull();
		});

		it("first matching strategy wins", () => {
			const s1: HealStrategy = {
				name: "first",
				tool: "t",
				errorPattern: /err/,
				action: { type: "skip", message: "first wins" },
			};
			const s2: HealStrategy = {
				name: "second",
				tool: "t",
				errorPattern: /err/,
				action: { type: "skip", message: "second loses" },
			};
			const healer = new SelfHealer([s1, s2]);
			const result = healer.heal("t", {}, "err");
			expect(result!.strategy).toBe("first");
		});

		it("tool matching is case-insensitive", () => {
			const healer = new SelfHealer();
			const result = healer.heal("WRITE", makeInput(), "file already exists");
			expect(result).not.toBeNull();
		});

		it("tool matching is substring-based", () => {
			const healer = new SelfHealer();
			// "file_write" contains "write"
			const result = healer.heal("file_write", makeInput(), "EEXIST");
			expect(result).not.toBeNull();
			expect(result!.strategy).toBe("write→edit fallback");
		});

		it("handles input with no relevant keys gracefully", () => {
			const healer = new SelfHealer();
			const result = healer.heal("write", {}, "file already exists");
			expect(result).not.toBeNull();
			// Should not throw even with empty input
			expect(result!.healed).toBe(true);
		});

		it("diagnose returns null for non-matching error on correct tool", () => {
			const healer = new SelfHealer();
			expect(healer.diagnose("bash", "syntax error near unexpected token")).toBeNull();
		});
	});

	// ── Static builtinStrategies ─────────────────────────────────────────

	describe("builtinStrategies", () => {
		it("returns an array of strategies", () => {
			const strategies = SelfHealer.builtinStrategies();
			expect(Array.isArray(strategies)).toBe(true);
			expect(strategies.length).toBeGreaterThanOrEqual(7);
		});

		it("all strategies have required fields", () => {
			for (const s of SelfHealer.builtinStrategies()) {
				expect(s).toHaveProperty("name");
				expect(s).toHaveProperty("tool");
				expect(s).toHaveProperty("errorPattern");
				expect(s).toHaveProperty("action");
				expect(s.errorPattern).toBeInstanceOf(RegExp);
			}
		});

		it("each strategy has a unique name", () => {
			const names = SelfHealer.builtinStrategies().map((s) => s.name);
			expect(new Set(names).size).toBe(names.length);
		});
	});

	// ── Multiple heal attempts ──────────────────────────────────────────

	describe("multiple heals", () => {
		it("can heal different errors for the same tool", () => {
			const healer = new SelfHealer();
			const r1 = healer.heal("edit", makeInput(), "no match found");
			const r2 = healer.heal("edit", makeInput(), "ambiguous match");
			expect(r1!.strategy).toBe("edit→write fallback");
			expect(r2!.strategy).toBe("edit conflict split");
		});

		it("the permission denied wildcard catches errors on edit before ENOENT when pattern matches", () => {
			const healer = new SelfHealer();
			// "permission denied" matches the wildcard * strategy
			const result = healer.heal("edit", makeInput(), "permission denied");
			expect(result).not.toBeNull();
			expect(result!.action).toBe("skip");
		});
	});
});
