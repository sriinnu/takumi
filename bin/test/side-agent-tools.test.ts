import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.fn(async () => {});
const flushPersistence = vi.fn(async () => {});
const cleanOrphans = vi.fn(async () => 0);
const registerSideAgentTools = vi.fn();
const reconcilePersistedSideAgents = vi.fn(async () => ({ adopted: [], cleaned: [], crashed: [], cleanupFailed: [] }));
const isGitRepo = vi.fn(() => true);
const isAvailable = vi.fn(async () => true);
const sideAgentRegistryCtor = vi.fn();
const worktreePoolCtor = vi.fn();
const tmuxOrchestratorCtor = vi.fn();

class SideAgentRegistry {
	constructor(options?: unknown) {
		sideAgentRegistryCtor(options);
	}

	load = load;
	flushPersistence = flushPersistence;
}

class WorktreePoolManager {
	constructor(...args: unknown[]) {
		worktreePoolCtor(...args);
	}

	cleanOrphans = cleanOrphans;
}

class TmuxOrchestrator {
	static isAvailable = isAvailable;

	constructor(sessionName?: string) {
		tmuxOrchestratorCtor(sessionName);
	}
}

vi.mock("@takumi/agent", () => ({
	registerSideAgentTools,
	reconcilePersistedSideAgents,
	SideAgentRegistry,
	TmuxOrchestrator,
	WorktreePoolManager,
}));

vi.mock("@takumi/bridge", () => ({
	isGitRepo,
}));

describe("registerOptionalSideAgentTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("loads and reconciles persisted side agents before registering tools", async () => {
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");
		const tools = { register: vi.fn() };
		const cwd = "/repo";

		const status = await registerOptionalSideAgentTools(
			tools as never,
			{
				model: "o3",
				sideAgent: { maxConcurrent: 3 },
			} as never,
				cwd,
			);

		expect(status).toMatchObject({ enabled: true, degraded: false, reason: "enabled", summary: "ready" });
		expect(sideAgentRegistryCtor).toHaveBeenCalledWith({
			baseDir: join(cwd, ".takumi/side-agents"),
			autoSave: true,
		});
		expect(load).toHaveBeenCalledOnce();
		expect(reconcilePersistedSideAgents).toHaveBeenCalledWith(
			expect.objectContaining({
				repoRoot: cwd,
			}),
		);
		expect(flushPersistence).toHaveBeenCalledOnce();
		expect(cleanOrphans).toHaveBeenCalledOnce();
		expect(cleanOrphans.mock.invocationCallOrder[0]).toBeGreaterThan(flushPersistence.mock.invocationCallOrder[0]);
		expect(registerSideAgentTools).toHaveBeenCalledOnce();
		expect(registerSideAgentTools.mock.invocationCallOrder[0]).toBeGreaterThan(cleanOrphans.mock.invocationCallOrder[0]);
	});

	it("returns false without touching persistence when tmux is unavailable", async () => {
		isAvailable.mockResolvedValueOnce(false);
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");

		const status = await registerOptionalSideAgentTools(
			{ register: vi.fn() } as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		expect(status).toMatchObject({ enabled: false, degraded: true, reason: "tmux_unavailable" });
		expect(sideAgentRegistryCtor).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
		expect(reconcilePersistedSideAgents).not.toHaveBeenCalled();
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(registerSideAgentTools).not.toHaveBeenCalled();
	});

	it("fails closed when registry load throws", async () => {
		load.mockRejectedValueOnce(new Error("registry unreadable"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");

		const status = await registerOptionalSideAgentTools(
			{ register: vi.fn() } as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		expect(status).toMatchObject({ enabled: false, degraded: true, reason: "bootstrap_failed" });
		expect(reconcilePersistedSideAgents).not.toHaveBeenCalled();
		expect(flushPersistence).not.toHaveBeenCalled();
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(registerSideAgentTools).not.toHaveBeenCalled();
	});

	it("fails closed when reconcile throws", async () => {
		reconcilePersistedSideAgents.mockRejectedValueOnce(new Error("reconcile blew up"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");

		const status = await registerOptionalSideAgentTools(
			{ register: vi.fn() } as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		expect(status).toMatchObject({ enabled: false, degraded: true, reason: "bootstrap_failed" });
		expect(flushPersistence).not.toHaveBeenCalled();
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(registerSideAgentTools).not.toHaveBeenCalled();
	});

	it("fails closed when persistence flush throws", async () => {
		flushPersistence.mockRejectedValueOnce(new Error("persist failed"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");

		const status = await registerOptionalSideAgentTools(
			{ register: vi.fn() } as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		expect(status).toMatchObject({ enabled: false, degraded: true, reason: "bootstrap_failed" });
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(registerSideAgentTools).not.toHaveBeenCalled();
	});

	it("fails closed when orphan cleanup throws", async () => {
		cleanOrphans.mockRejectedValueOnce(new Error("git worktree list failed"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");

		const status = await registerOptionalSideAgentTools(
			{ register: vi.fn() } as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		expect(status).toMatchObject({ enabled: false, degraded: true, reason: "bootstrap_failed" });
		expect(registerSideAgentTools).not.toHaveBeenCalled();
	});
});
