import type { SideAgentInfo, SideAgentState, ToolResult } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";

import type { SideAgentListener } from "../src/cluster/side-agent-registry.js";

import { ToolRegistry } from "../src/tools/registry.js";
import {
	agentCheckDefinition,
	agentQueryDefinition,
	agentSendDefinition,
	agentStartDefinition,
	agentStopDefinition,
	agentWaitAnyDefinition,
	createAgentCheckHandler,
	createAgentQueryHandler,
	createAgentSendHandler,
	createAgentStartHandler,
	createAgentStopHandler,
	createAgentWaitAnyHandler,
	registerSideAgentTools,
	type SideAgentToolDeps,
} from "../src/tools/side-agent.js";
import { inferTopicDomain } from "../src/tools/side-agent-routing.js";
import { SIDE_AGENT_READY_MARKER } from "../src/tools/side-agent-worker-protocol.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<SideAgentInfo> = {}): SideAgentInfo {
	return {
		id: "side-1",
		description: "test agent",
		state: "running",
		model: "claude-sonnet",
		slotId: "wt-0001",
		worktreePath: "/tmp/worktrees/wt-0001",
		tmuxWindow: "agent-side-1",
		tmuxSessionName: "takumi-agents-test",
		tmuxWindowId: "@1",
		tmuxPaneId: "%0",
		branch: "takumi/side-agent/side-1-wt-0001",
		pid: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

function createMockDeps(): SideAgentToolDeps {
	let idCounter = 0;
	const agents = new Map<string, SideAgentInfo>();
	const listeners = new Set<SideAgentListener>();

	return {
		pool: {
			hasCapacity: vi.fn(() => true),
			allocate: vi.fn(async (agentId: string) => ({
				id: "wt-0001",
				path: `/tmp/worktrees/wt-0001`,
				branch: `takumi/side-agent/${agentId}-wt-0001`,
				inUse: true,
				agentId,
				createdAt: Date.now(),
			})),
			release: vi.fn(),
			getActiveSlots: vi.fn(() => []),
		} as unknown as SideAgentToolDeps["pool"],

		tmux: {
			createWindow: vi.fn(async (agentId: string, _cwd: string) => ({
				sessionName: "takumi-agents-test",
				windowId: "@1",
				windowName: `agent-${agentId}`,
				paneId: "%0",
			})),
			sendKeys: vi.fn(async () => {}),
			captureOutput: vi.fn(
				async (agentId: string) => `[${SIDE_AGENT_READY_MARKER} id=${agentId} ts=1]\nline 1\nline 2\nline 3`,
			),
			isWindowAlive: vi.fn(async () => true),
			killWindow: vi.fn(async () => {}),
		} as unknown as SideAgentToolDeps["tmux"],

		agents: {
			nextId: vi.fn(() => {
				idCounter += 1;
				return `side-${idCounter}`;
			}),
			register: vi.fn((info: SideAgentInfo) => {
				agents.set(info.id, { ...info });
			}),
			get: vi.fn((id: string) => {
				const a = agents.get(id);
				return a ? { ...a } : undefined;
			}),
			getAll: vi.fn(() => [...agents.values()]),
			remove: vi.fn((id: string) => agents.delete(id)),
			update: vi.fn((id: string, patch: Partial<SideAgentInfo>) => {
				const agent = agents.get(id);
				if (!agent) {
					throw new Error(`Side agent "${id}" not found`);
				}
				Object.assign(agent, patch);
				agent.updatedAt = Date.now();
				return { ...agent };
			}),
			transition: vi.fn((id: string, newState: SideAgentState, error?: string) => {
				const a = agents.get(id);
				if (a) {
					const from = a.state;
					a.state = newState;
					if (error !== undefined) {
						a.error = error;
					}
					a.updatedAt = Date.now();
					for (const listener of listeners) {
						listener({ type: "agent_state_changed", id, from, to: newState });
					}
				}
			}),
			on: vi.fn((listener: SideAgentListener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			}),
		} as unknown as SideAgentToolDeps["agents"],

		repoRoot: "/tmp/test-repo",
	};
}

function parse(result: ToolResult): Record<string, unknown> {
	return JSON.parse(result.output) as Record<string, unknown>;
}

function seedAgent(deps: SideAgentToolDeps, overrides: Partial<SideAgentInfo> = {}): SideAgentInfo {
	const agent = makeAgent(overrides);
	(deps.agents.register as ReturnType<typeof vi.fn>)(agent);
	return agent;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("takumi_agent_start", () => {
	it("registers agent and returns ID", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Fix the login bug" });
		expect(result.isError).toBe(false);

		const data = parse(result);
		expect(data.id).toBe("side-1");
		expect(data.status).toBe("running");
		expect(data.worktree).toBe("/tmp/worktrees/wt-0001");
		expect(data.branch).toContain("side-1");

		expect(deps.pool.allocate).toHaveBeenCalledWith("side-1");
		expect(deps.agents.register).toHaveBeenCalled();
		expect(deps.tmux.createWindow).toHaveBeenCalledWith("side-1", "/tmp/worktrees/wt-0001");
		expect(deps.tmux.sendKeys).toHaveBeenNthCalledWith(
			1,
			"side-1",
			expect.stringContaining("bin/cli/side-agent-worker.ts"),
		);
		expect(deps.tmux.sendKeys).toHaveBeenNthCalledWith(
			2,
			"side-1",
			expect.stringContaining("[TAKUMI_SIDE_AGENT_DISPATCH id=side-1 seq=1 kind=start]"),
		);
		expect(deps.agents.transition).toHaveBeenCalledWith("side-1", "running");
	});

	it("dispatches the initial task envelope when provided", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Plan auth refactor", initialPrompt: "produce a plan" });

		expect(deps.tmux.sendKeys).toHaveBeenNthCalledWith(
			2,
			"side-1",
			expect.stringContaining("Primary task: Plan auth refactor"),
		);
		expect(deps.tmux.sendKeys).toHaveBeenNthCalledWith(2, "side-1", expect.stringContaining("produce a plan"));
	});

	it("rolls back the slot and registry entry when tmux window creation fails", async () => {
		const deps = createMockDeps();
		(deps.tmux.createWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("tmux unavailable"));
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Investigate lane failure" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("tmux unavailable");
		expect(deps.pool.release).toHaveBeenCalledWith("wt-0001");
		expect(deps.agents.remove).toHaveBeenCalledWith("side-1");
	});

	it("rolls back the slot and registry entry when initial prompt delivery fails", async () => {
		const deps = createMockDeps();
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("pane write failed"));
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Investigate lane failure", initialPrompt: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("pane write failed");
		expect(deps.pool.release).toHaveBeenCalledWith("wt-0001");
		expect(deps.agents.remove).toHaveBeenCalledWith("side-1");
	});

	it("keeps a failed registry row when worktree rollback cleanup fails", async () => {
		const deps = createMockDeps();
		(deps.tmux.createWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("tmux unavailable"));
		(deps.pool.release as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("worktree busy"));
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Investigate lane failure" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("tmux unavailable");
		expect(result.output).toContain("Cleanup also failed: worktree cleanup failed: worktree busy");
		expect(deps.agents.remove).not.toHaveBeenCalled();
		expect(deps.agents.transition).toHaveBeenCalledWith(
			"side-1",
			"failed",
			expect.stringContaining("Residual cleanup failed after startup error."),
		);
		expect(deps.agents.get("side-1")).toMatchObject({
			state: "failed",
			slotId: "wt-0001",
			worktreePath: "/tmp/worktrees/wt-0001",
			tmuxWindow: null,
			error: expect.stringContaining("worktree busy"),
		});
	});

	it("preserves tmux metadata when window rollback cleanup fails", async () => {
		const deps = createMockDeps();
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("pane write failed"));
		(deps.tmux.killWindow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("tmux stuck"));
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Investigate lane failure", initialPrompt: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("pane write failed");
		expect(result.output).toContain("Cleanup also failed: tmux cleanup failed: tmux stuck");
		expect(deps.pool.release).toHaveBeenCalledWith("wt-0001");
		expect(deps.agents.remove).not.toHaveBeenCalled();
		expect(deps.agents.get("side-1")).toMatchObject({
			state: "failed",
			slotId: null,
			worktreePath: null,
			tmuxWindow: "agent-side-1",
			tmuxSessionName: "takumi-agents-test",
			tmuxWindowId: "@1",
			tmuxPaneId: "%0",
			error: expect.stringContaining("tmux stuck"),
		});
	});

	it("fails when pool is at capacity", async () => {
		const deps = createMockDeps();
		(deps.pool.hasCapacity as ReturnType<typeof vi.fn>).mockReturnValue(false);

		const handler = createAgentStartHandler(deps);
		const result = await handler({ description: "Another task" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("at capacity");
		expect(deps.pool.allocate).not.toHaveBeenCalled();
	});

	it("uses default model when none specified", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Some task" });

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("claude-sonnet");
		expect(registerCall.tmuxSessionName).toBeNull();
	});

	it("uses configured side-agent default model when provided", async () => {
		const deps = createMockDeps();
		deps.defaultModel = "gpt-4o-mini";
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Handle a generic backlog task cheaply" });

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("gpt-4o-mini");
	});

	it("uses topic-aware routing when an explicit topic is provided", async () => {
		const deps = createMockDeps();
		deps.defaultModel = "gpt-4o-mini";
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Audit the auth layer", topic: "code-review" });
		expect(result.isError).toBe(false);

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("o3");

		const data = parse(result);
		expect(data.model).toBe("o3");
		expect(data.topic).toBe("code-review");
		expect(data.routingSource).toBe("topic");
	});

	it("uses preferred model when provided and no topic routing applies", async () => {
		const deps = createMockDeps();
		deps.defaultModel = "gpt-4o-mini";
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Handle generic coordination work", preferredModel: "o3-mini" });
		expect(result.isError).toBe(false);

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("o3-mini");

		const data = parse(result);
		expect(data.model).toBe("o3-mini");
		expect(data.routingSource).toBe("preferred");
	});

	it("keeps topic-aware routing ahead of preferred model hints", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		const result = await handler({
			description: "Audit the auth patch with a second-pass review",
			topic: "code-review",
			preferredModel: "gpt-4o-mini",
		});
		expect(result.isError).toBe(false);

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).not.toBe("gpt-4o-mini");

		const data = parse(result);
		expect(data.routingSource).toBe("topic");
		expect(data.topic).toBe("code-review");
	});

	it("infers topic-aware routing from the task description", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Write README guidance and summarize missing documentation" });

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("claude-haiku-4-20250514");
	});

	it("passes custom model through", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Some task", model: "gpt-4o" });

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("gpt-4o");
	});

	it("keeps explicit model overrides ahead of topic routing", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		const result = await handler({
			description: "Review the auth patch for vulnerabilities",
			topic: "security-analysis",
			model: "gpt-4o",
		});

		expect(result.isError).toBe(false);
		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("gpt-4o");

		const data = parse(result);
		expect(data.routingSource).toBe("explicit");
		expect(data.topic).toBeNull();
	});
});

describe("inferTopicDomain", () => {
	it("respects explicit valid topics", () => {
		expect(inferTopicDomain("anything", "testing")).toBe("testing");
	});

	it("infers topics from task descriptions", () => {
		expect(inferTopicDomain("Debug the flaky integration failure")).toBe("debugging");
		expect(inferTopicDomain("Write docs for the mesh handoff flow")).toBe("documentation");
	});
});

describe("takumi_agent_check", () => {
	it("returns status and output for known agent", async () => {
		const deps = createMockDeps();
		seedAgent(deps);

		const handler = createAgentCheckHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.id).toBe("side-1");
		expect(data.state).toBe("running");
		expect(data.recentOutput).toContain("line 1");
		expect(deps.tmux.captureOutput).toHaveBeenCalledWith("side-1", 50);
	});

	it("handles unknown agent", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

		const handler = createAgentCheckHandler(deps);
		const result = await handler({ id: "nope" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain('unknown agent "nope"');
	});

	it("handles tmux capture failure gracefully", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent());
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("tmux dead"));

		const handler = createAgentCheckHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.recentOutput).toBe("<no output available>");
	});

	it("marks a live agent crashed when its tmux window is gone", async () => {
		const deps = createMockDeps();
		let currentAgent = makeAgent({ id: "side-1", state: "running" });
		(deps.agents.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
			id === "side-1" ? { ...currentAgent } : undefined,
		);
		(deps.agents.transition as ReturnType<typeof vi.fn>).mockImplementation(
			(id: string, newState: SideAgentState, error?: string) => {
				if (id === "side-1") {
					currentAgent = { ...currentAgent, state: newState, error, updatedAt: Date.now() };
				}
			},
		);
		(deps.tmux.isWindowAlive as ReturnType<typeof vi.fn>).mockResolvedValue(false);
		const handler = createAgentCheckHandler(deps);

		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		expect(deps.agents.transition).toHaveBeenCalledWith(
			"side-1",
			"crashed",
			"Side-agent tmux window is no longer alive.",
		);
		const data = parse(result);
		expect(data.state).toBe("crashed");
		expect(data.recentOutput).toBe("<tmux window missing>");
	});

	it("keeps pre-tmux startup lanes pending instead of crashing them", async () => {
		const deps = createMockDeps();
		const pendingAgent = makeAgent({
			id: "side-1",
			state: "spawning_tmux",
			tmuxWindow: null,
			tmuxSessionName: null,
			tmuxWindowId: null,
			tmuxPaneId: null,
		});
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(pendingAgent);
		(deps.tmux.isWindowAlive as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		const handler = createAgentCheckHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		expect(deps.agents.transition).not.toHaveBeenCalled();
		const data = parse(result);
		expect(data.state).toBe("spawning_tmux");
		expect(data.recentOutput).toBe("<tmux window pending>");
	});
});

describe("takumi_agent_wait_any", () => {
	it("resolves immediately when agent already in target state", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
			if (id === "side-1") return makeAgent({ id: "side-1", state: "done" });
			return undefined;
		});

		const handler = createAgentWaitAnyHandler(deps);
		const result = await handler({ ids: ["side-1"] });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.id).toBe("side-1");
		expect(data.state).toBe("done");
	});

	it("waits and resolves when agent transitions to target state", async () => {
		const deps = createMockDeps();
		let capturedListener: SideAgentListener | null = null;

		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
		(deps.agents.on as ReturnType<typeof vi.fn>).mockImplementation((listener: SideAgentListener) => {
			capturedListener = listener;
			return () => {
				capturedListener = null;
			};
		});

		const handler = createAgentWaitAnyHandler(deps);
		const resultPromise = handler({ ids: ["side-1"] });

		// Simulate state change after a tick
		await new Promise((r) => setTimeout(r, 10));
		expect(capturedListener).not.toBeNull();
		capturedListener!({ type: "agent_state_changed", id: "side-1", from: "running", to: "done" });

		const result = await resultPromise;
		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.id).toBe("side-1");
		expect(data.state).toBe("done");
	});

	it("uses custom target states", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "finishing" }));

		const handler = createAgentWaitAnyHandler(deps);
		const result = await handler({ ids: ["side-1"], states: ["finishing"] });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.state).toBe("finishing");
	});

	it("respects abort signal", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
		(deps.agents.on as ReturnType<typeof vi.fn>).mockImplementation(() => () => {});

		const controller = new AbortController();
		const handler = createAgentWaitAnyHandler(deps);
		const resultPromise = handler({ ids: ["side-1"] }, controller.signal);

		controller.abort();
		const result = await resultPromise;
		expect(result.isError).toBe(true);
		expect(result.output).toContain("aborted");
	});

	it("returns immediately for a pre-aborted signal", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));

		const controller = new AbortController();
		controller.abort();

		const handler = createAgentWaitAnyHandler(deps);
		const result = await handler({ ids: ["side-1"] }, controller.signal);

		expect(result.isError).toBe(true);
		expect(result.output).toContain("aborted");
		expect(deps.agents.on).not.toHaveBeenCalled();
	});
});

describe("takumi_agent_send", () => {
	it("queues a dispatch envelope for a running agent", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "side-1", prompt: "run the tests" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.sent).toBe(true);
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith(
			"side-1",
			expect.stringContaining("[TAKUMI_SIDE_AGENT_DISPATCH id=side-1 seq=1 kind=send]"),
		);
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", expect.stringContaining("run the tests"));
	});

	it("queues a dispatch envelope for a waiting_user agent", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "waiting_user" });

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "side-1", prompt: "yes" });

		expect(result.isError).toBe(false);
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", expect.stringContaining("kind=send"));
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", expect.stringContaining("yes"));
	});

	it("fails for non-running agent", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "done" }));

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "side-1", prompt: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("done");
		expect(result.output).toContain("can only send");
		expect(deps.tmux.sendKeys).not.toHaveBeenCalled();
	});

	it("fails for unknown agent", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "nope", prompt: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain('unknown agent "nope"');
	});

	it("marks the lane crashed when its tmux window is missing", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });
		(deps.tmux.isWindowAlive as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "side-1", prompt: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("tmux window is missing");
		expect(deps.agents.transition).toHaveBeenCalledWith(
			"side-1",
			"crashed",
			"Side-agent tmux window is no longer alive.",
		);
	});
});

describe("takumi_agent_stop", () => {
	it("stops a running agent, closes tmux, and releases the worktree", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
		(deps.agents.update as ReturnType<typeof vi.fn>).mockImplementation(
			(_id: string, patch: Partial<SideAgentInfo>) => ({
				...makeAgent({ state: "stopped" }),
				...patch,
			}),
		);

		const handler = createAgentStopHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.state).toBe("stopped");
		expect(data.reason).toBe("Stopped by operator");
		expect(data.closedWindow).toBe(true);
		expect(data.releasedWorktree).toBe(true);
		expect(deps.tmux.killWindow).toHaveBeenCalledWith("side-1");
		expect(deps.pool.release).toHaveBeenCalledWith("wt-0001");
		expect(deps.agents.transition).toHaveBeenCalledWith("side-1", "stopped", "Stopped by operator");
		expect(deps.agents.update).toHaveBeenCalledWith(
			"side-1",
			expect.objectContaining({
				tmuxWindow: null,
				tmuxSessionName: null,
				tmuxWindowId: null,
				tmuxPaneId: null,
				slotId: null,
				worktreePath: null,
			}),
		);
	});

	it("accepts waiting_user agents", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "waiting_user" }));
		(deps.agents.update as ReturnType<typeof vi.fn>).mockImplementation(
			(_id: string, patch: Partial<SideAgentInfo>) => ({
				...makeAgent({ state: "stopped" }),
				...patch,
			}),
		);

		const handler = createAgentStopHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		expect(deps.tmux.killWindow).toHaveBeenCalledWith("side-1");
	});

	it("returns alreadyStopped for terminal agents", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "done" }));

		const handler = createAgentStopHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.alreadyStopped).toBe(true);
		expect(deps.tmux.killWindow).not.toHaveBeenCalled();
		expect(deps.pool.release).not.toHaveBeenCalled();
	});

	it("surfaces partial cleanup failures after marking the lane failed", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
		(deps.agents.update as ReturnType<typeof vi.fn>).mockImplementation(
			(_id: string, patch: Partial<SideAgentInfo>) => ({
				...makeAgent({ state: "stopped" }),
				...patch,
			}),
		);
		(deps.pool.release as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("worktree locked"));

		const handler = createAgentStopHandler(deps);
		const result = await handler({ id: "side-1" });

		expect(result.isError).toBe(true);
		expect(deps.agents.transition).toHaveBeenCalledWith("side-1", "stopped", "Stopped by operator");
		expect(deps.agents.update).toHaveBeenCalledWith(
			"side-1",
			expect.objectContaining({ error: expect.stringContaining("worktree locked") }),
		);
		const data = parse(result);
		expect(data.closedWindow).toBe(true);
		expect(data.releasedWorktree).toBe(false);
		expect(data.cleanupErrors).toEqual([expect.stringContaining("worktree locked")]);
	});
});

describe("takumi_agent_query", () => {
	it("returns structured result when agent responds with JSON", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, prompt: string) => {
			const requestId = /STRUCTURED_QUERY id=([^\s\]]+)/.exec(prompt)?.[1] ?? "unknown";
			(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
				`[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}","answer":42}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`,
			);
		});

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "what is x?" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.responseType).toBe("structured");
		expect((data.response as Record<string, unknown>).answer).toBe(42);
		expect((data.response as Record<string, unknown>).requestId).toBe(data.requestId);
		expect(data.query).toBe("what is x?");
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", expect.stringContaining("what is x?"));
	});

	it("uses default format 'json' when not specified", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, prompt: string) => {
			const requestId = /STRUCTURED_QUERY id=([^\s\]]+)/.exec(prompt)?.[1] ?? "unknown";
			(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
				`[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}","ok":true}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`,
			);
		});

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "test" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.format).toBe("json");
	});

	it("accepts waiting_user agent state", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "waiting_user" });
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, prompt: string) => {
			const requestId = /STRUCTURED_QUERY id=([^\s\]]+)/.exec(prompt)?.[1] ?? "unknown";
			(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
				`[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}","status":"ready"}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`,
			);
		});

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "ready?" });

		expect(result.isError).toBe(false);
		expect(deps.tmux.sendKeys).toHaveBeenCalled();
	});

	it("returns error for unknown agent", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "ghost", query: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain('unknown agent "ghost"');
	});

	it("returns error for agent in non-queryable state", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "done" }));

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "hello" });

		expect(result.isError).toBe(true);
		expect(result.output).toContain("done");
		expect(result.output).toContain("can only query");
		expect(deps.tmux.sendKeys).not.toHaveBeenCalled();
	});

	it("returns error for starting agent state", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "starting" }));

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "hello" });

		expect(result.isError).toBe(true);
		expect(deps.tmux.sendKeys).not.toHaveBeenCalled();
	});

	it("respects abort signal before first poll", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue("no json here");

		const controller = new AbortController();
		controller.abort();

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "hello" }, controller.signal);

		expect(result.isError).toBe(true);
		expect(result.output).toContain("aborted");
	});

	it("falls back to raw output on timeout", async () => {
		vi.useFakeTimers();
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue("raw output, no json block");

		const handler = createAgentQueryHandler(deps);
		const resultPromise = handler({ id: "side-1", query: "hello" });

		// Advance past the 60s polling timeout
		await vi.advanceTimersByTimeAsync(61_000);

		const result = await resultPromise;
		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.responseType).toBe("raw");
		expect(data.warning).toContain("Timed out");

		vi.useRealTimers();
	});

	it("handles tmux capture failure mid-poll gracefully", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });

		let callCount = 0;
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, prompt: string) => {
			const requestId = /STRUCTURED_QUERY id=([^\s\]]+)/.exec(prompt)?.[1] ?? "unknown";
			(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockImplementation(async () => {
				callCount += 1;
				if (callCount === 1) throw new Error("tmux pane gone");
				return `[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}","recovered":true}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`;
			});
		});

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "test resilience" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.responseType).toBe("structured");
		expect((data.response as Record<string, unknown>).recovered).toBe(true);
	});

	it("ignores stale JSON blocks from earlier structured queries", async () => {
		const deps = createMockDeps();
		seedAgent(deps, { state: "running" });
		(deps.tmux.sendKeys as ReturnType<typeof vi.fn>).mockImplementation(async (_id: string, prompt: string) => {
			const requestId = /STRUCTURED_QUERY id=([^\s\]]+)/.exec(prompt)?.[1] ?? "unknown";
			(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
				[
					'[STRUCTURED_QUERY_RESPONSE id=old-request]\n```json\n{"requestId":"old-request","answer":"stale"}\n```\n[/STRUCTURED_QUERY_RESPONSE]',
					`[STRUCTURED_QUERY_RESPONSE id=${requestId}]\n\`\`\`json\n{"requestId":"${requestId}","answer":"fresh"}\n\`\`\`\n[/STRUCTURED_QUERY_RESPONSE]`,
				].join("\n"),
			);
		});
		const handler = createAgentQueryHandler(deps);

		const result = await handler({ id: "side-1", query: "latest answer?" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect((data.response as Record<string, unknown>).answer).toBe("fresh");
	});
});

describe("registerSideAgentTools", () => {
	it("registers all side-agent tools in registry", () => {
		const registry = new ToolRegistry();
		const deps = createMockDeps();

		registerSideAgentTools(registry, deps);

		expect(registry.has("takumi_agent_start")).toBe(true);
		expect(registry.has("takumi_agent_check")).toBe(true);
		expect(registry.has("takumi_agent_wait_any")).toBe(true);
		expect(registry.has("takumi_agent_send")).toBe(true);
		expect(registry.has("takumi_agent_stop")).toBe(true);
		expect(registry.has("takumi_agent_query")).toBe(true);
		expect(registry.size).toBe(6);
	});

	it("tool definitions have correct categories", () => {
		expect(agentStartDefinition.category).toBe("execute");
		expect(agentCheckDefinition.category).toBe("read");
		expect(agentWaitAnyDefinition.category).toBe("interact");
		expect(agentSendDefinition.category).toBe("interact");
		expect(agentStopDefinition.category).toBe("execute");
		expect(agentQueryDefinition.category).toBe("interact");
	});

	it("tool definitions have correct permission flags", () => {
		expect(agentStartDefinition.requiresPermission).toBe(true);
		expect(agentCheckDefinition.requiresPermission).toBe(false);
		expect(agentWaitAnyDefinition.requiresPermission).toBe(false);
		expect(agentSendDefinition.requiresPermission).toBe(true);
		expect(agentStopDefinition.requiresPermission).toBe(true);
		expect(agentQueryDefinition.requiresPermission).toBe(false);
	});
});
