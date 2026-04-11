import type { SessionData } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { registerCoreCommands } from "../src/commands/app-commands-core.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

describe("core session switching commands", () => {
	it("routes /session resume through the app-level resumeSession handler", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const resumeSession = vi.fn(async () => undefined);

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage: vi.fn(),
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			resumeSession,
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/session resume session-123");

		expect(resumeSession).toHaveBeenCalledOnce();
		expect(resumeSession).toHaveBeenCalledWith("session-123");
	});

	it("routes /session attach through the shared app-level resumeSession handler", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const resumeSession = vi.fn(async () => undefined);
		const addInfoMessage = vi.fn();

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			resumeSession,
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/session attach daemon-123");

		expect(addInfoMessage).toHaveBeenCalledWith("Attaching daemon session daemon-123...");
		expect(resumeSession).toHaveBeenCalledOnce();
		expect(resumeSession).toHaveBeenCalledWith("daemon-123");
	});

	it("routes forked sessions through the app-level activateSession handler", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const activateSession = vi.fn(async (_session: SessionData, _notice?: string) => undefined);
		const saveSession = vi.fn(async () => undefined);
		const forkSession = vi.fn(async (id: string) => ({
			id: `${id}-fork`,
			title: "Fork of current",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
			model: "claude-sonnet-4-20250514",
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		}));

		state.sessionId.value = "session-current";

		vi.doMock("@takumi/core", async () => {
			const actual = await vi.importActual<typeof import("@takumi/core")>("@takumi/core");
			return {
				...actual,
				saveSession,
				forkSession,
			};
		});

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage: vi.fn(),
			buildSessionData: vi.fn(() => ({
				id: state.sessionId.value,
				title: "Current",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				messages: [],
				model: "claude-sonnet-4-20250514",
				tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
			})) as never,
			startAutoSaver: vi.fn(),
			activateSession,
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/fork");

		expect(saveSession).toHaveBeenCalledOnce();
		expect(forkSession).toHaveBeenCalledWith("session-current");
		expect(activateSession).toHaveBeenCalledOnce();
		expect(activateSession.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ id: "session-current-fork" }));
		vi.doUnmock("@takumi/core");
	});

	it("uses the dynamic provider catalog when switching providers", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const addInfoMessage = vi.fn();
		state.setAvailableProviderModels({ zai: ["kimi-k2-0711-preview", "kimi-latest"] });
		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-4-20250514";

		async function* sendMessage() {
			yield* [];
		}

		registerCoreCommands({
			commands,
			state,
			agentRunner: { setSendMessageFn: vi.fn() } as never,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			providerFactory: vi.fn(async () => sendMessage),
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/provider zai");

		expect(state.provider.value).toBe("zai");
		expect(state.model.value).toBe("kimi-latest");
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Switched to provider: zai"));
	});

	it("cycles provider-scoped models via /model next and prev", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const addInfoMessage = vi.fn();
		state.setAvailableProviderModels({ anthropic: ["claude-a", "claude-b", "claude-c"] });
		state.provider.value = "anthropic";
		state.model.value = "claude-a";

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/model next");
		expect(state.model.value).toBe("claude-b");

		await commands.execute("/model prev");
		expect(state.model.value).toBe("claude-a");
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Model cycled to:"));
	});

	it("supports named thinking levels", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const addInfoMessage = vi.fn();

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/think level deep");

		expect(state.thinking.value).toBe(true);
		expect(state.thinkingBudget.value).toBe(24_000);
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Thinking level: Deep"));
	});

	it("renders grouped help output for the command cockpit", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const addInfoMessage = vi.fn();

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: {} as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/help");

		const helpText = addInfoMessage.mock.calls.at(-1)?.[0] as string;
		expect(helpText).toContain("Available commands:");
		expect(helpText).toContain("Runtime");
		expect(helpText).toContain("Sessions");
		expect(helpText).toContain("/model");
		expect(helpText).toContain("/session");
		expect(helpText).toContain("Ctrl+K opens the command palette.");
	});

	it("updates the live session budget via /budget", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const addInfoMessage = vi.fn();
		const setBudgetLimit = vi.fn();
		const config = {} as { maxCostUsd?: number };

		registerCoreCommands({
			commands,
			state,
			agentRunner: { setBudgetLimit } as never,
			config: config as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/budget 2.5");

		expect(config.maxCostUsd).toBe(2.5);
		expect(setBudgetLimit).toHaveBeenCalledWith(2.5);
		expect(addInfoMessage).toHaveBeenCalledWith(expect.stringContaining("Budget limit set to $2.5000"));
	});

	it("shows a model-aware runtime cost report via /cost", async () => {
		const commands = new SlashCommandRegistry();
		const state = new AppState();
		const addInfoMessage = vi.fn();

		state.setCostSnapshot({
			totalUsd: 0.024,
			totalInputTokens: 4_000,
			totalOutputTokens: 1_500,
			turns: [
				{
					turn: 1,
					inputTokens: 2_000,
					outputTokens: 1_000,
					cacheReadTokens: 500,
					cacheWriteTokens: 0,
					costUsd: 0.01,
					model: "claude-sonnet-4-20250514",
					timestamp: Date.now() - 1_000,
				},
				{
					turn: 2,
					inputTokens: 2_000,
					outputTokens: 500,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					costUsd: 0.014,
					model: "gpt-4o",
					timestamp: Date.now(),
				},
			],
			ratePerMinute: 0.006,
			projectedUsd: 0.084,
			budgetFraction: 0.24,
			alertLevel: "info",
			avgCostPerTurn: 0.012,
			elapsedSeconds: 120,
		});

		registerCoreCommands({
			commands,
			state,
			agentRunner: null,
			config: { maxCostUsd: 0.1 } as never,
			autoPr: false,
			autoShip: false,
			addInfoMessage,
			buildSessionData: vi.fn() as never,
			startAutoSaver: vi.fn(),
			quit: vi.fn().mockResolvedValue(undefined),
			getActiveCoder: vi.fn().mockReturnValue(null),
			setActiveCoder: vi.fn(),
			getActiveAutocycle: vi.fn().mockReturnValue(null),
			setActiveAutocycle: vi.fn(),
		} as never);

		await commands.execute("/cost");

		const report = addInfoMessage.mock.calls.at(-1)?.[0] as string;
		expect(report).toContain("Cost report");
		expect(report).toContain("By model (tracked this runtime)");
		expect(report).toContain("claude-sonnet-4-20250514");
		expect(report).toContain("gpt-4o");
		expect(report).toContain("Recent priced turns");
		expect(report).toContain("Budget");
	});
});
