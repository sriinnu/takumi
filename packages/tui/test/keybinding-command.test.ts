import { describe, expect, it, vi } from "vitest";
import { registerCoreCommands } from "../src/commands/app-commands-core.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { DEFAULT_KEYBINDING_DEFINITIONS } from "../src/input/keybinding-config.js";
import { AppState } from "../src/state.js";

function createContext(overrides?: {
	ensureKeybindingsFile?: () => Promise<{ filePath: string; created: boolean }>;
	reloadKeybindings?: () => Promise<{
		filePath: string;
		found: boolean;
		definitions: typeof DEFAULT_KEYBINDING_DEFINITIONS extends readonly (infer T)[] ? T[] : never;
		skipped: string[];
		error?: string;
	}>;
	addInfoMessage?: (text: string) => void;
}) {
	const commands = new SlashCommandRegistry();
	const addInfoMessage = overrides?.addInfoMessage ?? vi.fn();

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
		ensureKeybindingsFile: overrides?.ensureKeybindingsFile,
		reloadKeybindings: overrides?.reloadKeybindings,
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

describe("/keybindings command", () => {
	it("creates or surfaces the keybindings config path", async () => {
		const ensureKeybindingsFile = vi.fn(async () => ({ filePath: "/tmp/keybindings.json", created: true }));
		const { commands, addInfoMessage } = createContext({ ensureKeybindingsFile });

		await commands.execute("/keybindings");

		expect(ensureKeybindingsFile).toHaveBeenCalledOnce();
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("/tmp/keybindings.json"));
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("/keybindings reload"));
	});

	it("reloads keybindings through the app context", async () => {
		const reloadKeybindings = vi.fn(async () => ({
			filePath: "/tmp/keybindings.json",
			found: true,
			definitions: DEFAULT_KEYBINDING_DEFINITIONS.map((definition) => ({
				...definition,
				aliases: [...definition.aliases],
			})),
			skipped: ["app.ghost-action (unknown action)"],
		}));
		const { commands, addInfoMessage } = createContext({ reloadKeybindings });

		await commands.execute("/keybindings reload");

		expect(reloadKeybindings).toHaveBeenCalledOnce();
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Keybindings reloaded."));
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("app.ghost-action"));
	});
});
