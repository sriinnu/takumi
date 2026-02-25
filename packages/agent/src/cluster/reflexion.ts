/**
 * @file reflexion.ts
 * @module cluster/reflexion
 *
 * Reflexion: Self-Critique and Verbal Reinforcement Learning
 *
 * **Paper:** "Reflexion: Language Agents with Verbal Reinforcement Learning"
 * Shinn et al., arXiv:2303.11366 (March 2023)
 *
 * ## Key Insight
 * Instead of blindly retrying failed tasks, agents should:
 * 1. **Reflect** on why they failed (self-critique)
 * 2. **Record** the critique in memory (Akasha traces)
 * 3. **Learn** from past mistakes on similar tasks
 * 4. **Adjust** strategy on the next attempt
 *
 * Result: 91% success rate on AlfWorld vs 75% without reflection.
 *
 * ## Implementation Strategy
 * 1. After validation failure, generate self-critique:
 *    - What went wrong?
 *    - Why did validators reject it?
 *    - What should be different next time?
 * 2. Store critique in Chitragupta Akasha with tags: ["self_reflection", taskType]
 * 3. On retry, inject relevant past critiques into worker prompt
 * 4. Worker adjusts approach based on learned patterns
 *
 * ## Integration with Takumi
 * - Triggered in FIXING phase after validation rejection
 * - Uses `akasha_deposit` to store reflections
 * - Uses `akasha_traces` to retrieve relevant past failures
 * - Augments worker system prompt with reflection history
 *
 * @see https://arxiv.org/abs/2303.11366
 */

import type { ChitraguptaBridge } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { MessagePayload } from "../loop.js";
import type { PhaseContext } from "./phases.js";
import { ValidationDecision, type ValidationResult } from "./types.js";

const log = createLogger("cluster-reflexion");

// ─── Type Definitions ────────────────────────────────────────────────────────

/** A self-critique generated after a validation failure. */
export interface SelfCritique {
	/** Task that was attempted. */
	task: string;
	/** What was produced (the failed output). */
	attemptedSolution: string;
	/** Why it failed (from validators). */
	validatorFeedback: string[];
	/** Agent's reflection on the failure. */
	reflection: string;
	/** Concrete action points for next attempt. */
	actionItems: string[];
	/** Timestamp of the critique. */
	timestamp: number;
}

/** Configuration for reflexion behavior. */
export interface ReflexionConfig {
	/** Whether reflexion is enabled (default: true). */
	enabled: boolean;
	/** Max number of past critiques to inject into retry prompts (default: 3). */
	maxHistorySize: number;
	/** Whether to use Akasha for persistent memory (default: true if bridge available). */
	useAkasha: boolean;
}

// ─── Reflexion Engine ────────────────────────────────────────────────────────

/**
 * Generates a self-critique after a validation failure.
 *
 * Calls the LLM with a reflexion prompt that asks:
 * - What specific issues did validators identify?
 * - What assumptions or approaches were wrong?
 * - What should be done differently on the next attempt?
 *
 * @param ctx - Phase context (for LLM calls)
 * @param task - Original task description
 * @param failedOutput - The work product that was rejected
 * @param validationResults - Feedback from validators
 * @returns A structured self-critique with action items
 *
 * @example
 * ```ts
 * const critique = await generateSelfCritique(ctx, "Add OAuth login", failedCode, validations);
 * console.log(critique.reflection); // "I failed because..."
 * console.log(critique.actionItems); // ["Fix X", "Improve Y"]
 * ```
 */
export async function generateSelfCritique(
	ctx: PhaseContext,
	task: string,
	failedOutput: string,
	validationResults: ValidationResult[],
): Promise<SelfCritique> {
	log.info("Generating self-critique for failed attempt");

	const validatorFeedback = validationResults
		.filter((v) => v.decision !== ValidationDecision.APPROVE)
		.map((v) => `${v.validatorId}: ${v.reasoning}`);

	const reflexionPrompt = buildReflexionPrompt(task, failedOutput, validatorFeedback);

	const messages: MessagePayload[] = [{ role: "user", content: reflexionPrompt }];

	let reflection = "";
	try {
		for await (const event of ctx.sendMessage(messages, REFLEXION_SYSTEM_PROMPT, [], undefined, {
			// Use a medium model for critiques (no need for frontier)
			model: ctx.getModelForRole?.("PLANNER" as any),
			// @ts-expect-error - temperature property
			temperature: 0.3, // Low temp for focused analysis
		})) {
			if (event.type === "text_delta") {
				reflection += event.text;
			}
		}
	} catch (err) {
		log.error(`Failed to generate self-critique: ${err}`);
		reflection = "Unable to generate self-critique due to error.";
	}

	// Parse action items from the reflection (look for numbered lists or bullet points)
	const actionItems = extractActionItems(reflection);

	const critique: SelfCritique = {
		task,
		attemptedSolution: failedOutput,
		validatorFeedback,
		reflection,
		actionItems,
		timestamp: Date.now(),
	};

	return critique;
}

/**
 * Stores a self-critique in Chitragupta Akasha for future learning.
 *
 * Tags:
 * - "self_reflection" (type of knowledge)
 * - Task type (e.g., "CODING", "DEBUG")
 * - Complexity level (e.g., "STANDARD")
 *
 * @param chitragupta - Chitragupta bridge (stdio MCP client)
 * @param critique - The critique to store
 * @param taskType - Optional task type for better retrieval
 */
export async function storeCritique(
	chitragupta: ChitraguptaBridge,
	critique: SelfCritique,
	taskType?: string,
): Promise<void> {
	const content = JSON.stringify({
		task: critique.task,
		reflection: critique.reflection,
		actionItems: critique.actionItems,
		timestamp: critique.timestamp,
	});

	const tags = ["self_reflection"];
	if (taskType) tags.push(taskType);

	try {
		await chitragupta.akashaDeposit(content, "agent_learning", tags);
		log.info(`Stored critique in Akasha: ${critique.actionItems.length} action items`);
	} catch (err) {
		log.error(`Failed to store critique in Akasha: ${err}`);
	}
}

/**
 * Retrieves relevant past critiques from Akasha for similar tasks.
 *
 * Queries Akasha traces with:
 * - "self_reflection" tag
 * - Task description (semantic similarity)
 * - Task type if available
 *
 * @param chitragupta - Chitragupta bridge
 * @param task - Current task description
 * @param maxResults - Max critiques to retrieve (default: 3)
 * @returns Array of past critiques (may be empty)
 */
export async function retrievePastCritiques(
	chitragupta: ChitraguptaBridge,
	task: string,
	maxResults = 3,
): Promise<SelfCritique[]> {
	try {
		const query = `self_reflection for task: ${task}`;
		const traces = await chitragupta.akashaTraces(query, maxResults);

		return traces
			.map((trace) => {
				try {
					return JSON.parse(trace.content) as SelfCritique;
				} catch {
					return null;
				}
			})
			.filter((c): c is SelfCritique => c !== null);
	} catch (err) {
		log.error(`Failed to retrieve past critiques: ${err}`);
		return [];
	}
}

/**
 * Augments a worker's system prompt with reflexion history.
 *
 * Injects:
 * 1. Past critiques from similar tasks
 * 2. Common failure patterns learned across all tasks
 * 3. Specific action items to focus on
 *
 * @param basePrompt - Original worker system prompt
 * @param pastCritiques - Retrieved past failures
 * @returns Enhanced prompt with learning history
 */
export function augmentPromptWithReflexion(basePrompt: string, pastCritiques: SelfCritique[]): string {
	if (pastCritiques.length === 0) {
		return basePrompt;
	}

	const reflexionSection = `

**Learning from Past Mistakes:**
You've attempted similar tasks before. Here's what you learned:

${pastCritiques
	.map(
		(c, i) => `
${i + 1}. Previous failure on: "${c.task.slice(0, 60)}..."
   - What went wrong: ${c.reflection.slice(0, 150)}...
   - Action items: ${c.actionItems.slice(0, 3).join("; ")}
`,
	)
	.join("\n")}

**Apply these lessons to avoid repeating mistakes.**
`;

	return basePrompt + reflexionSection;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Builds the reflexion prompt sent to the LLM.
 */
function buildReflexionPrompt(task: string, failedOutput: string, validatorFeedback: string[]): string {
	return `You attempted to solve this task but validators rejected your solution. Reflect on what went wrong.

**Task:**
${task}

**Your Solution (rejected):**
${failedOutput.slice(0, 1000)}${failedOutput.length > 1000 ? "\n...(truncated)" : ""}

**Validator Feedback:**
${validatorFeedback.join("\n\n")}

**Reflect deeply:**
1. What specific issues did validators identify?
2. What assumptions did you make that were incorrect?
3. What approach should you take differently on the next attempt?
4. What concrete action items will improve the solution?

Provide a structured reflection with clear action items.`;
}

/**
 * System prompt for the reflexion LLM call.
 */
const REFLEXION_SYSTEM_PROMPT = `You are a self-reflective coding agent analyzing your own failures.

Your goal is to extract actionable lessons from validation feedback so you can improve on the next attempt.

Output format:
1. Brief analysis of what went wrong
2. Numbered list of specific action items for next attempt

Be concise, honest, and actionable. Focus on what YOU can control.`;

/**
 * Extracts action items from reflexion text (looks for numbered/bulleted lists).
 */
function extractActionItems(reflection: string): string[] {
	const lines = reflection.split("\n");
	const actionItems: string[] = [];

	for (const line of lines) {
		// Match patterns like "1. ", "- ", "• ", etc.
		const match = line.match(/^\s*(?:\d+\.|[-•*])\s+(.+)$/);
		if (match?.[1]) {
			actionItems.push(match[1].trim());
		}
	}

	return actionItems.slice(0, 5); // Max 5 action items
}
