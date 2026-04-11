import type { SessionData } from "@takumi/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/commands/app-command-context.js";
import { registerSessionTreeCommands } from "../src/commands/app-commands-tree.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

const treeSwitchMocks = vi.hoisted(() => ({
	loadSession: vi.fn(),
	saveSession: vi.fn(),
}));

vi.mock("@takumi/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@takumi/core")>();
	return {
		...actual,
		loadSession: treeSwitchMocks.loadSession,
		saveSession: treeSwitchMocks.saveSession,
	};
});

function buildSession(id: string, messages: SessionData["messages"] = []): SessionData {
	return {
		id,
		title: `Session ${id}`,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		messages,
		model: "claude-sonnet-4-20250514",
		tokenUsage: {
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
		},
	};
}

function buildMessage(id: string, role: "user" | "assistant", text: string) {
	return {
		id,
		role,
		content: [{ type: "text" as const, text }],
		timestamp: Date.now(),
	};
}

function createContext(overrides: Partial<AppCommandContext> = {}) {
	const commands = new SlashCommandRegistry();
	const state = overrides.state ?? new AppState();
	const ctx: AppCommandContext = {
		commands,
		state,
		agentRunner: null,
		config: {} as AppCommandContext["config"],
		autoPr: false,
		autoShip: false,
		addInfoMessage: vi.fn(),
		buildSessionData: vi.fn(() => buildSession(state.sessionId.value || "session-current")) as never,
		startAutoSaver: vi.fn(),
		quit: vi.fn(async () => undefined),
		getExtensionRunner: () => null,
		getConventionFiles: () => null,
		getActiveCoder: () => null,
		setActiveCoder: vi.fn(),
		getActiveAutocycle: () => null,
		setActiveAutocycle: vi.fn(),
		...overrides,
	};
	registerSessionTreeCommands(ctx);
	return { commands, state, ctx };
}

describe("session tree switching", () => {
	beforeEach(() => {
		treeSwitchMocks.loadSession.mockReset();
		treeSwitchMocks.saveSession.mockReset();
	});

	it("routes /switch through the app-level activateSession handler when available", async () => {
		const targetSession = buildSession("session-next", [
			buildMessage("u1", "user", "hello"),
			buildMessage("a1", "assistant", "hi"),
		]);
		const state = new AppState();
		const addInfoMessage = vi.fn();
		const activateSession = vi.fn(async () => undefined);

		state.sessionId.value = "session-current";
		treeSwitchMocks.loadSession.mockResolvedValue(targetSession);
		treeSwitchMocks.saveSession.mockResolvedValue(undefined);

		const { commands } = createContext({ state, addInfoMessage, activateSession });

		await commands.execute("/switch session-next");

		expect(treeSwitchMocks.saveSession).toHaveBeenCalledOnce();
		expect(activateSession).toHaveBeenCalledWith(
			targetSession,
			expect.stringContaining("Switched to session: Session session-next"),
			"resume",
		);
		expect(addInfoMessage).not.toHaveBeenCalled();
	});

	it("recomputes turn count when /switch falls back to local session restore", async () => {
		const messages = [
			buildMessage("u1", "user", "hello"),
			buildMessage("a1", "assistant", "hi"),
			buildMessage("u2", "user", "show tree"),
		];
		const targetSession = buildSession("session-next", messages);
		const state = new AppState();
		const hydrateHistory = vi.fn();

		state.sessionId.value = "session-current";
		state.turnCount.value = 99;
		treeSwitchMocks.loadSession.mockResolvedValue(targetSession);
		treeSwitchMocks.saveSession.mockResolvedValue(undefined);

		const { commands } = createContext({
			state,
			agentRunner: { hydrateHistory } as never,
		});

		await commands.execute("/switch session-next");

		expect(state.sessionId.value).toBe("session-next");
		expect(state.turnCount.value).toBe(2);
		expect(hydrateHistory).toHaveBeenCalledWith(messages);
	});
});
