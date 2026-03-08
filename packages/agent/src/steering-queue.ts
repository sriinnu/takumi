/**
 * Steering Queue — Phase 48
 *
 * A priority message queue for directing the agent mid-run.
 * Users can enqueue directives while the agent is processing,
 * and the agent loop drains them between turns.
 *
 * Priority levels:
 * - INTERRUPT (0): Abort current work and process immediately
 * - HIGH     (1): Process before next regular turn
 * - NORMAL   (2): Process in FIFO order between turns
 * - LOW      (3): Process only when queue is otherwise empty
 *
 * Design:
 * - Thread-safe for single-threaded Node.js (no atomics needed)
 * - Items are dequeued highest-priority-first, then FIFO within a level
 * - Supports peeking, draining, and size checks
 * - Emits a callback when a new item is enqueued (for waking the loop)
 */

import { createLogger } from "@takumi/core";

const log = createLogger("steering-queue");

// ── Types ────────────────────────────────────────────────────────────────────

/** Priority levels — lower number = higher priority. */
export const SteeringPriority = {
	INTERRUPT: 0,
	HIGH: 1,
	NORMAL: 2,
	LOW: 3,
} as const;

export type SteeringPriorityLevel = (typeof SteeringPriority)[keyof typeof SteeringPriority];

/** A single steering directive in the queue. */
export interface SteeringItem {
	/** Unique ID for tracking. */
	id: string;
	/** The directive text to inject as a user message. */
	text: string;
	/** Priority level. */
	priority: SteeringPriorityLevel;
	/** Unix timestamp when enqueued. */
	enqueuedAt: number;
	/** Optional metadata (source command, context, etc.). */
	metadata?: Record<string, unknown>;
}

/** Options for enqueueing a directive. */
export interface EnqueueOptions {
	priority?: SteeringPriorityLevel;
	metadata?: Record<string, unknown>;
}

/** Callback invoked when a new item is enqueued. */
export type OnEnqueueCallback = (item: SteeringItem) => void;

/** Callback invoked whenever queue size changes. */
export type OnSizeChangeCallback = (size: number) => void;

// ── Queue Implementation ─────────────────────────────────────────────────────

let nextId = 1;

function generateSteeringId(): string {
	return `steer-${nextId++}`;
}

export class SteeringQueue {
	/** Internal storage — one array per priority level (0-3). */
	private buckets: SteeringItem[][] = [[], [], [], []];

	/** Optional callback invoked on every enqueue. */
	private onEnqueue: OnEnqueueCallback | null = null;

	/** Optional callback invoked whenever queue size changes. */
	private onSizeChange: OnSizeChangeCallback | null = null;

	/** Maximum queue size (prevents unbounded growth). */
	private maxSize: number;

	constructor(maxSize = 100) {
		this.maxSize = maxSize;
	}

	/**
	 * Register a callback for new enqueue events.
	 * Returns an unsubscribe function.
	 */
	onEnqueued(callback: OnEnqueueCallback): () => void {
		this.onEnqueue = callback;
		return () => {
			if (this.onEnqueue === callback) this.onEnqueue = null;
		};
	}

	/**
	 * Register a callback for queue size changes.
	 * Returns an unsubscribe function.
	 */
	onSizeChanged(callback: OnSizeChangeCallback): () => void {
		this.onSizeChange = callback;
		return () => {
			if (this.onSizeChange === callback) this.onSizeChange = null;
		};
	}

	/**
	 * Add a directive to the queue.
	 * Returns the generated item ID, or null if the queue is full.
	 */
	enqueue(text: string, options?: EnqueueOptions): string | null {
		if (this.size >= this.maxSize) {
			log.warn(`Steering queue full (${this.maxSize}), dropping directive`);
			return null;
		}

		const priority = options?.priority ?? SteeringPriority.NORMAL;
		const item: SteeringItem = {
			id: generateSteeringId(),
			text,
			priority,
			enqueuedAt: Date.now(),
			metadata: options?.metadata,
		};

		this.buckets[priority].push(item);
		log.debug(`Enqueued steering item ${item.id} at priority ${priority}`);

		if (this.onEnqueue) {
			try {
				this.onEnqueue(item);
			} catch (err) {
				log.warn("onEnqueue callback threw", err);
			}
		}

		this.emitSizeChange();

		return item.id;
	}

	/**
	 * Dequeue the highest-priority item.
	 * Returns null if the queue is empty.
	 */
	dequeue(): SteeringItem | null {
		for (const bucket of this.buckets) {
			if (bucket.length > 0) {
				const item = bucket.shift()!;
				this.emitSizeChange();
				return item;
			}
		}
		return null;
	}

	/**
	 * Peek at the highest-priority item without removing it.
	 */
	peek(): SteeringItem | null {
		for (const bucket of this.buckets) {
			if (bucket.length > 0) {
				return bucket[0];
			}
		}
		return null;
	}

	/**
	 * Drain all items from the queue in priority order.
	 * Returns them as an array, clears the queue.
	 */
	drain(): SteeringItem[] {
		const result: SteeringItem[] = [];
		for (const bucket of this.buckets) {
			result.push(...bucket.splice(0));
		}
		if (result.length > 0) this.emitSizeChange();
		return result;
	}

	/**
	 * Drain only items at or above a given priority.
	 * Lower-priority items remain in the queue.
	 */
	drainAbove(maxPriority: SteeringPriorityLevel): SteeringItem[] {
		const result: SteeringItem[] = [];
		for (let i = 0; i <= maxPriority; i++) {
			result.push(...this.buckets[i].splice(0));
		}
		if (result.length > 0) this.emitSizeChange();
		return result;
	}

	/**
	 * Check if there are any INTERRUPT-priority items.
	 */
	hasInterrupt(): boolean {
		return this.buckets[SteeringPriority.INTERRUPT].length > 0;
	}

	/**
	 * Total number of items across all priority levels.
	 */
	get size(): number {
		return this.buckets.reduce((sum, b) => sum + b.length, 0);
	}

	/**
	 * Whether the queue is empty.
	 */
	get isEmpty(): boolean {
		return this.size === 0;
	}

	/**
	 * Remove a specific item by ID.
	 * Returns true if found and removed.
	 */
	remove(id: string): boolean {
		for (const bucket of this.buckets) {
			const idx = bucket.findIndex((item) => item.id === id);
			if (idx !== -1) {
				bucket.splice(idx, 1);
				this.emitSizeChange();
				return true;
			}
		}
		return false;
	}

	/**
	 * Clear all items from the queue.
	 */
	clear(): void {
		const hadItems = !this.isEmpty;
		for (const bucket of this.buckets) {
			bucket.length = 0;
		}
		if (hadItems) this.emitSizeChange();
	}

	/**
	 * Get a snapshot of the queue contents (for debugging / UI display).
	 */
	snapshot(): SteeringItem[] {
		const result: SteeringItem[] = [];
		for (const bucket of this.buckets) {
			result.push(...bucket);
		}
		return result;
	}

	private emitSizeChange(): void {
		if (!this.onSizeChange) return;
		try {
			this.onSizeChange(this.size);
		} catch (err) {
			log.warn("onSizeChange callback threw", err);
		}
	}
}
