import type { ConventionFiles, ExtensionRunner, LoadedExtension, LoadedTakumiPackage } from "@takumi/agent";
import type { ToolDefinition } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/app-command-context.js";
import type { PackageInspection } from "../src/app-package-inspector.js";

const packageInspectorMocks = vi.hoisted(() => ({
	inspectTakumiPackages: vi.fn(),
	formatPackageList: vi.fn(),
	formatPackageSummary: vi.fn(),
	formatPackageDetail: vi.fn(),
	selectTakumiPackage: vi.fn(),
}));

vi.mock("../src/app-package-inspector.js", () => ({
	inspectTakumiPackages: packageInspectorMocks.inspectTakumiPackages,
	formatPackageList: packageInspectorMocks.formatPackageList,
	formatPackageSummary: packageInspectorMocks.formatPackageSummary,
	formatPackageDetail: packageInspectorMocks.formatPackageDetail,
	selectTakumiPackage: packageInspectorMocks.selectTakumiPackage,
}));

import { registerExtensionCommands } from "../src/app-commands-extensions.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { AppState } from "../src/state.js";

/**
 * I build a minimal command context for extension command tests.
 */
function createContext(options?: {
	extensionRunner?: ExtensionRunner | null;
	agentRunner?: AppCommandContext["agentRunner"];
	conventionFiles?: ConventionFiles | null;
}) {
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];
	const ctx: AppCommandContext = {
		commands,
		state: new AppState(),
		agentRunner: options?.agentRunner ?? null,
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
		getConventionFiles: () => options?.conventionFiles ?? null,
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => null,
		setActiveAutocycle: vi.fn(),
	};
	registerExtensionCommands(ctx);
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

function createConventionFiles(overrides: Partial<ConventionFiles> = {}): ConventionFiles {
	return {
		systemPromptAddon: "Project prompt addon",
		toolRules: [{ tool: "bash", requiresPermission: true, reason: "Shell commands stay gated" }],
		skills: [
			{
				name: "Code Review",
				description: "Review diffs for correctness and regressions.",
				prompt: "Review code carefully.",
				path: "/repo/.takumi/skills/code-review.md",
				alwaysOn: true,
				tags: ["review", "quality"],
				source: "project",
			},
		],
		skillsPromptAddon: "## Skills\n- Code Review",
		loadedFiles: ["/repo/.takumi/system-prompt.md", "/repo/.takumi/skills/code-review.md"],
		...overrides,
	};
}

function createPackageInspection(overrides: Partial<PackageInspection> = {}): PackageInspection {
	return {
		packages: [],
		errors: [],
		...overrides,
	};
}

function createLoadedPackage(overrides: Partial<LoadedTakumiPackage> = {}): LoadedTakumiPackage {
	return {
		rootPath: "/repo/.takumi/packages/sample",
		manifestPath: "/repo/.takumi/packages/sample/package.json",
		packageName: "@takumi/sample-package",
		description: "Sample Takumi package",
		version: "0.2.0",
		source: "project",
		resources: {
			extensions: ["./index.mjs"],
			skills: ["./skills"],
			systemPrompt: "./system-prompt.md",
			toolRules: "./tool-rules.json",
		},
		governance: {
			provenance: "local",
			capabilitiesRequested: ["workflow.review"],
			compatibility: { takumi: "^0.1.0", packageApi: "1" },
			evals: { coverage: ["smoke"], score: 0.91, suite: "local-smoke" },
			maintainer: "takumi-team",
		},
		extensions: ["/repo/.takumi/packages/sample/index.mjs"],
		skillPaths: ["/repo/.takumi/packages/sample/skills/review.md"],
		systemPromptPath: "/repo/.takumi/packages/sample/system-prompt.md",
		toolRulesPath: "/repo/.takumi/packages/sample/tool-rules.json",
		warnings: [],
		...overrides,
	};
}

beforeEach(() => {
	packageInspectorMocks.inspectTakumiPackages.mockReset();
	packageInspectorMocks.formatPackageList.mockReset();
	packageInspectorMocks.formatPackageSummary.mockReset();
	packageInspectorMocks.formatPackageDetail.mockReset();
	packageInspectorMocks.selectTakumiPackage.mockReset();
});

describe("/extensions command", () => {
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

	it("reports invalid selectors cleanly", async () => {
		const extensionRunner = createExtensionRunner([createLoadedExtension()]);
		const { commands, infoMessages } = createContext({ extensionRunner });

		await commands.execute("/extensions show missing-extension");

		expect(infoMessages[0]).toContain("Unknown extension: missing-extension");
	});

	it("lists loaded tools from the live registry", async () => {
		const toolDefinitions: ToolDefinition[] = [
			{
				name: "read",
				description: "Read a file",
				inputSchema: { file_path: { type: "string" } },
				requiresPermission: false,
				category: "read",
			},
			{
				name: "bash",
				description: "Run shell commands",
				inputSchema: { command: { type: "string" } },
				requiresPermission: true,
				category: "execute",
			},
		];
		const toolRegistry = { getDefinitions: () => toolDefinitions };
		const agentRunner = { getTools: () => toolRegistry } as AppCommandContext["agentRunner"];
		const { commands, infoMessages } = createContext({ agentRunner, extensionRunner: createExtensionRunner([]) });

		await commands.execute("/tools");

		expect(infoMessages[0]).toContain("Tools: 2");
		expect(infoMessages[0]).toContain("Permission-gated: 1");
		expect(infoMessages[0]).toContain("bash  [execute] [permission]");
		expect(infoMessages[0]).toContain("read  [read] [no-permission]");
	});

	it("shows tool details for a selected tool", async () => {
		const toolDefinitions: ToolDefinition[] = [
			{
				name: "mcp.search",
				description: "Search a connected MCP surface",
				inputSchema: { query: { type: "string" }, limit: { type: "number" } },
				requiresPermission: false,
				category: "search",
			},
		];
		const toolRegistry = { getDefinitions: () => toolDefinitions };
		const agentRunner = { getTools: () => toolRegistry } as AppCommandContext["agentRunner"];
		const { commands, infoMessages } = createContext({ agentRunner });

		await commands.execute("/tools show mcp.search");

		expect(infoMessages[0]).toContain("mcp.search");
		expect(infoMessages[0]).toContain("Category: search");
		expect(infoMessages[0]).toContain("Inputs: limit, query");
		expect(infoMessages[0]).toContain("Description: Search a connected MCP surface");
	});

	it("lists loaded local skills", async () => {
		const { commands, infoMessages } = createContext({ conventionFiles: createConventionFiles() });

		await commands.execute("/skills");

		expect(infoMessages[0]).toContain("Skills: 1");
		expect(infoMessages[0]).toContain("Always-on: 1");
		expect(infoMessages[0]).toContain("1. Code Review [always-on] [project] [review, quality]");
	});

	it("shows details for a selected skill", async () => {
		const { commands, infoMessages } = createContext({ conventionFiles: createConventionFiles() });

		await commands.execute("/skills show Code Review");

		expect(infoMessages[0]).toContain("Code Review");
		expect(infoMessages[0]).toContain("Always-on: yes");
		expect(infoMessages[0]).toContain("Tags: review, quality");
		expect(infoMessages[0]).toContain("/repo/.takumi/skills/code-review.md");
	});

	it("shows loaded convention files", async () => {
		const { commands, infoMessages } = createContext({ conventionFiles: createConventionFiles() });

		await commands.execute("/conventions");

		expect(infoMessages[0]).toContain("Convention files");
		expect(infoMessages[0]).toContain("Loaded files: 2");
		expect(infoMessages[0]).toContain("Tool rules: 1");
		expect(infoMessages[0]).toContain("/repo/.takumi/system-prompt.md");
	});

	it("lists discovered Takumi packages", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		packageInspectorMocks.formatPackageList.mockReturnValue("Packages: 1\n1. @takumi/sample-package@0.2.0");
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages");

		expect(packageInspectorMocks.inspectTakumiPackages).toHaveBeenCalledOnce();
		expect(packageInspectorMocks.formatPackageList).toHaveBeenCalledWith(inspection);
		expect(infoMessages).toEqual(["Packages: 1\n1. @takumi/sample-package@0.2.0"]);
	});

	it("shows package summary on demand", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		packageInspectorMocks.formatPackageSummary.mockReturnValue("Packages: 1\nWarnings: 0\nErrors: 0");
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages summary");

		expect(packageInspectorMocks.formatPackageSummary).toHaveBeenCalledWith(inspection);
		expect(infoMessages).toEqual(["Packages: 1\nWarnings: 0\nErrors: 0"]);
	});

	it("shows package details for a selected package", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		const selected = createLoadedPackage();
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		packageInspectorMocks.selectTakumiPackage.mockReturnValue(selected);
		packageInspectorMocks.formatPackageDetail.mockReturnValue("@takumi/sample-package\nSource: project/local");
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages show sample-package");

		expect(packageInspectorMocks.selectTakumiPackage).toHaveBeenCalledWith(inspection, "sample-package");
		expect(packageInspectorMocks.formatPackageDetail).toHaveBeenCalledWith(selected);
		expect(infoMessages).toEqual(["@takumi/sample-package\nSource: project/local"]);
	});

	it("reports invalid package selectors cleanly", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		packageInspectorMocks.selectTakumiPackage.mockReturnValue(null);
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages show missing-package");

		expect(infoMessages[0]).toContain("Unknown package: missing-package");
	});

	it("offers live package argument completions", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		const { commands } = createContext();

		expect(commands.get("/packages")?.getArgumentCompletions?.("show sample")).toEqual(["show @takumi/sample-package"]);
	});
});
