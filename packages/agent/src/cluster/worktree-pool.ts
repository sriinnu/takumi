/**
 * @file worktree-pool.ts
 * @module cluster/worktree-pool
 *
 * Manages a pool of git worktrees for side agents (Phase 21.2).
 *
 * Each side agent gets an isolated worktree checkout so it can make changes
 * without interfering with the main working tree or other agents. The pool
 * enforces a maximum slot limit, tracks ownership, and provides lifecycle
 * helpers for allocation, release, and cleanup.
 */

import { join, resolve, sep } from "node:path";
import { gitBranch, gitWorktreeAdd, gitWorktreeList, gitWorktreeRemove } from "@takumi/bridge";
import { createLogger } from "@takumi/core";

const log = createLogger("worktree-pool");

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = ".takumi/worktrees";
const DEFAULT_MAX_SLOTS = 5;
const BRANCH_PREFIX = "takumi/side-agent";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorktreeSlot {
	id: string;
	path: string;
	branch: string;
	inUse: boolean;
	agentId: string | null;
	createdAt: number;
}

export interface WorktreePoolOptions {
	/** Base directory (relative to repo root) for worktrees. Default: `.takumi/worktrees` */
	baseDir?: string;
	/** Maximum concurrent worktree slots. Default: 5 */
	maxSlots?: number;
}

// ── Pool Manager ──────────────────────────────────────────────────────────────

/**
 * Manages a bounded pool of git worktree slots for side agents.
 *
 * Lifecycle:
 * 1. `allocate(agentId)` — creates a branch + worktree, assigns it to the agent.
 * 2. Agent does its work inside the worktree.
 * 3. `release(slotId)` — removes the worktree and frees the slot.
 * 4. `cleanup()` — tears down everything on shutdown.
 */
export class WorktreePoolManager {
	private readonly slots: Map<string, WorktreeSlot> = new Map();
	private readonly repoRoot: string;
	private readonly baseDir: string;
	private readonly maxSlots: number;
	private slotCounter = 0;

	constructor(repoRoot: string, options?: WorktreePoolOptions) {
		this.repoRoot = repoRoot;
		this.baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
		this.maxSlots = options?.maxSlots ?? DEFAULT_MAX_SLOTS;
	}

	// ── Public API ──────────────────────────────────────────────────────────

	/**
	 * Allocate a worktree slot for a side agent.
	 *
	 * Creates a new branch off `baseBranch` (default: current branch) and
	 * checks it out into a dedicated worktree directory.
	 *
	 * @throws {Error} If the pool is at capacity.
	 * @throws {Error} If `git worktree add` fails.
	 */
	async allocate(agentId: string, baseBranch?: string): Promise<WorktreeSlot> {
		if (!this.hasCapacity()) {
			throw new Error(`Worktree pool at capacity (${this.maxSlots} slots). Cannot allocate for agent "${agentId}".`);
		}

		const slotId = this.nextSlotId();
		const branch = `${BRANCH_PREFIX}/${agentId}-${slotId}`;
		const worktreePath = join(this.repoRoot, this.baseDir, slotId);

		const base = baseBranch ?? gitBranch(this.repoRoot) ?? "HEAD";
		const result = gitWorktreeAdd(this.repoRoot, worktreePath, base, { newBranch: branch });

		if (result === null) {
			throw new Error(`Failed to create worktree at "${worktreePath}" for agent "${agentId}".`);
		}

		const slot: WorktreeSlot = {
			id: slotId,
			path: worktreePath,
			branch,
			inUse: true,
			agentId,
			createdAt: Date.now(),
		};

		this.slots.set(slotId, slot);
		log.info(`Allocated worktree slot ${slotId} for agent "${agentId}" at ${worktreePath}`);
		return slot;
	}

	/**
	 * Release a worktree slot back to the pool.
	 *
	 * Removes the git worktree and deletes the slot from tracking.
	 * No-op if the slot does not exist.
	 */
	async release(slotId: string): Promise<void> {
		const slot = this.slots.get(slotId);
		if (!slot) {
			log.warn(`Attempted to release unknown slot: ${slotId}`);
			return;
		}

		const removed = gitWorktreeRemove(this.repoRoot, slot.path);
		if (!removed) {
			throw new Error(`Failed to remove worktree slot ${slotId} at ${slot.path}`);
		}
		this.slots.delete(slotId);
		log.info(`Released worktree slot ${slotId} (agent: ${slot.agentId ?? "none"})`);
	}

	/** Get info about a specific slot. */
	getSlot(slotId: string): WorktreeSlot | undefined {
		return this.slots.get(slotId);
	}

	/**
	 * Re-adopt a persisted slot after process restart.
	 * I keep this explicit so restart recovery can rebuild in-memory capacity
	 * accounting without touching git again.
	 */
	adopt(slot: WorktreeSlot): WorktreeSlot {
		const existing = this.slots.get(slot.id);
		if (
			existing &&
			(existing.path !== slot.path || existing.agentId !== slot.agentId || existing.branch !== slot.branch)
		) {
			throw new Error(`Worktree slot ${slot.id} is already tracked for a different side agent.`);
		}
		const nextSlot: WorktreeSlot = { ...slot, inUse: true };
		this.slots.set(nextSlot.id, nextSlot);
		this.syncSlotCounter(nextSlot.id);
		log.info(`Adopted worktree slot ${nextSlot.id} for agent "${nextSlot.agentId ?? "unknown"}" at ${nextSlot.path}`);
		return nextSlot;
	}

	/** Get all active (in-use) slots. */
	getActiveSlots(): WorktreeSlot[] {
		return [...this.slots.values()].filter((s) => s.inUse);
	}

	/** Get all tracked slots. */
	getAllSlots(): WorktreeSlot[] {
		return [...this.slots.values()];
	}

	/** Check whether the pool can accept another allocation. */
	hasCapacity(): boolean {
		const activeCount = this.getActiveSlots().length;
		return activeCount < this.maxSlots;
	}

	/**
	 * Clean up **all** tracked worktrees.
	 * Intended for graceful shutdown — releases every slot regardless of state.
	 */
	async cleanup(): Promise<void> {
		const ids = [...this.slots.keys()];
		log.info(`Cleaning up ${ids.length} worktree slot(s)…`);

		const results = await Promise.allSettled(ids.map((id) => this.release(id)));

		const failed = results.filter((r) => r.status === "rejected");
		if (failed.length > 0) {
			log.warn(`${failed.length} worktree cleanup(s) failed`);
		}
	}

	/**
	 * Detect and remove orphaned worktrees that live under `baseDir` but are
	 * not tracked by this pool instance. This can happen after a crash or
	 * ungraceful shutdown.
	 *
	 * @returns The number of orphaned worktrees that were cleaned up.
	 */
	async cleanOrphans(): Promise<number> {
		const orphans = this.findOrphans();
		let cleaned = 0;
		for (const wt of orphans) {
			log.info(`Removing orphaned worktree: ${wt}`);
			const removed = gitWorktreeRemove(this.repoRoot, wt);
			if (removed) cleaned++;
		}

		if (cleaned > 0) {
			log.info(`Cleaned ${cleaned} orphaned worktree(s)`);
		}
		return cleaned;
	}

	/**
	 * I return worktrees under the managed base directory that are not tracked by
	 * the current slot map or by the optional tracked path set. I let callers
	 * provide a preloaded worktree list so audits do not pay for the same git
	 * query twice in one pass.
	 */
	findOrphans(trackedPaths?: Iterable<string>, allWorktrees?: Iterable<string>): string[] {
		const discoveredWorktrees = allWorktrees ? [...allWorktrees] : gitWorktreeList(this.repoRoot);
		const knownPaths = new Set<string>([...this.slots.values()].map((slot) => resolve(slot.path)));
		for (const path of trackedPaths ?? []) {
			knownPaths.add(resolve(path));
		}
		const absoluteBase = resolve(this.repoRoot, this.baseDir);
		return discoveredWorktrees.filter(
			(worktreePath) =>
				isManagedWorktreePath(resolve(worktreePath), absoluteBase) && !knownPaths.has(resolve(worktreePath)),
		);
	}

	// ── Internals ───────────────────────────────────────────────────────────

	/** Generate a monotonically-increasing slot ID. */
	private nextSlotId(): string {
		this.slotCounter++;
		return `wt-${this.slotCounter.toString().padStart(4, "0")}`;
	}

	private syncSlotCounter(slotId: string): void {
		const match = /^wt-(\d+)$/.exec(slotId);
		const value = match ? Number.parseInt(match[1], 10) : Number.NaN;
		if (!Number.isNaN(value) && value > this.slotCounter) {
			this.slotCounter = value;
		}
	}
}

function isManagedWorktreePath(worktreePath: string, absoluteBase: string): boolean {
	return worktreePath === absoluteBase || worktreePath.startsWith(`${absoluteBase}${sep}`);
}
