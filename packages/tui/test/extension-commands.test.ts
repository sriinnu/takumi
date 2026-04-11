import type { ExtensionRunner, LoadedExtension } from "@takumi/agent";
import { describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/commands/app-command-context.js";
import { registerExtensionInspectionCommands } from "../src/commands/app-commands-extension-inspection.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

/**
 * I build a minimal command context for extension inspection tests.
 */
function createContext(options?: { extensionRunner?: ExtensionRunner | null }) {
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];
	const ctx: AppCommandContext = {
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
		} as AppCommandContext["config"],
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text) => infoMessages.push(text),
		buildSessionData: vi.fn() as AppCommandContext["buildSessionData"],
		startAutoSaver: vi.fn(),
		quit: vi.fn(async () => undefined),
		getExtensionRunner: () => options?.extensionRunner ?? null,
		getConventionFiles: () => null,
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => null,
		setActiveAutocycle: vi.fn(),
	};
	registerExtensionInspectionCommands(ctx);
	return { commands, infoMessages };
}

/**
 * I create a lightweight extension runner mock with loaded extensions.
 */
function createExtensionRunner(extensions: LoadedExtension[]): ExtensionRunner {
	return { _extensions: extensions } as ExtensionRunner;
}

function createLoadedExtension(overrides: Partial<LoadedExtension> = {}): LoadedExtension {
	return {
		path: "/repo/.takumi/extensions/sample-extension.ts",
		resolvedPath: "/repo/.takumi/extensions/sample-extension.ts",
		handlers: new Map([
			["session_start", [() => undefined]],
			["agent_end", [() => undefined, () => undefined]],
		]),
		tools: new Map([["sample.lookup", { name: "sample.lookup" } as never]]),
		commands: new Map([
			[
				"/sample",
				{
					name: "/sample",
					description: "Sample extension command",
					handler: async () => undefined,
				},
			],
		]),
		shortcuts: new Map([
			[
				"ctrl+shift+s",
				{
					key: "ctrl+shift+s",
					description: "Sample extension shortcut",
					extensionPath: "/repo/.takumi/extensions/sample-extension.ts",
					handler: () => undefined,
				},
			],
		]),
		manifest: {
			name: "sample-extension",
			version: "1.2.3",
			description: "Shows extension status.",
			author: "Takumi",
			homepage: "https://example.com/sample-extension",
		},
		_actions: {
			sendUserMessage: () => undefined,
			getActiveTools: () => [],
			setActiveTools: () => undefined,
			exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
			getSessionName: () => undefined,
			setSessionName: () => undefined,
		},
		...overrides,
	};
}

describe("/extensions command", () => {
	it("registers builtin pack metadata", () => {
		const { commands } = createContext();

		expect(commands.get("/extensions")?.source).toBe("builtin");
		expect(commands.get("/extensions")?.packId).toBe("builtin.extensions");
		expect(commands.get("/extensions")?.packLabel).toBe("Extensions");
		expect(commands.get("/extensions")?.requestedName).toBe("/extensions");
	});

	it("reports when no extension runtime is active", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/extensions");

		expect(infoMessages).toEqual(["No extension runtime is active."]);
	});

	it("lists loaded extensions with aggregate counts", async () => {
		const extensionRunner = createExtensionRunner([createLoadedExtension()]);
		const { commands, infoMessages } = createContext({ extensionRunner });

		await commands.execute("/extensions");

		expect(infoMessages[0]).toContain("Extensions: 1");
		expect(infoMessages[0]).toContain("Commands: 1");
		expect(infoMessages[0]).toContain("Shortcuts: 1");
		expect(infoMessages[0]).toContain("Tools: 1");
		expect(infoMessages[0]).toContain("Handlers: 3");
		expect(infoMessages[0]).toContain("1. sample-extension@1.2.3");
	});

	it("shows detailed extension metadata for a selected extension", async () => {
		const extensionRunner = createExtensionRunner([createLoadedExtension()]);
		const { commands, infoMessages } = createContext({ extensionRunner });

		await commands.execute("/extensions show sample-extension");

		expect(infoMessages[0]).toContain("sample-extension@1.2.3");
		expect(infoMessages[0]).toContain("Description: Shows extension status.");
		expect(infoMessages[0]).toContain("Commands (1): /sample");
		expect(infoMessages[0]).toContain("Shortcuts (1): ctrl+shift+s");
		expect(infoMessages[0]).toContain("Tools (1): sample.lookup");
		expect(infoMessages[0]).toContain("Handlers (3): agent_end, session_start");
	});

	it("shows residency and package metadata for package-backed extensions", async () => {
		const extensionRunner = createExtensionRunner([
			createLoadedExtension({
				path: "/repo/.takumi/packages/review-kit/index.mjs",
				resolvedPath: "/repo/.takumi/packages/review-kit/index.mjs",
				origin: {
					residency: "package",
					packageId: "@takumi/review-kit",
					packageName: "@takumi/review-kit",
					packageSource: "project",
				},
			}),
		]);
		const { commands, infoMessages } = createContext({ extensionRunner });

		await commands.execute("/extensions show sample-extension");

		expect(infoMessages[0]).toContain("Residency: package:@takumi/review-kit [project]");
		expect(infoMessages[0]).toContain("Package: @takumi/review-kit");
		expect(infoMessages[0]).toContain("Package source: project");
		expect(infoMessages[0]).toContain("Path: /repo/.takumi/packages/review-kit/index.mjs");
	});

	it("shows registered slash command names when extension commands were renamed", async () => {
		const extensionRunner = createExtensionRunner([createLoadedExtension()]);
		const { commands, infoMessages } = createContext({ extensionRunner });
		commands.register("/sample.sample-extension", "Renamed sample extension command", vi.fn(), {
			metadata: {
				source: "external",
				packId: "extension:sample-extension",
				packLabel: "sample-extension",
				requestedName: "/sample",
				residency: "project",
			},
		});

		await commands.execute("/extensions show sample-extension");

		expect(infoMessages[0]).toContain("Requested commands (1): /sample");
		expect(infoMessages[0]).toContain("Registered slash commands (1): /sample.sample-extension (requested /sample)");
	});

	it("reports invalid selectors cleanly", async () => {
		const extensionRunner = createExtensionRunner([createLoadedExtension()]);
		const { commands, infoMessages } = createContext({ extensionRunner });

		await commands.execute("/extensions show missing-extension");

		expect(infoMessages[0]).toContain("Unknown extension: missing-extension");
	});
});
