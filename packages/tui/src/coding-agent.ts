/**
 * CodingAgent -- structured coding workflow.
 * Plan -> Branch -> Execute -> Validate -> Review -> Commit
 */

import type { Message } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { AppState } from "./state.js";
import type { AgentRunner } from "./agent-runner.js";

const log = createLogger("coding-agent");

export type CodingPhase =
	| "idle"
	| "planning"
	| "branching"
	| "executing"
	| "validating"
	| "reviewing"
	| "committing"
	| "done";

export interface CodingTask {
	description: string;
	phase: CodingPhase;
	branchName: string | null;
	plan: string | null;
	filesModified: string[];
	testsPassed: boolean | null;
	error: string | null;
}

const PHASE_LABELS: Record<CodingPhase, string> = {
	idle: "Idle",
	planning: "Phase 1/6: Planning...",
	branching: "Phase 2/6: Creating branch...",
	executing: "Phase 3/6: Executing changes...",
	validating: "Phase 4/6: Validating...",
	reviewing: "Phase 5/6: Self-review...",
	committing: "Phase 6/6: Committing...",
	done: "Done",
};

export class CodingAgent {
	private state: AppState;
	private runner: AgentRunner;
	private task: CodingTask | null = null;
	private messageSeq = 0;

	constructor(state: AppState, runner: AgentRunner) {
		this.state = state;
		this.runner = runner;
	}

	get currentTask(): CodingTask | null {
		return this.task;
	}

	get isActive(): boolean {
		return this.task !== null && this.task.phase !== "idle" && this.task.phase !== "done";
	}

	/** Start a new coding task. */
	async start(description: string): Promise<void> {
		this.task = {
			description,
			phase: "planning",
			branchName: null,
			plan: null,
			filesModified: [],
			testsPassed: null,
			error: null,
		};

		this.state.codingPhase.value = "planning";
		this.addSystemMessage(`Starting coding task: ${description}`);
		this.addSystemMessage(PHASE_LABELS.planning);

		try {
			await this.plan();
			await this.branch();
			await this.execute();
			await this.validate();
			await this.review();
			await this.commit();

			this.task.phase = "done";
			this.state.codingPhase.value = "done";
			this.addSystemMessage("Coding task complete!");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.task.error = message;
			this.task.phase = "idle";
			this.state.codingPhase.value = "idle";
			this.addSystemMessage(`Coding task failed: ${message}`);
			log.error("Coding task failed", err);
		}
	}

	private async plan(): Promise<void> {
		this.task!.phase = "planning";
		this.state.codingPhase.value = "planning";

		const prompt = `I need you to create a detailed implementation plan for the following task.
Do NOT make any changes yet -- just analyze the codebase and produce a step-by-step plan.

Task: ${this.task!.description}

Output your plan as a numbered list of specific changes to make, including file paths.`;

		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.branching);
	}

	private async branch(): Promise<void> {
		this.task!.phase = "branching";
		this.state.codingPhase.value = "branching";

		// Generate a branch name from the description
		const slug = this.task!.description
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40);
		this.task!.branchName = `feat/${slug}`;

		const prompt = `Create a new git branch named "${this.task!.branchName}" from the current HEAD. Use the bash tool to run: git checkout -b ${this.task!.branchName}`;
		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.executing);
	}

	private async execute(): Promise<void> {
		this.task!.phase = "executing";
		this.state.codingPhase.value = "executing";

		const prompt =
			"Now implement the plan. Make all the necessary code changes using the edit and write tools. Be thorough and precise.";
		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.validating);
	}

	private async validate(): Promise<void> {
		this.task!.phase = "validating";
		this.state.codingPhase.value = "validating";

		const prompt = `Validate the changes you just made:
1. Run the build command to check for type errors
2. Run the test suite to check for regressions
3. Report the results

If there are failures, fix them before proceeding.`;

		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.reviewing);
	}

	private async review(): Promise<void> {
		this.task!.phase = "reviewing";
		this.state.codingPhase.value = "reviewing";

		const prompt = `Review all the changes you've made:
1. Run git diff to see all changes
2. Check for any issues: missing error handling, security concerns, style problems
3. Fix any issues you find
4. List all files that were modified`;

		await this.runner.submit(prompt);
		this.addSystemMessage(PHASE_LABELS.committing);
	}

	private async commit(): Promise<void> {
		this.task!.phase = "committing";
		this.state.codingPhase.value = "committing";

		const prompt = `Commit all changes with a descriptive commit message that summarizes what was done. Use the bash tool to:
1. git add the modified files
2. git commit with a good message`;

		await this.runner.submit(prompt);
	}

	private addSystemMessage(text: string): void {
		const msg: Message = {
			id: `code-${Date.now()}-${this.messageSeq++}`,
			role: "assistant",
			content: [{ type: "text", text: `[/code] ${text}` }],
			timestamp: Date.now(),
		};
		this.state.addMessage(msg);
	}
}
