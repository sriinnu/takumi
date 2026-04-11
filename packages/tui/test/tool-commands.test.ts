import type { ToolDefinition } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/commands/app-command-context.js";
import { registerToolInspectionCommands } from "../src/commands/app-commands-tools.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext(options?: { agentRunner?: AppCommandContext["agentRunner"] }) {
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];
	const ctx: AppCommandContext = {
		commands,
		state: new AppState(),
		agentRunner: options?.agentRunner ?? null,
		config: {
			provider: "openai",
			model: "gpt-5",
			theme: "default",
			thinking: false,
			thinkingBudget: 0,
			systemPrompt: "",
		} as AppCommandContext["config"],
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text) => infoMessages.push(text),
		buildSessionData: vi.fn() as AppCommandContext["buildSessionData"],
		startAutoSaver: vi.fn(),
		quit: vi.fn(async () => undefined),
		getExtensionRunner: () => null,
		getConventionFiles: () => null,
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => null,
		setActiveAutocycle: vi.fn(),
	};
	registerToolInspectionCommands(ctx);
	return { commands, infoMessages };
}

describe("/tools command", () => {
	it("registers builtin pack metadata", () => {
		const { commands } = createContext();

		expect(commands.get("/tools")?.source).toBe("builtin");
		expect(commands.get("/tools")?.packId).toBe("builtin.tools");
		expect(commands.get("/tools")?.packLabel).toBe("Tools");
		expect(commands.get("/tools")?.requestedName).toBe("/tools");
	});

	it("reports when no agent runner is active", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/tools");

		expect(infoMessages).toEqual(["No agent runner is active, so no live tool registry is available."]);
	});

	it("lists loaded tools from the live registry", async () => {
		const toolDefinitions: ToolDefinition[] = [
			{
				name: "read",
				description: "Read a file",
				inputSchema: { file_path: { type: "string" } },
				requiresPermission: false,
				category: "read",
			},
			{
				name: "bash",
				description: "Run shell commands",
				inputSchema: { command: { type: "string" } },
				requiresPermission: true,
				category: "execute",
			},
		];
		const toolRegistry = { getDefinitions: () => toolDefinitions };
		const agentRunner = { getTools: () => toolRegistry } as AppCommandContext["agentRunner"];
		const { commands, infoMessages } = createContext({ agentRunner });

		await commands.execute("/tools");

		expect(infoMessages[0]).toContain("Tools: 2");
		expect(infoMessages[0]).toContain("Permission-gated: 1");
		expect(infoMessages[0]).toContain("bash  [execute] [permission]");
		expect(infoMessages[0]).toContain("read  [read] [no-permission]");
	});

	it("shows tool details for a selected tool", async () => {
		const toolDefinitions: ToolDefinition[] = [
			{
				name: "mcp.search",
				description: "Search a connected MCP surface",
				inputSchema: { query: { type: "string" }, limit: { type: "number" } },
				requiresPermission: false,
				category: "search",
			},
		];
		const toolRegistry = { getDefinitions: () => toolDefinitions };
		const agentRunner = { getTools: () => toolRegistry } as AppCommandContext["agentRunner"];
		const { commands, infoMessages } = createContext({ agentRunner });

		await commands.execute("/tools show mcp.search");

		expect(infoMessages[0]).toContain("mcp.search");
		expect(infoMessages[0]).toContain("Category: search");
		expect(infoMessages[0]).toContain("Inputs: limit, query");
		expect(infoMessages[0]).toContain("Description: Search a connected MCP surface");
	});
});
