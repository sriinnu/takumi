import type { ConventionFiles } from "@takumi/agent";
import { describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/commands/app-command-context.js";
import { registerConventionInspectionCommands } from "../src/commands/app-commands-conventions.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

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

function createContext(options?: { conventionFiles?: ConventionFiles | null }) {
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
		getConventionFiles: () => options?.conventionFiles ?? null,
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => null,
		setActiveAutocycle: vi.fn(),
	};
	registerConventionInspectionCommands(ctx);
	return { commands, infoMessages };
}

describe("convention inspection commands", () => {
	it("registers builtin pack metadata for both commands", () => {
		const { commands } = createContext({ conventionFiles: createConventionFiles() });

		expect(commands.get("/skills")?.source).toBe("builtin");
		expect(commands.get("/skills")?.packId).toBe("builtin.conventions");
		expect(commands.get("/skills")?.packLabel).toBe("Conventions");
		expect(commands.get("/conventions")?.source).toBe("builtin");
		expect(commands.get("/conventions")?.packId).toBe("builtin.conventions");
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

	it("reports when no local skills are loaded", async () => {
		const { commands, infoMessages } = createContext({ conventionFiles: createConventionFiles({ skills: [] }) });

		await commands.execute("/skills");

		expect(infoMessages).toEqual(["No local skills are loaded."]);
	});

	it("shows loaded convention files", async () => {
		const { commands, infoMessages } = createContext({ conventionFiles: createConventionFiles() });

		await commands.execute("/conventions");

		expect(infoMessages[0]).toContain("Convention files");
		expect(infoMessages[0]).toContain("Loaded files: 2");
		expect(infoMessages[0]).toContain("Tool rules: 1");
		expect(infoMessages[0]).toContain("/repo/.takumi/system-prompt.md");
	});

	it("reports when no convention files are loaded", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/conventions");

		expect(infoMessages).toEqual(["No local convention files are loaded."]);
	});
});
