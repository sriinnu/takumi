import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Autocycle, type AutocycleRunSummary, type CycleResult, DEFAULT_MAX_ITERATIONS } from "@takumi/agent";
import { batch } from "@takumi/render";
import type { AgentRunner } from "./agent-runner.js";
import type { AppCommandContext } from "./app-command-context.js";

export interface AutocycleAgentOptions {
	targetFile: string;
	evalCommand: string;
	evalBudgetMs: number;
	metricRegex?: string;
	maximizeMetric?: boolean;
	maxIterations?: number;
}

export class AutocycleAgent {
	private ctx: AppCommandContext;
	private runner: AgentRunner;
	private options: AutocycleAgentOptions;
	/**
	 * Non-null while a loop is in-flight. Aborting this controller signals
	 * both the LLM runner and the evaluation subprocess to stop.
	 */
	private abortController: AbortController | null = null;

	/** True while an autocycle loop is in-flight. */
	get isActive(): boolean {
		return this.abortController !== null;
	}

	constructor(ctx: AppCommandContext, options: AutocycleAgentOptions) {
		this.ctx = ctx;
		if (!ctx.agentRunner) {
			throw new Error("AgentRunner is not initialized.");
		}
		this.runner = ctx.agentRunner;
		this.options = options;
	}

	/** Request cancellation. Aborts the signal then stops the runner. */
	cancel(): void {
		const ac = this.abortController;
		if (!ac) return;
		ac.abort();
		this.abortController = null;
		this.runner.cancel();
	}

	/** Run the autonomous optimisation loop. */
	async start(objective: string): Promise<void> {
		this.abortController = new AbortController();
		const state = this.ctx.state;

		let metricRegex: RegExp | undefined;
		if (this.options.metricRegex) {
			try {
				metricRegex = new RegExp(this.options.metricRegex);
			} catch (err) {
				throw new Error(`Invalid metric regex: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		const autocycle = new Autocycle({
			targetFile: this.options.targetFile,
			evalCommand: this.options.evalCommand,
			evalBudgetMs: this.options.evalBudgetMs,
			metricRegex,
			optimizeDirection: this.options.maximizeMetric ? "maximize" : "minimize",
		});

		// Validate target file is accessible before starting the loop
		await autocycle.validateTargetFile();

		const maxIter = this.options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		let lastResult: CycleResult | null = null;

		batch(() => {
			state.autocyclePhase.value = "running";
			state.autocycleMaxIterations.value = maxIter;
			state.autocycleIteration.value = 0;
			state.autocycleMetric.value = null;
		});

		this.ctx.addInfoMessage(`Starting Autocycle for: ${objective}`);
		this.ctx.addInfoMessage(`Autocycle ledger: ${autocycle.getLedgerFilePath()}`);

		try {
			const signal = this.abortController.signal;
			const targetFullPath = path.resolve(process.cwd(), this.options.targetFile);

			for (let i = 0; i < maxIter; i++) {
				if (signal.aborted) {
					this.ctx.addInfoMessage(`Autocycle cancelled at iteration ${i + 1}/${maxIter}.`);
					break;
				}

				state.autocycleIteration.value = i + 1;
				state.autocyclePhase.value = "generating";

				// Clear history between iterations to prevent unbounded growth
				if (i > 0) this.runner.clearHistory();

				const prompt = buildAutocyclePrompt(objective, this.options.targetFile, this.options.evalCommand, lastResult);

				this.ctx.addInfoMessage(`Autocycle ${i + 1}/${maxIter} — generating...`);

				// Snapshot target file hash before generation to detect mutations
				const preGenHash = await hashFile(targetFullPath);
				if (preGenHash === null) {
					this.ctx.addInfoMessage(
						`Iteration ${i + 1}: unable to read target file before generation — skipping evaluation.`,
					);
					continue;
				}

				try {
					await this.runner.submit(prompt);
				} catch (err) {
					if (signal.aborted) break;
					const msg = err instanceof Error ? err.message : String(err);
					this.ctx.addInfoMessage(`Iteration ${i + 1} generation failed: ${msg} — skipping.`);
					continue;
				}

				if (signal.aborted) break;

				// Verify the agent actually mutated the target file
				const postGenHash = await hashFile(targetFullPath);
				if (postGenHash === null) {
					this.ctx.addInfoMessage(
						`Iteration ${i + 1}: unable to read target file after generation — skipping evaluation.`,
					);
					continue;
				}
				if (preGenHash === postGenHash) {
					this.ctx.addInfoMessage(`Iteration ${i + 1}: agent did not modify the target file — skipping evaluation.`);
					continue;
				}

				state.autocyclePhase.value = "evaluating";
				this.ctx.addInfoMessage(`Autocycle ${i + 1}/${maxIter} — evaluating...`);

				try {
					lastResult = await autocycle.runCycleEvaluation(signal);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					this.ctx.addInfoMessage(`Iteration ${i + 1} evaluation failed: ${msg} — skipping.`);
					continue;
				}

				if (lastResult.metric != null) {
					state.autocycleMetric.value = lastResult.metric;
				}

				if (lastResult.success) {
					this.ctx.addInfoMessage(
						`Iteration ${lastResult.iteration}: improved! Metric: ${lastResult.metric ?? "N/A"} (${lastResult.durationMs}ms)`,
					);
				} else {
					this.ctx.addInfoMessage(
						`Iteration ${lastResult.iteration}: no improvement, reverted. (${lastResult.durationMs}ms)`,
					);
				}
			}

			this.ctx.addInfoMessage(formatAutocycleRunSummary(autocycle.getRunSummary()));
			this.ctx.addInfoMessage(`Autocycle complete after ${maxIter} iterations.`);
		} finally {
			this.abortController = null;
			batch(() => {
				state.autocyclePhase.value = "idle";
				state.autocycleIteration.value = 0;
			});
		}
	}
}

function formatAutocycleRunSummary(summary: AutocycleRunSummary): string {
	if (summary.completedEvaluations === 0) {
		return "Autocycle summary: no completed evaluations.";
	}

	const keepRatePct = Math.round(summary.keepRate * 100);
	const metricPart = formatMetricSummary(summary);

	return [
		`Autocycle summary: evals=${summary.completedEvaluations}`,
		`keep=${summary.counts.keep} (${keepRatePct}%)`,
		`discard=${summary.counts.discard}`,
		`crash=${summary.counts.crash}`,
		`timeout=${summary.counts.timeout}`,
		`metric-missing=${summary.counts["metric-missing"]}`,
		`aborted=${summary.counts.aborted}`,
		`avg=${summary.averageDurationMs}ms`,
		metricPart,
	].join(" | ");
}

function formatMetricSummary(summary: AutocycleRunSummary): string {
	if (summary.bestMetric == null) {
		return "best=n/a";
	}

	if (summary.baselineMetric == null) {
		return `best=${summary.bestMetric}`;
	}

	const delta =
		summary.optimizeDirection === "minimize"
			? summary.baselineMetric - summary.bestMetric
			: summary.bestMetric - summary.baselineMetric;

	const deltaPrefix = delta > 0 ? "+" : "";
	return `best=${summary.bestMetric} (baseline=${summary.baselineMetric}, delta=${deltaPrefix}${delta})`;
}

/** Build the prompt for the LLM agent at each iteration. */
function buildAutocyclePrompt(
	objective: string,
	targetFile: string,
	evalCommand: string,
	lastResult: CycleResult | null,
): string {
	let prompt = "We are running an Autocycle optimization loop.\n\n";
	prompt += `Objective: ${objective}\n`;
	prompt += `Target File: ${targetFile}\n`;
	prompt += `Eval Command: ${evalCommand}\n`;
	if (lastResult?.metric != null) {
		prompt += `Current Best Metric: ${lastResult.metric}\n`;
		prompt += `Last iteration ${lastResult.success ? "improved" : "did not improve"} the metric.\n\n`;
	}
	prompt += "Your task: Edit the target file to improve the metric. ";
	prompt += "If your changes cause errors or lower the metric, they will be automatically reverted.\n";
	prompt += "Make the changes using your code tools now.";
	return prompt;
}

/** Compute SHA-256 hash of a file. Returns null if the file cannot be read. */
async function hashFile(filePath: string): Promise<string | null> {
	try {
		const content = await fs.readFile(filePath);
		return createHash("sha256").update(content).digest("hex");
	} catch {
		return null;
	}
}
