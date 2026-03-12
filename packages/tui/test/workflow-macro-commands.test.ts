import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import type { Message, ToolDefinition, ToolResult } from "@takumi/core";
import { registerProductivityCommands } from "../src/app-commands-productivity.js";
import { registerWorkflowCommands } from "../src/app-commands-workflow.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { AppState } from "../src/state.js";

function lastInfoText(state: AppState): string {
	const message = [...state.messages.value].reverse().find((entry) => entry.id.startsWith("info-"));
	if (!message) {
		return "";
	}
	const block = message.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

function createContext() {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	const submit = vi.fn().mockResolvedValue(undefined);
	const codeHandler = vi.fn().mockResolvedValue(undefined);
	const toolDefinitions = new Map<string, ToolDefinition>();
	const toolExecute = vi.fn<(inputName: string, input: Record<string, unknown>) => Promise<ToolResult>>();
	const getDefinition = vi.fn((name: string) => toolDefinitions.get(name));

	commands.register("/code", "Start coding agent", codeHandler);

	const ctx = {
		commands,
		state,
		agentRunner: {
			isRunning: false,
			submit,
			clearHistory: vi.fn(),
			checkToolPermission: vi.fn(async () => true),
			getTools: () => ({
				getDefinition,
				execute: (name: string, input: Record<string, unknown>) => toolExecute(name, input),
			}),
		},
		config: {} as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text: string) => {
			const message: Message = {
				id: `info-${Date.now()}`,
				role: "assistant",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
			};
			state.addMessage(message);
		},
		buildSessionData: vi.fn(),
		startAutoSaver: vi.fn(),
		quit: vi.fn(),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	};

	registerWorkflowCommands(ctx as never);
	registerProductivityCommands(ctx as never);

	return {
		ctx,
		commands,
		state,
		submit,
		codeHandler,
		toolDefinitions,
		toolExecute,
		getDefinition,
	};
}

describe("workflow/productivity slash commands", () => {
	beforeEach(() => {
		vi.mocked(execSync).mockReset();
	});

	it("registers the new workflow and productivity commands", () => {
		const { commands } = createContext();
		for (const name of [
			"/plan",
			"/design",
			"/build",
			"/test",
			"/review",
			"/reflect",
			"/co-plan",
			"/co-validate",
			"/route-plan",
			"/worktree-spin",
			"/scarlett-fix",
			"/commit-msg",
			"/pr-desc",
			"/security-scan",
			"/env-audit",
			"/context-prune",
			"/doc-refactor",
			"/article",
			"/handoff",
			"/hand-off",
			"/pass-on",
		]) {
			expect(commands.has(name)).toBe(true);
		}
	});

	it("/plan submits a read-only planning macro", async () => {
		const { commands, submit } = createContext();

		await commands.execute("/plan refactor the auth flow");

		expect(submit).toHaveBeenCalledOnce();
		expect(submit.mock.calls[0][0]).toContain("Workflow command: /plan");
		expect(submit.mock.calls[0][0]).toContain("Do not edit files");
		expect(submit.mock.calls[0][0]).toContain("refactor the auth flow");
	});

	it("/build dispatches through /code with an execution prompt", async () => {
		const { commands, codeHandler } = createContext();

		await commands.execute("/build implement the parser cleanup");

		expect(codeHandler).toHaveBeenCalledOnce();
		expect(codeHandler.mock.calls[0][0]).toContain("Execution mode");
		expect(codeHandler.mock.calls[0][0]).toContain("implement the parser cleanup");
	});

	it("/route-plan includes Scarlett and routing context in the submitted prompt", async () => {
		const { commands, state, submit } = createContext();
		state.routingDecisions.value = [
			{
				request: { capability: "coding" },
				selected: {
					id: "takumi.local",
					kind: "local-process",
					capabilities: ["coding"],
					health: "healthy",
					trust: "high",
				},
				fallbackChain: ["takumi.local"],
				policyTrace: ["local-first"],
				reason: "healthy local lane",
				degraded: false,
			},
		] as never;

		await commands.execute("/route-plan migrate executor flow");

		expect(submit).toHaveBeenCalledOnce();
		expect(submit.mock.calls[0][0]).toContain("Workflow command: /route-plan");
		expect(submit.mock.calls[0][0]).toContain("healthy local lane");
		expect(submit.mock.calls[0][0]).toContain("migrate executor flow");
	});

	it("/co-plan uses native side-agent tools when available", async () => {
		const { commands, submit, ctx, toolDefinitions, toolExecute } = createContext();
		toolDefinitions.set("takumi_agent_start", {
			name: "takumi_agent_start",
			description: "start",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: true,
			category: "execute",
		});
		toolDefinitions.set("takumi_agent_query", {
			name: "takumi_agent_query",
			description: "query",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: false,
			category: "interact",
		});
		toolExecute.mockImplementation(async (name) => {
			if (name === "takumi_agent_start") {
				return {
					output: JSON.stringify({
						id: "side-1",
						status: "running",
						worktree: "/tmp/wt-1",
						branch: "takumi/side-agent/side-1-wt-1",
						tmuxWindow: "agent-side-1",
					}),
					isError: false,
				};
			}
			return {
				output: JSON.stringify({
					id: "side-1",
					query: "plan",
					format: "json",
					responseType: "structured",
					response: { summary: "Alt plan", steps: ["A"], risks: ["R"] },
				}),
				isError: false,
			};
		});

		await commands.execute("/co-plan improve auth flow");

		expect(ctx.agentRunner?.checkToolPermission).toHaveBeenCalledWith(
			"takumi_agent_start",
			expect.objectContaining({ description: expect.stringContaining("improve auth flow") }),
		);
		expect(toolExecute).toHaveBeenCalledWith(
			"takumi_agent_query",
			expect.objectContaining({ id: "side-1", format: "json" }),
		);
		expect(submit).toHaveBeenCalledOnce();
		expect(submit.mock.calls[0][0]).toContain("Independent side-lane output");
		expect(submit.mock.calls[0][0]).toContain("Alt plan");
	});

	it("/worktree-spin creates a native worktree before dispatching /code", async () => {
		const { commands, codeHandler, ctx, toolDefinitions, toolExecute } = createContext();
		toolDefinitions.set("worktree_create", {
			name: "worktree_create",
			description: "create",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: true,
			category: "execute",
		});
		toolDefinitions.set("worktree_destroy", {
			name: "worktree_destroy",
			description: "destroy",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: true,
			category: "execute",
		});
		toolExecute.mockImplementation(async (name) => {
			if (name === "worktree_create") {
				return {
					output: JSON.stringify({ path: "/tmp/wt-auth", branch: "HEAD", label: "add-caching" }),
					isError: false,
				};
			}
			return { output: "Destroyed", isError: false };
		});

		await commands.execute("/worktree-spin add caching");

		expect(ctx.agentRunner?.checkToolPermission).toHaveBeenCalledWith(
			"worktree_create",
			expect.objectContaining({ label: "add-caching" }),
		);
		expect(toolExecute).toHaveBeenCalledWith("worktree_create", expect.objectContaining({ label: "add-caching" }));
		expect(codeHandler).toHaveBeenCalledOnce();
		expect(codeHandler.mock.calls[0][0]).toContain("/tmp/wt-auth");
		expect(codeHandler.mock.calls[0][0]).toContain("Use worktree_exec for validation commands");
	});

	it("/context-prune compacts session messages and clears agent history", async () => {
		const { commands, state, ctx } = createContext();
		state.messages.value = Array.from({ length: 24 }, (_, index) => ({
			id: `m-${index}`,
			role: index % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `message ${index}` }],
			timestamp: Date.now() + index,
		})) as Message[];

		await commands.execute("/context-prune 4");

		expect(state.messages.value.length).toBeLessThan(24);
		expect(ctx.agentRunner?.clearHistory).toHaveBeenCalledOnce();
		expect(lastInfoText(state)).toContain("Pruned context");
	});

	it("/commit-msg reports when there is no git diff to inspect", async () => {
		const { commands, state, submit } = createContext();
		vi.mocked(execSync).mockImplementation(() => "");

		await commands.execute("/commit-msg");

		expect(submit).not.toHaveBeenCalled();
		expect(lastInfoText(state)).toContain("found no staged or unstaged changes");
	});

	it("/handoff aliases resolve to the same macro path", async () => {
		const { commands, submit } = createContext();

		await commands.execute("/hand-off platform notes");
		await commands.execute("/pass-on reviewer summary");

		expect(submit).toHaveBeenCalledTimes(2);
		expect(submit.mock.calls[0][0]).toContain("Workflow command: /handoff");
		expect(submit.mock.calls[0][0]).toContain("platform notes");
		expect(submit.mock.calls[1][0]).toContain("reviewer summary");
	});
});
