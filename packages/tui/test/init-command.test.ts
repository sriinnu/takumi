import { afterEach, describe, expect, it, vi } from "vitest";

const initCoreMocks = vi.hoisted(() => ({
	ensureTakumiProjectInstructionsFile: vi.fn(),
	formatTakumiProjectInstructionsInspection: vi.fn(),
	getTakumiProjectInstructionsPath: vi.fn(),
	inspectTakumiProjectInstructions: vi.fn(),
	tryRevealTakumiProjectInstructionsFile: vi.fn(),
}));

vi.mock("@takumi/core", async () => {
	const actual = await vi.importActual<typeof import("@takumi/core")>("@takumi/core");
	return {
		...actual,
		ensureTakumiProjectInstructionsFile: initCoreMocks.ensureTakumiProjectInstructionsFile,
		formatTakumiProjectInstructionsInspection: initCoreMocks.formatTakumiProjectInstructionsInspection,
		getTakumiProjectInstructionsPath: initCoreMocks.getTakumiProjectInstructionsPath,
		inspectTakumiProjectInstructions: initCoreMocks.inspectTakumiProjectInstructions,
		tryRevealTakumiProjectInstructionsFile: initCoreMocks.tryRevealTakumiProjectInstructionsFile,
	};
});

import { registerInitCommands } from "../src/commands/app-commands-init.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext(addInfoMessage = vi.fn()) {
	const commands = new SlashCommandRegistry();

	registerInitCommands({
		commands,
		state: new AppState(),
		agentRunner: null,
		config: { workingDirectory: "/repo" } as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage,
		buildSessionData: vi.fn() as never,
		startAutoSaver: vi.fn(),
		quit: vi.fn().mockResolvedValue(undefined),
		getExtensionRunner: vi.fn().mockReturnValue(null),
		getConventionFiles: vi.fn().mockReturnValue(null),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	} as never);

	return { commands, addInfoMessage };
}

describe("/init command", () => {
	afterEach(() => {
		for (const mock of Object.values(initCoreMocks)) {
			mock.mockReset();
		}
	});

	it("creates or reveals the Takumi instructions file", async () => {
		initCoreMocks.ensureTakumiProjectInstructionsFile.mockResolvedValue({
			filePath: "/repo/TAKUMI.md",
			created: true,
			projectRoot: "/repo",
		});
		initCoreMocks.inspectTakumiProjectInstructions.mockReturnValue({
			projectRoot: "/repo",
			activePath: "/repo/TAKUMI.md",
			defaultPath: "/repo/TAKUMI.md",
			searchPaths: [],
		});
		initCoreMocks.formatTakumiProjectInstructionsInspection.mockReturnValue("Search order:\n  ▶ /repo/TAKUMI.md");
		initCoreMocks.tryRevealTakumiProjectInstructionsFile.mockReturnValue({ opened: false, error: "open failed" });

		const { commands, addInfoMessage } = createContext();
		await commands.execute("/init");

		expect(initCoreMocks.ensureTakumiProjectInstructionsFile).toHaveBeenCalledWith("/repo");
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("/repo/TAKUMI.md"));
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("open failed"));
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("TAKUMI.md takes precedence"));
	});

	it("prints the Takumi instructions path", async () => {
		initCoreMocks.getTakumiProjectInstructionsPath.mockReturnValue("/repo/TAKUMI.md");

		const { commands, addInfoMessage } = createContext();
		await commands.execute("/init path");

		expect(addInfoMessage).toHaveBeenCalledWith("/repo/TAKUMI.md");
	});

	it("offers argument completions", () => {
		const { commands } = createContext();
		expect(commands.get("/init")?.getArgumentCompletions?.("sh")).toEqual(["show"]);
	});
});
