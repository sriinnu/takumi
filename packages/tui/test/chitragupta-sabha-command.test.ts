import type { Message } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { registerChitraguptaCommands } from "../src/commands/app-commands-chitragupta.js";
import { SlashCommandRegistry } from "../src/commands/commands.js";
import { AppState } from "../src/state.js";

function collectMessages(state: AppState): string[] {
	const texts: string[] = [];
	const originalAdd = state.addMessage.bind(state);
	state.addMessage = (message) => {
		const block = message.content.find((entry) => entry.type === "text");
		if (block?.type === "text") {
			texts.push(block.text);
		}
		originalAdd(message);
	};
	return texts;
}

function createContext(overrides?: {
	reconnectChitragupta?: () => Promise<{
		connected: boolean;
		canonicalSessionId: string | null;
		syncedMessages: number;
		pendingMessages: number;
		syncStatus?: string;
		validationWarnings?: string[];
		validationConflicts?: string[];
		lastError?: string;
		lastSyncedMessageId?: string;
		lastFailedMessageId?: string;
	}>;
}) {
	const commands = new SlashCommandRegistry();
	const state = new AppState();
	const messages = collectMessages(state);

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
		reconnectChitragupta: vi.fn(
			overrides?.reconnectChitragupta ??
				(async () => ({
					connected: true,
					canonicalSessionId: "canon-77",
					syncedMessages: 2,
					pendingMessages: 0,
					syncStatus: "ready",
				})),
		),
		quit: vi.fn(),
		getActiveCoder: vi.fn().mockReturnValue(null),
		setActiveCoder: vi.fn(),
		getActiveAutocycle: vi.fn().mockReturnValue(null),
		setActiveAutocycle: vi.fn(),
	};

	registerChitraguptaCommands(ctx as never);

	return { commands, state, messages };
}

describe("/sabha command", () => {
	it("shows not connected when Chitragupta is unavailable", async () => {
		const { commands, messages } = createContext();

		await commands.execute("/sabha");

		expect(messages.at(-1)).toBe("Chitragupta not connected");
	});

	it("rebinds and reports sync status", async () => {
		const { commands, messages } = createContext();

		await commands.execute("/rebind");

		expect(messages.at(-2)).toBe("Rebinding to Chitragupta...");
		expect(messages.at(-1)).toContain("Chitragupta rebind status");
		expect(messages.at(-1)).toContain("Canonical session: canon-77");
		expect(messages.at(-1)).toContain("Synced local turns: 2");
		expect(messages.at(-1)).toContain("Sync status: ready");
	});

	it("reports the stalled replay turn when rebind fails mid-sync", async () => {
		const { commands, messages } = createContext({
			reconnectChitragupta: async () => ({
				connected: true,
				canonicalSessionId: "canon-88",
				syncedMessages: 1,
				pendingMessages: 2,
				syncStatus: "failed",
				lastSyncedMessageId: "user-1",
				lastFailedMessageId: "assistant-1",
				lastError: "daemon write failed",
			}),
		});

		await commands.execute("/rebind");

		expect(messages.at(-1)).toContain("Sync status: failed");
		expect(messages.at(-1)).toContain("Last mirrored turn: user-1");
		expect(messages.at(-1)).toContain("Replay stalled on: assistant-1");
		expect(messages.at(-1)).toContain("Last error: daemon write failed");
	});

	it("surfaces replay validation drift in the rebind report", async () => {
		const { commands, messages } = createContext({
			reconnectChitragupta: async () => ({
				connected: true,
				canonicalSessionId: "canon-99",
				syncedMessages: 0,
				pendingMessages: 2,
				syncStatus: "failed",
				validationConflicts: ["provider mismatch (anthropic ≠ openai)"],
				validationWarnings: ["Policy contractVersion markers are incomplete; policy-era validation is partial."],
				lastError: "Replay validation blocked canonical rebind for canon-99",
			}),
		});

		await commands.execute("/rebind");

		expect(messages.at(-1)).toContain("Replay validation conflicts: provider mismatch (anthropic ≠ openai)");
		expect(messages.at(-1)).toContain(
			"Replay validation warnings: Policy contractVersion markers are incomplete; policy-era validation is partial.",
		);
	});

	it("uses /route as the canonical routing drill-down surface", async () => {
		const { commands, state, messages } = createContext();
		state.routingDecisions.value = [
			{
				request: {
					consumer: "takumi",
					sessionId: "canon-route",
					capability: "coding.patch-cheap",
				},
				selected: {
					id: "adapter.takumi.executor",
					kind: "adapter",
					label: "Takumi Executor",
					capabilities: ["coding.patch-cheap"],
					costClass: "low",
					trust: "local",
					health: "healthy",
					invocation: {
						id: "takumi",
						transport: "local-process",
						entrypoint: "takumi",
						requestShape: "route-request",
						responseShape: "route-response",
						timeoutMs: 1000,
						streaming: true,
					},
					providerFamily: "takumi",
					metadata: { model: "takumi-local" },
				},
				reason: "Selected executor route",
				fallbackChain: ["cli.codex"],
				policyTrace: ["requested:coding.patch-cheap", "selected:adapter.takumi.executor"],
				degraded: false,
			},
		] as never;

		await commands.execute("/route summary");

		const output = messages.at(-1) ?? "";
		expect(output).toContain("## Route Summary");
		expect(output).toContain("Engine-routed:   1 (100%)");
		expect(output).toContain("Drill down: /route inspect <#> • /lanes • /lane-show <id>");
	});

	it("shows route detail with authority, enforcement, and fallback chain", async () => {
		const { commands, state, messages } = createContext();
		state.routingDecisions.value = [
			{
				request: {
					consumer: "takumi",
					sessionId: "canon-route",
					capability: "coding.review.strict",
				},
				selected: null,
				reason: "Engine unavailable; used local fallback",
				fallbackChain: ["adapter.takumi.executor", "cli.codex"],
				policyTrace: ["requested:coding.review.strict", "fallback:cli.codex"],
				degraded: true,
			},
		] as never;

		await commands.execute("/route inspect 1");

		const output = messages.at(-1) ?? "";
		expect(output).toContain("## Route #1");
		expect(output).toContain("Authority: takumi-fallback");
		expect(output).toContain("Enforcement: capability-only");
		expect(output).toContain("### Fallback chain");
		expect(output).toContain("cli.codex");
	});

	it("shows default sabha council details when no tracked sabha exists", async () => {
		const { commands, state, messages } = createContext();
		state.chitraguptaBridge.value = {
			isConnected: true,
			telemetrySnapshot: vi.fn().mockResolvedValue({
				schemaVersion: 2,
				timestamp: Date.now(),
				aggregate: "idle",
				counts: { total: 0, working: 0, waiting_input: 0, idle: 0, error: 0 },
				context: { total: 0, normal: 0, approachingLimit: 0, nearLimit: 0, atLimit: 0 },
				sessions: {},
				instancesByPid: {},
				instances: [],
			}),
		} as never;
		state.chitraguptaObserver.value = {
			capabilities: vi.fn().mockResolvedValue({ capabilities: [] }) as never,
		} as never;

		await commands.execute("/sabha");

		const output = messages.at(-1) ?? "";
		expect(output).toContain("Tracked Sabha: none");
		expect(output).toContain("## Default Sabha");
		expect(output).toContain("planner — planner");
		expect(output).toContain("validator — validator");
		expect(output).toContain("scarlett — integrity");
	});

	it("summarizes tracked sabha, working agents, and available lanes", async () => {
		const { commands, state, messages } = createContext();
		state.lastSabhaId.value = "sabha-1";
		state.chitraguptaBridge.value = {
			isConnected: true,
			telemetrySnapshot: vi.fn().mockResolvedValue({
				schemaVersion: 2,
				timestamp: Date.now(),
				aggregate: "working",
				counts: { total: 2, working: 1, waiting_input: 0, idle: 1, error: 0 },
				context: { total: 2, normal: 2, approachingLimit: 0, nearLimit: 0, atLimit: 0 },
				sessions: {},
				instancesByPid: {},
				instances: [
					{
						schemaVersion: 2,
						process: { pid: 4242, ppid: 1, uptime: 10, heartbeatAt: Date.now(), startedAt: Date.now() - 10_000 },
						system: { host: "localhost", user: "me", platform: "darwin", arch: "arm64", nodeVersion: "v22" },
						workspace: { cwd: process.cwd(), git: { branch: "main", dirty: true } },
						session: { id: "sess-1", file: "session.json", name: "Auth repair" },
						model: { provider: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
						state: { activity: "working", idle: false },
						context: {
							tokens: 1000,
							contextWindow: 10_000,
							remainingTokens: 9000,
							percent: 10,
							pressure: "normal",
							closeToLimit: false,
							nearLimit: false,
						},
						routing: { tty: "ttys001", mux: null, muxSession: null, muxWindowId: null, terminalApp: "Terminal" },
						capabilities: { hasUI: true, hasTools: true, hasMemory: true },
						extensions: { telemetry: null, bridge: null },
						lastEvent: "heartbeat",
					},
					{
						schemaVersion: 2,
						process: { pid: 5252, ppid: 1, uptime: 10, heartbeatAt: Date.now() - 1000, startedAt: Date.now() - 11_000 },
						system: { host: "localhost", user: "me", platform: "darwin", arch: "arm64", nodeVersion: "v22" },
						workspace: { cwd: process.cwd(), git: { branch: "feature/x", dirty: false } },
						session: { id: "sess-2", file: "session-2.json", name: "Idle lane" },
						model: { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
						state: { activity: "idle", idle: true, idleSince: Date.now() - 1000 },
						context: {
							tokens: 200,
							contextWindow: 10_000,
							remainingTokens: 9800,
							percent: 2,
							pressure: "normal",
							closeToLimit: false,
							nearLimit: false,
						},
						routing: { tty: "ttys002", mux: null, muxSession: null, muxWindowId: null, terminalApp: "Terminal" },
						capabilities: { hasUI: true, hasTools: true, hasMemory: true },
						extensions: { telemetry: null, bridge: null },
						lastEvent: "heartbeat",
					},
				],
			}),
		} as never;
		state.chitraguptaObserver.value = {
			capabilities: vi.fn().mockResolvedValue({
				capabilities: [
					{
						id: "adapter.takumi.executor",
						kind: "adapter",
						label: "Takumi Executor",
						capabilities: ["coding.patch-cheap"],
						costClass: "low",
						trust: "local",
						health: "healthy",
						invocation: {
							id: "takumi",
							transport: "local-process",
							entrypoint: "takumi",
							requestShape: "x",
							responseShape: "y",
							timeoutMs: 1000,
							streaming: true,
						},
						providerFamily: "takumi",
					},
					{
						id: "cli.codex",
						kind: "cli",
						label: "Codex CLI",
						capabilities: ["coding.review.strict"],
						costClass: "low",
						trust: "local",
						health: "degraded",
						invocation: {
							id: "codex",
							transport: "local-process",
							entrypoint: "codex",
							requestShape: "x",
							responseShape: "y",
							timeoutMs: 1000,
							streaming: false,
						},
						providerFamily: "openai",
					},
					{
						id: "llm.dead",
						kind: "llm",
						label: "Dead lane",
						capabilities: ["coding.patch-cheap"],
						costClass: "low",
						trust: "remote",
						health: "down",
						invocation: {
							id: "dead",
							transport: "api",
							entrypoint: "dead",
							requestShape: "x",
							responseShape: "y",
							timeoutMs: 1000,
							streaming: true,
						},
						providerFamily: "other",
					},
				],
			}) as never,
			sabhaGather: vi.fn().mockResolvedValue({
				explanation: "Tracked Sabha gathered",
				sabha: {
					id: "sabha-1",
					topic: "Auth routing dispute",
					status: "deliberating",
					convener: "chitragupta",
					createdAt: Date.now() - 5000,
					participants: [
						{ id: "planner", role: "planner", targetClientId: "takumi-main" },
						{ id: "validator", role: "validator", targetClientId: "takumi-review" },
					],
					participantCount: 2,
					roundCount: 1,
					currentRound: {
						roundNumber: 1,
						proposal: {
							pratijna: "Use route envelopes",
							hetu: "Preserve engine authority",
							udaharana: "Takumi exec",
							upanaya: "This repo",
							nigamana: "Adopt the contract",
						},
						unresolvedChallenges: [],
						allChallenges: [],
						votes: [],
						voteSummary: { supportWeight: 1, opposeWeight: 0, abstainWeight: 0, count: 1 },
						verdict: null,
					},
					finalVerdict: null,
				},
			}) as never,
		} as never;

		await commands.execute("/sabha");

		const output = messages.at(-1) ?? "";
		expect(output).toContain("## Sabha");
		expect(output).toContain("Auth routing dispute");
		expect(output).toContain("## Default Sabha");
		expect(output).toContain("## Working agents");
		expect(output).toContain("Auth repair");
		expect(output).toContain("anthropic/claude-sonnet");
		expect(output).toContain("## Available agents");
		expect(output).toContain("adapter.takumi.executor");
		expect(output).toContain("cli.codex");
		expect(output).not.toContain("llm.dead");
		expect(state.controlPlaneCapabilities.value.map((capability) => capability.id)).toContain(
			"adapter.takumi.executor",
		);
	});
});
