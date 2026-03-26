import { describe, expect, it, vi } from "vitest";
import { registerExtensionHostSurfaces } from "../src/app-extension-host.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { KeyBindingRegistry } from "../src/keybinds.js";
import { AppState } from "../src/state.js";

function createExtensionRunner(options: {
	commands?: Array<{
		name: string;
		extensionPath: string;
		description?: string;
		handler?: (...args: any[]) => Promise<void>;
	}>;
	shortcuts?: Array<{ key: string; extensionPath: string; description?: string; handler?: () => Promise<void> | void }>;
}) {
	const commandEntries =
		options.commands?.map(({ extensionPath, description, handler, name }) => [
			name,
			{
				extensionPath,
				command: {
					name,
					description,
					handler: handler ?? (async () => undefined),
				},
			},
		]) ?? [];
	const shortcutEntries =
		options.shortcuts?.map(({ description, extensionPath, handler, key }) => [
			key,
			{
				key,
				description,
				extensionPath,
				handler: handler ?? (() => undefined),
			},
		]) ?? [];

	return {
		getAllCommands: () => new Map(commandEntries),
		getAllShortcuts: () => new Map(shortcutEntries),
		createContext: () => ({
			get cwd() {
				return "/repo";
			},
			get model() {
				return "gpt-4.1";
			},
			get sessionId() {
				return "session-1";
			},
			isIdle: () => true,
			abort: () => undefined,
			getContextUsage: () => undefined,
			getSystemPrompt: () => "system",
			compact: () => undefined,
			shutdown: () => undefined,
			get hasUI() {
				return false;
			},
			notify: () => undefined,
			ui: {
				confirm: async () => false,
				pick: async () => undefined,
				setWidget: () => undefined,
				removeWidget: () => undefined,
			},
			session: {
				getSnapshot: () => undefined,
				getName: () => undefined,
				setName: () => undefined,
			},
		}),
	} as any;
}

describe("registerExtensionHostSurfaces", () => {
	it("registers extension commands with command context helpers", async () => {
		const commands = new SlashCommandRegistry();
		const keybinds = new KeyBindingRegistry();
		const state = new AppState();
		const handler = vi.fn(async (_args, ctx) => {
			expect(ctx.cwd).toBe("/repo");
			expect(typeof ctx.waitForIdle).toBe("function");
			expect(typeof ctx.newSession).toBe("function");
			expect(typeof ctx.switchSession).toBe("function");
		});

		const report = registerExtensionHostSurfaces({
			extensionRunner: createExtensionRunner({
				commands: [{ name: "hello", extensionPath: "/tmp/sample-extension.ts", description: "Say hello", handler }],
			}),
			commands,
			keybinds,
			state,
			addInfoMessage: vi.fn(),
			activateSession: vi.fn(async () => undefined),
			resumeSession: vi.fn(async () => undefined),
		});

		expect(report.commandCount).toBe(1);
		expect(commands.has("/hello")).toBe(true);
		await commands.execute("/hello world");
		expect(handler).toHaveBeenCalledOnce();
		expect(handler.mock.calls[0]?.[0]).toBe("world");
	});

	it("renames conflicting extension commands instead of clobbering built-ins", async () => {
		const commands = new SlashCommandRegistry();
		commands.register("/help", "Built-in help", vi.fn());

		registerExtensionHostSurfaces({
			extensionRunner: createExtensionRunner({
				commands: [{ name: "help", extensionPath: "/tmp/sample-extension.ts", description: "Extension help" }],
			}),
			commands,
			keybinds: new KeyBindingRegistry(),
			state: new AppState(),
			addInfoMessage: vi.fn(),
			activateSession: vi.fn(async () => undefined),
			resumeSession: vi.fn(async () => undefined),
		});

		const extensionCommand = commands
			.list()
			.find((command) => command.name !== "/help" && command.description.includes("requested /help"));
		expect(extensionCommand?.name).toMatch(/^\/help\./);
	});

	it("registers non-conflicting extension shortcuts and skips collisions", async () => {
		const keybinds = new KeyBindingRegistry();
		const builtin = vi.fn();
		const shortcutHandler = vi.fn();
		keybinds.register("ctrl+k", "Command palette", builtin);

		const report = registerExtensionHostSurfaces({
			extensionRunner: createExtensionRunner({
				shortcuts: [
					{ key: "ctrl+k", extensionPath: "/tmp/sample-extension.ts", description: "Conflicting shortcut" },
					{
						key: "ctrl+g",
						extensionPath: "/tmp/sample-extension.ts",
						description: "Extension shortcut",
						handler: shortcutHandler,
					},
				],
			}),
			commands: new SlashCommandRegistry(),
			keybinds,
			state: new AppState(),
			addInfoMessage: vi.fn(),
			activateSession: vi.fn(async () => undefined),
			resumeSession: vi.fn(async () => undefined),
		});

		expect(report.shortcutCount).toBe(1);
		expect(report.skippedShortcuts).toEqual(["ctrl+k (sample-extension)"]);
		keybinds.get("ctrl+g")?.handler();
		expect(shortcutHandler).toHaveBeenCalledOnce();
		expect(builtin).not.toHaveBeenCalled();
	});
});
