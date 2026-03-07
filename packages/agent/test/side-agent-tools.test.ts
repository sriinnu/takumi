import type { SideAgentInfo, SideAgentState, ToolResult } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";

import type { SideAgentListener } from "../src/cluster/side-agent-registry.js";

import { ToolRegistry } from "../src/tools/registry.js";
import {
	agentCheckDefinition,
	agentQueryDefinition,
	agentSendDefinition,
	agentStartDefinition,
	agentWaitAnyDefinition,
	createAgentCheckHandler,
	createAgentQueryHandler,
	createAgentSendHandler,
	createAgentStartHandler,
	createAgentWaitAnyHandler,
	registerSideAgentTools,
	type SideAgentToolDeps,
} from "../src/tools/side-agent.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<SideAgentInfo> = {}): SideAgentInfo {
	return {
		id: "side-1",
		description: "test agent",
		state: "running",
		model: "claude-sonnet",
		worktreePath: "/tmp/worktrees/wt-0001",
		tmuxWindow: "agent-side-1",
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
			captureOutput: vi.fn(async () => "line 1\nline 2\nline 3"),
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
			transition: vi.fn((id: string, newState: SideAgentState) => {
				const a = agents.get(id);
				if (a) {
					const from = a.state;
					a.state = newState;
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("takumi_agent_start", () => {
	it("registers agent and returns ID", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		const result = await handler({ description: "Fix the login bug" });
		expect(result.isError).toBe(false);

		const data = parse(result);
		expect(data.id).toBe("side-1");
		expect(data.status).toBe("starting");
		expect(data.worktree).toBe("/tmp/worktrees/wt-0001");
		expect(data.branch).toContain("side-1");

		expect(deps.pool.allocate).toHaveBeenCalledWith("side-1");
		expect(deps.agents.register).toHaveBeenCalled();
		expect(deps.tmux.createWindow).toHaveBeenCalledWith("side-1", "/tmp/worktrees/wt-0001");
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
	});

	it("uses configured side-agent default model when provided", async () => {
		const deps = createMockDeps();
		deps.defaultModel = "gpt-4o-mini";
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Review docs cheaply" });

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("gpt-4o-mini");
	});

	it("passes custom model through", async () => {
		const deps = createMockDeps();
		const handler = createAgentStartHandler(deps);

		await handler({ description: "Some task", model: "gpt-4o" });

		const registerCall = (deps.agents.register as ReturnType<typeof vi.fn>).mock.calls[0][0] as SideAgentInfo;
		expect(registerCall.model).toBe("gpt-4o");
	});
});

describe("takumi_agent_check", () => {
	it("returns status and output for known agent", async () => {
		const deps = createMockDeps();
		// Pre-populate agent
		const agent = makeAgent();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(agent);

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
});

describe("takumi_agent_send", () => {
	it("sends keys to tmux window for running agent", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "side-1", prompt: "run the tests" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.sent).toBe(true);
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", "run the tests");
	});

	it("sends keys to waiting_user agent", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "waiting_user" }));

		const handler = createAgentSendHandler(deps);
		const result = await handler({ id: "side-1", prompt: "yes" });

		expect(result.isError).toBe(false);
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", "yes");
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
});

describe("takumi_agent_query", () => {
	it("returns structured result when agent responds with JSON", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue(
			'some preamble\n```json\n{"answer": 42}\n```\n',
		);

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "what is x?" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.responseType).toBe("structured");
		expect((data.response as Record<string, unknown>).answer).toBe(42);
		expect(data.query).toBe("what is x?");
		expect(deps.tmux.sendKeys).toHaveBeenCalledWith("side-1", expect.stringContaining("what is x?"));
	});

	it("uses default format 'json' when not specified", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue('```json\n{"ok": true}\n```');

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "test" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.format).toBe("json");
	});

	it("accepts waiting_user agent state", async () => {
		const deps = createMockDeps();
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "waiting_user" }));
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockResolvedValue('```json\n{"status": "ready"}\n```');

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
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
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
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));
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
		(deps.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(makeAgent({ state: "running" }));

		let callCount = 0;
		(deps.tmux.captureOutput as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			callCount += 1;
			if (callCount === 1) throw new Error("tmux pane gone");
			return '```json\n{"recovered": true}\n```';
		});

		const handler = createAgentQueryHandler(deps);
		const result = await handler({ id: "side-1", query: "test resilience" });

		expect(result.isError).toBe(false);
		const data = parse(result);
		expect(data.responseType).toBe("structured");
		expect((data.response as Record<string, unknown>).recovered).toBe(true);
	});
});

describe("registerSideAgentTools", () => {
	it("registers all 4 tools in registry", () => {
		const registry = new ToolRegistry();
		const deps = createMockDeps();

		registerSideAgentTools(registry, deps);

		expect(registry.has("takumi_agent_start")).toBe(true);
		expect(registry.has("takumi_agent_check")).toBe(true);
		expect(registry.has("takumi_agent_wait_any")).toBe(true);
		expect(registry.has("takumi_agent_send")).toBe(true);
		expect(registry.has("takumi_agent_query")).toBe(true);
		expect(registry.size).toBe(5);
	});

	it("tool definitions have correct categories", () => {
		expect(agentStartDefinition.category).toBe("execute");
		expect(agentCheckDefinition.category).toBe("read");
		expect(agentWaitAnyDefinition.category).toBe("interact");
		expect(agentSendDefinition.category).toBe("interact");
		expect(agentQueryDefinition.category).toBe("interact");
	});

	it("tool definitions have correct permission flags", () => {
		expect(agentStartDefinition.requiresPermission).toBe(true);
		expect(agentCheckDefinition.requiresPermission).toBe(false);
		expect(agentWaitAnyDefinition.requiresPermission).toBe(false);
		expect(agentSendDefinition.requiresPermission).toBe(true);
		expect(agentQueryDefinition.requiresPermission).toBe(false);
	});
});
