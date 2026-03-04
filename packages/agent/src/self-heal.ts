/**
 * Self-Healing Agent Loop — automatic recovery strategies for failed tool calls.
 *
 * When a tool invocation fails during the agent loop, the SelfHealer can
 * diagnose the error and suggest an alternative action (retry with modified
 * input, fall back to a different tool, skip, or split an edit into chunks).
 *
 * Built-in strategies cover the most common failure modes:
 *   1. write → edit fallback  (file already exists)
 *   2. edit → write fallback  (no match found)
 *   3. bash timeout retry     (increased timeout)
 *   4. edit conflict split    (ambiguous match → smaller edits)
 *   5. permission denied skip (tool denied by policy)
 *   6. file not found create  (ENOENT → suggest creating the file)
 */

import { createLogger } from "@takumi/core";

const log = createLogger("self-heal");

// ── Public types ─────────────────────────────────────────────────────────────

export type HealAction =
	| { type: "retry_with_modified_input"; transform: (input: Record<string, unknown>) => Record<string, unknown> }
	| {
			type: "fallback_tool";
			toolName: string;
			inputMapper: (originalInput: Record<string, unknown>) => Record<string, unknown>;
	  }
	| { type: "skip"; message: string }
	| { type: "split_edit"; maxChunkLines: number };

export interface HealStrategy {
	/** Unique human-readable name for this strategy. */
	name: string;
	/** Tool name (or glob-like prefix) this strategy applies to. */
	tool: string;
	/** Error pattern (regex) that triggers this strategy. */
	errorPattern: RegExp;
	/** Alternative action to take when the pattern matches. */
	action: HealAction;
}

export interface HealResult {
	healed: boolean;
	strategy: string;
	originalError: string;
	action: HealAction["type"];
	detail: string;
}

// ── Built-in strategies ──────────────────────────────────────────────────────

function builtinWriteToEditFallback(): HealStrategy {
	return {
		name: "write→edit fallback",
		tool: "write",
		errorPattern: /file (already )?exists|EEXIST/i,
		action: {
			type: "fallback_tool",
			toolName: "edit",
			inputMapper: (input) => {
				const filePath = input.filePath ?? input.path ?? input.file;
				const content = input.content ?? input.text ?? "";
				return {
					filePath,
					oldString: "",
					newString: content,
				};
			},
		},
	};
}

function builtinEditToWriteFallback(): HealStrategy {
	return {
		name: "edit→write fallback",
		tool: "edit",
		errorPattern: /no match found|oldString.*not found|does not match/i,
		action: {
			type: "fallback_tool",
			toolName: "write",
			inputMapper: (input) => {
				const filePath = input.filePath ?? input.path ?? input.file;
				const content = input.newString ?? input.content ?? "";
				return { filePath, content };
			},
		},
	};
}

function builtinBashTimeoutRetry(): HealStrategy {
	return {
		name: "bash timeout retry",
		tool: "bash",
		errorPattern: /timed?\s*out|ETIMEDOUT|timeout/i,
		action: {
			type: "retry_with_modified_input",
			transform: (input) => {
				const currentTimeout = typeof input.timeout === "number" ? input.timeout : 30_000;
				return { ...input, timeout: Math.min(currentTimeout * 2, 300_000) };
			},
		},
	};
}

function builtinEditConflictSplit(): HealStrategy {
	return {
		name: "edit conflict split",
		tool: "edit",
		errorPattern: /ambiguous|multiple matches|matched \d+ locations/i,
		action: {
			type: "split_edit",
			maxChunkLines: 20,
		},
	};
}

function builtinPermissionDeniedSkip(): HealStrategy {
	return {
		name: "permission denied skip",
		tool: "*",
		errorPattern: /permission denied|EACCES|not allowed|forbidden|blocked by policy/i,
		action: {
			type: "skip",
			message: "Tool call skipped — permission denied. Consider adjusting permissions or using an alternative.",
		},
	};
}

function builtinFileNotFoundCreate(): HealStrategy {
	return {
		name: "file not found create",
		tool: "read",
		errorPattern: /ENOENT|no such file|file not found|does not exist/i,
		action: {
			type: "fallback_tool",
			toolName: "write",
			inputMapper: (input) => {
				const filePath = input.filePath ?? input.path ?? input.file;
				return { filePath, content: "" };
			},
		},
	};
}

/** Also handle edit on non-existent files. */
function builtinEditFileNotFoundCreate(): HealStrategy {
	return {
		name: "edit file not found create",
		tool: "edit",
		errorPattern: /ENOENT|no such file|file not found|does not exist/i,
		action: {
			type: "fallback_tool",
			toolName: "write",
			inputMapper: (input) => {
				const filePath = input.filePath ?? input.path ?? input.file;
				const content = input.newString ?? input.content ?? "";
				return { filePath, content };
			},
		},
	};
}

// ── SelfHealer class ─────────────────────────────────────────────────────────

export class SelfHealer {
	private readonly strategies: HealStrategy[] = [];

	constructor(strategies?: HealStrategy[]) {
		if (strategies) {
			this.strategies.push(...strategies);
		} else {
			this.strategies.push(...SelfHealer.builtinStrategies());
		}
		log.debug(`SelfHealer initialised with ${this.strategies.length} strategies`);
	}

	/** Register a new healing strategy (appended to the end). */
	register(strategy: HealStrategy): void {
		this.strategies.push(strategy);
		log.debug(`Registered strategy: ${strategy.name}`);
	}

	/** Register a strategy at the front of the list (highest priority). */
	registerFirst(strategy: HealStrategy): void {
		this.strategies.unshift(strategy);
		log.debug(`Registered priority strategy: ${strategy.name}`);
	}

	/** Return the current number of registered strategies. */
	get strategyCount(): number {
		return this.strategies.length;
	}

	/**
	 * Find the first matching heal strategy for a failed tool call.
	 * Returns `null` if no strategy matches.
	 */
	diagnose(toolName: string, error: string): HealStrategy | null {
		for (const strategy of this.strategies) {
			if (!matchesTool(strategy.tool, toolName)) continue;
			if (strategy.errorPattern.test(error)) {
				log.debug(`Diagnosed "${toolName}" error with strategy "${strategy.name}"`);
				return strategy;
			}
		}
		return null;
	}

	/**
	 * Attempt to heal a failed tool call.
	 * Returns a `HealResult` describing the recovery, or `null` if unrecoverable.
	 */
	heal(toolName: string, input: Record<string, unknown>, error: string): HealResult | null {
		const strategy = this.diagnose(toolName, error);
		if (!strategy) {
			log.debug(`No healing strategy found for "${toolName}": ${truncate(error, 100)}`);
			return null;
		}

		const result = applyAction(strategy, input, error);
		log.info(`Healed "${toolName}" via "${strategy.name}" → ${result.action}`);
		return result;
	}

	/** Return all built-in strategies in priority order. */
	static builtinStrategies(): HealStrategy[] {
		return [
			builtinWriteToEditFallback(),
			builtinEditToWriteFallback(),
			builtinBashTimeoutRetry(),
			builtinEditConflictSplit(),
			builtinPermissionDeniedSkip(),
			builtinFileNotFoundCreate(),
			builtinEditFileNotFoundCreate(),
		];
	}
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Check whether a strategy's tool pattern matches the given tool name. */
function matchesTool(pattern: string, toolName: string): boolean {
	if (pattern === "*") return true;
	return toolName.toLowerCase().includes(pattern.toLowerCase());
}

/** Build a HealResult from a matched strategy. */
function applyAction(strategy: HealStrategy, input: Record<string, unknown>, error: string): HealResult {
	const base: Omit<HealResult, "detail"> = {
		healed: true,
		strategy: strategy.name,
		originalError: error,
		action: strategy.action.type,
	};

	switch (strategy.action.type) {
		case "retry_with_modified_input": {
			const modified = strategy.action.transform(input);
			return { ...base, detail: `Retrying with modified input: ${summariseKeys(modified)}` };
		}
		case "fallback_tool": {
			const mapped = strategy.action.inputMapper(input);
			return {
				...base,
				detail: `Falling back to tool "${strategy.action.toolName}" with keys: ${summariseKeys(mapped)}`,
			};
		}
		case "skip":
			return { ...base, detail: strategy.action.message };
		case "split_edit":
			return { ...base, detail: `Splitting edit into chunks of ≤${strategy.action.maxChunkLines} lines` };
	}
}

/** Summarise the top-level keys of an object for logging. */
function summariseKeys(obj: Record<string, unknown>): string {
	return Object.keys(obj).join(", ");
}

/** Truncate a string with ellipsis. */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 1)}…`;
}
