/**
 * Tool Compose Pipelines — Phase 31.
 *
 * Allows the agent to declare multi-step tool chains that execute
 * sequentially, piping the output of one tool as input to the next.
 *
 * Example pipeline: read_file → grep → ast_patch
 *
 * This reduces LLM round trips: instead of the agent calling tools
 * one-by-one (each requiring a full LLM turn), it declares an
 * entire pipeline upfront. The runtime executes all steps locally.
 *
 * Each step spec references a tool name + input template. Templates
 * can use `$prev` to reference the previous step's output.
 */

import type { ToolDefinition } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { ToolHandler, ToolRegistry } from "./registry.js";

const log = createLogger("tool-compose");

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineStep {
	/** Name of the tool to invoke. */
	tool: string;
	/** Input arguments. Use `$prev` in string values to inject previous output. */
	input: Record<string, unknown>;
}

export interface PipelineSpec {
	/** Human-readable name for the pipeline. */
	name: string;
	/** Ordered steps to execute. */
	steps: PipelineStep[];
	/** If true, abort the pipeline on any step error. Default: true. */
	abortOnError?: boolean;
}

export interface StepResult {
	tool: string;
	output: string;
	isError: boolean;
	durationMs: number;
}

export interface PipelineResult {
	/** Name of the pipeline. */
	name: string;
	/** Results for each step (in order). */
	steps: StepResult[];
	/** Final output (last step's output). */
	finalOutput: string;
	/** Whether the pipeline completed without errors. */
	success: boolean;
	/** Total duration in ms. */
	totalMs: number;
}

// ── Pipeline executor ────────────────────────────────────────────────────────

/**
 * Resolve `$prev` placeholders in step inputs.
 * Recursively walks the input object and replaces string values
 * containing `$prev` with the previous step's output.
 */
function resolveInputs(input: Record<string, unknown>, prevOutput: string): Record<string, unknown> {
	const resolved: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (typeof value === "string") {
			resolved[key] = value.replace(/\$prev/g, prevOutput);
		} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			resolved[key] = resolveInputs(value as Record<string, unknown>, prevOutput);
		} else {
			resolved[key] = value;
		}
	}
	return resolved;
}

/**
 * Execute a pipeline: run each step sequentially, piping outputs.
 */
export async function executePipeline(spec: PipelineSpec, registry: ToolRegistry): Promise<PipelineResult> {
	const abortOnError = spec.abortOnError ?? true;
	const results: StepResult[] = [];
	let prevOutput = "";
	const pipelineStart = Date.now();

	log.info(`Executing pipeline "${spec.name}" (${spec.steps.length} steps)`);

	for (const step of spec.steps) {
		if (!registry.has(step.tool)) {
			const errResult: StepResult = {
				tool: step.tool,
				output: `Tool "${step.tool}" not found in registry`,
				isError: true,
				durationMs: 0,
			};
			results.push(errResult);
			if (abortOnError) break;
			continue;
		}

		const resolvedInput = resolveInputs(step.input, prevOutput);
		const stepStart = Date.now();

		try {
			const result = await registry.execute(step.tool, resolvedInput);
			const stepResult: StepResult = {
				tool: step.tool,
				output: result.output,
				isError: result.isError ?? false,
				durationMs: Date.now() - stepStart,
			};
			results.push(stepResult);
			prevOutput = result.output;

			log.debug(`Step "${step.tool}" completed in ${stepResult.durationMs}ms`);

			if (stepResult.isError && abortOnError) {
				log.warn(`Pipeline "${spec.name}" aborted at step "${step.tool}"`);
				break;
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const stepResult: StepResult = {
				tool: step.tool,
				output: `Error: ${errMsg}`,
				isError: true,
				durationMs: Date.now() - stepStart,
			};
			results.push(stepResult);
			if (abortOnError) break;
		}
	}

	const hasErrors = results.some((r) => r.isError);
	const totalMs = Date.now() - pipelineStart;

	log.info(`Pipeline "${spec.name}" ${hasErrors ? "failed" : "succeeded"} in ${totalMs}ms`);

	return {
		name: spec.name,
		steps: results,
		finalOutput: results.length > 0 ? results[results.length - 1].output : "",
		success: !hasErrors,
		totalMs,
	};
}

// ── Tool definition for the compose tool ─────────────────────────────────────

export const composeDefinition: ToolDefinition = {
	name: "tool_compose",
	description:
		"Execute a pipeline of tools sequentially, piping the output of each step " +
		"as $prev into the next step's input. Reduces round trips by chaining " +
		"multiple tool calls in a single invocation.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Human-readable name for this pipeline.",
			},
			steps: {
				type: "array",
				description: "Ordered list of steps. Each step has a tool name and input object.",
				items: {
					type: "object",
					properties: {
						tool: { type: "string", description: "Name of the tool to invoke." },
						input: {
							type: "object",
							description: 'Input arguments. Use "$prev" in string values to inject previous output.',
						},
					},
					required: ["tool", "input"],
				},
			},
			abort_on_error: {
				type: "boolean",
				description: "If true (default), stop the pipeline on any step failure.",
			},
		},
		required: ["name", "steps"],
	},
	requiresPermission: false,
	category: "execute",
};

/**
 * Create a handler for the compose tool.
 * Needs a reference to the registry to look up tools by name.
 */
export function createComposeHandler(registry: ToolRegistry): ToolHandler {
	return async (input: Record<string, unknown>) => {
		const spec: PipelineSpec = {
			name: (input.name as string) ?? "unnamed",
			steps: (input.steps as PipelineStep[]) ?? [],
			abortOnError: (input.abort_on_error as boolean) ?? true,
		};

		if (spec.steps.length === 0) {
			return { output: "Pipeline has no steps.", isError: true };
		}

		if (spec.steps.length > 10) {
			return { output: "Pipeline exceeds maximum 10 steps.", isError: true };
		}

		const result = await executePipeline(spec, registry);

		const summary = result.steps
			.map((s, i) => `${i + 1}. ${s.tool}: ${s.isError ? "FAILED" : "OK"} (${s.durationMs}ms)`)
			.join("\n");

		const output = [
			`Pipeline "${result.name}" — ${result.success ? "SUCCESS" : "FAILED"} (${result.totalMs}ms)`,
			"",
			"Steps:",
			summary,
			"",
			"Final output:",
			result.finalOutput,
		].join("\n");

		return { output, isError: !result.success };
	};
}
