import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionData, TakumiConfig } from "@takumi/core";
import { ArtifactStore } from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandContext } from "../src/app-command-context.js";
import { buildHandoffWorkState, parseHandoffArgs, registerHandoffCommands } from "../src/app-commands-handoff.js";
import { SlashCommandRegistry } from "../src/commands.js";
import { AppState } from "../src/state.js";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(() => "main\n"),
}));

function makeConfig(): TakumiConfig {
	return {
		provider: "anthropic",
		model: "claude-sonnet-4",
		theme: "default",
		thinking: false,
		thinkingBudget: 0,
	} as TakumiConfig;
}

function makeContext(state: AppState, commands: SlashCommandRegistry, activateSessionSpy = vi.fn()): AppCommandContext {
	const infoMessages: string[] = [];
	const addInfoMessage = (text: string) => {
		infoMessages.push(text);
		state.addMessage({
			id: `info-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
	};

	const ctx: AppCommandContext = {
		commands,
		state,
		agentRunner: null,
		config: makeConfig(),
		autoPr: false,
		autoShip: false,
		addInfoMessage,
		buildSessionData: () => ({
			id: state.sessionId.value,
			title: "Fix structured handoff",
			createdAt: state.messages.value[0]?.timestamp ?? Date.now(),
			updatedAt: Date.now(),
			messages: state.messages.value,
			model: state.model.value,
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		}),
		startAutoSaver: () => {},
		activateSession: async (session, notice, reason) => {
			await activateSessionSpy(session, notice, reason);
			if (notice) addInfoMessage(notice);
		},
		quit: async () => {},
		getActiveCoder: () => null,
		setActiveCoder: () => {},
		getActiveAutocycle: () => null,
		setActiveAutocycle: () => {},
	};

	Reflect.set(ctx, "infoMessages", infoMessages);
	return ctx;
}

function lastInfo(state: AppState): string {
	const last = state.messages.value.at(-1);
	const block = last?.content.find((item) => item.type === "text");
	return block?.type === "text" ? block.text : "";
}

describe("handoff command helpers", () => {
	it("parses supported target formats", () => {
		expect(parseHandoffArgs("new continue validation", "fallback")?.target.kind).toBe("new-session");
		expect(parseHandoffArgs("session:abc123 focus review", "fallback")?.target.id).toBe("abc123");
		expect(parseHandoffArgs("branch:review tighten docs", "fallback")?.target.kind).toBe("branch");
		expect(parseHandoffArgs("side-agent:lane-2 investigate failure", "fallback")?.target.kind).toBe("side-agent");
		expect(parseHandoffArgs("mystery-target nope", "fallback")).toBeNull();
	});

	it("builds a structured work-state snapshot", () => {
		const session: SessionData = {
			id: "session-1",
			title: "Fix structured handoff",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			model: "claude-sonnet-4",
			messages: [
				{
					id: "u1",
					role: "user",
					content: [{ type: "text", text: "Please finish the remaining tasks." }],
					timestamp: Date.now(),
				},
				{
					id: "a1",
					role: "assistant",
					content: [{ type: "text", text: "Implemented the handoff manager and started TUI wiring." }],
					timestamp: Date.now(),
				},
			],
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		};

		const workState = buildHandoffWorkState(session, "Finish validation");
		expect(workState.objective).toBe("Finish validation");
		expect(workState.decisions[0]).toContain("Implemented the handoff manager");
		expect(workState.nextAction).toContain("Please finish the remaining tasks");
	});
});

describe("handoff slash commands", () => {
	let originalHome: string | undefined;
	let tempHome: string;

	beforeEach(async () => {
		originalHome = process.env.HOME;
		tempHome = await mkdtemp(join(tmpdir(), "takumi-handoff-tui-"));
		process.env.HOME = tempHome;
	});

	afterEach(async () => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		await rm(tempHome, { recursive: true, force: true });
	});

	it("creates, lists, and reattaches a prepared branch handoff", async () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const activateSession = vi.fn(async () => {});
		const ctx = makeContext(state, commands, activateSession);

		state.sessionId.value = "session-main";
		state.model.value = "claude-sonnet-4";
		state.provider.value = "anthropic";
		state.turnCount.value = 2;
		state.messages.value = [
			{
				id: "u1",
				role: "user",
				content: [{ type: "text", text: "Please finish the branch handoff flow." }],
				timestamp: Date.now(),
			},
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "text", text: "I created the manager; next is command wiring." }],
				timestamp: Date.now(),
			},
		];

		registerHandoffCommands(ctx);

		const created = await commands.execute("/handoff-to branch:review finish validation pass");
		expect(created).toBe(true);
		expect(lastInfo(state)).toContain("Structured handoff created.");

		const store = new ArtifactStore();
		const artifacts = await store.query({ kind: "handoff" });
		expect(artifacts).toHaveLength(1);
		const payload = JSON.parse(artifacts[0].body ?? "{}") as {
			handoffId?: string;
			target?: { kind?: string; id?: string };
		};
		expect(payload.target?.kind).toBe("branch");
		expect(payload.target?.id).toBeTruthy();

		await commands.execute("/handoffs 5");
		expect(lastInfo(state)).toContain("Recent handoffs:");
		expect(lastInfo(state)).toContain(payload.handoffId ?? "");

		await commands.execute(`/reattach ${payload.handoffId}`);
		expect(activateSession).toHaveBeenCalledOnce();
		const activatedSession = activateSession.mock.calls[0]?.[0] as SessionData;
		expect(activatedSession.id).toBe(payload.target?.id);
		expect(lastInfo(state)).toContain("Reattached");
	});

	it("shows usage for invalid handoff target specs", async () => {
		const state = new AppState();
		const commands = new SlashCommandRegistry();
		const ctx = makeContext(state, commands);

		state.sessionId.value = "session-main";
		state.messages.value = [
			{
				id: "u1",
				role: "user",
				content: [{ type: "text", text: "Hello" }],
				timestamp: Date.now(),
			},
		];

		registerHandoffCommands(ctx);
		await commands.execute("/handoff-to branch:");
		expect(lastInfo(state)).toContain("Usage:");
	});
});
