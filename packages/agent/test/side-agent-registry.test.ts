import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SideAgentEvent, SideAgentInfo, SideAgentState } from "@takumi/core";

import { SideAgentRegistry } from "../src/cluster/side-agent-registry.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<SideAgentInfo> = {}): SideAgentInfo {
	return {
		id: "side-1",
		description: "test agent",
		state: "allocating_worktree",
		model: "claude-sonnet",
		slotId: "wt-0001",
		worktreePath: null,
		tmuxWindow: null,
		tmuxSessionName: null,
		tmuxWindowId: null,
		tmuxPaneId: null,
		branch: "side/side-1",
		pid: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	};
}

function tmpDir(): string {
	return join(tmpdir(), `takumi-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SideAgentRegistry", () => {
	// ── register ────────────────────────────────────────────────────────────

	it("register adds agent to registry", () => {
		const reg = new SideAgentRegistry();
		const agent = makeAgent();
		reg.register(agent);
		expect(reg.get("side-1")).toEqual(agent);
	});

	it("register throws on duplicate id", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent());
		expect(() => reg.register(makeAgent())).toThrow("already registered");
	});

	// ── get ─────────────────────────────────────────────────────────────────

	it("get returns undefined for missing id", () => {
		const reg = new SideAgentRegistry();
		expect(reg.get("nope")).toBeUndefined();
	});

	it("get returns a copy (not the internal reference)", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent());
		const a = reg.get("side-1")!;
		a.description = "mutated";
		expect(reg.get("side-1")!.description).toBe("test agent");
	});

	// ── getAll ──────────────────────────────────────────────────────────────

	it("getAll returns all agents", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1" }));
		reg.register(makeAgent({ id: "side-2" }));
		expect(reg.getAll()).toHaveLength(2);
	});

	// ── getByState ──────────────────────────────────────────────────────────

	it("getByState filters correctly", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "running" }));
		reg.register(makeAgent({ id: "side-2", state: "done" }));
		reg.register(makeAgent({ id: "side-3", state: "running" }));

		const running = reg.getByState("running");
		expect(running).toHaveLength(2);
		expect(running.map((a) => a.id).sort()).toEqual(["side-1", "side-3"]);
	});

	it("getByState accepts multiple states", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "done" }));
		reg.register(makeAgent({ id: "side-2", state: "failed" }));
		reg.register(makeAgent({ id: "side-3", state: "running" }));

		expect(reg.getByState("done", "failed")).toHaveLength(2);
	});

	// ── transition ──────────────────────────────────────────────────────────

	it("transition updates state and emits event", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "allocating_worktree" }));

		const events: SideAgentEvent[] = [];
		reg.on((e) => events.push(e));

		reg.transition("side-1", "spawning_tmux");

		expect(reg.get("side-1")!.state).toBe("spawning_tmux");
		expect(events).toContainEqual(
			expect.objectContaining({ type: "agent_state_changed", from: "allocating_worktree", to: "spawning_tmux" }),
		);
	});

	it("transition throws on invalid transition", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "allocating_worktree" }));

		expect(() => reg.transition("side-1", "running")).toThrow("Invalid side-agent transition");
	});

	it("transition throws for unknown agent", () => {
		const reg = new SideAgentRegistry();
		expect(() => reg.transition("nope", "running")).toThrow("not found");
	});

	it("transition to crashed is always allowed from non-terminal", () => {
		const nonTerminal: SideAgentState[] = [
			"allocating_worktree",
			"spawning_tmux",
			"starting",
			"running",
			"waiting_user",
			"finishing",
			"waiting_merge_lock",
			"retrying_reconcile",
		];

		for (const state of nonTerminal) {
			const reg = new SideAgentRegistry();
			reg.register(makeAgent({ id: "side-1", state }));
			expect(() => reg.transition("side-1", "crashed", "boom")).not.toThrow();
			expect(reg.get("side-1")!.state).toBe("crashed");
		}
	});

	it("transition to crashed is NOT allowed from terminal states", () => {
		for (const state of ["stopped", "done", "failed"] as SideAgentState[]) {
			const reg = new SideAgentRegistry();
			reg.register(makeAgent({ id: "side-1", state }));
			expect(() => reg.transition("side-1", "crashed")).toThrow("Invalid side-agent transition");
		}
	});

	it("transition stores error string", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "running" }));
		reg.transition("side-1", "failed", "disk full");
		expect(reg.get("side-1")!.error).toBe("disk full");
	});

	it("allows waiting_user lanes to stop for operator-driven interrupts", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "waiting_user" }));

		expect(() => reg.transition("side-1", "stopped", "Stopped by operator")).not.toThrow();
		expect(reg.get("side-1")!.state).toBe("stopped");
	});

	it("transition emits agent_failed for failed/crashed", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "running" }));

		const events: SideAgentEvent[] = [];
		reg.on((e) => events.push(e));

		reg.transition("side-1", "failed", "oom");
		expect(events).toContainEqual(expect.objectContaining({ type: "agent_failed", id: "side-1", error: "oom" }));
	});

	it("transition emits agent_stopped for stopped", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "running" }));

		const events: SideAgentEvent[] = [];
		reg.on((e) => events.push(e));

		reg.transition("side-1", "stopped", "Stopped by operator");
		expect(events).toContainEqual(
			expect.objectContaining({ type: "agent_stopped", id: "side-1", reason: "Stopped by operator" }),
		);
	});

	it("transition emits agent_completed for done", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "waiting_merge_lock" }));

		const events: SideAgentEvent[] = [];
		reg.on((e) => events.push(e));

		reg.transition("side-1", "done");
		expect(events).toContainEqual(expect.objectContaining({ type: "agent_completed", id: "side-1" }));
	});

	// ── remove ──────────────────────────────────────────────────────────────

	it("remove deletes agent and returns true", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent());
		expect(reg.remove("side-1")).toBe(true);
		expect(reg.get("side-1")).toBeUndefined();
	});

	it("remove returns false for missing agent", () => {
		const reg = new SideAgentRegistry();
		expect(reg.remove("nope")).toBe(false);
	});

	it("update patches non-state fields and refreshes updatedAt", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", tmuxWindow: null }));
		const before = reg.get("side-1")!.updatedAt;

		const updated = reg.update("side-1", { tmuxWindow: "agent-side-1", error: "note" });

		expect(updated.tmuxWindow).toBe("agent-side-1");
		expect(updated.error).toBe("note");
		expect(updated.updatedAt).toBeGreaterThanOrEqual(before);
		expect(reg.get("side-1")!.tmuxWindow).toBe("agent-side-1");
	});

	// ── on / off ────────────────────────────────────────────────────────────

	it("on returns unsubscribe function", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "allocating_worktree" }));

		const listener = vi.fn();
		const off = reg.on(listener);

		reg.transition("side-1", "spawning_tmux");
		expect(listener).toHaveBeenCalledTimes(1);

		off();
		reg.transition("side-1", "starting");
		expect(listener).toHaveBeenCalledTimes(1); // not called again
	});

	// ── save / load ─────────────────────────────────────────────────────────

	it("save persists to disk and load restores", async () => {
		const dir = tmpDir();

		try {
			const reg1 = new SideAgentRegistry(dir);
			reg1.register(makeAgent({ id: "side-1" }));
			reg1.register(
				makeAgent({
					id: "side-2",
					state: "running",
					slotId: "wt-0002",
					worktreePath: "/tmp/worktrees/wt-0002",
					tmuxWindow: "agent-side-2",
					tmuxSessionName: "takumi-side-agents",
					tmuxWindowId: "@2",
					tmuxPaneId: "%1",
				}),
			);
			await reg1.save();

			// Verify file exists
			const raw = await readFile(join(dir, "registry.json"), "utf-8");
			const parsed = JSON.parse(raw);
			expect(parsed).toHaveLength(2);

			// Load into a fresh registry
			const reg2 = new SideAgentRegistry(dir);
			await reg2.load();
			expect(reg2.getAll()).toHaveLength(2);
			expect(reg2.get("side-1")).toBeDefined();
			expect(reg2.get("side-2")!.state).toBe("running");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("load from non-existent file is a no-op", async () => {
		const dir = tmpDir();
		const reg = new SideAgentRegistry(dir);
		await reg.load(); // should not throw
		expect(reg.getAll()).toHaveLength(0);
	});

	it("load throws on unreadable registry paths instead of pretending the registry is empty", async () => {
		const dir = tmpDir();

		try {
			await mkdir(join(dir, "registry.json"), { recursive: true });
			const reg = new SideAgentRegistry(dir);

			await expect(reg.load()).rejects.toThrow("Failed to read side-agent registry");
			expect(reg.getAll()).toHaveLength(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("load throws on invalid JSON and preserves existing in-memory state", async () => {
		const dir = tmpDir();

		try {
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, "registry.json"), "{not-json", "utf-8");
			const reg = new SideAgentRegistry(dir);
			reg.register(makeAgent({ id: "side-live", state: "running" }));

			await expect(reg.load()).rejects.toThrow("Failed to parse side-agent registry");
			expect(reg.get("side-live")).toMatchObject({ state: "running" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("load restores counter from existing IDs", async () => {
		const dir = tmpDir();

		try {
			const reg1 = new SideAgentRegistry(dir);
			reg1.register(makeAgent({ id: "side-5" }));
			await reg1.save();

			const reg2 = new SideAgentRegistry(dir);
			await reg2.load();
			expect(reg2.nextId()).toBe("side-6");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	// ── nextId ──────────────────────────────────────────────────────────────

	it("nextId generates sequential IDs", () => {
		const reg = new SideAgentRegistry();
		expect(reg.nextId()).toBe("side-1");
		expect(reg.nextId()).toBe("side-2");
		expect(reg.nextId()).toBe("side-3");
	});

	// ── activeCount ─────────────────────────────────────────────────────────

	it("activeCount excludes terminal states", () => {
		const reg = new SideAgentRegistry();
		reg.register(makeAgent({ id: "side-1", state: "running" }));
		reg.register(makeAgent({ id: "side-2", state: "stopped" }));
		reg.register(makeAgent({ id: "side-3", state: "done" }));
		reg.register(makeAgent({ id: "side-4", state: "failed" }));
		reg.register(makeAgent({ id: "side-5", state: "crashed" }));
		reg.register(makeAgent({ id: "side-6", state: "starting" }));

		expect(reg.activeCount()).toBe(2);
	});

	it("activeCount returns 0 for empty registry", () => {
		const reg = new SideAgentRegistry();
		expect(reg.activeCount()).toBe(0);
	});
});

it("load normalizes malformed persisted entries instead of trusting disk blindly", async () => {
	const dir = tmpDir();

	try {
		const raw = JSON.stringify([
			{
				id: "side-9",
				description: 123,
				state: "running",
				model: "o3",
				slotId: null,
				worktreePath: null,
				tmuxWindow: null,
				branch: "takumi/side-agent/side-9",
				startedAt: "bad",
				updatedAt: null,
			},
			{ nope: true },
		]);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "registry.json"), raw, "utf-8");

		const reg = new SideAgentRegistry(dir);
		await reg.load();

		expect(reg.getAll()).toHaveLength(1);
		expect(reg.get("side-9")).toMatchObject({
			state: "failed",
			error: expect.stringContaining("could not be recovered safely"),
		});
		expect(await readFile(join(dir, "registry.json"), "utf-8")).toBe(raw);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("load preserves the high-water side-agent counter even when a malformed row is skipped", async () => {
	const dir = tmpDir();

	try {
		const raw = JSON.stringify([{ id: "side-41", nope: true }, makeAgent({ id: "side-5" })]);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "registry.json"), raw, "utf-8");

		const reg = new SideAgentRegistry(dir);
		await reg.load();

		expect(reg.nextId()).toBe("side-42");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
