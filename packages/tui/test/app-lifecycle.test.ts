import type { ChitraguptaHealth, RoutingDecision, VasanaTendency } from "@takumi/bridge";
import type { SessionData } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { TakumiApp } from "../src/app.js";

function createApp() {
	return new TakumiApp({
		config: {
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			thinking: false,
			thinkingBudget: 10000,
			theme: "default",
		} as never,
		stdin: { on: vi.fn(), resume: vi.fn() } as never,
		stdout: { write: vi.fn() } as never,
	});
}

function buildSession(id: string): SessionData {
	return {
		id,
		title: `Session ${id}`,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		messages: [],
		model: "claude-sonnet-4-20250514",
		tokenUsage: {
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
		},
		controlPlane: undefined,
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

function buildStartupRoutingDecision(): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-startup",
			capability: "coding.patch-cheap",
		},
		selected: {
			id: "llm.gemini.gemini-2.5-pro",
			kind: "llm",
			label: "Gemini 2.5 Pro",
			capabilities: ["coding.patch-cheap"],
			costClass: "medium",
			trust: "cloud",
			health: "healthy",
			invocation: {
				id: "gemini-chat",
				transport: "http",
				entrypoint: "https://example.invalid/gemini",
				requestShape: "ChatRequest",
				responseShape: "ChatResponse",
				timeoutMs: 30_000,
				streaming: true,
			},
			tags: ["coding"],
			providerFamily: "gemini",
			metadata: { model: "gemini-2.5-pro" },
		},
		reason: "Selected Gemini for startup",
		fallbackChain: [],
		policyTrace: ["selected:llm.gemini.gemini-2.5-pro"],
		degraded: false,
	};
}

function buildStartupTendency(): VasanaTendency {
	return {
		tendency: "regression-tests-first",
		valence: "positive",
		strength: 0.91,
		stability: 0.84,
		predictiveAccuracy: 0.79,
		reinforcementCount: 6,
		description: "Prefers adding regression coverage before trusting a fix.",
	};
}

function buildStartupHealth(): ChitraguptaHealth {
	return {
		state: { sattva: 0.72, rajas: 0.18, tamas: 0.1 },
		dominant: "sattva",
		trend: { sattva: "stable", rajas: "falling", tamas: "stable" },
		alerts: [],
		history: [],
	};
}

describe("TakumiApp lifecycle cleanup", () => {
	it("cleans active work before switching sessions", async () => {
		const app = createApp() as any;
		const coder = {
			isActive: true,
			cancel: vi.fn(async () => undefined),
			shutdown: vi.fn(async () => undefined),
		};
		const autocycle = {
			isActive: true,
			cancel: vi.fn(),
		};
		const runner = {
			isRunning: true,
			cancel: vi.fn(),
			hydrateHistory: vi.fn(),
		};

		app.activeCoder = coder;
		app.activeAutocycle = autocycle;
		app.agentRunner = runner;

		await app.activateSession(buildSession("session-next"), "Switched", "resume");

		expect(runner.cancel).toHaveBeenCalledOnce();
		expect(autocycle.cancel).toHaveBeenCalledOnce();
		expect(coder.cancel).toHaveBeenCalledWith("Switching to session session-next.");
		expect(coder.shutdown).toHaveBeenCalledOnce();
		expect(app.activeCoder).toBeNull();
		expect(app.activeAutocycle).toBeNull();
		expect(app.state.sessionId.value).toBe("session-next");
	});

	it("restores turn count when switching to an existing session", async () => {
		const app = createApp() as any;
		const runner = {
			isRunning: false,
			hydrateHistory: vi.fn(),
		};
		const session = buildSession("session-history");
		session.messages = [
			buildMessage("u1", "user", "hello"),
			buildMessage("a1", "assistant", "hi"),
			buildMessage("u2", "user", "show status"),
		];

		app.agentRunner = runner;

		await app.activateSession(session, "Switched", "resume");

		expect(app.state.turnCount.value).toBe(2);
		expect(runner.hydrateHistory).toHaveBeenCalledWith(session.messages);
	});

	it("restores canonical sync metadata when switching sessions", async () => {
		const app = createApp() as any;
		const runner = {
			isRunning: false,
			hydrateHistory: vi.fn(),
		};
		const session = buildSession("session-canonical");
		session.controlPlane = {
			canonicalSessionId: "canon-42",
			sync: {
				lastSyncedMessageId: "msg-2",
				lastSyncedMessageTimestamp: 2000,
				lastSyncedAt: 3000,
				status: "ready",
			},
		};

		app.agentRunner = runner;

		await app.activateSession(session, "Switched", "resume");

		expect(app.state.canonicalSessionId.value).toBe("canon-42");
		expect(app.state.chitraguptaSync.value).toMatchObject({
			lastSyncedMessageId: "msg-2",
			lastSyncedMessageTimestamp: 2000,
			lastSyncedAt: 3000,
			status: "ready",
		});
	});

	it("restores persisted degraded execution context when switching sessions", async () => {
		const app = createApp() as any;
		const runner = {
			isRunning: false,
			hydrateHistory: vi.fn(),
		};
		const session = buildSession("session-degraded");
		session.controlPlane = {
			degradedContext: {
				firstDetectedAt: 1000,
				lastUpdatedAt: 2000,
				sources: [
					{
						kind: "route_degraded",
						reason: "Primary lane fell back to degraded routing",
						firstDetectedAt: 1000,
						lastDetectedAt: 2000,
						capability: "coding.patch-cheap",
						authority: "engine",
						fallbackChain: ["lane-fallback"],
					},
				],
			},
		};

		app.agentRunner = runner;

		await app.activateSession(session, "Switched", "resume");

		expect(app.state.degradedExecutionContext.value).toMatchObject({
			firstDetectedAt: 1000,
			lastUpdatedAt: 2000,
			sources: [
				{
					kind: "route_degraded",
					reason: "Primary lane fell back to degraded routing",
				},
			],
		});
	});

	it("seeds startup control-plane state before the live bridge reconnects", () => {
		const app = new TakumiApp({
			config: {
				provider: "gemini",
				model: "gemini-2.5-pro",
				thinking: false,
				thinkingBudget: 10000,
				theme: "default",
			} as never,
			stdin: { on: vi.fn(), resume: vi.fn() } as never,
			stdout: { write: vi.fn() } as never,
			startupControlPlane: {
				canonicalSessionId: "canon-startup",
				memoryContext: "Remember the regression failures that already reproduced this bug.",
				tendencies: [buildStartupTendency()],
				health: buildStartupHealth(),
				routingDecision: buildStartupRoutingDecision(),
			},
		});

		expect(app.state.canonicalSessionId.value).toBe("canon-startup");
		expect(app.state.chitraguptaMemory.value).toContain("regression failures");
		expect(app.state.vasanaTendencies.value).toHaveLength(1);
		expect(app.state.chitraguptaHealth.value?.dominant).toBe("sattva");
		expect(app.state.routingDecisions.value).toHaveLength(1);
		expect(app.state.routingDecisions.value[0]?.selected?.id).toBe("llm.gemini.gemini-2.5-pro");
	});

	it("cleans active work before quitting", async () => {
		const app = createApp() as any;
		const coder = {
			isActive: true,
			cancel: vi.fn(async () => undefined),
			shutdown: vi.fn(async () => undefined),
		};
		const autocycle = {
			isActive: true,
			cancel: vi.fn(),
		};
		const runner = {
			isRunning: true,
			cancel: vi.fn(),
		};

		app.running = true;
		app.activeCoder = coder;
		app.activeAutocycle = autocycle;
		app.agentRunner = runner;

		const originalExit = process.exit;
		const exitMock = vi.fn();
		(process as any).exit = exitMock;

		try {
			await app.quit();
			expect(exitMock).toHaveBeenCalledWith(0);
		} finally {
			(process as any).exit = originalExit;
		}

		expect(runner.cancel).toHaveBeenCalledOnce();
		expect(autocycle.cancel).toHaveBeenCalledOnce();
		expect(coder.cancel).toHaveBeenCalledWith("Application exit requested.");
		expect(coder.shutdown).toHaveBeenCalledOnce();
		expect(app.activeCoder).toBeNull();
		expect(app.activeAutocycle).toBeNull();
		expect(app.running).toBe(false);
	});

	it("emits OSC 133 lifecycle markers for supported terminals", async () => {
		const write = vi.fn();
		const originalTermProgram = process.env.TERM_PROGRAM;
		process.env.TERM_PROGRAM = "ghostty";

		const app = new TakumiApp({
			config: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				thinking: false,
				thinkingBudget: 10000,
				theme: "default",
			} as never,
			stdin: { on: vi.fn(), resume: vi.fn(), setRawMode: vi.fn() } as never,
			stdout: { write } as never,
		}) as any;

		app.write("hello");
		app.terminalCapabilities = { ...app.terminalCapabilities, osc133: true };
		app.running = true;

		const originalExit = process.exit;
		(process as any).exit = vi.fn();
		try {
			app.write("\x1b]133;C\x07");
			await app.quit();
		} finally {
			(process as any).exit = originalExit;
			process.env.TERM_PROGRAM = originalTermProgram;
		}

		expect(write).toHaveBeenCalledWith("\x1b]133;C\x07");
		expect(write).toHaveBeenCalledWith("\x1b]133;D;0\x07");
	});

	it("priority-renders after handled keybindings", () => {
		const app = createApp() as any;
		const schedulePriorityRender = vi.fn();

		app.scheduler = { schedulePriorityRender };
		app.keybinds.handle = vi.fn(() => true);

		app.handleInput(Buffer.from(KEY_CODES.CTRL_K, "utf-8"));

		expect(schedulePriorityRender).toHaveBeenCalledOnce();
	});

	it("binds Ctrl+P to preview and keeps Ctrl+K for the command palette", () => {
		const app = createApp() as any;

		expect(app.keybinds.getById("app.command-palette.toggle")?.key).toBe("ctrl+k");
		expect(app.keybinds.getById("app.command-palette.toggle")?.aliases).toEqual([]);
		expect(app.keybinds.getById("app.preview.toggle")?.key).toBe("ctrl+p");

		expect(app.state.previewVisible.value).toBe(false);
		expect(
			app.keybinds.handle({
				key: "p",
				ctrl: true,
				alt: false,
				shift: false,
				meta: false,
				raw: KEY_CODES.CTRL_P,
			}),
		).toBe(true);
		expect(app.state.previewVisible.value).toBe(true);

		expect(
			app.keybinds.handle({
				key: "k",
				ctrl: true,
				alt: false,
				shift: false,
				meta: false,
				raw: KEY_CODES.CTRL_K,
			}),
		).toBe(true);
		expect(app.state.topDialog).toBe("command-palette");
	});
});
