import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunner } from "../src/agent/agent-runner.js";
import { CodingAgent } from "../src/agent/coding-agent.js";
import { AppState } from "../src/state.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Create a minimal mock AgentRunner. */
function mockRunner(overrides: Partial<AgentRunner> = {}): AgentRunner {
	return {
		submit: vi.fn(async () => {}),
		cancel: vi.fn(),
		clearHistory: vi.fn(),
		isRunning: false,
		permissions: { check: vi.fn(), getRules: vi.fn(() => []), reset: vi.fn() } as any,
		checkToolPermission: vi.fn(async () => true),
		...overrides,
	} as unknown as AgentRunner;
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("CodingAgent", () => {
	let state: AppState;
	let runner: AgentRunner;

	beforeEach(() => {
		state = new AppState();
		runner = mockRunner();
	});

	/* ---- constructor ----------------------------------------------------- */

	describe("constructor", () => {
		it("starts with no active task", () => {
			const agent = new CodingAgent(state, runner);
			expect(agent.currentTask).toBeNull();
		});

		it("isActive returns false when idle (no task)", () => {
			const agent = new CodingAgent(state, runner);
			expect(agent.isActive).toBe(false);
		});
	});

	/* ---- start ----------------------------------------------------------- */

	describe("start", () => {
		it("sets the task description", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Add a login form");

			expect(agent.currentTask).not.toBeNull();
			expect(agent.currentTask!.description).toBe("Add a login form");
		});

		it("runs through all phases and ends in done", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Refactor auth module");

			expect(agent.currentTask!.phase).toBe("done");
			expect(agent.isActive).toBe(false);
		});

		it("calls runner.submit for each phase (6 times)", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Fix bug");

			// plan, branch, execute, validate, review, commit = 6 calls
			expect(runner.submit).toHaveBeenCalledTimes(6);
		});

		it("sets phase to done on completion", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Add tests");

			expect(agent.currentTask!.phase).toBe("done");
			expect(state.codingPhase.value).toBe("done");
		});

		it("adds system messages to state during execution", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Implement feature X");

			const messages = state.messages.value;
			// Should have multiple system messages with [/code] prefix
			const codeMessages = messages.filter((m) =>
				m.content.some((b) => b.type === "text" && (b as any).text.startsWith("[/code]")),
			);
			expect(codeMessages.length).toBeGreaterThanOrEqual(7);
			// Starting message + 6 phase transition messages + completion message
		});

		it("updates codingPhase signal as it progresses", async () => {
			const phases: string[] = [];
			const originalSubmit = vi.fn(async () => {
				phases.push(state.codingPhase.value);
			});
			runner = mockRunner({ submit: originalSubmit } as any);

			const agent = new CodingAgent(state, runner);
			await agent.start("Track phases");

			// Each submit captures the phase at that moment
			expect(phases).toEqual(["planning", "branching", "executing", "validating", "reviewing", "committing"]);
		});
	});

	/* ---- branchName generation ------------------------------------------- */

	describe("branchName generation", () => {
		it("generates a slug-based branch name from the description", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Add user authentication");

			expect(agent.currentTask!.branchName).toBe("feat/add-user-authentication");
		});

		it("lowercases and strips special characters", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Fix Bug #123: Handle NULL values!!");

			expect(agent.currentTask!.branchName).toBe("feat/fix-bug-123-handle-null-values");
		});

		it("truncates long descriptions to 40 characters", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("This is a very long description that should be truncated to fit within the branch name limit");

			const slug = agent.currentTask!.branchName!.replace("feat/", "");
			expect(slug.length).toBeLessThanOrEqual(40);
		});

		it("strips leading and trailing hyphens from the slug", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("---leading and trailing---");

			expect(agent.currentTask!.branchName).toBe("feat/leading-and-trailing");
		});
	});

	/* ---- error handling -------------------------------------------------- */

	describe("error handling", () => {
		it("sets error on task when runner.submit throws", async () => {
			const failRunner = mockRunner({
				submit: vi.fn(async () => {
					throw new Error("API timeout");
				}),
			} as any);

			const agent = new CodingAgent(state, failRunner);
			await agent.start("This will fail");

			expect(agent.currentTask!.error).toBe("API timeout");
			expect(agent.currentTask!.phase).toBe("idle");
			expect(agent.isActive).toBe(false);
		});

		it("resets codingPhase to idle on error", async () => {
			const failRunner = mockRunner({
				submit: vi.fn(async () => {
					throw new Error("Network error");
				}),
			} as any);

			const agent = new CodingAgent(state, failRunner);
			await agent.start("Will fail");

			expect(state.codingPhase.value).toBe("idle");
		});

		it("adds a failure system message on error", async () => {
			const failRunner = mockRunner({
				submit: vi.fn(async () => {
					throw new Error("Something broke");
				}),
			} as any);

			const agent = new CodingAgent(state, failRunner);
			await agent.start("Broken task");

			const messages = state.messages.value;
			const failMsg = messages.find((m) =>
				m.content.some((b) => b.type === "text" && (b as any).text.includes("failed")),
			);
			expect(failMsg).toBeDefined();
			expect(failMsg!.content.some((b) => b.type === "text" && (b as any).text.includes("Something broke"))).toBe(true);
		});

		it("handles non-Error thrown values", async () => {
			const failRunner = mockRunner({
				submit: vi.fn(async () => {
					throw "string error";
				}),
			} as any);

			const agent = new CodingAgent(state, failRunner);
			await agent.start("String throw");

			expect(agent.currentTask!.error).toBe("string error");
			expect(agent.currentTask!.phase).toBe("idle");
		});
	});

	/* ---- cancellation ---------------------------------------------------- */

	describe("resume", () => {
		it("surfaces checkpoint compatibility summaries when resume is blocked", async () => {
			const agent = new CodingAgent(state, runner);
			const fakeOrchestrator = {
				setChitraguptaMemory: vi.fn(),
				resume: vi.fn(async () => {
					throw new Error("resume blocked");
				}),
				getLastResumeCompatibility: vi.fn(() => ({
					ok: false,
					blocking: true,
					warnings: [],
					conflicts: [],
					summary: "Checkpoint compatibility blocked resume for cluster-1: route policy mismatch",
				})),
			} as never;

			(agent as any).orchestrator = fakeOrchestrator;

			await agent.resume("cluster-1");

			expect(fakeOrchestrator.setChitraguptaMemory).toHaveBeenCalledOnce();
			expect(state.messages.value.at(-1)?.content[0]).toEqual(
				expect.objectContaining({
					type: "text",
					text: expect.stringContaining("Checkpoint compatibility blocked resume for cluster-1: route policy mismatch"),
				}),
			);
		});

		it("surfaces checkpoint compatibility warnings before continuing resume", async () => {
			const agent = new CodingAgent(state, runner);
			const clusterState = {
				id: "cluster-2",
				phase: "PLANNING",
				agents: new Map([["planner", {}]]),
				validationAttempt: 0,
				config: { taskDescription: "Resume task" },
			} as never;
			const fakeOrchestrator = {
				setChitraguptaMemory: vi.fn(),
				resume: vi.fn(async () => clusterState),
				getLastResumeCompatibility: vi.fn(() => ({
					ok: true,
					blocking: false,
					warnings: ["Checkpoint topology hierarchical differs from the current default swarm."],
					conflicts: [],
					summary:
						"Checkpoint compatibility warnings for cluster-2: Checkpoint topology hierarchical differs from the current default swarm.",
				})),
				execute: vi.fn(async function* () {
					yield { type: "cluster_complete", success: true };
				}),
				onAgentText: null,
			} as never;

			(agent as any).orchestrator = fakeOrchestrator;

			await agent.resume("cluster-2");

			const texts = state.messages.value.flatMap((message) =>
				message.content.filter((block) => block.type === "text").map((block) => (block as { text: string }).text),
			);
			expect(texts.some((text) => text.includes("Checkpoint compatibility warnings for cluster-2"))).toBe(true);
			expect(texts.some((text) => text.includes("Resuming cluster cluster-2 from phase PLANNING"))).toBe(true);
		});
	});

	describe("cancellation", () => {
		it("cancel stops the runner when a task is active", async () => {
			const blockingRunner = mockRunner();
			const agent = new CodingAgent(state, blockingRunner);
			(agent as any).task = {
				description: "Cancel me",
				phase: "planning",
				branchName: null,
				plan: null,
				filesModified: [],
				testsPassed: null,
				error: null,
				orchestrationMode: "single",
			};

			expect(agent.isActive).toBe(true);
			await agent.cancel("Session switch requested.");

			expect(blockingRunner.cancel).toHaveBeenCalledOnce();
			expect((agent as any).stopRequestedReason).toBe("Session switch requested.");
		});
	});

	/* ---- system messages ------------------------------------------------- */

	describe("system messages", () => {
		it("messages have [/code] prefix", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Check messages");

			const messages = state.messages.value;
			for (const msg of messages) {
				for (const block of msg.content) {
					if (block.type === "text") {
						expect((block as any).text).toMatch(/^\[\/code\]/);
					}
				}
			}
		});

		it("messages have assistant role", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Check roles");

			const messages = state.messages.value;
			for (const msg of messages) {
				expect(msg.role).toBe("assistant");
			}
		});

		it("messages have unique IDs", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Check IDs");

			const messages = state.messages.value;
			const ids = new Set(messages.map((m) => m.id));
			expect(ids.size).toBe(messages.length);
		});

		it("includes the starting task description in the first message", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Implement dark mode");

			const first = state.messages.value[0];
			expect(first.content[0].type).toBe("text");
			expect((first.content[0] as any).text).toContain("Implement dark mode");
		});
	});

	/* ---- initial task properties ----------------------------------------- */

	describe("initial task properties", () => {
		it("plan starts as null", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Check defaults");

			// After completion, plan is still null (set by external logic)
			expect(agent.currentTask!.plan).toBeNull();
		});

		it("filesModified starts as empty array", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Check defaults");

			expect(agent.currentTask!.filesModified).toEqual([]);
		});

		it("testsPassed starts as null", async () => {
			const agent = new CodingAgent(state, runner);
			await agent.start("Check defaults");

			expect(agent.currentTask!.testsPassed).toBeNull();
		});
	});
});
