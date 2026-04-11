/**
 * Tests for side-agent-runtime helpers — launch command generation,
 * ready-wait (channel + polling paths), and the capture-pane fallback
 * that closes the tmux wait-for race window.
 */

import { describe, expect, it, vi } from "vitest";
import type { Orchestrator } from "../src/cluster/orchestrator-factory.js";
import { buildSideAgentWorkerLaunchCommand, waitForSideAgentReady } from "../src/tools/side-agent-runtime.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrchestrator(overrides: Partial<Orchestrator> = {}): Orchestrator {
	return {
		createWindow: vi.fn(),
		sendKeys: vi.fn(),
		captureOutput: vi.fn(async () => ""),
		isWindowAlive: vi.fn(async () => true),
		killWindow: vi.fn(),
		...overrides,
	};
}

// ── buildSideAgentWorkerLaunchCommand ─────────────────────────────────────────

describe("buildSideAgentWorkerLaunchCommand", () => {
	it("produces a command that prefers pre-built JS with tsx fallback", () => {
		const cmd = buildSideAgentWorkerLaunchCommand({
			id: "lane-1",
			model: "claude-sonnet",
			repoRoot: "/home/dev/takumi",
			worktreePath: "/tmp/wt/lane-1",
		});

		expect(cmd).toContain("cd '/home/dev/takumi'");
		expect(cmd).toContain("if [ -f dist-bin/cli/side-agent-worker.js ]");
		expect(cmd).toContain("node dist-bin/cli/side-agent-worker.js");
		expect(cmd).toContain("pnpm exec tsx --tsconfig tsconfig.dev.json bin/cli/side-agent-worker.ts");
		expect(cmd).toContain("--id 'lane-1'");
		expect(cmd).toContain("--model 'claude-sonnet'");
		expect(cmd).toContain("--worktree '/tmp/wt/lane-1'");
	});

	it("shell-quotes paths containing spaces", () => {
		const cmd = buildSideAgentWorkerLaunchCommand({
			id: "lane-2",
			model: "gpt-4o",
			repoRoot: "/Users/dev/my project",
			worktreePath: "/tmp/work trees/wt-2",
		});

		expect(cmd).toContain("cd '/Users/dev/my project'");
		expect(cmd).toContain("--worktree '/tmp/work trees/wt-2'");
	});

	it("shell-quotes paths containing single quotes", () => {
		const cmd = buildSideAgentWorkerLaunchCommand({
			id: "lane-3",
			model: "claude-sonnet",
			repoRoot: "/home/dev/it's-a-repo",
			worktreePath: "/tmp/wt/lane-3",
		});

		// shellQuote replaces ' with "'"' so the shell re-joins correctly.
		expect(cmd).toContain(`'/home/dev/it"'"'s-a-repo'`);
	});
});

// ── waitForSideAgentReady ─────────────────────────────────────────────────────

describe("waitForSideAgentReady", () => {
	describe("channel path (waitForChannel available)", () => {
		it("resolves immediately when channel is signaled", async () => {
			const tmux = makeOrchestrator({
				waitForChannel: vi.fn(async () => true),
			});

			await expect(waitForSideAgentReady({ id: "lane-1", tmux, timeoutMs: 5_000 })).resolves.toBeUndefined();

			expect(tmux.waitForChannel).toHaveBeenCalledWith("takumi-ready-lane-1", 5_000);
			// Should NOT have called captureOutput when channel succeeds.
			expect(tmux.captureOutput).not.toHaveBeenCalled();
		});

		it("falls back to capture-pane when channel times out (race closure)", async () => {
			const tmux = makeOrchestrator({
				waitForChannel: vi.fn(async () => false),
				captureOutput: vi.fn(async () => "[TAKUMI_SIDE_AGENT_READY id=lane-1 ts=1]"),
			});

			// Should NOT throw — the capture-pane fallback finds the marker.
			await expect(waitForSideAgentReady({ id: "lane-1", tmux, timeoutMs: 100 })).resolves.toBeUndefined();

			expect(tmux.waitForChannel).toHaveBeenCalled();
			expect(tmux.captureOutput).toHaveBeenCalledWith("lane-1", 80);
		});

		it("throws when both channel and capture-pane fallback miss", async () => {
			const tmux = makeOrchestrator({
				waitForChannel: vi.fn(async () => false),
				captureOutput: vi.fn(async () => "some unrelated output"),
			});

			await expect(waitForSideAgentReady({ id: "lane-1", tmux, timeoutMs: 100 })).rejects.toThrow(
				"did not report ready state",
			);
		});
	});

	describe("polling path (no waitForChannel)", () => {
		it("resolves when ready marker appears in captured output", async () => {
			let callCount = 0;
			const tmux = makeOrchestrator({
				captureOutput: vi.fn(async () => {
					callCount += 1;
					// Marker appears on 3rd poll.
					return callCount >= 3 ? "[TAKUMI_SIDE_AGENT_READY id=poll-1 ts=1]" : "booting...";
				}),
			});

			await expect(waitForSideAgentReady({ id: "poll-1", tmux, timeoutMs: 5_000 })).resolves.toBeUndefined();

			expect(callCount).toBeGreaterThanOrEqual(3);
		});

		it("throws after timeout when marker never appears", async () => {
			const tmux = makeOrchestrator({
				captureOutput: vi.fn(async () => "no marker here"),
			});

			await expect(waitForSideAgentReady({ id: "poll-2", tmux, timeoutMs: 250 })).rejects.toThrow(
				"did not report ready state within 250ms",
			);
		});
	});
});
