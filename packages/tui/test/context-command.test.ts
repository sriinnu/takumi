import { describe, expect, it, vi } from "vitest";
import { registerContextCommands } from "../src/commands/app-commands-context.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function createContext(config: Record<string, unknown> = {}) {
	const commands = new SlashCommandRegistry();
	const infoMessages: string[] = [];
	const state = new AppState();

	registerContextCommands({
		commands,
		state,
		agentRunner: null,
		config: {
			provider: "openai",
			model: "gpt-5",
			theme: "default",
			thinking: false,
			thinkingBudget: 0,
			systemPrompt: "",
			workingDirectory: "/repo",
			...config,
		} as never,
		autoPr: false,
		autoShip: false,
		addInfoMessage: (text) => infoMessages.push(text),
		buildSessionData: vi.fn() as never,
		startAutoSaver: vi.fn(),
		quit: vi.fn(async () => undefined),
		getExtensionRunner: vi.fn().mockReturnValue(null),
		getConventionFiles: vi.fn().mockReturnValue(null),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	} as never);

	return { commands, infoMessages, state };
}

describe("/context command", () => {
	it("shows an honest unmeasured state before telemetry exists", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/context");

		expect(infoMessages[0]).toContain("Usage        not measured yet in this runtime");
		expect(infoMessages[0]).toContain("Hub          standalone");
		expect(infoMessages[0]).toContain("Advice       Live context telemetry appears after usage updates");
	});

	it("reports live context, budget, and tracked side lanes", async () => {
		const { commands, infoMessages, state } = createContext({ maxCostUsd: 1 });
		state.sessionId.value = "session-123";
		state.canonicalSessionId.value = "canonical-456";
		state.chitraguptaConnected.value = true;
		state.turnCount.value = 4;
		state.messages.value = [{} as never, {} as never, {} as never];
		state.totalInputTokens.value = 6_000;
		state.totalOutputTokens.value = 2_000;
		state.contextTokens.value = 85_000;
		state.contextWindow.value = 200_000;
		state.contextPercent.value = 42.5;
		state.contextPressure.value = "normal";
		state.sideLanes.upsert({ id: "lane-1", commandName: "/lane", state: "running", tmuxWindow: "win-1" });
		state.setCostSnapshot({
			totalUsd: 0.12,
			totalInputTokens: 6_000,
			totalOutputTokens: 2_000,
			turns: [],
			ratePerMinute: 0.15,
			projectedUsd: 1.62,
			budgetFraction: 0.12,
			alertLevel: "warning",
			avgCostPerTurn: 0.03,
			elapsedSeconds: 45,
		});

		await commands.execute("/context");

		const text = infoMessages[0];
		expect(text).toContain("Session      session-123");
		expect(text).toContain("Canonical    canonical-456");
		expect(text).toContain("Hub          connected");
		expect(text).toContain("Usage        85,000 / 200,000 (42.5%)");
		expect(text).toContain("Budget       $1.00 (12.0% used");
		expect(text).toContain("Projected    $1.62 (10m horizon)");
		expect(text).toContain("Side lanes   1 tracked (/lane:running@win-1)");
	});

	it("warns clearly when context is near the limit", async () => {
		const { commands, infoMessages, state } = createContext();
		state.contextTokens.value = 192_000;
		state.contextWindow.value = 200_000;
		state.contextPercent.value = 96.1;
		state.contextPressure.value = "near_limit";

		await commands.execute("/context");

		expect(infoMessages[0]).toContain("Pressure     Near limit");
		expect(infoMessages[0]).toContain("Advice       Context is very tight; compact or hand off now.");
	});

	it("reports replay failure diagnostics honestly", async () => {
		const { commands, infoMessages, state } = createContext();
		state.sessionId.value = "session-456";
		state.canonicalSessionId.value = "canonical-789";
		state.chitraguptaConnected.value = true;
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "First turn" }],
				timestamp: 1000,
				sessionTurn: true,
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: [{ type: "text", text: "Second turn" }],
				timestamp: 2000,
				sessionTurn: true,
			},
		];
		state.chitraguptaSync.value = {
			status: "failed",
			lastSyncedMessageId: "user-1",
			lastSyncedMessageTimestamp: 1000,
			lastFailedMessageId: "assistant-1",
			lastFailedMessageTimestamp: 2000,
			lastError: "daemon write failed",
		};

		await commands.execute("/context");

		expect(infoMessages[0]).toContain("Sync         failed (1 pending, stalled on assistant-1): daemon write failed");
	});

	it("shows usage guidance for invalid arguments", async () => {
		const { commands, infoMessages } = createContext();

		await commands.execute("/context now");

		expect(infoMessages).toEqual(["Usage: /context"]);
	});
});
