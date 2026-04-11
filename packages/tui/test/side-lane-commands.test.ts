import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import type { Message, ToolDefinition, ToolResult } from "@takumi/core";
import { registerSideLaneCommands } from "../src/commands/app-commands-side-lanes.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
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
	const toolDefinitions = new Map<string, ToolDefinition>();
	const toolExecute = vi.fn<(inputName: string, input: Record<string, unknown>) => Promise<ToolResult>>();
	const getDefinition = vi.fn((name: string) => toolDefinitions.get(name));
	const executeCommandTool = vi.fn((name: string, input: Record<string, unknown>) => toolExecute(name, input));

	const ctx = {
		commands,
		state,
		agentRunner: {
			isRunning: false,
			submit: vi.fn(),
			clearHistory: vi.fn(),
			checkToolPermission: vi.fn(async () => true),
			executeCommandTool,
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

	registerSideLaneCommands(ctx as never);

	return {
		ctx,
		commands,
		state,
		toolDefinitions,
		toolExecute,
		executeCommandTool,
	};
}

describe("side-lane slash commands", () => {
	const originalTmux = process.env.TMUX;

	beforeEach(() => {
		vi.mocked(execFileSync).mockReset();
		process.env.TMUX = originalTmux;
	});

	it("refreshes the latest tracked lane", async () => {
		const { commands, state, toolDefinitions, toolExecute } = createContext();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			title: "Independent planning lane",
			state: "running",
			tmuxWindow: "agent-side-1",
		});
		toolDefinitions.set("takumi_agent_check", {
			name: "takumi_agent_check",
			description: "check",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: false,
			category: "read",
		});
		toolExecute.mockResolvedValue({
			output: JSON.stringify({
				id: "side-1",
				state: "waiting_user",
				description: "Independent planning lane",
				model: "o3-mini",
				branch: "takumi/side-agent/side-1",
				recentOutput: "need approval\n",
			}),
			isError: false,
		});

		await commands.execute("/lane-refresh");

		expect(toolExecute).toHaveBeenCalledWith("takumi_agent_check", { id: "side-1" });
		expect(state.sideLanes.find("side-1")).toMatchObject({
			state: "waiting_user",
			recentOutput: "need approval",
			model: "o3-mini",
		});
		expect(lastInfoText(state)).toContain("side-1 is waiting_user");
	});

	it("shows detailed metadata for the latest tracked lane", async () => {
		const { commands, state } = createContext();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			title: "Independent planning lane",
			state: "waiting_user",
			tmuxWindow: "agent-side-1",
			branch: "takumi/side-agent/side-1",
			worktree: "/tmp/takumi/side-1",
			model: "o3-mini",
			lastQuery: "continue",
			responseType: "structured",
			responseSummary: "Waiting for operator input",
			recentOutput: "need approval\n",
		});

		await commands.execute("/lane-show");

		expect(lastInfoText(state)).toContain("Digest: /co-plan:waiting_user@agent-side-1");
		expect(lastInfoText(state)).toContain("tmux: agent-side-1");
		expect(lastInfoText(state)).toContain("Branch: takumi/side-agent/side-1");
		expect(lastInfoText(state)).toContain("Worktree: /tmp/takumi/side-1");
		expect(lastInfoText(state)).toContain("Model: o3-mini");
		expect(lastInfoText(state)).toContain("Summary: Waiting for operator input");
		expect(lastInfoText(state)).toContain("Recent output:");
	});

	it("offers lane selector completions for inspect and send flows", async () => {
		const { commands, state } = createContext();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "waiting_user",
			tmuxWindow: "agent-side-1",
		});

		expect(commands.get("/lane-show")?.getArgumentCompletions?.("side")).toEqual(["side-1", "agent-side-1"]);
		expect(commands.get("/lane-send")?.getArgumentCompletions?.("agent")).toEqual(["agent-side-1 "]);
	});

	it("sends a prompt to a tracked lane and refreshes it", async () => {
		const { commands, state, toolDefinitions, toolExecute } = createContext();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			title: "Independent planning lane",
			state: "waiting_user",
			tmuxWindow: "agent-side-1",
		});
		toolDefinitions.set("takumi_agent_send", {
			name: "takumi_agent_send",
			description: "send",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: true,
			category: "interact",
		});
		toolDefinitions.set("takumi_agent_check", {
			name: "takumi_agent_check",
			description: "check",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: false,
			category: "read",
		});
		toolExecute.mockImplementation(async (name) => {
			if (name === "takumi_agent_send") {
				return { output: JSON.stringify({ id: "side-1", sent: true }), isError: false };
			}
			return {
				output: JSON.stringify({
					id: "side-1",
					state: "running",
					description: "Independent planning lane",
					model: "o3-mini",
					branch: "takumi/side-agent/side-1",
					recentOutput: "continuing work\n",
				}),
				isError: false,
			};
		});

		await commands.execute("/lane-send side-1 continue");

		expect(toolExecute).toHaveBeenCalledWith("takumi_agent_send", { id: "side-1", prompt: "continue" });
		expect(state.sideLanes.find("side-1")).toMatchObject({
			state: "running",
			recentOutput: "continuing work",
		});
		expect(lastInfoText(state)).toContain("sent prompt to side-1");
	});

	it("focuses the latest tracked lane inside tmux", async () => {
		const { commands, state } = createContext();
		process.env.TMUX = "/tmp/tmux";
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
		});

		await commands.execute("/lane-focus");

		expect(execFileSync).toHaveBeenCalledWith("tmux", ["select-window", "-t", "agent-side-1"], { stdio: "ignore" });
	});

	it("stops a tracked lane through the native stop tool", async () => {
		const { commands, state, ctx, toolDefinitions, toolExecute } = createContext();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
		});
		toolDefinitions.set("takumi_agent_stop", {
			name: "takumi_agent_stop",
			description: "stop",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: true,
			category: "execute",
		});
		toolExecute.mockResolvedValue({
			output: JSON.stringify({ id: "side-1", state: "stopped", reason: "Stopped by operator" }),
			isError: false,
		});

		await commands.execute("/lane-stop");

		expect(ctx.agentRunner?.executeCommandTool).toHaveBeenCalledWith("takumi_agent_stop", { id: "side-1" });
		expect(toolExecute).toHaveBeenCalledWith("takumi_agent_stop", { id: "side-1" });
		expect(state.sideLanes.find("side-1")).toMatchObject({
			state: "stopped",
			error: "Stopped by operator",
		});
		expect(lastInfoText(state)).toContain("stopped side-1");
	});

	it("blocks lane stop while autocycle owns the command lease", async () => {
		const { commands, state, ctx, toolDefinitions, toolExecute } = createContext();
		ctx.getActiveAutocycle = vi.fn(() => ({ isActive: true }));
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
		});
		toolDefinitions.set("takumi_agent_stop", {
			name: "takumi_agent_stop",
			description: "stop",
			inputSchema: { type: "object", properties: {} },
			requiresPermission: true,
			category: "execute",
		});

		await commands.execute("/lane-stop");

		expect(ctx.agentRunner?.executeCommandTool).not.toHaveBeenCalled();
		expect(toolExecute).not.toHaveBeenCalled();
		expect(lastInfoText(state)).toContain("/lane-stop is unavailable while the autocycle lane is active.");
	});
});
