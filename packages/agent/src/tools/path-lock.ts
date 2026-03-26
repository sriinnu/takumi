/**
 * PathLockManager — serializes writes targeting the same file path.
 *
 * Tool calls may execute in parallel within one assistant turn. That is great
 * for throughput, but unsafe when multiple write/edit/ast_patch calls target
 * the same file. This manager provides a tiny path-scoped lock with ordered
 * acquisition so unrelated files still run concurrently while same-file writes
 * queue deterministically.
 */

export type ReleasePathLock = () => void;

interface LockEntry {
	ready: Promise<void>;
	release: () => void;
}

export class PathLockManager {
	private readonly locks = new Map<string, LockEntry>();

	/**
	 * Acquire exclusive access for one or more absolute file paths.
	 * Paths are normalized, de-duplicated, and acquired in sorted order to avoid
	 * deadlocks when callers request overlapping path sets.
	 */
	async acquire(paths: string[]): Promise<ReleasePathLock> {
		const normalized = [...new Set(paths.map(normalizePath).filter(Boolean))].sort();
		if (normalized.length === 0) {
			return () => {};
		}

		const acquired: string[] = [];
		for (const path of normalized) {
			const previous = this.locks.get(path);
			if (previous) {
				await previous.ready;
			}

			let release!: () => void;
			const ready = new Promise<void>((resolve) => {
				release = resolve;
			});

			this.locks.set(path, { ready, release });
			acquired.push(path);
		}

		let released = false;
		return () => {
			if (released) return;
			released = true;

			for (const path of acquired) {
				const entry = this.locks.get(path);
				if (!entry) continue;
				this.locks.delete(path);
				entry.release();
			}
		};
	}
}

function normalizePath(path: string): string {
	return path.trim();
}
