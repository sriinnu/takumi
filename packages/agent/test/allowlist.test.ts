/**
 * Tests for the declarative allowlist configuration.
 */

import type { PermissionRule } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { buildDefaultRules, mergeAllowlist, parseAllowlistConfig } from "../src/safety/allowlist.js";

/* ── buildDefaultRules ─────────────────────────────────────────────────────── */

describe("buildDefaultRules", () => {
	it("returns a non-empty array of rules", () => {
		const rules = buildDefaultRules();
		expect(rules.length).toBeGreaterThan(0);
	});

	it("includes read-only tools as always-allowed", () => {
		const rules = buildDefaultRules();
		const read = rules.find((r) => r.tool === "read");
		expect(read).toBeDefined();
		expect(read!.allow).toBe(true);
		expect(read!.scope).toBe("global");
	});

	it("includes glob as always-allowed", () => {
		const rules = buildDefaultRules();
		const glob = rules.find((r) => r.tool === "glob");
		expect(glob).toBeDefined();
		expect(glob!.allow).toBe(true);
	});

	it("includes grep as always-allowed", () => {
		const rules = buildDefaultRules();
		const grep = rules.find((r) => r.tool === "grep");
		expect(grep).toBeDefined();
		expect(grep!.allow).toBe(true);
	});

	it("includes ask as always-allowed", () => {
		const rules = buildDefaultRules();
		const ask = rules.find((r) => r.tool === "ask");
		expect(ask).toBeDefined();
		expect(ask!.allow).toBe(true);
	});

	it("includes write/edit tools that require prompt", () => {
		const rules = buildDefaultRules();
		const write = rules.find((r) => r.tool === "write");
		expect(write).toBeDefined();
		expect(write!.allow).toBe(false);
		expect(write!.scope).toBe("session");
	});

	it("includes bash safe patterns", () => {
		const rules = buildDefaultRules();
		const bashRules = rules.filter((r) => r.tool === "bash");
		expect(bashRules.length).toBeGreaterThan(0);

		// npm/pnpm are safe
		const npm = bashRules.find((r) => r.pattern === "npm *" && r.allow);
		expect(npm).toBeDefined();
	});

	it("includes bash deny patterns", () => {
		const rules = buildDefaultRules();
		const bashDeny = rules.filter((r) => r.tool === "bash" && !r.allow);
		expect(bashDeny.length).toBeGreaterThan(0);

		// rm -rf / is denied
		const rmRf = bashDeny.find((r) => r.pattern.includes("rm -rf"));
		expect(rmRf).toBeDefined();
	});

	it("denies sudo", () => {
		const rules = buildDefaultRules();
		const sudo = rules.find((r) => r.tool === "bash" && r.pattern === "sudo *");
		expect(sudo).toBeDefined();
		expect(sudo!.allow).toBe(false);
	});

	it("denies git push --force", () => {
		const rules = buildDefaultRules();
		const forcePush = rules.find((r) => r.tool === "bash" && r.pattern.includes("push --force"));
		expect(forcePush).toBeDefined();
		expect(forcePush!.allow).toBe(false);
	});
});

/* ── mergeAllowlist ────────────────────────────────────────────────────────── */

describe("mergeAllowlist", () => {
	it("returns default rules when no overrides given", () => {
		const rules = mergeAllowlist();
		const defaults = buildDefaultRules();
		expect(rules).toEqual(defaults);
	});

	it("returns default rules when overrides is undefined", () => {
		const rules = mergeAllowlist(undefined);
		expect(rules.length).toBe(buildDefaultRules().length);
	});

	it("prepends allowBash patterns to rules", () => {
		const rules = mergeAllowlist({ allowBash: ["docker *"] });
		const docker = rules.find((r) => r.pattern === "docker *");
		expect(docker).toBeDefined();
		expect(docker!.allow).toBe(true);
		expect(docker!.scope).toBe("project");
	});

	it("prepends denyBash patterns to rules", () => {
		const rules = mergeAllowlist({ denyBash: ["curl *"] });
		const curl = rules.find((r) => r.pattern === "curl *");
		expect(curl).toBeDefined();
		expect(curl!.allow).toBe(false);
		expect(curl!.scope).toBe("project");
	});

	it("adds allowTools as globally allowed", () => {
		const rules = mergeAllowlist({ allowTools: ["custom_read"] });
		const custom = rules.find((r) => r.tool === "custom_read");
		expect(custom).toBeDefined();
		expect(custom!.allow).toBe(true);
		expect(custom!.scope).toBe("project");
	});

	it("adds denyTools as globally denied", () => {
		const rules = mergeAllowlist({ denyTools: ["dangerous"] });
		const deny = rules.find((r) => r.tool === "dangerous");
		expect(deny).toBeDefined();
		expect(deny!.allow).toBe(false);
	});

	it("custom rules appear first (highest priority)", () => {
		const customRule: PermissionRule = {
			tool: "bash",
			pattern: "make deploy*",
			allow: true,
			scope: "project",
		};
		const rules = mergeAllowlist({ rules: [customRule] });
		expect(rules[0]).toEqual(customRule);
	});

	it("deny overrides appear before allow overrides", () => {
		const rules = mergeAllowlist({
			denyBash: ["wget *"],
			allowBash: ["wget --help*"],
		});
		const denyIndex = rules.findIndex((r) => r.pattern === "wget *" && !r.allow);
		const allowIndex = rules.findIndex((r) => r.pattern === "wget --help*" && r.allow);
		expect(denyIndex).toBeLessThan(allowIndex);
	});

	it("overrides include base defaults at the end", () => {
		const rules = mergeAllowlist({ allowBash: ["extra *"] });
		const defaults = buildDefaultRules();
		// Last N elements should be the defaults
		const tail = rules.slice(-defaults.length);
		expect(tail).toEqual(defaults);
	});
});

/* ── parseAllowlistConfig ──────────────────────────────────────────────────── */

describe("parseAllowlistConfig", () => {
	it("returns undefined if no permissions key", () => {
		const result = parseAllowlistConfig({ name: "my-project" });
		expect(result).toBeUndefined();
	});

	it("parses safeCommands as allowBash", () => {
		const result = parseAllowlistConfig({
			permissions: {
				safeCommands: ["docker compose *", "make build"],
			},
		});
		expect(result).toBeDefined();
		expect(result!.allowBash).toEqual(["docker compose *", "make build"]);
	});

	it("parses denyCommands as denyBash", () => {
		const result = parseAllowlistConfig({
			permissions: {
				denyCommands: ["shutdown *"],
			},
		});
		expect(result!.denyBash).toEqual(["shutdown *"]);
	});

	it("parses allowTools", () => {
		const result = parseAllowlistConfig({
			permissions: {
				allowTools: ["mcp_search", "mcp_fetch"],
			},
		});
		expect(result!.allowTools).toEqual(["mcp_search", "mcp_fetch"]);
	});

	it("parses denyTools", () => {
		const result = parseAllowlistConfig({
			permissions: {
				denyTools: ["exec"],
			},
		});
		expect(result!.denyTools).toEqual(["exec"]);
	});

	it("parses custom rules array", () => {
		const result = parseAllowlistConfig({
			permissions: {
				rules: [
					{ tool: "bash", pattern: "cargo *", allow: true, scope: "project" },
					{ tool: "write", pattern: "*.lock", allow: false },
				],
			},
		});
		expect(result!.rules).toHaveLength(2);
		expect(result!.rules![0].tool).toBe("bash");
		expect(result!.rules![0].allow).toBe(true);
		expect(result!.rules![1].tool).toBe("write");
		expect(result!.rules![1].allow).toBe(false);
	});

	it("filters out non-string entries from arrays", () => {
		const result = parseAllowlistConfig({
			permissions: {
				safeCommands: ["valid", 123, null, "also-valid"],
			},
		});
		expect(result!.allowBash).toEqual(["valid", "also-valid"]);
	});

	it("handles empty permissions object", () => {
		const result = parseAllowlistConfig({ permissions: {} });
		expect(result).toBeDefined();
		expect(result!.allowBash).toBeUndefined();
		expect(result!.denyBash).toBeUndefined();
		expect(result!.rules).toBeUndefined();
	});
});
