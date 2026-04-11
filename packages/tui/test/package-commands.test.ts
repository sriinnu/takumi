import type { LoadedTakumiPackage } from "@takumi/agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageInspection } from "../src/app-package-inspector.js";
import type { AppCommandContext } from "../src/commands/app-command-context.js";

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

import { registerPackageInspectionCommand } from "../src/commands/app-commands-packages.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext() {
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
		getExtensionRunner: () => null,
		getConventionFiles: () => null,
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => null,
		setActiveAutocycle: vi.fn(),
	};
	registerPackageInspectionCommand(ctx);
	return { commands, infoMessages };
}

function createPackageInspection(overrides: Partial<PackageInspection> = {}): PackageInspection {
	return {
		packages: [],
		shadowedPackages: [],
		conflicts: [],
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

describe("/packages command", () => {
	it("registers builtin pack metadata", () => {
		const { commands } = createContext();

		expect(commands.get("/packages")?.source).toBe("builtin");
		expect(commands.get("/packages")?.packId).toBe("builtin.packages");
		expect(commands.get("/packages")?.packLabel).toBe("Packages");
		expect(commands.get("/packages")?.requestedName).toBe("/packages");
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
		packageInspectorMocks.formatPackageSummary.mockReturnValue("Packages: 1\nReady: 1\nDegraded: 0\nRejected: 0");
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages summary");

		expect(packageInspectorMocks.formatPackageSummary).toHaveBeenCalledWith(inspection);
		expect(infoMessages).toEqual(["Packages: 1\nReady: 1\nDegraded: 0\nRejected: 0"]);
	});

	it("shows package doctor output on demand", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages doctor");

		expect(infoMessages[0]).toContain("Takumi Packages");
		expect(infoMessages[0]).toContain("Discovered: 1");
		expect(infoMessages[0]).toContain("Ready:      1");
		expect(infoMessages[0]).toContain("@takumi/sample-package@0.2.0");
	});

	it("accepts validate as a doctor alias", async () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		const { commands, infoMessages } = createContext();

		await commands.execute("/packages validate");

		expect(infoMessages[0]).toContain("Takumi Packages");
		expect(infoMessages[0]).toContain("Discovered: 1");
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
		expect(packageInspectorMocks.formatPackageDetail).toHaveBeenCalledWith(selected, inspection);
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

	it("offers live package argument completions", () => {
		const inspection = createPackageInspection({ packages: [createLoadedPackage()] });
		packageInspectorMocks.inspectTakumiPackages.mockReturnValue(inspection);
		const { commands } = createContext();

		expect(commands.get("/packages")?.getArgumentCompletions?.("")).toEqual([
			"list",
			"summary",
			"doctor",
			"show @takumi/sample-package",
		]);
		expect(commands.get("/packages")?.getArgumentCompletions?.("doc")).toEqual(["doctor"]);
		expect(commands.get("/packages")?.getArgumentCompletions?.("val")).toEqual(["validate"]);
		expect(commands.get("/packages")?.getArgumentCompletions?.("show sample")).toEqual(["show @takumi/sample-package"]);
	});
});
