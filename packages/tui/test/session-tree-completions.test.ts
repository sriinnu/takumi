import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/app-command-context.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { AppState } from "../src/state.js";

const treeMocks = vi.hoisted(() => ({
	loadTreeManifest: vi.fn(),
	flattenTree: vi.fn(),
}));

vi.mock("@takumi/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@takumi/core")>();
	return {
		...actual,
		loadTreeManifest: treeMocks.loadTreeManifest,
		flattenTree: treeMocks.flattenTree,
	};
});

import { registerSessionTreeCommands } from "../src/app-commands-tree.js";

/**
 * I keep a very small context here because I only care about /switch completions.
 */
function createContext() {
	const commands = new SlashCommandRegistry();
	const ctx: AppCommandContext = {
		commands,
		state: new AppState(),
		agentRunner: null,
		config: {} as AppCommandContext["config"],
		autoPr: false,
		autoShip: false,
		addInfoMessage: vi.fn(),
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
	registerSessionTreeCommands(ctx);
	return { commands };
}

describe("/switch argument completions", () => {
	beforeEach(() => {
		treeMocks.loadTreeManifest.mockReset();
		treeMocks.flattenTree.mockReset();
	});

	it("suggests session ids when the label or id matches", async () => {
		treeMocks.loadTreeManifest.mockResolvedValue({ nodes: {} });
		treeMocks.flattenTree.mockReturnValue([
			{ id: "session-root", label: "Main", prefix: "", depth: 0, hasChildren: true, isLast: true },
			{ id: "session-branch", label: "Review Branch", prefix: "└── ", depth: 1, hasChildren: false, isLast: true },
		]);
		const { commands } = createContext();

		await expect(commands.get("/switch")?.getArgumentCompletions?.("review")).resolves.toEqual(["session-branch"]);
		await expect(commands.get("/switch")?.getArgumentCompletions?.("root")).resolves.toEqual(["session-root"]);
	});
});
