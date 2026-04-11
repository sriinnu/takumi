/**
 * yagna-phase-merge.ts — Topological-sort branch merging.
 *
 * After Kriya + Verify, each subtask has committed its changes to a
 * separate git branch. The merge phase applies Kahn's algorithm to
 * determine a safe merge order that respects the dependency DAG,
 * then merges branches one by one into the target branch.
 *
 * On conflict: the merge is aborted, a warning is emitted, and the
 * operator should resolve manually. The system does NOT force-push
 * or discard uncommitted work.
 */

import type { AppCommandContext } from "../commands/app-command-context.js";
import { runShellCommand } from "../commands/app-command-macros.js";
import type { YagnaEventListener, YagnaSnapshot, YagnaSubtask } from "./yagna-types.js";

/**
 * Run the merge phase: combine all subtask branches in dependency order.
 *
 * Skips subtasks that have no branch assigned (failed before Kriya)
 * or are in a failed state.
 *
 * @param _ctx - TUI app command context (reserved for future use).
 * @param snap - Yagna snapshot with branch-assigned subtasks.
 * @param emit - Event emitter for progress updates.
 */
export async function mergePhase(
	_ctx: AppCommandContext,
	snap: YagnaSnapshot,
	emit: YagnaEventListener,
): Promise<void> {
	// Only merge subtasks that completed successfully and have branches.
	const mergeable = snap.subtasks.filter((st) => st.status === "done" && st.branch);

	if (mergeable.length === 0) {
		return;
	}

	// Compute a safe merge order via topological sort (Kahn's algorithm).
	const sorted = topologicalSort(mergeable);

	// Merge each branch sequentially to avoid concurrent git conflicts.
	for (const subtask of sorted) {
		const success = mergeBranch(subtask, emit);
		if (!success) {
			// A merge conflict stops the entire merge phase.
			// The operator must resolve it manually.
			emit({
				kind: "subtask-status",
				subtaskId: subtask.id,
				status: "failed",
			});
			return;
		}
	}
}

/* ── Topological sort (Kahn's algorithm) ─────────────────────── */

/**
 * Sort subtasks in dependency order using Kahn's algorithm.
 *
 * Kahn's Algorithm:
 * 1. Compute in-degree for each node (number of unresolved dependencies).
 * 2. Seed the queue with nodes that have in-degree 0 (no dependencies).
 * 3. Process the queue: for each node, decrement the in-degree of its
 *    dependents; add newly zero-degree nodes to the queue.
 * 4. Result is a valid topological ordering of the DAG.
 *
 * Subtasks with unresolvable cycles are appended at the end (best-effort).
 *
 * @param subtasks - Array of subtasks with dependency edges.
 * @returns Sorted array in safe merge order.
 */
function topologicalSort(subtasks: YagnaSubtask[]): YagnaSubtask[] {
	// Build adjacency map: id → subtask, and compute in-degrees.
	const byId = new Map<string, YagnaSubtask>();
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>(); // parent → children that depend on it

	for (const st of subtasks) {
		byId.set(st.id, st);
		inDegree.set(st.id, 0);
		dependents.set(st.id, []);
	}

	// Build edges and count in-degrees.
	for (const st of subtasks) {
		for (const depId of st.dependencies) {
			if (byId.has(depId)) {
				inDegree.set(st.id, (inDegree.get(st.id) ?? 0) + 1);
				dependents.get(depId)!.push(st.id);
			}
			// Unknown dependencies are silently ignored (already done or pruned).
		}
	}

	// Seed the queue with zero in-degree nodes.
	const queue: string[] = [];
	for (const [id, deg] of inDegree) {
		if (deg === 0) queue.push(id);
	}

	const sorted: YagnaSubtask[] = [];

	// Process the queue (BFS-style).
	while (queue.length > 0) {
		const id = queue.shift()!;
		const st = byId.get(id);
		if (st) sorted.push(st);

		// Decrement in-degree for dependents; enqueue newly ready nodes.
		for (const childId of dependents.get(id) ?? []) {
			const newDeg = (inDegree.get(childId) ?? 1) - 1;
			inDegree.set(childId, newDeg);
			if (newDeg === 0) queue.push(childId);
		}
	}

	// Append any remaining nodes (cycles or orphans) at the end.
	for (const st of subtasks) {
		if (!sorted.includes(st)) sorted.push(st);
	}

	return sorted;
}

/* ── Git merge execution ─────────────────────────────────────── */

/**
 * Merge a single subtask branch into the current branch.
 *
 * Uses `--no-ff` to preserve the branch history in the merge commit.
 * On conflict, aborts the merge cleanly and returns false.
 *
 * @param subtask - Subtask with a branch to merge.
 * @param emit - Event emitter.
 * @returns true if merge succeeded, false on conflict.
 */
function mergeBranch(subtask: YagnaSubtask, emit: YagnaEventListener): boolean {
	emit({
		kind: "subtask-status",
		subtaskId: subtask.id,
		status: "done",
	});

	// Perform the merge with a descriptive commit message.
	const mergeCmd = `git merge --no-ff "${subtask.branch}" -m "feat(yagna): merge ${subtask.title}"`;
	const result = runShellCommand(mergeCmd);

	if (result === null) {
		// Merge conflict or error — abort and report.
		runShellCommand("git merge --abort");
		subtask.lastError = `Merge conflict on branch ${subtask.branch}`;
		return false;
	}

	return true;
}
