import { describe, expect, it, vi } from "vitest";
import { registerFilesCommands } from "../src/commands/app-commands-files.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext(config: Record<string, unknown> = {}) {
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];
	const state = new AppState();

	registerFilesCommands({
		commands,
		state,
		agentRunner: null,
		config: {
			provider: "openai",
			model: "gpt-5",
			theme: "default",
			thinking: false,
			thinkingBudget: 0,
			systemPrompt: "",
			workingDirectory: process.cwd(),
			...config,
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

	return { commands, infoMessages, state };
}

describe("/files command", () => {
	it("shows an honest empty-state before file tools run", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/files");

		expect(infoMessages[0]).toContain("Tracking     live runtime only");
		expect(infoMessages[0]).toContain("Changed      0");
		expect(infoMessages[0]).toContain("Read         0");
		expect(infoMessages[0]).toContain("Takumi tracks successful read/write/edit file tool calls in this runtime.");
	});

	it("reports tracked changed and read files", async () => {
		const { commands, infoMessages, state } = createContext();
		state.recordFileRead("packages/tui/src/state.ts");
		state.recordFileRead("packages/tui/src/app.ts");
		state.recordFileChange("packages/tui/src/app-commands-files.ts", "added");
		state.recordFileChange("packages/tui/src/agent-runner.ts", "modified");

		await commands.execute("/files");

		const text = infoMessages[0];
		expect(text).toContain("Changed      2");
		expect(text).toContain("Read         2");
		expect(text).toContain("1. modified packages/tui/src/agent-runner.ts");
		expect(text).toContain("2. added    packages/tui/src/app-commands-files.ts");
		expect(text).toContain("1. packages/tui/src/app.ts");
		expect(text).toContain("2. packages/tui/src/state.ts");
	});

	it("shows usage guidance for invalid arguments", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/files now");

		expect(infoMessages).toEqual(["Usage: /files"]);
	});
});
