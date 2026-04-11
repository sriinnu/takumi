import type { AppState } from "../state.js";
import type { AgentRunner } from "./agent-runner.js";
import type { CodingPhase, CodingTask } from "./coding-agent.js";

export const PHASE_LABELS: Record<CodingPhase, string> = {
	idle: "Idle",
	planning: "Phase 1/6: Planning...",
	branching: "Phase 2/6: Creating branch...",
	executing: "Phase 3/6: Executing changes...",
	validating: "Phase 4/6: Validating...",
	reviewing: "Phase 5/6: Self-review...",
	committing: "Phase 6/6: Committing...",
	done: "Done",
};

interface FlowDeps {
	task: CodingTask;
	state: AppState;
	runner: AgentRunner;
	addSystemMessage: (text: string) => void;
}

/** Run the single-agent coding workflow end-to-end. */
export async function runSingleAgentFlow(deps: FlowDeps): Promise<void> {
	await plan(deps);
	await branch(deps);
	await execute(deps);
	await validate(deps);
	await review(deps);
	await commit(deps);
}

async function plan({ task, state, runner, addSystemMessage }: FlowDeps): Promise<void> {
	task.phase = "planning";
	state.codingPhase.value = "planning";

	const prompt = `I need you to create a detailed implementation plan for the following task.
Do NOT make any changes yet -- just analyze the codebase and produce a step-by-step plan.

Task: ${task.description}

Output your plan as a numbered list of specific changes to make, including file paths.`;

	await runner.submit(prompt);
	addSystemMessage(PHASE_LABELS.branching);
}

async function branch({ task, state, runner, addSystemMessage }: FlowDeps): Promise<void> {
	task.phase = "branching";
	state.codingPhase.value = "branching";

	const slug = task.description
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
	task.branchName = `feat/${slug}`;

	const prompt = `Create a new git branch named "${task.branchName}" from the current HEAD. Use the bash tool to run: git checkout -b ${task.branchName}`;
	await runner.submit(prompt);
	addSystemMessage(PHASE_LABELS.executing);
}

async function execute({ task, state, runner, addSystemMessage }: FlowDeps): Promise<void> {
	task.phase = "executing";
	state.codingPhase.value = "executing";
	await runner.submit(
		"Now implement the plan. Make all the necessary code changes using the edit and write tools. Be thorough and precise.",
	);
	addSystemMessage(PHASE_LABELS.validating);
}

async function validate({ task, state, runner, addSystemMessage }: FlowDeps): Promise<void> {
	task.phase = "validating";
	state.codingPhase.value = "validating";

	const prompt = `Validate the changes you just made:
1. Run the build command to check for type errors
2. Run the test suite to check for regressions
3. Report the results

If there are failures, fix them before proceeding.`;

	await runner.submit(prompt);
	addSystemMessage(PHASE_LABELS.reviewing);
}

async function review({ task, state, runner, addSystemMessage }: FlowDeps): Promise<void> {
	task.phase = "reviewing";
	state.codingPhase.value = "reviewing";

	const prompt = `Review all the changes you've made:
1. Run git diff to see all changes
2. Check for any issues: missing error handling, security concerns, style problems
3. Fix any issues you find
4. List all files that were modified`;

	await runner.submit(prompt);
	addSystemMessage(PHASE_LABELS.committing);
}

async function commit({ task, state, runner }: FlowDeps): Promise<void> {
	task.phase = "committing";
	state.codingPhase.value = "committing";

	const prompt = `Commit all changes with a descriptive commit message that summarizes what was done. Use the bash tool to:
1. git add the modified files
2. git commit with a good message`;

	await runner.submit(prompt);
}
