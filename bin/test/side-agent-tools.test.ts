import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.fn(async () => {});
const flushPersistence = vi.fn(async () => {});
const cleanOrphans = vi.fn(async () => 0);
const reconcilePersistedSideAgents = vi.fn(async () => ({ adopted: [], cleaned: [], crashed: [], cleanupFailed: [] }));
const isGitRepo = vi.fn(() => true);
const isAvailable = vi.fn(async () => true);
const sideAgentRegistryCtor = vi.fn();
const worktreePoolCtor = vi.fn();
const tmuxOrchestratorCtor = vi.fn();
const createAgentStartHandler = vi.fn();
const createAgentCheckHandler = vi.fn();
const createAgentWaitAnyHandler = vi.fn();
const createAgentSendHandler = vi.fn();
const createAgentStopHandler = vi.fn();
const createAgentQueryHandler = vi.fn();

const agentStartDefinition = { name: "takumi_agent_start" };
const agentCheckDefinition = { name: "takumi_agent_check" };
const agentWaitAnyDefinition = { name: "takumi_agent_wait_any" };
const agentSendDefinition = { name: "takumi_agent_send" };
const agentStopDefinition = { name: "takumi_agent_stop" };
const agentQueryDefinition = { name: "takumi_agent_query" };

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
	reconcilePersistedSideAgents,
	SideAgentRegistry,
	TmuxOrchestrator,
	WorktreePoolManager,
	agentStartDefinition,
	agentCheckDefinition,
	agentWaitAnyDefinition,
	agentSendDefinition,
	agentStopDefinition,
	agentQueryDefinition,
	createAgentStartHandler,
	createAgentCheckHandler,
	createAgentWaitAnyHandler,
	createAgentSendHandler,
	createAgentStopHandler,
	createAgentQueryHandler,
}));

vi.mock("@takumi/bridge", () => ({
	isGitRepo,
}));

describe("registerOptionalSideAgentTools", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createAgentStartHandler.mockReturnValue(vi.fn(async () => ({ output: "start ok", isError: false })));
		createAgentCheckHandler.mockReturnValue(vi.fn(async () => ({ output: "check ok", isError: false })));
		createAgentWaitAnyHandler.mockReturnValue(vi.fn(async () => ({ output: "wait ok", isError: false })));
		createAgentSendHandler.mockReturnValue(vi.fn(async () => ({ output: "send ok", isError: false })));
		createAgentStopHandler.mockReturnValue(vi.fn(async () => ({ output: "stop ok", isError: false })));
		createAgentQueryHandler.mockReturnValue(vi.fn(async () => ({ output: "query ok", isError: false })));
	});

	it("registers side-agent tools without eagerly hydrating runtime state", async () => {
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

		expect(status).toMatchObject({ enabled: true, degraded: false, reason: "enabled", summary: "ready (lazy bootstrap)" });
		expect(sideAgentRegistryCtor).toHaveBeenCalledWith({
			baseDir: join(cwd, ".takumi/side-agents"),
			autoSave: true,
		});
		expect(load).not.toHaveBeenCalled();
		expect(reconcilePersistedSideAgents).not.toHaveBeenCalled();
		expect(flushPersistence).not.toHaveBeenCalled();
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(tools.register).toHaveBeenCalledTimes(6);
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
		expect(createAgentStartHandler).not.toHaveBeenCalled();
	});

	it("hydrates runtime on first tool use and reuses it after that", async () => {
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");
		const registered = new Map<string, (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>>();
		const tools = {
			register: vi.fn((definition: { name: string }, handler: (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>) => {
				registered.set(definition.name, handler);
			}),
		};

		await registerOptionalSideAgentTools(
			tools as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		const startHandler = registered.get("takumi_agent_start");
		expect(startHandler).toBeDefined();
		await startHandler!({ description: "review runtime" });
		await startHandler!({ description: "review runtime again" });

		expect(load).toHaveBeenCalledOnce();
		expect(reconcilePersistedSideAgents).toHaveBeenCalledOnce();
		expect(flushPersistence).toHaveBeenCalledOnce();
		expect(cleanOrphans).toHaveBeenCalledOnce();
		expect(createAgentStartHandler).toHaveBeenCalledOnce();
	});

	it("fails closed at invocation time when registry load throws", async () => {
		load.mockRejectedValueOnce(new Error("registry unreadable"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");
		const registered = new Map<string, (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>>();

		const status = await registerOptionalSideAgentTools(
			{
				register: vi.fn((definition: { name: string }, handler: (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>) => {
					registered.set(definition.name, handler);
				}),
			} as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		expect(status).toMatchObject({ enabled: true, degraded: false, reason: "enabled" });
		const result = await registered.get("takumi_agent_start")!({ description: "review runtime" });
		expect(result.isError).toBe(true);
		expect(result.output).toContain("side-agent runtime bootstrap failed");
		expect(reconcilePersistedSideAgents).not.toHaveBeenCalled();
		expect(createAgentStartHandler).not.toHaveBeenCalled();
	});

	it("fails closed at invocation time when reconcile throws", async () => {
		reconcilePersistedSideAgents.mockRejectedValueOnce(new Error("reconcile blew up"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");
		const registered = new Map<string, (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>>();

		await registerOptionalSideAgentTools(
			{
				register: vi.fn((definition: { name: string }, handler: (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>) => {
					registered.set(definition.name, handler);
				}),
			} as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		const result = await registered.get("takumi_agent_start")!({ description: "review runtime" });
		expect(result.isError).toBe(true);
		expect(flushPersistence).not.toHaveBeenCalled();
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(createAgentStartHandler).not.toHaveBeenCalled();
	});

	it("fails closed at invocation time when persistence flush throws", async () => {
		flushPersistence.mockRejectedValueOnce(new Error("persist failed"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");
		const registered = new Map<string, (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>>();

		await registerOptionalSideAgentTools(
			{
				register: vi.fn((definition: { name: string }, handler: (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>) => {
					registered.set(definition.name, handler);
				}),
			} as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		const result = await registered.get("takumi_agent_start")!({ description: "review runtime" });
		expect(result.isError).toBe(true);
		expect(cleanOrphans).not.toHaveBeenCalled();
		expect(createAgentStartHandler).not.toHaveBeenCalled();
	});

	it("fails closed at invocation time when orphan cleanup throws", async () => {
		cleanOrphans.mockRejectedValueOnce(new Error("git worktree list failed"));
		const { registerOptionalSideAgentTools } = await import("../cli/side-agent-tools.js");
		const registered = new Map<string, (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>>();

		await registerOptionalSideAgentTools(
			{
				register: vi.fn((definition: { name: string }, handler: (input: Record<string, unknown>) => Promise<{ output: string; isError: boolean }>) => {
					registered.set(definition.name, handler);
				}),
			} as never,
			{ model: "o3", sideAgent: { maxConcurrent: 2 } } as never,
			"/repo",
		);

		const result = await registered.get("takumi_agent_start")!({ description: "review runtime" });
		expect(result.isError).toBe(true);
		expect(createAgentStartHandler).not.toHaveBeenCalled();
	});
});
