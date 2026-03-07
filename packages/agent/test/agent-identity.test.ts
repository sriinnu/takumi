import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityScore, TaskOutcome } from "../src/cluster/agent-identity.js";
import { AgentProfileStore } from "../src/cluster/agent-identity.js";
import { AgentRole } from "../src/cluster/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a store backed by a temp file that doesn't exist yet. */
function createTempStore(): { store: AgentProfileStore; filePath: string } {
	const filePath = join(tmpdir(), `takumi-test-profiles-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
	const store = new AgentProfileStore(filePath);
	return { store, filePath };
}

function makeOutcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
	return {
		role: AgentRole.WORKER,
		model: "claude-sonnet-4-20250514",
		success: true,
		capabilities: ["typescript"],
		durationMs: 1000,
		tokensUsed: 500,
		...overrides,
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentProfileStore", () => {
	let store: AgentProfileStore;
	let filePath: string;

	beforeEach(() => {
		({ store, filePath } = createTempStore());
	});

	// ── getOrCreate ───────────────────────────────────────────────────────

	describe("getOrCreate", () => {
		it("creates a new profile for an unseen role+model", () => {
			const profile = store.getOrCreate(AgentRole.WORKER, "claude-sonnet-4-20250514");

			expect(profile.id).toBe("worker:claude-sonnet-4-20250514");
			expect(profile.role).toBe(AgentRole.WORKER);
			expect(profile.model).toBe("claude-sonnet-4-20250514");
			expect(profile.capabilities.size).toBe(0);
			expect(profile.tasksCompleted).toBe(0);
			expect(profile.tasksFailed).toBe(0);
		});

		it("returns the same profile on repeated calls", () => {
			const a = store.getOrCreate(AgentRole.WORKER, "model-a");
			const b = store.getOrCreate(AgentRole.WORKER, "model-a");
			expect(a).toBe(b);
		});

		it("creates distinct profiles for different role+model combos", () => {
			const worker = store.getOrCreate(AgentRole.WORKER, "model-a");
			const planner = store.getOrCreate(AgentRole.PLANNER, "model-a");
			const workerB = store.getOrCreate(AgentRole.WORKER, "model-b");

			expect(worker.id).not.toBe(planner.id);
			expect(worker.id).not.toBe(workerB.id);
		});
	});

	// ── recordOutcome ─────────────────────────────────────────────────────

	describe("recordOutcome", () => {
		it("increments tasksCompleted on success", () => {
			store.recordOutcome(makeOutcome({ success: true }));
			const profile = store.getOrCreate(AgentRole.WORKER, "claude-sonnet-4-20250514");
			expect(profile.tasksCompleted).toBe(1);
			expect(profile.tasksFailed).toBe(0);
		});

		it("increments tasksFailed on failure", () => {
			store.recordOutcome(makeOutcome({ success: false }));
			const profile = store.getOrCreate(AgentRole.WORKER, "claude-sonnet-4-20250514");
			expect(profile.tasksCompleted).toBe(0);
			expect(profile.tasksFailed).toBe(1);
		});

		it("creates capability scores from outcomes", () => {
			store.recordOutcome(makeOutcome({ capabilities: ["typescript", "testing"] }));
			const profile = store.getOrCreate(AgentRole.WORKER, "claude-sonnet-4-20250514");

			expect(profile.capabilities.size).toBe(2);
			expect(profile.capabilities.get("typescript")?.successRate).toBe(1);
			expect(profile.capabilities.get("testing")?.attempts).toBe(1);
		});

		it("applies EMA on subsequent outcomes", () => {
			// First: success → rate=1.0
			store.recordOutcome(makeOutcome({ success: true, capabilities: ["ts"] }));
			// Second: failure → rate = 0.3*0 + 0.7*1 = 0.7
			store.recordOutcome(makeOutcome({ success: false, capabilities: ["ts"] }));

			const cap = store.getOrCreate(AgentRole.WORKER, "claude-sonnet-4-20250514").capabilities.get("ts")!;
			expect(cap.attempts).toBe(2);
			expect(cap.successRate).toBeCloseTo(0.7, 5);
		});

		it("applies EMA on latency", () => {
			store.recordOutcome(makeOutcome({ durationMs: 1000, capabilities: ["ts"] }));
			store.recordOutcome(makeOutcome({ durationMs: 2000, capabilities: ["ts"] }));

			const cap = store.getOrCreate(AgentRole.WORKER, "claude-sonnet-4-20250514").capabilities.get("ts")!;
			// EMA: 0.3*2000 + 0.7*1000 = 600 + 700 = 1300
			expect(cap.avgLatencyMs).toBeCloseTo(1300, 0);
		});
	});

	// ── findByCapability ──────────────────────────────────────────────────

	describe("findByCapability", () => {
		it("returns profiles ranked by success rate", () => {
			// Worker with high success
			store.recordOutcome(makeOutcome({ role: AgentRole.WORKER, model: "good", capabilities: ["ts"], success: true }));
			store.recordOutcome(makeOutcome({ role: AgentRole.WORKER, model: "good", capabilities: ["ts"], success: true }));
			// Planner with low success
			store.recordOutcome(makeOutcome({ role: AgentRole.PLANNER, model: "ok", capabilities: ["ts"], success: true }));
			store.recordOutcome(makeOutcome({ role: AgentRole.PLANNER, model: "ok", capabilities: ["ts"], success: false }));

			const ranked = store.findByCapability("ts");
			expect(ranked).toHaveLength(2);
			expect(ranked[0].model).toBe("good"); // higher success rate
		});

		it("filters by minAttempts", () => {
			store.recordOutcome(makeOutcome({ model: "few", capabilities: ["ts"] }));
			store.recordOutcome(makeOutcome({ model: "many", capabilities: ["ts"] }));
			store.recordOutcome(makeOutcome({ model: "many", capabilities: ["ts"] }));
			store.recordOutcome(makeOutcome({ model: "many", capabilities: ["ts"] }));

			const result = store.findByCapability("ts", 3);
			expect(result).toHaveLength(1);
			expect(result[0].model).toBe("many");
		});

		it("returns empty for unknown capability", () => {
			store.recordOutcome(makeOutcome({ capabilities: ["typescript"] }));
			expect(store.findByCapability("python")).toEqual([]);
		});
	});

	// ── scoreForTask ──────────────────────────────────────────────────────

	describe("scoreForTask", () => {
		it("returns 0 for unknown profile", () => {
			expect(store.scoreForTask("nonexistent", ["ts"])).toBe(0);
		});

		it("returns 0 for empty capabilities list", () => {
			store.recordOutcome(makeOutcome());
			expect(store.scoreForTask("worker:claude-sonnet-4-20250514", [])).toBe(0);
		});

		it("scores based on capability match coverage", () => {
			// Record a profile good at typescript (1.0 success rate)
			store.recordOutcome(makeOutcome({ capabilities: ["typescript", "testing"], success: true }));

			const profileId = "worker:claude-sonnet-4-20250514";

			// Both matched → (1.0 + 1.0) / 2 = 1.0
			expect(store.scoreForTask(profileId, ["typescript", "testing"])).toBeCloseTo(1.0);

			// One matched, one not → 1.0 / 2 = 0.5
			expect(store.scoreForTask(profileId, ["typescript", "python"])).toBeCloseTo(0.5);

			// None matched → 0
			expect(store.scoreForTask(profileId, ["python", "rust"])).toBe(0);
		});
	});

	// ── Persistence ───────────────────────────────────────────────────────

	describe("persistence", () => {
		it("save() and load() round-trip profiles", () => {
			store.recordOutcome(makeOutcome({ capabilities: ["typescript", "testing"] }));
			store.save();

			// Create new store from same file
			const restored = new AgentProfileStore(filePath);
			expect(restored.size).toBe(1);

			const profile = restored.list()[0];
			expect(profile.id).toBe("worker:claude-sonnet-4-20250514");
			expect(profile.capabilities.size).toBe(2);
			expect(profile.capabilities.get("typescript")?.successRate).toBe(1);
			expect(profile.tasksCompleted).toBe(1);
		});

		it("save() is a no-op when not dirty", () => {
			// Fresh store, no changes — save should not create file
			store.save();
			expect(existsSync(filePath)).toBe(false);
		});

		it("handles missing file gracefully", () => {
			const missing = join(tmpdir(), `takumi-missing-${Date.now()}.json`);
			const s = new AgentProfileStore(missing);
			expect(s.size).toBe(0);
		});

		it("handles corrupt file gracefully", () => {
			// Write garbage
			writeFileSync(filePath, "{{not json}}", "utf-8");
			const s = new AgentProfileStore(filePath);
			expect(s.size).toBe(0);
		});
	});

	// ── size / list ───────────────────────────────────────────────────────

	describe("size / list", () => {
		it("tracks number of profiles", () => {
			expect(store.size).toBe(0);
			store.getOrCreate(AgentRole.WORKER, "a");
			expect(store.size).toBe(1);
			store.getOrCreate(AgentRole.PLANNER, "b");
			expect(store.size).toBe(2);
		});

		it("list() returns all profiles", () => {
			store.getOrCreate(AgentRole.WORKER, "a");
			store.getOrCreate(AgentRole.PLANNER, "b");
			expect(store.list()).toHaveLength(2);
		});
	});
});
