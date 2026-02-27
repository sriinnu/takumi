/**
 * Allowlist — a declarative safe-command configuration layer
 * that sits above the sandbox's static SAFE_COMMANDS set.
 *
 * Projects can ship a `takumi.json` with permission overrides, and
 * this module merges those with the built-in defaults to produce
 * the final set of PermissionRules used by the PermissionEngine.
 */

import type { PermissionRule } from "@takumi/core";
import { createLogger } from "@takumi/core";

const log = createLogger("allowlist");

// ── Default permission rules (spec §11) ───────────────────────────────────────

/** Read-only tools: always allowed, no prompt needed. */
const READ_ONLY_RULES: PermissionRule[] = [
	{ tool: "read", pattern: "*", allow: true, scope: "global" },
	{ tool: "glob", pattern: "*", allow: true, scope: "global" },
	{ tool: "grep", pattern: "*", allow: true, scope: "global" },
	{ tool: "ask", pattern: "*", allow: true, scope: "global" },
];

/** Write tools: prompt per session. */
const WRITE_RULES: PermissionRule[] = [
	{ tool: "write", pattern: "*", allow: false, scope: "session" },
	{ tool: "edit", pattern: "*", allow: false, scope: "session" },
];

/** Bash: safe patterns auto-allowed, everything else prompts. */
const BASH_SAFE_PATTERNS: string[] = [
	"npm *",
	"pnpm *",
	"yarn *",
	"bun *",
	"npx *",
	"git status*",
	"git diff*",
	"git log*",
	"git branch*",
	"git show*",
	"git stash list*",
	"tsc *",
	"tsc --noEmit*",
	"vitest *",
	"biome *",
	"eslint *",
	"prettier *",
	"ls *",
	"cat *",
	"head *",
	"tail *",
	"wc *",
	"find *",
	"grep *",
	"rg *",
];

/** Bash patterns that should always be denied. */
const BASH_DENY_PATTERNS: string[] = [
	"rm -rf /*",
	"rm -rf ~/*",
	"git push --force*",
	"git push -f*",
	"git reset --hard*",
	"git clean -f*",
	"sudo *",
];

// ── Build default rules ───────────────────────────────────────────────────────

function buildBashRules(): PermissionRule[] {
	const rules: PermissionRule[] = [];

	// Deny rules first (highest priority)
	for (const pattern of BASH_DENY_PATTERNS) {
		rules.push({ tool: "bash", pattern, allow: false, scope: "global" });
	}

	// Safe patterns
	for (const pattern of BASH_SAFE_PATTERNS) {
		rules.push({ tool: "bash", pattern, allow: true, scope: "session" });
	}

	return rules;
}

/**
 * Build the complete set of default permission rules,
 * following the priority order from the spec.
 */
export function buildDefaultRules(): PermissionRule[] {
	return [...buildBashRules(), ...READ_ONLY_RULES, ...WRITE_RULES];
}

// ── Merge with project overrides ──────────────────────────────────────────────

export interface AllowlistOverride {
	/** Additional patterns to allow for bash tool. */
	allowBash?: string[];
	/** Additional patterns to deny for bash tool. */
	denyBash?: string[];
	/** Additional tools to always allow (no prompt). */
	allowTools?: string[];
	/** Additional tools to always deny. */
	denyTools?: string[];
	/** Custom rules (highest priority). */
	rules?: PermissionRule[];
}

/**
 * Merge the built-in default rules with project-specific overrides.
 *
 * Priority order (first match wins):
 *  1. Custom rules from overrides
 *  2. Override deny patterns
 *  3. Override allow patterns
 *  4. Built-in defaults
 */
export function mergeAllowlist(overrides?: AllowlistOverride): PermissionRule[] {
	const base = buildDefaultRules();

	if (!overrides) return base;

	const custom: PermissionRule[] = [];

	// Explicit custom rules (top priority)
	if (overrides.rules) {
		custom.push(...overrides.rules);
	}

	// Deny overrides
	if (overrides.denyBash) {
		for (const pattern of overrides.denyBash) {
			custom.push({ tool: "bash", pattern, allow: false, scope: "project" });
		}
	}

	if (overrides.denyTools) {
		for (const tool of overrides.denyTools) {
			custom.push({ tool, pattern: "*", allow: false, scope: "project" });
		}
	}

	// Allow overrides
	if (overrides.allowBash) {
		for (const pattern of overrides.allowBash) {
			custom.push({ tool: "bash", pattern, allow: true, scope: "project" });
		}
	}

	if (overrides.allowTools) {
		for (const tool of overrides.allowTools) {
			custom.push({ tool, pattern: "*", allow: true, scope: "project" });
		}
	}

	log.info(`Merged allowlist: ${custom.length} overrides + ${base.length} defaults`);
	return [...custom, ...base];
}

/**
 * Parse allowlist overrides from a config object (e.g. from takumi.json).
 * Returns undefined if the config has no permission-related keys.
 */
export function parseAllowlistConfig(config: Record<string, unknown>): AllowlistOverride | undefined {
	const permissions = config.permissions as Record<string, unknown> | undefined;
	if (!permissions) return undefined;

	return {
		allowBash: asStringArray(permissions.safeCommands),
		denyBash: asStringArray(permissions.denyCommands),
		allowTools: asStringArray(permissions.allowTools),
		denyTools: asStringArray(permissions.denyTools),
		rules: parseRulesArray(permissions.rules),
	};
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter((v): v is string => typeof v === "string");
}

function parseRulesArray(value: unknown): PermissionRule[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
		.map((v) => ({
			tool: String(v.tool ?? "*"),
			pattern: String(v.pattern ?? "*"),
			allow: Boolean(v.allow),
			scope: (v.scope as PermissionRule["scope"]) ?? "project",
		}));
}
