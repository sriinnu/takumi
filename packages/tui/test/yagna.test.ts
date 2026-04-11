import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

import type { Message, ToolDefinition, ToolResult } from "@takumi/core";
import { registerYagnaCommands } from "../src/commands/app-commands-yagna.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";
import { createYagnaSnapshot } from "../src/yagna/yagna-loop.js";
import { DEFAULT_YAGNA_CONFIG } from "../src/yagna/yagna-types.js";

/** Retrieve the text from the most recent info message in state. */
function lastInfoText(state: AppState): string {
	const message = [...state.messages.value].reverse().find((entry) => entry.id.startsWith("info-"));
	if (!message) return "";
	const block = message.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

/** Build a minimal AppCommandContext matching the interface. */
function createContext() {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	const toolDefinitions = new Map<string, ToolDefinition>();
	const toolExecute = vi.fn<(inputName: string, input: Record<string, unknown>) => Promise<ToolResult>>();
	const getDefinition = vi.fn((name: string) => toolDefinitions.get(name));
	const executeCommandTool = vi.fn((name: string, input: Record<string, unknown>) => toolExecute(name, input));

	const ctx = {
		commands,
		state,
		agentRunner: {
			isRunning: false,
			submit: vi.fn().mockResolvedValue(undefined),
			clearHistory: vi.fn(),
			checkToolPermission: vi.fn(async () => true),
			executeCommandTool,
			getTools: () => ({
				getDefinition,
				execute: (name: string, input: Record<string, unknown>) => toolExecute(name, input),
			}),
		},
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
		getExtensionRunner: vi.fn().mockReturnValue(null),
		getConventionFiles: vi.fn().mockReturnValue(null),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	};

	registerYagnaCommands(ctx as never);

	return { ctx, commands, state, toolExecute };
}

describe("yagna slash commands", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("registers /yagna with aliases /autopilot and /ap", () => {
		const { commands } = createContext();
		expect(commands.get("/yagna")).toBeDefined();
		expect(commands.get("/autopilot")).toBeDefined();
		expect(commands.get("/ap")).toBeDefined();
	});

	it("registers /tarka with aliases /duh and /argue", () => {
		const { commands } = createContext();
		expect(commands.get("/tarka")).toBeDefined();
		expect(commands.get("/duh")).toBeDefined();
		expect(commands.get("/argue")).toBeDefined();
	});

	it("registers /kriya with aliases /tf and /blitz", () => {
		const { commands } = createContext();
		expect(commands.get("/kriya")).toBeDefined();
		expect(commands.get("/tf")).toBeDefined();
		expect(commands.get("/blitz")).toBeDefined();
	});

	it("shows usage when /yagna is invoked with no topic", async () => {
		const { commands, state } = createContext();
		await commands.execute("/yagna");
		expect(lastInfoText(state)).toContain("Usage");
	});

	it("shows usage when /tarka is invoked with no topic", async () => {
		const { commands, state } = createContext();
		await commands.execute("/tarka");
		expect(lastInfoText(state)).toContain("Usage");
	});

	it("shows usage when /kriya is invoked with no topic", async () => {
		const { commands, state } = createContext();
		await commands.execute("/kriya");
		expect(lastInfoText(state)).toContain("Usage");
	});
});

describe("createYagnaSnapshot", () => {
	it("creates a snapshot with defaults", () => {
		const snap = createYagnaSnapshot("Build a p2p mesh network");
		expect(snap.topic).toBe("Build a p2p mesh network");
		expect(snap.phase).toBe("idle");
		expect(snap.subtasks).toEqual([]);
		expect(snap.config).toEqual(DEFAULT_YAGNA_CONFIG);
		expect(snap.id).toMatch(/^yagna-/);
		expect(snap.startedAt).toBeGreaterThan(0);
	});

	it("applies config overrides", () => {
		const snap = createYagnaSnapshot("topic", {
			maxTarkaRounds: 5,
			autoMerge: false,
		});
		expect(snap.config.maxTarkaRounds).toBe(5);
		expect(snap.config.autoMerge).toBe(false);
		// Non-overridden values remain at defaults.
		expect(snap.config.maxRetries).toBe(DEFAULT_YAGNA_CONFIG.maxRetries);
	});

	it("generates unique IDs", () => {
		const a = createYagnaSnapshot("a");
		const b = createYagnaSnapshot("b");
		expect(a.id).not.toBe(b.id);
	});
});
