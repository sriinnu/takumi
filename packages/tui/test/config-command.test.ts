import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCoreCommands } from "../src/commands/app-commands-core.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

const originalCwd = process.cwd();
const originalConfigDir = process.env.TAKUMI_CONFIG_DIR;

function createContext(addInfoMessage = vi.fn()) {
	const commands = new SlashCommandRegistry();

	registerCoreCommands({
		commands,
		state: new AppState(),
		agentRunner: null,
		config: {} as never,
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

describe("/config command", () => {
	let projectDir = "";
	let configDir = "";

	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), "takumi-config-project-"));
		configDir = mkdtempSync(join(tmpdir(), "takumi-config-user-"));
		process.env.TAKUMI_CONFIG_DIR = configDir;
		process.chdir(projectDir);
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(projectDir, { recursive: true, force: true });
		rmSync(configDir, { recursive: true, force: true });
		if (originalConfigDir === undefined) delete process.env.TAKUMI_CONFIG_DIR;
		else process.env.TAKUMI_CONFIG_DIR = originalConfigDir;
	});

	it("creates the global config when no config exists yet", async () => {
		const { commands, addInfoMessage } = createContext();

		await commands.execute("/config");

		const expectedPath = join(configDir, "config.json");
		expect(existsSync(expectedPath)).toBe(true);
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining(expectedPath));
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Search order:"));
	});

	it("creates a project-local config when requested", async () => {
		const { commands, addInfoMessage } = createContext();

		await commands.execute("/config project");

		const expectedPath = join(projectDir, ".takumi", "config.json");
		expect(existsSync(expectedPath)).toBe(true);
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining(expectedPath));
	});
});
