import { beforeEach, describe, expect, it, vi } from "vitest";

const ideCoreMocks = vi.hoisted(() => ({
	detectAvailableIdeLaunchers: vi.fn(),
	openInIde: vi.fn(),
}));

vi.mock("@takumi/core", async () => {
	const actual = await vi.importActual<typeof import("@takumi/core")>("@takumi/core");
	return {
		...actual,
		detectAvailableIdeLaunchers: ideCoreMocks.detectAvailableIdeLaunchers,
		openInIde: ideCoreMocks.openInIde,
	};
});

import { registerIdeCommands } from "../src/commands/app-commands-ide.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext() {
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];
	registerIdeCommands({
		commands,
		state: new AppState(),
		agentRunner: null,
		config: {
			provider: "openai",
			model: "gpt-5",
			theme: "default",
			thinking: false,
			thinkingBudget: 0,
			systemPrompt: "",
			workingDirectory: "/repo",
		} as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text) => infoMessages.push(text),
		buildSessionData: vi.fn() as never,
		startAutoSaver: vi.fn(),
		quit: vi.fn(async () => undefined),
		getExtensionRunner: vi.fn().mockReturnValue(null),
		getConventionFiles: vi.fn().mockReturnValue(null),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	} as never);
	return { commands, infoMessages };
}

describe("/ide command", () => {
	beforeEach(() => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockReset();
		ideCoreMocks.openInIde.mockReset();
	});

	it("shows launcher status by default", async () => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockResolvedValue([
			{
				id: "cursor",
				label: "Cursor",
				command: "cursor",
				aliases: [],
				source: "cli",
				probeArgs: ["--version"],
				available: true,
			},
			{
				id: "system",
				label: "System default",
				command: "open",
				aliases: ["default"],
				source: "system",
				probeArgs: [],
				available: true,
			},
		]);
		const { commands, infoMessages } = createContext();

		await commands.execute("/ide");

		expect(infoMessages[0]).toContain("IDE target: /repo");
		expect(infoMessages[0]).toContain("Cursor [cursor]");
		expect(infoMessages[0]).toContain("Usage: /ide open [launcher] [path]");
	});

	it("opens the current project in the selected IDE", async () => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockResolvedValue([
			{
				id: "cursor",
				label: "Cursor",
				command: "cursor",
				aliases: [],
				source: "cli",
				probeArgs: ["--version"],
				available: true,
			},
		]);
		ideCoreMocks.openInIde.mockResolvedValue({
			opened: true,
			targetPath: "/repo",
			launcher: {
				id: "cursor",
				label: "Cursor",
				command: "cursor",
				aliases: [],
				source: "cli",
				probeArgs: ["--version"],
				available: true,
			},
		});
		const { commands, infoMessages } = createContext();

		await commands.execute("/ide open cursor");

		expect(ideCoreMocks.openInIde).toHaveBeenCalledWith(
			expect.objectContaining({
				selector: "cursor",
				cwd: "/repo",
			}),
		);
		expect(infoMessages).toEqual(["Opened /repo in Cursor."]);
	});

	it("parses quoted paths for IDE open", async () => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockResolvedValue([
			{
				id: "cursor",
				label: "Cursor",
				command: "cursor",
				aliases: [],
				source: "cli",
				probeArgs: ["--version"],
				available: true,
			},
		]);
		ideCoreMocks.openInIde.mockResolvedValue({
			opened: true,
			targetPath: "/repo/other project",
			launcher: {
				id: "cursor",
				label: "Cursor",
				command: "cursor",
				aliases: [],
				source: "cli",
				probeArgs: ["--version"],
				available: true,
			},
		});
		const { commands } = createContext();

		await commands.execute('/ide open cursor "../other project"');

		expect(ideCoreMocks.openInIde).toHaveBeenCalledWith(
			expect.objectContaining({
				selector: "cursor",
				targetPath: "../other project",
			}),
		);
	});

	it("offers launcher completions for the open subcommand", () => {
		const { commands } = createContext();

		expect(commands.get("/ide")?.getArgumentCompletions?.("op")).toEqual(["open"]);
		expect(commands.get("/ide")?.getArgumentCompletions?.("open cu")).toContain("open cursor");
	});
});
