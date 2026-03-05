/**
 * Tests for SteeringQueue — Phase 48.
 */

import { SteeringPriority, SteeringQueue } from "@takumi/agent";

describe("SteeringQueue", () => {
	let queue: SteeringQueue;

	beforeEach(() => {
		queue = new SteeringQueue();
	});

	// ── Basic enqueue / dequeue ───────────────────────────────────────────────
	it("should start empty", () => {
		expect(queue.isEmpty).toBe(true);
		expect(queue.size).toBe(0);
		expect(queue.dequeue()).toBeNull();
	});

	it("should enqueue and dequeue a single item", () => {
		const id = queue.enqueue("fix the bug");
		expect(id).toBeTruthy();
		expect(queue.size).toBe(1);
		expect(queue.isEmpty).toBe(false);

		const item = queue.dequeue();
		expect(item).not.toBeNull();
		expect(item!.text).toBe("fix the bug");
		expect(item!.priority).toBe(SteeringPriority.NORMAL);
		expect(queue.isEmpty).toBe(true);
	});

	it("should enqueue with a specific priority", () => {
		queue.enqueue("urgent", { priority: SteeringPriority.INTERRUPT });
		queue.enqueue("later", { priority: SteeringPriority.LOW });

		const first = queue.dequeue();
		expect(first!.priority).toBe(SteeringPriority.INTERRUPT);
		expect(first!.text).toBe("urgent");

		const second = queue.dequeue();
		expect(second!.priority).toBe(SteeringPriority.LOW);
		expect(second!.text).toBe("later");
	});

	// ── Priority ordering ─────────────────────────────────────────────────────
	it("should dequeue by priority (highest first)", () => {
		queue.enqueue("low", { priority: SteeringPriority.LOW });
		queue.enqueue("interrupt", { priority: SteeringPriority.INTERRUPT });
		queue.enqueue("normal", { priority: SteeringPriority.NORMAL });
		queue.enqueue("high", { priority: SteeringPriority.HIGH });

		expect(queue.dequeue()!.text).toBe("interrupt");
		expect(queue.dequeue()!.text).toBe("high");
		expect(queue.dequeue()!.text).toBe("normal");
		expect(queue.dequeue()!.text).toBe("low");
	});

	it("should dequeue FIFO within the same priority", () => {
		queue.enqueue("first");
		queue.enqueue("second");
		queue.enqueue("third");

		expect(queue.dequeue()!.text).toBe("first");
		expect(queue.dequeue()!.text).toBe("second");
		expect(queue.dequeue()!.text).toBe("third");
	});

	// ── peek ──────────────────────────────────────────────────────────────────
	it("should peek without removing", () => {
		queue.enqueue("hello");
		const peeked = queue.peek();
		expect(peeked!.text).toBe("hello");
		expect(queue.size).toBe(1);
	});

	it("should return null on peek when empty", () => {
		expect(queue.peek()).toBeNull();
	});

	// ── drain ─────────────────────────────────────────────────────────────────
	it("should drain all items in priority order", () => {
		queue.enqueue("low", { priority: SteeringPriority.LOW });
		queue.enqueue("high", { priority: SteeringPriority.HIGH });
		queue.enqueue("normal", { priority: SteeringPriority.NORMAL });

		const items = queue.drain();
		expect(items).toHaveLength(3);
		expect(items[0].text).toBe("high");
		expect(items[1].text).toBe("normal");
		expect(items[2].text).toBe("low");
		expect(queue.isEmpty).toBe(true);
	});

	it("should drainAbove a threshold priority", () => {
		queue.enqueue("interrupt", { priority: SteeringPriority.INTERRUPT });
		queue.enqueue("high", { priority: SteeringPriority.HIGH });
		queue.enqueue("normal", { priority: SteeringPriority.NORMAL });
		queue.enqueue("low", { priority: SteeringPriority.LOW });

		// Drain only INTERRUPT and HIGH (0 and 1 are ≤ HIGH=1)
		const items = queue.drainAbove(SteeringPriority.HIGH);
		expect(items).toHaveLength(2);
		expect(items[0].text).toBe("interrupt");
		expect(items[1].text).toBe("high");
		// NORMAL and LOW remain
		expect(queue.size).toBe(2);
	});

	// ── hasInterrupt ──────────────────────────────────────────────────────────
	it("should detect an interrupt", () => {
		expect(queue.hasInterrupt()).toBe(false);
		queue.enqueue("hello", { priority: SteeringPriority.NORMAL });
		expect(queue.hasInterrupt()).toBe(false);
		queue.enqueue("stop", { priority: SteeringPriority.INTERRUPT });
		expect(queue.hasInterrupt()).toBe(true);
	});

	// ── remove ────────────────────────────────────────────────────────────────
	it("should remove a specific item by id", () => {
		const id1 = queue.enqueue("first");
		const id2 = queue.enqueue("second");

		expect(queue.remove(id1!)).toBe(true);
		expect(queue.size).toBe(1);
		expect(queue.dequeue()!.text).toBe("second");

		// Removing again returns false
		expect(queue.remove(id2!)).toBe(false); // already dequeued
	});

	it("should return false when removing a non-existent id", () => {
		expect(queue.remove("non-existent")).toBe(false);
	});

	// ── clear ─────────────────────────────────────────────────────────────────
	it("should clear all items", () => {
		queue.enqueue("a");
		queue.enqueue("b");
		queue.enqueue("c");
		queue.clear();
		expect(queue.isEmpty).toBe(true);
		expect(queue.size).toBe(0);
	});

	// ── snapshot ──────────────────────────────────────────────────────────────
	it("should return a read-only snapshot", () => {
		queue.enqueue("low", { priority: SteeringPriority.LOW });
		queue.enqueue("high", { priority: SteeringPriority.HIGH });

		const snap = queue.snapshot();
		expect(snap).toHaveLength(2);
		// Snapshot is ordered by priority
		expect(snap[0].text).toBe("high");
		expect(snap[1].text).toBe("low");
		// Original queue is not drained
		expect(queue.size).toBe(2);
	});

	// ── maxSize ───────────────────────────────────────────────────────────────
	it("should reject enqueue when full", () => {
		const small = new SteeringQueue(3);
		small.enqueue("a");
		small.enqueue("b");
		small.enqueue("c");
		const result = small.enqueue("d");
		expect(result).toBeNull();
		expect(small.size).toBe(3);
	});

	// ── onEnqueued callback ───────────────────────────────────────────────────
	it("should fire enqueue callback", () => {
		const items: string[] = [];
		const unsub = queue.onEnqueued((item) => {
			items.push(item.text);
		});
		queue.enqueue("hello");
		queue.enqueue("world");
		expect(items).toEqual(["hello", "world"]);

		unsub();
		queue.enqueue("after");
		expect(items).toEqual(["hello", "world"]); // no callback after unsub
	});

	// ── metadata ──────────────────────────────────────────────────────────────
	it("should carry metadata through", () => {
		queue.enqueue("test", { metadata: { source: "test" } });
		const item = queue.dequeue();
		expect(item!.metadata).toEqual({ source: "test" });
	});
});
