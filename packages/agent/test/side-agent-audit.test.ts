import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("@takumi/bridge", () => ({
	gitWorktreeList: vi.fn(() => []),
	gitBranch: vi.fn(() => "takumi/side-agent/side-1-wt-0001"),
}));

vi.mock("@takumi/core", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

import { gitBranch, gitWorktreeList } from "@takumi/bridge";

const { auditSideAgentRuntime } = await import("../src/cluster/side-agent-audit.js");

type ExecFileCb = (err: Error | null, stdout: string, stderr: string) => void;

const mockedExecFile = execFile as unknown as Mock;
const REPO_ROOT = "/repo";
const WORKTREE_BASE = ".takumi/worktrees";
const tempDirs: string[] = [];

function makeAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "side-1",
		description: "side agent",
		state: "running",
		model: "gpt-5",
		slotId: "wt-0001",
		worktreePath: `${REPO_ROOT}/.takumi/worktrees/wt-0001`,
		tmuxWindow: "agent-side-1",
		tmuxSessionName: "takumi-side-agents",
		tmuxWindowId: "@1",
		tmuxPaneId: "%1",
		branch: "takumi/side-agent/side-1-wt-0001",
		pid: null,
		startedAt: 100,
		updatedAt: 100,
		...overrides,
	};
}

async function createRegistry(entries: unknown[]): Promise<string> {
	const baseDir = await mkdtemp(join(tmpdir(), "takumi-side-agent-audit-"));
	tempDirs.push(baseDir);
	await mkdir(baseDir, { recursive: true });
	await writeFile(join(baseDir, "registry.json"), JSON.stringify(entries, null, 2));
	return baseDir;
}

describe("auditSideAgentRuntime", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("skips tmux-missing findings when tmux is unavailable", async () => {
		const worktreePath = `${REPO_ROOT}/.takumi/worktrees/wt-0001`;
		const registryBaseDir = await createRegistry([makeAgent({ worktreePath })]);
		vi.mocked(gitWorktreeList).mockReturnValue([worktreePath]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");

		const audit = await auditSideAgentRuntime({
			repoRoot: REPO_ROOT,
			registryBaseDir,
			worktreeBaseDir: WORKTREE_BASE,
			tmuxAvailable: false,
		});

		expect(audit.tmuxInspected).toBe(false);
		expect(audit.issues.map((issue) => issue.code)).not.toContain("live_tmux_missing");
		expect(vi.mocked(gitWorktreeList)).toHaveBeenCalledTimes(1);
		expect(mockedExecFile).not.toHaveBeenCalled();
	});

	it("reports live drift, terminal residue, and orphaned worktrees in one pass", async () => {
		const liveWorktree = `${REPO_ROOT}/.takumi/worktrees/wt-0001`;
		const terminalWorktree = `${REPO_ROOT}/.takumi/worktrees/wt-0002`;
		const orphanedWorktree = `${REPO_ROOT}/.takumi/worktrees/wt-orphan`;
		const registryBaseDir = await createRegistry([
			makeAgent({ worktreePath: liveWorktree }),
			makeAgent({
				id: "side-2",
				state: "stopped",
				slotId: "wt-0002",
				worktreePath: terminalWorktree,
				tmuxWindow: "agent-side-2",
				tmuxWindowId: "@2",
				tmuxPaneId: "%2",
				branch: "takumi/side-agent/side-2-wt-0002",
			}),
		]);
		vi.mocked(gitWorktreeList).mockReturnValue([liveWorktree, terminalWorktree, orphanedWorktree]);
		vi.mocked(gitBranch).mockImplementation((worktreePath) =>
			worktreePath === liveWorktree ? "main" : "takumi/side-agent/side-2-wt-0002",
		);
		mockedExecFile.mockImplementation((_cmd: string, args: string[], cb: ExecFileCb) => {
			if (args[0] === "list-windows") {
				cb(null, "@2:agent-side-2:%2", "");
				return;
			}
			cb(new Error(`unexpected tmux call: ${args.join(" ")}`), "", "");
		});

		const audit = await auditSideAgentRuntime({
			repoRoot: REPO_ROOT,
			registryBaseDir,
			worktreeBaseDir: WORKTREE_BASE,
			tmuxAvailable: true,
		});

		expect(audit.tmuxInspected).toBe(true);
		expect(audit.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"live_branch_drift",
				"live_tmux_missing",
				"terminal_worktree_residual",
				"terminal_tmux_residual",
				"orphaned_worktree",
			]),
		);
		expect(audit.orphanedWorktrees).toEqual([orphanedWorktree]);
		expect(vi.mocked(gitWorktreeList)).toHaveBeenCalledTimes(1);
		expect(mockedExecFile).toHaveBeenCalledTimes(1);
	});

	it("trusts durable tmux window ids over pane-id drift", async () => {
		const worktreePath = `${REPO_ROOT}/.takumi/worktrees/wt-0001`;
		const registryBaseDir = await createRegistry([makeAgent({ worktreePath, tmuxPaneId: "%1" })]);
		vi.mocked(gitWorktreeList).mockReturnValue([worktreePath]);
		vi.mocked(gitBranch).mockReturnValue("takumi/side-agent/side-1-wt-0001");
		mockedExecFile.mockImplementation((_cmd: string, args: string[], cb: ExecFileCb) => {
			if (args[0] === "list-windows") {
				cb(null, "@1:agent-side-1:%9", "");
				return;
			}
			cb(new Error(`unexpected tmux call: ${args.join(" ")}`), "", "");
		});

		const audit = await auditSideAgentRuntime({
			repoRoot: REPO_ROOT,
			registryBaseDir,
			worktreeBaseDir: WORKTREE_BASE,
			tmuxAvailable: true,
		});

		expect(audit.issues.map((issue) => issue.code)).not.toContain("live_tmux_missing");
	});

	it("surfaces malformed and normalized registry rows without mutating disk", async () => {
		const registryBaseDir = await createRegistry([
			makeAgent({ state: "invalid-state", description: "" }),
			makeAgent({ id: "side-1", tmuxWindowId: "@9" }),
			{ nope: true },
		]);

		const audit = await auditSideAgentRuntime({
			repoRoot: REPO_ROOT,
			registryBaseDir,
			worktreeBaseDir: WORKTREE_BASE,
			tmuxAvailable: false,
		});

		expect(audit.registry.totalEntries).toBe(3);
		expect(audit.registry.normalizedEntries).toBe(1);
		expect(audit.registry.malformedEntries).toBe(2);
		expect(audit.registry.records).toHaveLength(3);
		expect(audit.issues.map((issue) => issue.code)).toEqual(
			expect.arrayContaining(["registry_entry_normalized", "registry_entry_malformed"]),
		);
	});

	it("keeps incomplete persisted live lanes as live audit failures", async () => {
		const worktreePath = `${REPO_ROOT}/.takumi/worktrees/wt-0001`;
		const registryBaseDir = await createRegistry([
			makeAgent({
				worktreePath,
				tmuxWindow: null,
				tmuxWindowId: null,
				tmuxPaneId: null,
			}),
		]);
		vi.mocked(gitWorktreeList).mockReturnValue([worktreePath]);

		const audit = await auditSideAgentRuntime({
			repoRoot: REPO_ROOT,
			registryBaseDir,
			worktreeBaseDir: WORKTREE_BASE,
			tmuxAvailable: false,
		});

		expect(audit.activeAgents).toBe(1);
		expect(audit.terminalAgents).toBe(0);
		expect(audit.registry.records.find((record) => record.rawId === "side-1")?.incompleteLive).toBe(true);
		expect(audit.issues.map((issue) => issue.code)).toContain("live_metadata_incomplete");
		expect(audit.issues.map((issue) => issue.code)).not.toContain("terminal_worktree_residual");
	});

	it("surfaces registry read failures instead of pretending the registry is empty", async () => {
		const registryBaseDir = await mkdtemp(join(tmpdir(), "takumi-side-agent-audit-eisdir-"));
		tempDirs.push(registryBaseDir);
		await mkdir(join(registryBaseDir, "registry.json"), { recursive: true });

		const audit = await auditSideAgentRuntime({
			repoRoot: REPO_ROOT,
			registryBaseDir,
			worktreeBaseDir: WORKTREE_BASE,
			tmuxAvailable: false,
		});

		expect(audit.registry.readError).toBeTruthy();
		expect(audit.issues.map((issue) => issue.code)).toContain("registry_read_failed");
	});
});
