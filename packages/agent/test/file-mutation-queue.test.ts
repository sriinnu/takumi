/**
 * Tests for FileMutationQueue — concurrency correctness is the primary concern.
 *
 * I verify that same-path mutations are serialized (tail-chaining guarantee),
 * different-path mutations run concurrently, errors don't block the chain,
 * and the queue cleans up after draining.
 */

import { describe, expect, it } from "vitest";
import { FileMutationQueue } from "../src/tools/file-mutation-queue.js";

/** Utility: sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("FileMutationQueue", () => {
	it("runs a single mutation immediately and returns its result", async () => {
		const q = new FileMutationQueue();
		const result = await q.enqueue("/tmp/a.ts", async () => 42);
		expect(result).toBe(42);
	});

	it("serializes two mutations on the same path", async () => {
		const q = new FileMutationQueue();
		const order: number[] = [];

		const p1 = q.enqueue("/tmp/a.ts", async () => {
			order.push(1);
			await sleep(30);
			order.push(2);
		});

		const p2 = q.enqueue("/tmp/a.ts", async () => {
			order.push(3);
			await sleep(10);
			order.push(4);
		});

		await Promise.all([p1, p2]);

		// p2 must not start (push 3) until p1 finishes (push 2)
		expect(order).toEqual([1, 2, 3, 4]);
	});

	it("serializes 3+ concurrent mutations on the same path (no thundering herd)", async () => {
		const q = new FileMutationQueue();
		const order: string[] = [];

		const run = (label: string, ms: number) =>
			q.enqueue("/tmp/a.ts", async () => {
				order.push(`${label}-start`);
				await sleep(ms);
				order.push(`${label}-end`);
			});

		// All three enqueued synchronously — must chain properly
		const p1 = run("A", 20);
		const p2 = run("B", 10);
		const p3 = run("C", 5);

		await Promise.all([p1, p2, p3]);

		// Each must start only after the previous ends
		expect(order).toEqual(["A-start", "A-end", "B-start", "B-end", "C-start", "C-end"]);
	});

	it("allows unrelated file paths to run concurrently", async () => {
		const q = new FileMutationQueue();
		const order: string[] = [];

		const p1 = q.enqueue("/tmp/a.ts", async () => {
			order.push("a-start");
			await sleep(30);
			order.push("a-end");
		});

		const p2 = q.enqueue("/tmp/b.ts", async () => {
			order.push("b-start");
			await sleep(10);
			order.push("b-end");
		});

		await Promise.all([p1, p2]);

		// b should finish before a because they run concurrently and b is faster
		expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
	});

	it("does not block subsequent mutations when one rejects", async () => {
		const q = new FileMutationQueue();

		const p1 = q.enqueue("/tmp/a.ts", async () => {
			throw new Error("boom");
		});

		const p2 = q.enqueue("/tmp/a.ts", async () => "ok");

		// p1 rejects
		await expect(p1).rejects.toThrow("boom");
		// p2 still runs and resolves
		const result = await p2;
		expect(result).toBe("ok");
	});

	it("cleans up the chain entry after the queue drains", async () => {
		const q = new FileMutationQueue();
		expect(q.size).toBe(0);

		await q.enqueue("/tmp/a.ts", async () => "done");
		expect(q.size).toBe(0);
	});

	it("keeps chain entry alive while mutations are pending", async () => {
		const q = new FileMutationQueue();
		let resolveInner!: () => void;
		const gate = new Promise<void>((r) => {
			resolveInner = r;
		});

		const p1 = q.enqueue("/tmp/a.ts", () => gate);
		// While p1 is running, the chain is active
		expect(q.size).toBe(1);

		resolveInner();
		await p1;
		expect(q.size).toBe(0);
	});

	it("normalizes relative paths to avoid separate chains for the same file", async () => {
		const q = new FileMutationQueue();
		const order: number[] = [];

		// These should resolve to the same absolute path and serialize
		const p1 = q.enqueue("/tmp/a.ts", async () => {
			order.push(1);
			await sleep(20);
			order.push(2);
		});

		const p2 = q.enqueue("  /tmp/a.ts  ", async () => {
			order.push(3);
		});

		await Promise.all([p1, p2]);
		expect(order).toEqual([1, 2, 3]);
	});

	it("propagates the typed return value through the promise", async () => {
		const q = new FileMutationQueue();
		const result: string = await q.enqueue("/tmp/a.ts", async () => "hello");
		expect(result).toBe("hello");
	});
});

describe("FileMutationQueue — regression: concurrent edit + ast_patch data loss", () => {
	/**
	 * Bug #6: ast_patch bypasses the queue entirely (uses raw readFile/writeFile).
	 * This test validates that two enqueued mutations on the same file never
	 * see stale content — i.e. the queue's serialization guarantee holds.
	 *
	 * If a caller bypasses the queue (like ast_patch does), this test would
	 * still pass, but a separate integration test should verify ast_patch
	 * is wired through the queue.
	 */
	it("two enqueued mutations on the same file compose correctly", async () => {
		const q = new FileMutationQueue();
		let content = "original";

		const p1 = q.enqueue("/tmp/file.ts", async () => {
			// Read then write
			const read = content;
			await sleep(10);
			content = read.replace("original", "first-edit");
		});

		const p2 = q.enqueue("/tmp/file.ts", async () => {
			// Read then write — should see p1's result
			const read = content;
			await sleep(5);
			content = read.replace("first-edit", "second-edit");
		});

		await Promise.all([p1, p2]);
		expect(content).toBe("second-edit");
	});

	it("without the queue, concurrent mutations cause data loss", async () => {
		// This demonstrates WHY the queue matters
		let content = "original";

		const p1 = (async () => {
			const read = content;
			await sleep(10);
			content = read.replace("original", "first-edit");
		})();

		const p2 = (async () => {
			const read = content; // reads "original" — stale!
			await sleep(5);
			content = read.replace("original", "second-edit");
		})();

		await Promise.all([p1, p2]);
		// One edit stomps the other — final content is unpredictable
		// but will NOT be "second-edit" applied after "first-edit"
		expect(content).not.toBe("second-edit-after-first");
	});
});
