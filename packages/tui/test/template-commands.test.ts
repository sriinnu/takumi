import { describe, expect, it, vi } from "vitest";
import { registerTemplateCommands } from "../src/app-commands-template.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { AppState } from "../src/state.js";

function createContext() {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	const addInfoMessage = vi.fn();
	const submit = vi.fn(async () => undefined);

	registerTemplateCommands({
		commands,
		state,
		agentRunner: { submit } as never,
		config: {} as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage,
		buildSessionData: vi.fn() as never,
		startAutoSaver: vi.fn(),
		quit: vi.fn().mockResolvedValue(undefined),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	} as never);

	return { commands, addInfoMessage, submit };
}

describe("/template command", () => {
	it("lists built-in templates", async () => {
		const { commands, addInfoMessage } = createContext();

		await commands.execute("/template list");

		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Built-in templates:"));
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("review"));
	});

	it("rejects missing template params", async () => {
		const { commands, addInfoMessage, submit } = createContext();

		await commands.execute("/template run review file=src/app.ts");

		expect(submit).not.toHaveBeenCalled();
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Missing template params"));
	});

	it("renders and submits a template", async () => {
		const { commands, submit } = createContext();

		await commands.execute('/template run review file=src/app.ts focus="performance"');

		expect(submit).toHaveBeenCalledOnce();
		expect(submit).toHaveBeenCalledWith(expect.stringContaining("Review src/app.ts with focus on performance"));
	});
});
