import type { SessionData } from "@takumi/core";
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
});
