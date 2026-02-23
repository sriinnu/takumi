/**
 * PermissionEngine — manages tool execution permissions.
 *
 * Rules can be scoped to session, project, or global.
 * Supports pattern matching for tool arguments (e.g., file paths).
 */

import type { PermissionEngine as IPermissionEngine, PermissionDecision, PermissionRule } from "@takumi/core";
import { createLogger } from "@takumi/core";

const log = createLogger("permissions");

export class PermissionEngine implements IPermissionEngine {
	private rules: PermissionRule[] = [];

	/** Callback for asking the user for permission. */
	private promptUser: ((tool: string, args: Record<string, unknown>) => Promise<PermissionDecision>) | null = null;

	constructor(initialRules?: PermissionRule[]) {
		if (initialRules) {
			this.rules = [...initialRules];
		}
	}

	/** Set the user prompt callback (provided by the TUI layer). */
	setPromptCallback(fn: (tool: string, args: Record<string, unknown>) => Promise<PermissionDecision>): void {
		this.promptUser = fn;
	}

	/** Check if a tool action is allowed. */
	async check(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
		// Check explicit rules first (most specific wins)
		for (const rule of this.rules) {
			if (this.ruleMatches(rule, tool, args)) {
				log.debug(`Permission ${rule.allow ? "granted" : "denied"} by rule`, { tool, rule });
				return {
					allowed: rule.allow,
					reason: rule.allow ? "Allowed by rule" : "Denied by rule",
					rule,
				};
			}
		}

		// No matching rule — prompt user if callback is available
		if (this.promptUser) {
			return this.promptUser(tool, args);
		}

		// Default: deny
		return {
			allowed: false,
			reason: "No matching permission rule and no prompt callback",
		};
	}

	/** Add a grant rule. */
	grant(rule: PermissionRule): void {
		// Remove any conflicting rules for the same tool+pattern
		this.rules = this.rules.filter(
			(r) => !(r.tool === rule.tool && r.pattern === rule.pattern && r.scope === rule.scope),
		);
		this.rules.unshift({ ...rule, allow: true });
		log.info("Permission granted", { tool: rule.tool, pattern: rule.pattern });
	}

	/** Add a deny rule. */
	deny(rule: PermissionRule): void {
		this.rules = this.rules.filter(
			(r) => !(r.tool === rule.tool && r.pattern === rule.pattern && r.scope === rule.scope),
		);
		this.rules.unshift({ ...rule, allow: false });
		log.info("Permission denied", { tool: rule.tool, pattern: rule.pattern });
	}

	/** Reset all session-scoped rules. */
	reset(): void {
		this.rules = this.rules.filter((r) => r.scope !== "session");
		log.info("Session permissions reset");
	}

	/** Reset all rules. */
	resetAll(): void {
		this.rules = [];
		log.info("All permissions reset");
	}

	/** Get all current rules. */
	getRules(): ReadonlyArray<PermissionRule> {
		return this.rules;
	}

	private ruleMatches(rule: PermissionRule, tool: string, args: Record<string, unknown>): boolean {
		// Tool name must match
		if (rule.tool !== "*" && rule.tool !== tool) return false;

		// Pattern matching (against file_path, command, or any string arg)
		if (rule.pattern === "*") return true;

		const target = (args.file_path ?? args.command ?? args.path ?? "") as string;
		if (!target) return rule.pattern === "*";

		return matchPattern(rule.pattern, target);
	}
}

/** Simple glob-like pattern matching (supports * and **). */
function matchPattern(pattern: string, value: string): boolean {
	// Convert glob to regex
	const regexStr = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "{{GLOBSTAR}}")
		.replace(/\*/g, "[^/]*")
		.replace(/{{GLOBSTAR}}/g, ".*")
		.replace(/\?/g, ".");

	const regex = new RegExp(`^${regexStr}$`);
	return regex.test(value);
}
