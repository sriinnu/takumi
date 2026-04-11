import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Normalize a worktree path into a stable identity.
 *
 * I prefer the filesystem's canonical path when it exists, but I still fall
 * back to an absolute path so stale registry rows can be compared without
 * exploding on missing directories.
 */
export function normalizeWorktreePath(path: string): string {
	const absolutePath = resolve(path.trim());
	try {
		return realpathSync(absolutePath);
	} catch {
		return absolutePath;
	}
}

/**
 * Build a normalized set of worktree identities for fast membership checks.
 */
export function createNormalizedWorktreePathSet(paths: Iterable<string>): Set<string> {
	const normalizedPaths = new Set<string>();
	for (const path of paths) {
		normalizedPaths.add(normalizeWorktreePath(path));
	}
	return normalizedPaths;
}
