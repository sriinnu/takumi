import { DEFAULT_EVAL_BUDGET_MS, DEFAULT_MAX_ITERATIONS } from "@takumi/agent";
import type { AppCommandContext } from "./app-command-context.js";
import { AutocycleAgent } from "./autocycle-agent.js";

/** Valid range for --budget flag (seconds). */
const BUDGET_RANGE = { min: 1, max: 3600 } as const;
/** Valid range for --iterations flag. */
const ITERATIONS_RANGE = { min: 1, max: 100 } as const;

function parseStrictInt(value: string | undefined): number | null {
	if (value === undefined) return null;
	if (!/^\d+$/.test(value.trim())) return Number.NaN;
	return Number.parseInt(value, 10);
}

/** Exported for testing. */
export function parseBasicArgs(args: string) {
	const parsed: Record<string, string> = {};
	// Supports: --key "quoted value", --key 'quoted', --key=value, --key multi word value --next
	const regex = /--(\w+)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|((?:(?!\s--)[^\s"']|\s(?!--))+))/g;
	const flags = [...args.matchAll(regex)];

	for (const match of flags) {
		const val = match[2] ?? match[3] ?? match[4];
		parsed[match[1]] = val.trim();
	}

	let objective = args;
	for (const match of flags) {
		objective = objective.replace(match[0], "");
	}
	return { parsed, objective: objective.trim() };
}

export function registerAutocycleCommands(ctx: AppCommandContext): void {
	ctx.commands.register(
		"/autocycle",
		"Run an evaluation-driven autonomous loop (like autoresearch)",
		async (args) => {
			// Guard: prevent double invocation
			const existing = ctx.getActiveAutocycle();
			if (existing) {
				ctx.addInfoMessage("Autocycle already running. Cancel with Ctrl+C first.");
				return;
			}

			const { parsed, objective } = parseBasicArgs(args || "");

			if (!objective?.trim()) {
				ctx.addInfoMessage(
					'Usage: /autocycle <objective> --target <file> --command "<eval-cmd>" [--metric <regex>] [--maximize true] [--iterations 7] [--budget 300]',
				);
				return;
			}

			if (!parsed.target || !parsed.command) {
				ctx.addInfoMessage('Error: /autocycle requires --target <file> and --command "<eval-cmd>"');
				return;
			}

			if (!ctx.agentRunner) {
				ctx.addInfoMessage("Error: No agent runner configured. Cannot start Autocycle.");
				return;
			}

			// Validate & parse numeric options with bounds
			const parsedBudget = parseStrictInt(parsed.budget);
			const budgetSec = parsedBudget ?? DEFAULT_EVAL_BUDGET_MS / 1000;
			if (!Number.isFinite(budgetSec) || budgetSec < BUDGET_RANGE.min || budgetSec > BUDGET_RANGE.max) {
				ctx.addInfoMessage(
					`Error: --budget must be a number between ${BUDGET_RANGE.min} and ${BUDGET_RANGE.max} seconds. Got: ${parsed.budget}`,
				);
				return;
			}

			const parsedIterations = parseStrictInt(parsed.iterations);
			const iterations = parsedIterations ?? DEFAULT_MAX_ITERATIONS;
			if (!Number.isFinite(iterations) || iterations < ITERATIONS_RANGE.min || iterations > ITERATIONS_RANGE.max) {
				ctx.addInfoMessage(
					`Error: --iterations must be a number between ${ITERATIONS_RANGE.min} and ${ITERATIONS_RANGE.max}. Got: ${parsed.iterations}`,
				);
				return;
			}

			const agent = new AutocycleAgent(ctx, {
				targetFile: parsed.target,
				evalCommand: parsed.command,
				evalBudgetMs: budgetSec * 1000,
				metricRegex: parsed.metric,
				maximizeMetric: parsed.maximize === "true",
				maxIterations: iterations,
			});

			// Set active BEFORE start() to prevent double-invocation race
			ctx.setActiveAutocycle(agent);

			agent
				.start(objective)
				.catch((err) => {
					ctx.addInfoMessage(`Autocycle failed: ${err instanceof Error ? err.message : String(err)}`);
				})
				.finally(() => {
					ctx.setActiveAutocycle(null);
				});
		},
		[],
	);

	ctx.commands.register("/autocycle-cancel", "Cancel a running autocycle loop", () => {
		const active = ctx.getActiveAutocycle();
		if (!active?.isActive) {
			ctx.addInfoMessage("No autocycle is currently running.");
			return;
		}
		active.cancel();
		ctx.addInfoMessage("Autocycle cancellation requested.");
	});
}
