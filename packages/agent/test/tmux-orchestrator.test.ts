/**
 * Tests for TmuxOrchestrator — Phase 21.3: Side Agent Isolation
 *
 * All tmux interactions are mocked via `child_process.execFile` so
 * we never invoke real tmux. Tests verify argument wiring, error
 * handling, and lifecycle management.
 */

import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

// Import after mock is wired up.
const { TmuxOrchestrator } = await import("../src/cluster/tmux-orchestrator.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;

const mockedExecFile = execFile as unknown as Mock;

/** Configure the next N calls to execFile to succeed with the given stdout values. */
function succeedWith(...stdouts: string[]): void {
	for (const stdout of stdouts) {
		mockedExecFile.mockImplementationOnce((_cmd: string, _args: string[], cb: ExecFileCb) => {
			cb(null, stdout, "");
			return { stdin: { end: vi.fn() } };
		});
	}
}

/** Configure the next call to execFile to fail. */
function failWith(message = "command failed"): void {
	mockedExecFile.mockImplementationOnce((_cmd: string, _args: string[], cb: ExecFileCb) => {
		cb(new Error(message), "", "");
		return { stdin: { end: vi.fn() } };
	});
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("TmuxOrchestrator", () => {
	let orch: InstanceType<typeof TmuxOrchestrator>;

	beforeEach(() => {
		vi.clearAllMocks();
		orch = new TmuxOrchestrator("test-session");
	});

	afterEach(async () => {
		// Prevent cleanup from throwing on leftover mocks.
		mockedExecFile.mockImplementation((_cmd: string, _args: string[], cb: ExecFileCb) => {
			cb(null, "", "");
			return { stdin: { end: vi.fn() } };
		});
		await orch.cleanup();
	});

	// ── Static: isAvailable ─────────────────────────────────────────────────

	describe("isAvailable", () => {
		it("returns true when tmux is found", async () => {
			succeedWith("tmux 3.4");
			const result = await TmuxOrchestrator.isAvailable();
			expect(result).toBe(true);
			expect(mockedExecFile).toHaveBeenCalledWith("tmux", ["-V"], expect.any(Function));
		});

		it("returns false when tmux is not found", async () => {
			failWith("not found");
			const result = await TmuxOrchestrator.isAvailable();
			expect(result).toBe(false);
		});
	});

	// ── Static: isInsideTmux ────────────────────────────────────────────────

	describe("isInsideTmux", () => {
		const originalTMUX = process.env.TMUX;

		afterEach(() => {
			if (originalTMUX === undefined) {
				delete process.env.TMUX;
			} else {
				process.env.TMUX = originalTMUX;
			}
		});

		it("returns true when TMUX env var is set", () => {
			process.env.TMUX = "/tmp/tmux-501/default,12345,0";
			expect(TmuxOrchestrator.isInsideTmux()).toBe(true);
		});

		it("returns false when TMUX env var is unset", () => {
			delete process.env.TMUX;
			expect(TmuxOrchestrator.isInsideTmux()).toBe(false);
		});

		it("returns false when TMUX env var is empty string", () => {
			process.env.TMUX = "";
			expect(TmuxOrchestrator.isInsideTmux()).toBe(false);
		});
	});

	// ── createWindow ────────────────────────────────────────────────────────

	describe("createWindow", () => {
		it("creates a session if needed then creates a window", async () => {
			// 1st call: has-session fails (not yet created)
			failWith("no session");
			// 2nd call: new-session succeeds
			succeedWith("");
			// 3rd call: new-window returns id
			succeedWith("@1:%3");

			const win = await orch.createWindow("alpha", "/tmp/workdir");
			expect(win.sessionName).toBe("test-session");
			expect(win.windowId).toBe("@1");
			expect(win.paneId).toBe("%3");
			expect(win.windowName).toBe("agent-alpha");

			// Verify new-window args include cwd and format
			const newWindowCall = mockedExecFile.mock.calls[2];
			expect(newWindowCall[0]).toBe("tmux");
			expect(newWindowCall[1]).toContain("new-window");
			expect(newWindowCall[1]).toContain("/tmp/workdir");
		});

		it("passes command to new-window when provided", async () => {
			// has-session succeeds (already created by previous createWindow)
			succeedWith("");
			// new-window
			succeedWith("@2:%5");

			const win = await orch.createWindow("beta", "/tmp", "node agent.js");
			expect(win.windowId).toBe("@2");

			const args = mockedExecFile.mock.calls[1][1] as string[];
			expect(args[args.length - 1]).toBe("node agent.js");
		});

		it("throws when agent id already has a window", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window

			await orch.createWindow("dup", "/tmp");
			await expect(orch.createWindow("dup", "/tmp")).rejects.toThrow('already exists for agent "dup"');
		});
	});

	// ── sendKeys ────────────────────────────────────────────────────────────

	describe("sendKeys", () => {
		it("sends text to the correct window target via load-buffer + paste-buffer", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("send-test", "/tmp");

			succeedWith(""); // load-buffer
			succeedWith(""); // paste-buffer
			await orch.sendKeys("send-test", "echo hello");

			const loadCall = mockedExecFile.mock.calls[2];
			const pasteCall = mockedExecFile.mock.calls[3];
			expect(loadCall[1]).toContain("load-buffer");
			expect(pasteCall[1]).toContain("paste-buffer");
			expect(pasteCall[1]).toContain("test-session:@1");
		});

		it("throws for unknown agent id", async () => {
			await expect(orch.sendKeys("ghost", "ls")).rejects.toThrow('No tmux window found for agent "ghost"');
		});
	});

	// ── captureOutput ───────────────────────────────────────────────────────

	describe("captureOutput", () => {
		it("captures pane output with default line count", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("capture-test", "/tmp");

			succeedWith("line1\nline2\nline3"); // capture-pane
			const output = await orch.captureOutput("capture-test");

			expect(output).toBe("line1\nline2\nline3");
			const call = mockedExecFile.mock.calls[2];
			expect(call[1]).toContain("capture-pane");
			expect(call[1]).toContain("-500");
		});

		it("accepts custom line count", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("cap2", "/tmp");

			succeedWith("output"); // capture-pane
			await orch.captureOutput("cap2", 100);

			const call = mockedExecFile.mock.calls[2];
			expect(call[1]).toContain("-100");
		});
	});

	// ── killWindow ──────────────────────────────────────────────────────────

	describe("killWindow", () => {
		it("kills the window and removes it from managed set", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("kill-test", "/tmp");

			succeedWith(""); // kill-window
			await orch.killWindow("kill-test");

			expect(orch.getWindows().has("kill-test")).toBe(false);
		});

		it("is idempotent for unknown agent id", async () => {
			await expect(orch.killWindow("nonexistent")).resolves.toBeUndefined();
		});

		it("swallows errors when window is already dead", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("dead", "/tmp");

			failWith("window not found");
			await expect(orch.killWindow("dead")).resolves.toBeUndefined();
			expect(orch.getWindows().has("dead")).toBe(false);
		});
	});

	// ── isWindowAlive ───────────────────────────────────────────────────────

	describe("isWindowAlive", () => {
		it("returns true when window id is in list-windows output", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("alive-test", "/tmp");

			succeedWith("@0\n@1\n@2"); // list-windows
			const alive = await orch.isWindowAlive("alive-test");
			expect(alive).toBe(true);
		});

		it("returns false when window id is missing from list-windows output", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("dead-test", "/tmp");

			succeedWith("@0\n@2"); // list-windows — @1 missing
			const alive = await orch.isWindowAlive("dead-test");
			expect(alive).toBe(false);
		});

		it("returns false for unknown agent id", async () => {
			const alive = await orch.isWindowAlive("unknown");
			expect(alive).toBe(false);
		});

		it("returns false when list-windows fails", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("err-test", "/tmp");

			failWith("session gone");
			const alive = await orch.isWindowAlive("err-test");
			expect(alive).toBe(false);
		});
	});

	describe("adoptWindow", () => {
		it("reattaches a persisted agent to an existing tmux window", async () => {
			succeedWith(""); // has-session
			succeedWith("@4:agent-side-9:%2"); // list-windows

			const adopted = await orch.adoptWindow("side-9", "agent-side-9");

			expect(adopted).toMatchObject({
				sessionName: "test-session",
				windowId: "@4",
				windowName: "agent-side-9",
				paneId: "%2",
			});
			expect(orch.getWindows().get("side-9")).toMatchObject({ windowId: "@4" });
		});

		it("returns null when the persisted tmux session is gone", async () => {
			failWith("no session");

			await expect(orch.adoptWindow("side-9", "agent-side-9")).resolves.toBeNull();
		});

		it("can reattach by durable window coordinates", async () => {
			succeedWith(""); // has-session
			succeedWith("@4:agent-side-9:%2"); // list-windows

			const adopted = await orch.adoptWindow("side-9", {
				sessionName: "test-session",
				windowId: "@4",
				paneId: "%2",
			});

			expect(adopted).toMatchObject({
				sessionName: "test-session",
				windowId: "@4",
				windowName: "agent-side-9",
				paneId: "%2",
			});
		});
	});

	// ── getWindows ──────────────────────────────────────────────────────────

	describe("getWindows", () => {
		it("returns a copy of the managed windows map", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window
			await orch.createWindow("map-test", "/tmp");

			const map = orch.getWindows();
			expect(map.size).toBe(1);
			expect(map.get("map-test")?.windowName).toBe("agent-map-test");

			// Mutating the copy should not affect the orchestrator.
			map.delete("map-test");
			expect(orch.getWindows().size).toBe(1);
		});
	});

	// ── waitForChannel ──────────────────────────────────────────────────────

	describe("waitForChannel", () => {
		it("resolves true when the channel is signaled", async () => {
			mockedExecFile.mockImplementationOnce((_cmd: string, _args: string[], cb: ExecFileCb) => {
				cb(null, "", "");
				return { kill: vi.fn() };
			});

			const result = await orch.waitForChannel("test-chan", 5_000);
			expect(result).toBe(true);
			expect(mockedExecFile).toHaveBeenCalledWith("tmux", ["wait-for", "test-chan"], expect.any(Function));
		});

		it("resolves false when tmux wait-for errors", async () => {
			mockedExecFile.mockImplementationOnce((_cmd: string, _args: string[], cb: ExecFileCb) => {
				cb(new Error("dead"), "", "");
				return { kill: vi.fn() };
			});

			const result = await orch.waitForChannel("test-chan", 5_000);
			expect(result).toBe(false);
		});

		it("resolves false immediately when signal is already aborted", async () => {
			const ac = new AbortController();
			ac.abort();
			const result = await orch.waitForChannel("test-chan", 5_000, ac.signal);
			expect(result).toBe(false);
			// Should not have called tmux at all.
			expect(mockedExecFile).not.toHaveBeenCalled();
		});

		it("kills the process when abort fires mid-wait", async () => {
			const killFn = vi.fn();
			mockedExecFile.mockImplementationOnce((_cmd: string, _args: string[], _cb: ExecFileCb) => {
				// Intentionally never call cb — simulates blocking wait-for.
				return { kill: killFn };
			});

			const ac = new AbortController();
			const promise = orch.waitForChannel("test-chan", 30_000, ac.signal);
			ac.abort();

			const result = await promise;
			expect(result).toBe(false);
			expect(killFn).toHaveBeenCalled();
		});
	});

	// ── cleanup ─────────────────────────────────────────────────────────────

	describe("cleanup", () => {
		it("kills all managed windows and destroys the session", async () => {
			succeedWith(""); // has-session
			succeedWith("@1:%0"); // new-window A
			await orch.createWindow("a", "/tmp");

			succeedWith("@2:%1"); // new-window B (session already exists)
			// need has-session again since createWindow calls ensureSession
			mockedExecFile.mockImplementationOnce((_cmd: string, _args: string[], cb: ExecFileCb) => {
				cb(null, "", "");
			});
			succeedWith("@2:%1");
			await orch.createWindow("b", "/tmp");

			// cleanup: kill-window × 2 + kill-session × 1
			succeedWith(""); // kill-window a
			succeedWith(""); // kill-window b
			succeedWith(""); // kill-session

			await orch.cleanup();
			expect(orch.getWindows().size).toBe(0);
		});
	});
});
