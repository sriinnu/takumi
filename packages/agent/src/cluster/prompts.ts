/**
 * @file prompts.ts
 * @module cluster/prompts
 *
 * Validator system-prompt templates for multi-agent blind validation.
 *
 * Each validator role receives a tailored system prompt that focuses its
 * review on a specific quality dimension. Kept in a separate file so
 * {@link orchestrator.ts} stays under the 450-LOC limit.
 *
 * @see {@link AgentRole} for role definitions
 */

import { getTopologyGuidance } from "./mesh-policy.js";
import type { ClusterTopology } from "./types.js";
import { AgentRole } from "./types.js";

// ─── Base ────────────────────────────────────────────────────────────────────

/**
 * Base instruction prepended to every validator prompt.
 * Enforces the blind-validation contract: validators only receive the
 * task description + final output — never the worker's chat history.
 */
const BASE =
	"You are a validator agent in a multi-agent system.\n" +
	"You independently verify work products without seeing the worker's " +
	"conversation history.\n" +
	"You can use the `akasha_traces` tool to read context shared by the planner or worker.\n" +
	"Be thorough, objective, and specific in your findings.";

// ─── Role-Specific Prompts ───────────────────────────────────────────────────

/**
 * Returns the validator system-prompt for the given {@link AgentRole}.
 *
 * @param role - The validator agent's assigned role.
 * @returns A fully formed system-prompt string ready to pass to the LLM.
 */

export function getValidatorPrompt(role: AgentRole, topology: ClusterTopology = "hierarchical"): string {
	const guidance = `\n\n${getTopologyGuidance(topology, "validator")}`;
	switch (role) {
		case AgentRole.VALIDATOR_REQUIREMENTS:
			return (
				`${BASE}\n\n` +
				"Your focus: Verify the work product meets ALL stated requirements.\n" +
				"Check for:\n" +
				"- Completeness: are all requirements addressed?\n" +
				"- Correctness: does it do exactly what was asked?\n" +
				`- Edge cases: are boundary conditions handled?${guidance}`
			);

		case AgentRole.VALIDATOR_CODE:
			return (
				`${BASE}\n\n` +
				"Your focus: Verify code quality and best practices.\n" +
				"Check for:\n" +
				"- Style consistency and naming conventions\n" +
				"- Error handling and null-safety\n" +
				"- Code duplication and unnecessary complexity\n" +
				`- JSDoc comments on public APIs${guidance}`
			);

		case AgentRole.VALIDATOR_SECURITY:
			return (
				`${BASE}\n\n` +
				"Your focus: Identify security vulnerabilities.\n" +
				"Check for:\n" +
				"- Injection attacks (SQL, command, path traversal)\n" +
				"- Credential or secret exposure\n" +
				"- Missing input validation or sanitisation\n" +
				"- Auth/authorisation gaps\n" +
				`- Dependency CVEs or unsafe APIs${guidance}`
			);

		case AgentRole.VALIDATOR_TESTS:
			return (
				`${BASE}\n\n` +
				"Your focus: Verify test coverage and quality.\n" +
				"Check for:\n" +
				"- Tests exist for every public function/class\n" +
				"- Edge cases and unhappy paths are covered\n" +
				"- Assertions are meaningful (not just truthy checks)\n" +
				`- Integration or end-to-end coverage where relevant${guidance}`
			);

		case AgentRole.VALIDATOR_ADVERSARIAL:
			return (
				`${BASE}\n\n` +
				"Your focus: Try to break the implementation.\n" +
				"Check for:\n" +
				"- Unexpected or malformed inputs\n" +
				"- Race conditions and concurrency bugs\n" +
				"- Resource exhaustion (memory leaks, infinite loops)\n" +
				"- Error propagation and unhandled rejections\n" +
				`- Failure modes that could cascade${guidance}`
			);

		default:
			return `${BASE}${guidance}`;
	}
}

// ─── Planning Prompt ─────────────────────────────────────────────────────────

/**
 * System prompt for the planner agent.
 * Produces a structured plan consumed by the worker.
 */
const PLANNER_PROMPT_BASE =
	"You are a planning agent in a multi-agent coding system.\n" +
	"Analyse the task and produce a detailed, step-by-step implementation plan.\n\n" +
	"Break the plan into:\n" +
	"1. Files to create or modify (with exact paths)\n" +
	"2. Specific changes in each file\n" +
	"3. Tests to write\n" +
	"4. Potential risks or edge cases\n\n" +
	"You can use the `akasha_deposit` tool to share important architectural decisions or context with the worker and validators.\n" +
	"Be precise — the worker agent will execute your plan verbatim.";

export function getPlannerPrompt(topology: ClusterTopology = "hierarchical"): string {
	return `${PLANNER_PROMPT_BASE}\n\n${getTopologyGuidance(topology, "planner")}`;
}

// ─── Worker Prompt ───────────────────────────────────────────────────────────

/**
 * System prompt for the worker (executor) agent.
 *
 * @param hasPlan - Whether a planner produced a plan to follow.
 * @returns System prompt string.
 */
export function getWorkerPrompt(hasPlan: boolean, topology: ClusterTopology = "hierarchical"): string {
	return (
		"You are a worker agent in a multi-agent coding system.\n" +
		"Implement the task precisely and thoroughly.\n\n" +
		(hasPlan
			? "Follow the plan provided by the planner agent exactly.\n\n"
			: "Implement the task directly without a prior plan.\n\n") +
		"You can use the `akasha_traces` tool to read context shared by the planner, and `akasha_deposit` to share findings with validators.\n" +
		"After implementation:\n" +
		"1. Run the build to confirm zero type errors\n" +
		"2. Run tests to verify correctness\n" +
		`3. Summarise all files changed\n\n${getTopologyGuidance(topology, "worker")}`
	);
}

// ─── Fixer Prompt ────────────────────────────────────────────────────────────

/**
 * System prompt for the fixing phase (worker addressing validator rejections).
 */
const FIXER_PROMPT_BASE =
	"You are fixing issues identified by independent validator agents.\n" +
	"Address every issue carefully and thoroughly before re-submitting.";

export function getFixerPrompt(topology: ClusterTopology = "hierarchical"): string {
	return `${FIXER_PROMPT_BASE}\n\n${getTopologyGuidance(topology, "fixer")}`;
}
