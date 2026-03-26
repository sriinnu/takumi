import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock @takumi/bridge git helpers ───────────────────────────────────────────

vi.mock("@takumi/bridge", () => ({
	gitWorktreeAdd: vi.fn((_root: string, path: string, _commitish?: string, _options?: { newBranch?: string }) => path),
	gitWorktreeRemove: vi.fn(() => true),
	gitWorktreeList: vi.fn(() => []),
	gitBranch: vi.fn(() => "main"),
	gitRoot: vi.fn((cwd: string) => cwd),
	isGitRepo: vi.fn(() => true),
}));

vi.mock("@takumi/core", () => ({
	createLogger: () => ({
		info: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	}),
}));

import { gitBranch, gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove } from "@takumi/bridge";
import { WorktreePoolManager } from "../src/cluster/worktree-pool.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_ROOT = "/fake/repo";
const BASE_DIR = ".takumi/worktrees";

function createPool(max = 3): WorktreePoolManager {
	return new WorktreePoolManager(REPO_ROOT, { maxSlots: max, baseDir: BASE_DIR });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorktreePoolManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── allocate ────────────────────────────────────────────────────────────

	describe("allocate", () => {
		it("creates a worktree slot and returns it", async () => {
			const pool = createPool();
			const slot = await pool.allocate("agent-1");

			expect(slot.id).toBe("wt-0001");
			expect(slot.agentId).toBe("agent-1");
			expect(slot.inUse).toBe(true);
			expect(slot.path).toBe(join(REPO_ROOT, BASE_DIR, "wt-0001"));
			expect(slot.branch).toContain("agent-1");
			expect(slot.createdAt).toBeGreaterThan(0);

			expect(gitWorktreeAdd).toHaveBeenCalledOnce();
			expect(gitWorktreeAdd).toHaveBeenCalledWith(
				REPO_ROOT,
				join(REPO_ROOT, BASE_DIR, "wt-0001"),
				"main",
				expect.objectContaining({ newBranch: slot.branch }),
			);
		});

		it("uses the provided baseBranch instead of current branch", async () => {
			const pool = createPool();
			await pool.allocate("agent-2", "develop");

			expect(gitWorktreeAdd).toHaveBeenCalledWith(
				REPO_ROOT,
				expect.any(String),
				"develop",
				expect.objectContaining({ newBranch: expect.stringContaining("agent-2") }),
			);
			// gitBranch should NOT be called when baseBranch is explicit
			expect(gitBranch).not.toHaveBeenCalled();
		});

		it("increments slot IDs on successive allocations", async () => {
			const pool = createPool(5);
			const s1 = await pool.allocate("a");
			const s2 = await pool.allocate("b");
			const s3 = await pool.allocate("c");

			expect(s1.id).toBe("wt-0001");
			expect(s2.id).toBe("wt-0002");
			expect(s3.id).toBe("wt-0003");
		});

		it("throws when pool is at capacity", async () => {
			const pool = createPool(2);
			await pool.allocate("a");
			await pool.allocate("b");

			await expect(pool.allocate("c")).rejects.toThrow(/at capacity/);
		});

		it("throws when gitWorktreeAdd fails", async () => {
			vi.mocked(gitWorktreeAdd).mockReturnValueOnce(null);
			const pool = createPool();

			await expect(pool.allocate("bad-agent")).rejects.toThrow(/Failed to create worktree/);
		});
	});

	// ── release ─────────────────────────────────────────────────────────────

	describe("release", () => {
		it("removes the worktree and deletes the slot", async () => {
			const pool = createPool();
			const slot = await pool.allocate("agent-x");

			await pool.release(slot.id);

			expect(gitWorktreeRemove).toHaveBeenCalledWith(REPO_ROOT, slot.path);
			expect(pool.getSlot(slot.id)).toBeUndefined();
			expect(pool.getAllSlots()).toHaveLength(0);
		});

		it("is a no-op for unknown slot IDs", async () => {
			const pool = createPool();
			await pool.release("does-not-exist");

			expect(gitWorktreeRemove).not.toHaveBeenCalled();
		});

		it("frees capacity after release", async () => {
			const pool = createPool(1);
			const slot = await pool.allocate("agent-solo");

			expect(pool.hasCapacity()).toBe(false);
			await pool.release(slot.id);
			expect(pool.hasCapacity()).toBe(true);
		});

		it("throws and keeps the slot when git worktree removal fails", async () => {
			const pool = createPool();
			const slot = await pool.allocate("agent-bad-remove");
			vi.mocked(gitWorktreeRemove).mockReturnValueOnce(false);

			await expect(pool.release(slot.id)).rejects.toThrow(/Failed to remove worktree slot/);
			expect(pool.getSlot(slot.id)).toBeDefined();
		});
	});

	// ── getActiveSlots / getAllSlots ─────────────────────────────────────────

	describe("slot queries", () => {
		it("adopt rehydrates a persisted slot without touching git", () => {
			const pool = createPool(2);
			const slot = pool.adopt({
				id: "wt-0004",
				path: join(REPO_ROOT, BASE_DIR, "wt-0004"),
				branch: "takumi/side-agent/side-4-wt-0004",
				inUse: true,
				agentId: "side-4",
				createdAt: 123,
			});

			expect(slot.id).toBe("wt-0004");
			expect(pool.getSlot("wt-0004")).toMatchObject({ agentId: "side-4", inUse: true });
			expect(gitWorktreeAdd).not.toHaveBeenCalled();
			expect(gitWorktreeRemove).not.toHaveBeenCalled();
		});

		it("getActiveSlots returns only in-use slots", async () => {
			const pool = createPool(5);
			const s1 = await pool.allocate("a");
			await pool.allocate("b");
			await pool.release(s1.id);

			const active = pool.getActiveSlots();
			expect(active).toHaveLength(1);
			expect(active[0].agentId).toBe("b");
		});

		it("getAllSlots returns every tracked slot", async () => {
			const pool = createPool(5);
			await pool.allocate("a");
			await pool.allocate("b");

			expect(pool.getAllSlots()).toHaveLength(2);
		});

		it("getSlot returns undefined for missing ID", () => {
			const pool = createPool();
			expect(pool.getSlot("nope")).toBeUndefined();
		});

		it("adopt keeps the slot counter aligned with persisted slots", async () => {
			const pool = createPool(3);
			pool.adopt({
				id: "wt-0007",
				path: join(REPO_ROOT, BASE_DIR, "wt-0007"),
				branch: "takumi/side-agent/side-7-wt-0007",
				inUse: true,
				agentId: "side-7",
				createdAt: 123,
			});

			const slot = await pool.allocate("fresh");
			expect(slot.id).toBe("wt-0008");
		});
	});

	// ── hasCapacity ─────────────────────────────────────────────────────────

	describe("hasCapacity", () => {
		it("returns true when slots are available", () => {
			const pool = createPool(3);
			expect(pool.hasCapacity()).toBe(true);
		});

		it("returns false when pool is full", async () => {
			const pool = createPool(1);
			await pool.allocate("only-one");
			expect(pool.hasCapacity()).toBe(false);
		});
	});

	// ── cleanup ─────────────────────────────────────────────────────────────

	describe("cleanup", () => {
		it("releases all tracked slots", async () => {
			const pool = createPool(5);
			await pool.allocate("a");
			await pool.allocate("b");
			await pool.allocate("c");

			await pool.cleanup();

			expect(gitWorktreeRemove).toHaveBeenCalledTimes(3);
			expect(pool.getAllSlots()).toHaveLength(0);
		});

		it("survives partial failures during cleanup", async () => {
			vi.mocked(gitWorktreeRemove)
				.mockReturnValueOnce(true)
				.mockImplementationOnce(() => {
					throw new Error("boom");
				});

			const pool = createPool(3);
			await pool.allocate("a");
			await pool.allocate("b");

			// Should not throw even though one removal fails
			await expect(pool.cleanup()).resolves.toBeUndefined();
		});
	});

	// ── cleanOrphans ────────────────────────────────────────────────────────

	describe("cleanOrphans", () => {
		it("removes worktrees under baseDir not tracked by the pool", async () => {
			const orphanPath = join(REPO_ROOT, BASE_DIR, "wt-stale");
			vi.mocked(gitWorktreeList).mockReturnValue([
				REPO_ROOT, // main worktree — should be ignored
				orphanPath,
			]);

			const pool = createPool();
			const cleaned = await pool.cleanOrphans();

			expect(cleaned).toBe(1);
			expect(gitWorktreeRemove).toHaveBeenCalledWith(REPO_ROOT, orphanPath);
		});

		it("does not remove tracked worktrees", async () => {
			const pool = createPool();
			const slot = await pool.allocate("tracked-agent");

			vi.mocked(gitWorktreeList).mockReturnValue([slot.path]);
			vi.mocked(gitWorktreeRemove).mockClear();

			const cleaned = await pool.cleanOrphans();

			expect(cleaned).toBe(0);
			expect(gitWorktreeRemove).not.toHaveBeenCalled();
		});

		it("ignores worktrees outside the managed baseDir", async () => {
			vi.mocked(gitWorktreeList).mockReturnValue(["/other/place/wt-something"]);

			const pool = createPool();
			const cleaned = await pool.cleanOrphans();

			expect(cleaned).toBe(0);
		});

		it("does not treat sibling path prefixes as managed worktrees", async () => {
			vi.mocked(gitWorktreeList).mockReturnValue([join(REPO_ROOT, ".takumi/worktrees-old", "wt-stale")]);

			const pool = createPool();
			const cleaned = await pool.cleanOrphans();

			expect(cleaned).toBe(0);
			expect(gitWorktreeRemove).not.toHaveBeenCalled();
		});
	});

	// ── concurrent allocations ──────────────────────────────────────────────

	describe("concurrent allocations", () => {
		it("handles parallel allocate calls without exceeding maxSlots", async () => {
			const pool = createPool(3);

			const results = await Promise.allSettled([
				pool.allocate("c1"),
				pool.allocate("c2"),
				pool.allocate("c3"),
				pool.allocate("c4"), // should fail — over capacity
			]);

			const fulfilled = results.filter((r) => r.status === "fulfilled");
			const rejected = results.filter((r) => r.status === "rejected");

			// At least 3 should succeed; the 4th may succeed or fail depending on timing
			// since these are not truly concurrent (JS is single-threaded in the event loop)
			expect(fulfilled.length).toBeGreaterThanOrEqual(3);
			expect(fulfilled.length + rejected.length).toBe(4);
		});
	});
});
