/**
 * @file progressive-refinement.ts
 * @module cluster/progressive-refinement
 *
 * Progressive Refinement: Iterative Improvement via Critic Feedback
 *
 * **Inspiration:** Critic-based reinforcement learning from robotics/RL literature
 * Applied to code generation in projects like AlphaCodium and Reflexion
 *
 * ## Key Insight
 * Instead of generating one "final" output, workers should:
 * 1. Generate an initial draft
 * 2. Receive targeted critique from a specialized critic agent
 * 3. Refine the draft based on critique
 * 4. Repeat 2-3 for N iterations until quality threshold met
 *
 * Result: Incremental improvement without full regeneration overhead.
 * Each iteration focuses on specific weaknesses identified by the critic.
 *
 * ## Implementation Strategy
 * - **Critic Agent**: Specialized LLM role that identifies issues but doesn't fix them
 * - **Worker Agent**: Receives critique, applies targeted fixes
 * - **Iteration Budget**: Max 3 refine cycles to avoid diminishing returns
 * - **Quality Metrics**: Track heuristic score improvement across iterations
 * - **Early Exit**: Stop if heuristic score plateau (<5% improvement)
 *
 * ## Integration with Takumi
 * - Replaces single-shot worker generation in WORKING phase
 * - Compatible with ensemble.ts (can refine each ensemble candidate)
 * - Uses AgentEvaluator to measure progress
 * - Logs refinement trajectory for Akasha learning
 *
 * @see AlphaCodium paper (arXiv:2401.08500)
 * @see Reflexion paper (arXiv:2303.11366)
 */

import { createLogger } from "@takumi/core";
import type { AgentEvaluator } from "@yugenlab/chitragupta/niyanta";
import type { MessagePayload } from "../loop.js";
import type { PhaseContext } from "./phases.js";

const log = createLogger("cluster-progressive");

// ─── Type Definitions ────────────────────────────────────────────────────────

/** Configuration for progressive refinement. */
export interface ProgressiveConfig {
	/** Max refinement iterations (default: 3). */
	maxIterations: number;
	/** Minimum improvement threshold to continue (default: 0.05 = 5%). */
	minImprovement: number;
	/** Whether to use a dedicated critic model (default: true). */
	useCriticModel: boolean;
	/** Target heuristic score to stop early (default: 9.0/10). */
	targetScore: number;
}

/** State of a single refinement iteration. */
export interface RefinementIteration {
	/** Iteration number (1-indexed). */
	iteration: number;
	/** Current output draft. */
	output: string;
	/** Critic feedback (issues identified). */
	critique: string;
	/** Heuristic quality score (0-10). */
	heuristicScore: number;
	/** Token usage for this iteration. */
	tokenUsage: { input: number; output: number };
}

/** Result of progressive refinement. */
export interface ProgressiveResult {
	/** All iterations executed. */
	iterations: RefinementIteration[];
	/** Final refined output. */
	finalOutput: string;
	/** Final heuristic score. */
	finalScore: number;
	/** Improvement from initial to final (%). */
	improvement: number;
	/** Total token usage across all iterations. */
	totalTokenUsage: { input: number; output: number };
	/** Why refinement stopped (target_reached | max_iterations | plateau). */
	stopReason: "target_reached" | "max_iterations" | "plateau";
}

// ─── Progressive Refinement Engine ───────────────────────────────────────────

/**
 * Progressively refines a worker's output via critic feedback loop.
 *
 * Process:
 * 1. Evaluate initial output with AgentEvaluator
 * 2. If score < target, generate critique highlighting weaknesses
 * 3. Worker refines output based on critique
 * 4. Repeat 2-3 until target reached, plateau, or max iterations
 *
 * @param ctx - Phase context (for LLM calls)
 * @param evaluator - AgentEvaluator for quality scoring
 * @param taskDescription - Original task
 * @param initialOutput - Worker's first draft
 * @param config - Refinement configuration
 * @returns Final refined output with improvement metrics
 *
 * @example
 * ```ts
 * const result = await progressiveRefine(ctx, evaluator, taskDesc, workerDraft, {
 *   maxIterations: 3,
 *   minImprovement: 0.05,
 *   targetScore: 9.0
 * });
 * console.log(result.finalScore); // 9.2 (vs initial 7.3)
 * console.log(result.improvement); // 26% improvement
 * ```
 */
export async function progressiveRefine(
	ctx: PhaseContext,
	evaluator: AgentEvaluator,
	taskDescription: string,
	initialOutput: string,
	config: Partial<ProgressiveConfig> = {},
): Promise<ProgressiveResult> {
	const cfg: ProgressiveConfig = {
		maxIterations: config.maxIterations ?? 3,
		minImprovement: config.minImprovement ?? 0.05,
		useCriticModel: config.useCriticModel ?? true,
		targetScore: config.targetScore ?? 9.0,
	};

	log.info(`Starting progressive refinement: target=${cfg.targetScore}, max_iterations=${cfg.maxIterations}`);

	const iterations: RefinementIteration[] = [];
	let currentOutput = initialOutput;
	const initialReport = evaluator.evaluate("progressive", "refinement", taskDescription, currentOutput);
	let currentScore = initialReport.overallScore;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	log.info(`Initial heuristic score: ${currentScore.toFixed(2)}/10`);

	// Initial iteration (no critique yet)
	iterations.push({
		iteration: 0,
		output: currentOutput,
		critique: "",
		heuristicScore: currentScore,
		tokenUsage: { input: 0, output: 0 },
	});

	let stopReason: ProgressiveResult["stopReason"] = "max_iterations";

	// Refinement loop
	for (let i = 1; i <= cfg.maxIterations; i++) {
		log.info(`Refinement iteration ${i}/${cfg.maxIterations}`);

		// Step 1: Generate critique
		const critique = await generateCritique(ctx, taskDescription, currentOutput, cfg.useCriticModel);
		totalInputTokens += 500; // Approximate (actual usage tracked in sendMessage)
		totalOutputTokens += critique.length / 4; // Rough token estimate

		// Step 2: Worker refines based on critique
		const { refinedOutput, inputTokens, outputTokens } = await refineOutput(
			ctx,
			taskDescription,
			currentOutput,
			critique,
		);
		totalInputTokens += inputTokens;
		totalOutputTokens += outputTokens;

		// Step 3: Evaluate refined output
		const refinedReport = evaluator.evaluate("progressive", "refinement", taskDescription, refinedOutput);
		const newScore = refinedReport.overallScore;
		const improvement = (newScore - currentScore) / currentScore;

		log.info(`Iteration ${i}: score ${newScore.toFixed(2)}/10 (${(improvement * 100).toFixed(1)}% improvement)`);

		iterations.push({
			iteration: i,
			output: refinedOutput,
			critique,
			heuristicScore: newScore,
			tokenUsage: { input: inputTokens, output: outputTokens },
		});

		// Check stopping conditions
		if (newScore >= cfg.targetScore) {
			log.info(`Target score reached: ${newScore.toFixed(2)} >= ${cfg.targetScore}`);
			stopReason = "target_reached";
			currentOutput = refinedOutput;
			currentScore = newScore;
			break;
		}

		if (improvement < cfg.minImprovement && i > 1) {
			log.info(`Plateau detected: improvement ${(improvement * 100).toFixed(1)}% < ${cfg.minImprovement * 100}%`);
			stopReason = "plateau";
			// Don't update output if it got worse
			if (newScore > currentScore) {
				currentOutput = refinedOutput;
				currentScore = newScore;
			}
			break;
		}

		currentOutput = refinedOutput;
		currentScore = newScore;
	}

	const initialScore = iterations[0].heuristicScore;
	const totalImprovement = (currentScore - initialScore) / initialScore;

	return {
		iterations,
		finalOutput: currentOutput,
		finalScore: currentScore,
		improvement: totalImprovement,
		totalTokenUsage: { input: totalInputTokens, output: totalOutputTokens },
		stopReason,
	};
}

// ─── Critic Agent ────────────────────────────────────────────────────────────

/**
 * Generates critique of the current output.
 *
 * Critic identifies:
 * - Correctness issues (bugs, logic errors)
 * - Completeness issues (missing functionality)
 * - Quality issues (style, readability, edge cases)
 *
 * Critic does NOT provide fixes, only identifies problems.
 */
async function generateCritique(
	ctx: PhaseContext,
	taskDescription: string,
	currentOutput: string,
	useCriticModel: boolean,
): Promise<string> {
	const prompt = `**Task:**
${taskDescription}

**Current Output:**
${currentOutput.slice(0, 2000)}${currentOutput.length > 2000 ? "\n...(truncated)" : ""}

**Your Role:**
You are a code critic. Identify specific issues in the output:
- Correctness: bugs, logic errors, incorrect behavior
- Completeness: missing features, edge cases not handled
- Quality: poor naming, unclear logic, lack of error handling

Be specific and actionable. Point to exact lines or sections.
Do NOT provide fixes, only identify problems.`;

	const messages: MessagePayload[] = [{ role: "user", content: prompt }];

	let critique = "";
	try {
		for await (const event of ctx.sendMessage(messages, CRITIC_SYSTEM_PROMPT, [], undefined, {
			model: useCriticModel ? ctx.getModelForRole?.("VALIDATOR" as any) : undefined,
			// @ts-expect-error - temperature property
			temperature: 0.3, // Medium temp for thorough analysis
		})) {
			if (event.type === "text_delta") {
				critique += event.text;
			}
		}
	} catch (err) {
		log.error(`Failed to generate critique: ${err}`);
		critique = "Unable to generate critique due to error.";
	}

	return critique;
}

const CRITIC_SYSTEM_PROMPT = `You are a meticulous code critic with expertise in software engineering best practices.

Your role:
- Identify bugs, logic errors, and incorrect behavior
- Spot missing features or incomplete implementations
- Highlight quality issues (naming, structure, error handling)
- Be specific: reference exact lines or sections
- Be constructive: explain WHY something is an issue, not just WHAT

You do NOT provide fixes. You only identify problems.
Output a numbered list of issues, most critical first.`;

// ─── Refinement Agent ────────────────────────────────────────────────────────

/**
 * Worker refines output based on critic feedback.
 */
async function refineOutput(
	ctx: PhaseContext,
	taskDescription: string,
	currentOutput: string,
	critique: string,
): Promise<{ refinedOutput: string; inputTokens: number; outputTokens: number }> {
	const prompt = `**Original Task:**
${taskDescription}

**Current Output:**
${currentOutput.slice(0, 2000)}${currentOutput.length > 2000 ? "\n...(truncated)" : ""}

**Critic Feedback:**
${critique}

**Your Task:**
Refine the output to address the critic's feedback.
Fix the identified issues while preserving working functionality.
Provide the complete refined output.`;

	const messages: MessagePayload[] = [{ role: "user", content: prompt }];

	let refinedOutput = "";
	let inputTokens = 0;
	let outputTokens = 0;

	try {
		for await (const event of ctx.sendMessage(messages, REFINE_SYSTEM_PROMPT, [], undefined, {
			model: ctx.getModelForRole?.("WORKER" as any),
			// @ts-expect-error - temperature property
			temperature: 0.5, // Medium-low temp for focused fixes
		})) {
			if (event.type === "text_delta") {
				refinedOutput += event.text;
			}
			if (event.type === "usage_update") {
				inputTokens += event.usage.inputTokens;
				outputTokens += event.usage.outputTokens;
			}
		}
	} catch (err) {
		log.error(`Failed to refine output: ${err}`);
		refinedOutput = currentOutput; // Fallback to current if refinement fails
	}

	return { refinedOutput, inputTokens, outputTokens };
}

const REFINE_SYSTEM_PROMPT = `You are a skilled software engineer refining your code based on peer review.

Your role:
- Address each issue identified in the critique
- Fix bugs and complete missing functionality
- Improve code quality and readability
- Preserve all working parts of the current output
- Provide the complete refined output (not diffs)

Focus on making targeted improvements, not rewriting everything.`;
