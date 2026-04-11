import { describe, expect, it, vi } from "vitest";
import { registerTemplateCommands } from "../src/commands/app-commands-template.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext(options?: { withAgentRunner?: boolean }) {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	const addInfoMessage = vi.fn();
	const submit = vi.fn(async () => undefined);
	const agentRunner = options?.withAgentRunner === false ? null : ({ submit } as never);

	registerTemplateCommands({
		commands,
		state,
		agentRunner,
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
	it("registers builtin pack metadata and alias routing", () => {
		const { commands } = createContext();

		expect(commands.get("/template")?.source).toBe("builtin");
		expect(commands.get("/template")?.packId).toBe("builtin.template");
		expect(commands.get("/template")?.packLabel).toBe("Templates");
		expect(commands.get("/template")?.requestedName).toBe("/template");
		expect(commands.get("/tmpl")?.name).toBe("/template");
	});

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

	it("renders locally when no agent runner is active", async () => {
		const { commands, addInfoMessage, submit } = createContext({ withAgentRunner: false });

		await commands.execute('/tmpl run review file=src/app.ts focus="performance"');

		expect(submit).not.toHaveBeenCalled();
		expect(addInfoMessage).toHaveBeenCalledWith(
			expect.stringContaining("Rendered template:\n\nReview src/app.ts with focus on performance"),
		);
	});
});
