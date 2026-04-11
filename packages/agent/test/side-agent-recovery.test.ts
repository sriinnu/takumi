import type { SideAgentInfo } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		realpathSync: vi.fn((path: string) => path.replace("/symlink-repo", "/real-repo")),
	};
});

vi.mock("@takumi/bridge", () => ({
	gitWorktreeList: vi.fn(() => []),
	gitBranch: vi.fn(() => "takumi/side-agent/side-1-wt-0001"),
}));

import { gitBranch, gitWorktreeList } from "@takumi/bridge";
import { reconcilePersistedSideAgents } from "../src/cluster/side-agent-recovery.js";
import { SideAgentRegistry } from "../src/cluster/side-agent-registry.js";

function makeAgent(overrides: Partial<SideAgentInfo> = {}): SideAgentInfo {
	return {
		id: "side-1",
		description: "test agent",
		state: "running",
		model: "o3",
		slotId: "wt-0001",
		worktreePath: "/repo/.takumi/worktrees/wt-0001",
		tmuxWindow: "agent-side-1",
		tmuxSessionName: "takumi-side-agents",
		tmuxWindowId: "@1",
		tmuxPaneId: "%0",
		branch: "takumi/side-agent/side-1-wt-0001",
		pid: null,
		startedAt: 100,
		updatedAt: 100,
		...overrides,
	};
}

describe("reconcilePersistedSideAgents", () => {
	it("adopts recoverable running lanes back into tmux and the worktree pool", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent());
		vi.mocked(gitWorktreeList).mockReturnValue(["/repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");
		const pool = {
			adopt: vi.fn(),
		};
		const tmux = {
			adoptWindow: vi.fn(async () => ({
				sessionName: "takumi-side-agents",
				windowId: "@1",
				windowName: "agent-side-1",
				paneId: "%0",
			})),
		};

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: pool as never,
			tmux: tmux as never,
			repoRoot: "/repo",
		});

		expect(summary).toEqual({ adopted: ["side-1"], cleaned: [], crashed: [], cleanupFailed: [] });
		expect(tmux.adoptWindow).toHaveBeenCalledWith(
			"side-1",
			expect.objectContaining({
				sessionName: "takumi-side-agents",
				windowId: "@1",
				windowName: "agent-side-1",
				paneId: "%0",
			}),
		);
		expect(pool.adopt).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "wt-0001",
				path: "/repo/.takumi/worktrees/wt-0001",
				agentId: "side-1",
			}),
		);
		expect(agents.get("side-1")?.state).toBe("running");
	});

	it("recovers lanes when persisted worktree paths differ only by canonicalization", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent({ worktreePath: "/symlink-repo/.takumi/worktrees/wt-0001" }));
		vi.mocked(gitWorktreeList).mockReturnValue(["/real-repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");
		const pool = {
			adopt: vi.fn(),
		};
		const tmux = {
			adoptWindow: vi.fn(async () => ({
				sessionName: "takumi-side-agents",
				windowId: "@1",
				windowName: "agent-side-1",
				paneId: "%0",
			})),
		};

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: pool as never,
			tmux: tmux as never,
			repoRoot: "/symlink-repo",
		});

		expect(summary).toEqual({ adopted: ["side-1"], cleaned: [], crashed: [], cleanupFailed: [] });
		expect(pool.adopt).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "/real-repo/.takumi/worktrees/wt-0001",
			}),
		);
		expect(agents.get("side-1")?.worktreePath).toBe("/real-repo/.takumi/worktrees/wt-0001");
	});

	it("crashes startup-state lanes because they cannot be reattached safely", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent({ state: "starting", tmuxWindow: null }));
		vi.mocked(gitWorktreeList).mockReturnValue(["/repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: { adopt: vi.fn() } as never,
			tmux: { adoptWindow: vi.fn() } as never,
			repoRoot: "/repo",
		});

		expect(summary).toEqual({ adopted: [], cleaned: [], crashed: ["side-1"], cleanupFailed: [] });
		expect(agents.get("side-1")).toMatchObject({
			state: "crashed",
			error: "Side-agent was mid-startup during restart and could not be reattached safely.",
		});
	});

	it("crashes lanes whose persisted tmux window is gone", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent());
		vi.mocked(gitWorktreeList).mockReturnValue(["/repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");
		const tmux = {
			adoptWindow: vi.fn(async () => null),
		};

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: { adopt: vi.fn() } as never,
			tmux: tmux as never,
			repoRoot: "/repo",
		});

		expect(summary).toEqual({ adopted: [], cleaned: [], crashed: ["side-1"], cleanupFailed: [] });
		expect(agents.get("side-1")).toMatchObject({
			state: "crashed",
			error: "Side-agent tmux window is missing and could not be reattached after restart.",
		});
	});

	it("cleans leaked terminal-lane resources during startup reconcile", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent({ state: "stopped", error: "Stopped by operator" }));
		vi.mocked(gitWorktreeList).mockReturnValue(["/repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");
		const pool = {
			adopt: vi.fn(),
			release: vi.fn(async () => {}),
		};
		const tmux = {
			adoptWindow: vi.fn(async () => ({
				sessionName: "takumi-side-agents",
				windowId: "@1",
				windowName: "agent-side-1",
				paneId: "%0",
			})),
			killWindow: vi.fn(async () => {}),
		};

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: pool as never,
			tmux: tmux as never,
			repoRoot: "/repo",
		});

		expect(summary).toEqual({ adopted: [], cleaned: ["side-1"], crashed: [], cleanupFailed: [] });
		expect(tmux.killWindow).toHaveBeenCalledWith("side-1");
		expect(pool.release).toHaveBeenCalledWith("wt-0001");
		expect(agents.get("side-1")).toMatchObject({
			state: "stopped",
			slotId: null,
			worktreePath: null,
			tmuxWindow: null,
			tmuxSessionName: null,
			tmuxWindowId: null,
			tmuxPaneId: null,
			error: "Stopped by operator",
		});
	});

	it("crashes lanes whose worktree branch drifted after restart", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent());
		vi.mocked(gitWorktreeList).mockReturnValue(["/repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("main");

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: { adopt: vi.fn() } as never,
			tmux: { adoptWindow: vi.fn() } as never,
			repoRoot: "/repo",
		});

		expect(summary).toEqual({ adopted: [], cleaned: [], crashed: ["side-1"], cleanupFailed: [] });
		expect(agents.get("side-1")).toMatchObject({
			state: "crashed",
			error: 'Side-agent worktree branch drifted to "main" and could not be reattached safely.',
		});
	});

	it("kills a reattached tmux window when worktree-slot adoption fails", async () => {
		const agents = new SideAgentRegistry();
		agents.register(makeAgent());
		vi.mocked(gitWorktreeList).mockReturnValue(["/repo/.takumi/worktrees/wt-0001"]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");
		const pool = {
			adopt: vi.fn(() => {
				throw new Error("slot conflict");
			}),
		};
		const tmux = {
			adoptWindow: vi.fn(async () => ({
				sessionName: "takumi-side-agents",
				windowId: "@1",
				windowName: "agent-side-1",
				paneId: "%0",
			})),
			killWindow: vi.fn(async () => {}),
		};

		const summary = await reconcilePersistedSideAgents({
			agents,
			pool: pool as never,
			tmux: tmux as never,
			repoRoot: "/repo",
		});

		expect(summary).toEqual({ adopted: [], cleaned: [], crashed: ["side-1"], cleanupFailed: [] });
		expect(tmux.killWindow).toHaveBeenCalledWith("side-1");
		expect(agents.get("side-1")).toMatchObject({
			state: "crashed",
			error: expect.stringContaining("slot conflict"),
		});
	});
});
