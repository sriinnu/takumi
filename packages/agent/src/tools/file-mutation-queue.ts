/**
 * FileMutationQueue — per-file promise chain that serializes write operations.
 *
 * I solve the race condition where parallel tool calls targeting the same file
 * read identical original content and one silently overwrites the other's edits.
 * Unlike PathLockManager (which has a gap for the 3rd+ acquirer), I maintain a
 * proper tail-chaining guarantee: every enqueued mutation waits for ALL prior
 * mutations on that path, not just the first.
 *
 * Unrelated files still run fully concurrently — the queue is per-path.
 */

import { isAbsolute, resolve } from "node:path";

export class FileMutationQueue {
	/** I map each normalized file path to the tail promise of its mutation chain. */
	private readonly chains = new Map<string, Promise<void>>();

	/**
	 * I enqueue `fn` to run after all prior mutations on `filePath` have settled.
	 * If no mutation is in progress for this path, `fn` runs immediately.
	 * Errors in one mutation do NOT block subsequent mutations — I catch and
	 * re-throw but still advance the chain.
	 */
	enqueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
		const key = normalizePath(filePath);
		const previous = this.chains.get(key) ?? Promise.resolve();

		let resolveMutation!: () => void;
		const tail = new Promise<void>((r) => {
			resolveMutation = r;
		});

		// Replace the tail immediately so the next caller chains after us.
		this.chains.set(key, tail);

		const result = previous.then(async () => {
			try {
				return await fn();
			} finally {
				// Advance the chain regardless of success/failure.
				resolveMutation();
				// Cleanup: if I'm still the tail, no one else queued — remove entry.
				if (this.chains.get(key) === tail) {
					this.chains.delete(key);
				}
			}
		});

		return result;
	}

	/** I return the number of file paths that currently have pending mutations. */
	get size(): number {
		return this.chains.size;
	}
}

/** I serialize `fn` through the given queue for `filePath`. Convenience wrapper. */
export function withFileMutationQueue<T>(queue: FileMutationQueue, filePath: string, fn: () => Promise<T>): Promise<T> {
	return queue.enqueue(filePath, fn);
}

/** Default singleton — import this when a shared queue across tools is needed. */
export const defaultFileMutationQueue = new FileMutationQueue();

function normalizePath(raw: string): string {
	const trimmed = raw.trim();
	return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}
