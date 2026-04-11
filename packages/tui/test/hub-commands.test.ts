import type { Message } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { artifactStoreMock, gitBranchMock, gitDiffMock, gitStatusMock } = vi.hoisted(() => ({
	artifactStoreMock: {
		manifest: vi.fn(),
		load: vi.fn(),
		setPromoted: vi.fn(),
	},
	gitBranchMock: vi.fn(),
	gitDiffMock: vi.fn(),
	gitStatusMock: vi.fn(),
}));

vi.mock("@takumi/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@takumi/core")>();
	return {
		...actual,
		ArtifactStore: vi.fn(function MockArtifactStore() {
			return artifactStoreMock;
		}),
	};
});

vi.mock("@takumi/bridge", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@takumi/bridge")>();
	return {
		...actual,
		gitBranch: gitBranchMock,
		gitDiff: gitDiffMock,
		gitStatus: gitStatusMock,
	};
});

import { registerHubCommands } from "../src/commands/app-commands-hub.js";
import { registerSideLaneCommands } from "../src/commands/app-commands-side-lanes.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function lastInfoText(state: AppState): string {
	const message = [...state.messages.value].reverse().find((entry) => entry.id.startsWith("info-"));
	if (!message) return "";
	const block = message.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

function createContext() {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	state.sessionId.value = "sess-1";

	const ctx = {
		commands,
		state,
		agentRunner: null,
		config: {} as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text: string) => {
			const message: Message = {
				id: `info-${Date.now()}`,
				role: "assistant",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
			};
			state.addMessage(message);
		},
		buildSessionData: vi.fn(),
		startAutoSaver: vi.fn(),
		quit: vi.fn(),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	};

	registerHubCommands(ctx as never);
	return { commands, state };
}

describe("hub slash commands", () => {
	beforeEach(() => {
		artifactStoreMock.manifest.mockReset();
		artifactStoreMock.load.mockReset();
		artifactStoreMock.setPromoted.mockReset();
		gitBranchMock.mockReset();
		gitDiffMock.mockReset();
		gitStatusMock.mockReset();
	});

	it("lists scoped artifacts with review state", async () => {
		const { commands, state } = createContext();
		state.artifactPromotion.value = {
			status: "pending",
			pendingArtifactIds: ["art-2"],
			importedArtifactIds: ["art-1"],
		};
		artifactStoreMock.manifest.mockResolvedValue([
			{
				artifactId: "art-1",
				kind: "validation",
				producer: "takumi.exec",
				createdAt: "2025-03-01T10:00:00.000Z",
				summary: "Validate the operator board route summary.",
				promoted: true,
				importStatus: "imported",
				contentHash: "hash-1",
			},
			{
				artifactId: "art-2",
				kind: "plan",
				producer: "takumi.exec",
				createdAt: "2025-03-01T09:00:00.000Z",
				summary: "Add a drill-down for operator review.",
				promoted: false,
				importStatus: "pending",
				contentHash: "hash-2",
			},
		]);

		await commands.execute("/artifacts");

		const output = lastInfoText(state);
		expect(output).toContain("## Hub Artifacts (2)");
		expect(output).toContain("Review: pending • 1 pending • 1 imported");
		expect(output).toContain("validation");
		expect(output).toContain("promoted/imported");
		expect(output).toContain("Add a drill-down for operator review");
	});

	it("inspects an artifact by ordinal and renders diff content", async () => {
		const { commands, state } = createContext();
		state.artifactPromotion.value = {
			status: "ready",
			pendingArtifactIds: [],
			importedArtifactIds: ["art-1"],
		};
		artifactStoreMock.manifest.mockResolvedValue([
			{
				artifactId: "art-1",
				kind: "validation",
				producer: "takumi.exec",
				createdAt: "2025-03-01T10:00:00.000Z",
				summary: "Validation diff for the review surface.",
				promoted: false,
				importStatus: "imported",
				contentHash: "hash-1",
			},
		]);
		artifactStoreMock.load.mockResolvedValue({
			artifactId: "art-1",
			kind: "validation",
			producer: "takumi.exec",
			createdAt: "2025-03-01T10:00:00.000Z",
			summary: "Validation diff for the review surface.",
			promoted: false,
			importStatus: "imported",
			body: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
			path: "src/a.ts",
			contentHash: "hash-1",
			metadata: { status: "passed" },
		});

		await commands.execute("/artifacts inspect 1");

		const output = lastInfoText(state);
		expect(output).toContain("## Artifact Review");
		expect(output).toContain("Artifact ID: art-1");
		expect(output).toContain("Path: src/a.ts");
		expect(output).toContain("### Metadata");
		expect(output).toContain("```diff");
		expect(output).toContain("diff --git a/src/a.ts b/src/a.ts");
	});

	it("promotes an artifact by id", async () => {
		const { commands, state } = createContext();
		artifactStoreMock.load.mockResolvedValue({
			artifactId: "art-2",
			kind: "plan",
			producer: "takumi.exec",
			createdAt: "2025-03-01T09:00:00.000Z",
			summary: "Add a drill-down for operator review.",
			promoted: false,
			contentHash: "hash-2",
		});
		artifactStoreMock.setPromoted.mockResolvedValue(true);

		await commands.execute("/artifacts promote art-2");

		expect(artifactStoreMock.setPromoted).toHaveBeenCalledWith("art-2", true);
		expect(lastInfoText(state)).toContain("Promoted art-2");
	});

	it("shows repo review output from shared git state", async () => {
		const { commands, state } = createContext();
		gitBranchMock.mockReturnValue("main");
		gitStatusMock.mockReturnValue({
			branch: "main",
			staged: ["src/a.ts"],
			modified: ["src/b.ts"],
			untracked: ["notes.md"],
			deleted: [],
			renamed: [],
			copied: [],
			conflicted: [],
			isClean: false,
		});
		gitDiffMock.mockImplementation((_cwd: string, staged?: boolean) =>
			staged ? "diff --git a/src/a.ts b/src/a.ts\n+stage\n" : "diff --git a/src/b.ts b/src/b.ts\n+work\n",
		);

		await commands.execute("/artifacts review");

		const output = lastInfoText(state);
		expect(output).toContain("## Review Surface");
		expect(output).toContain("Branch: main");
		expect(output).toContain("Staged files: src/a.ts");
		expect(output).toContain("Modified files: src/b.ts");
		expect(output).toContain("### Staged diff");
		expect(output).toContain("### Working diff");
	});

	it("offers completions for artifact actions and targets", async () => {
		const { commands } = createContext();
		artifactStoreMock.manifest.mockResolvedValue([
			{
				artifactId: "art-9",
				kind: "summary",
				producer: "takumi.exec",
				createdAt: "2025-03-01T11:00:00.000Z",
				summary: "Summarize operator work.",
				promoted: false,
				contentHash: "hash-9",
			},
		]);

		await expect(commands.get("/artifacts")?.getArgumentCompletions?.("ins")).resolves.toContain("inspect ");
		await expect(commands.get("/artifacts")?.getArgumentCompletions?.("promote ")).resolves.toContain("art-9 ");
	});

	it("keeps /lanes reserved for tracked side-lane listing", () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const ctx = {
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage: vi.fn(),
			buildSessionData: vi.fn(),
			startAutoSaver: vi.fn(),
			quit: vi.fn(),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		};

		registerSideLaneCommands(ctx as never);
		registerHubCommands(ctx as never);

		expect(commands.get("/lanes")?.name).toBe("/lane-list");
		expect(commands.get("/lane")?.name).toBe("/lane");
	});

	it("shows legacy guidance for /lane without stealing tracked lane vocabulary", async () => {
		const { commands, state } = createContext();

		await commands.execute("/lane");

		const output = lastInfoText(state);
		expect(output).toContain("Routing drill-down now lives under `/route`");
		expect(output).toContain("/lanes");
		expect(output).toContain("/lane-show <id>");
	});
});
