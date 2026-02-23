/**
 * Reactive signals system based on Preact Signals algorithm.
 *
 * Provides fine-grained reactivity with automatic dependency tracking:
 *   signal(value)     — writable reactive value
 *   computed(fn)      — derived value, lazy + cached
 *   effect(fn)        — side effect, re-runs on dependency changes
 *   batch(fn)         — batch multiple writes, single notification
 *   untrack(fn)       — read without subscribing
 */

// ── Internal state ────────────────────────────────────────────────────────────

/** Global version counter — incremented on every signal write. */
let globalVersion = 0;

/** Currently evaluating computed/effect (for dependency tracking). */
let currentObserver: Computation | null = null;

/** Batch depth counter. When > 0 we defer notifications. */
let batchDepth = 0;

/** Pending effects to run after batch completes. */
const pendingEffects: Set<EffectNode> = new Set();

// ── Signal ────────────────────────────────────────────────────────────────────

const SIGNAL_BRAND = Symbol("signal");

export interface ReadonlySignal<T> {
	readonly value: T;
	peek(): T;
	subscribe(fn: (value: T) => void): () => void;
}

export interface Signal<T> extends ReadonlySignal<T> {
	value: T;
}

interface SignalNode<T> extends Signal<T> {
	_brand: typeof SIGNAL_BRAND;
	_value: T;
	_version: number;
	_subscribers: Set<Computation>;
}

/** Create a writable reactive signal. */
export function signal<T>(initialValue: T): Signal<T> {
	const node: SignalNode<T> = {
		_brand: SIGNAL_BRAND,
		_value: initialValue,
		_version: 0,
		_subscribers: new Set(),

		get value(): T {
			// Track dependency
			if (currentObserver !== null) {
				currentObserver._sources.add(node);
				node._subscribers.add(currentObserver);
			}
			return node._value;
		},

		set value(newValue: T) {
			if (Object.is(node._value, newValue)) return;
			node._value = newValue;
			node._version = ++globalVersion;
			notifySubscribers(node);
		},

		peek(): T {
			return node._value;
		},

		subscribe(fn: (value: T) => void): () => void {
			// Create an effect that calls fn
			const dispose = effect(() => {
				fn(node.value);
				return undefined;
			});
			return dispose;
		},
	};

	return node;
}

// ── Computed ──────────────────────────────────────────────────────────────────

interface ComputedNode<T> extends Computation, ReadonlySignal<T> {
	_fn: () => T;
	_value: T | undefined;
	_version: number;
	_dirty: boolean;
	_subscribers: Set<Computation>;
}

/** Create a derived reactive value. Lazy: only recomputes when read and dirty. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
	const node: ComputedNode<T> = {
		_fn: fn,
		_value: undefined as T | undefined,
		_version: -1,
		_dirty: true,
		_sources: new Set(),
		_subscribers: new Set(),

		_notify(): void {
			if (!node._dirty) {
				node._dirty = true;
				notifySubscribers(node);
			}
		},

		get value(): T {
			// Track dependency
			if (currentObserver !== null) {
				currentObserver._sources.add(node as any);
				node._subscribers.add(currentObserver);
			}

			if (node._dirty) {
				const prevObserver = currentObserver;
				// Unsubscribe from old sources
				cleanupComputation(node);

				currentObserver = node;
				try {
					const newValue = node._fn();
					if (!Object.is(node._value, newValue)) {
						node._value = newValue;
						node._version = ++globalVersion;
					}
				} finally {
					currentObserver = prevObserver;
					node._dirty = false;
				}
			}
			return node._value as T;
		},

		peek(): T {
			if (node._dirty) {
				// Force compute without tracking
				const prevObserver = currentObserver;
				currentObserver = null;
				cleanupComputation(node);
				currentObserver = node;
				try {
					node._value = node._fn();
					node._version = ++globalVersion;
				} finally {
					currentObserver = prevObserver;
					node._dirty = false;
				}
			}
			return node._value as T;
		},

		subscribe(fn: (value: T) => void): () => void {
			const dispose = effect(() => {
				fn(node.value);
				return undefined;
			});
			return dispose;
		},
	};

	return node;
}

// ── Effect ────────────────────────────────────────────────────────────────────

interface EffectNode extends Computation {
	_fn: () => undefined | (() => void);
	_cleanup: (() => void) | undefined;
	_disposed: boolean;
}

/**
 * Create a side effect that re-runs whenever its dependencies change.
 * Returns a dispose function.
 */
export function effect(fn: () => undefined | (() => void)): () => void {
	const node: EffectNode = {
		_fn: fn,
		_cleanup: undefined,
		_disposed: false,
		_sources: new Set(),

		_notify(): void {
			if (node._disposed) return;
			if (batchDepth > 0) {
				pendingEffects.add(node);
			} else {
				runEffect(node);
			}
		},
	};

	// Run immediately to establish dependencies
	runEffect(node);

	return () => {
		node._disposed = true;
		if (typeof node._cleanup === "function") {
			node._cleanup();
		}
		cleanupComputation(node);
		pendingEffects.delete(node);
	};
}

function runEffect(node: EffectNode): void {
	if (node._disposed) return;

	// Run cleanup from previous execution
	if (typeof node._cleanup === "function") {
		node._cleanup();
		node._cleanup = undefined;
	}

	// Unsubscribe from old sources
	cleanupComputation(node);

	const prevObserver = currentObserver;
	currentObserver = node;
	try {
		node._cleanup = node._fn();
	} finally {
		currentObserver = prevObserver;
	}
}

// ── Batch ─────────────────────────────────────────────────────────────────────

/**
 * Batch multiple signal writes. Effects are deferred until the
 * outermost batch() completes, avoiding redundant re-computations.
 */
export function batch(fn: () => void): void {
	batchDepth++;
	try {
		fn();
	} finally {
		batchDepth--;
		if (batchDepth === 0) {
			flushPendingEffects();
		}
	}
}

function flushPendingEffects(): void {
	// Copy and clear to handle effects that schedule more effects
	const effects = [...pendingEffects];
	pendingEffects.clear();
	for (const eff of effects) {
		runEffect(eff);
	}
}

// ── Untrack ───────────────────────────────────────────────────────────────────

/** Run a function without tracking any signal reads as dependencies. */
export function untrack<T>(fn: () => T): T {
	const prevObserver = currentObserver;
	currentObserver = null;
	try {
		return fn();
	} finally {
		currentObserver = prevObserver;
	}
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface Computation {
	_sources: Set<any>;
	_notify(): void;
}

/** Remove a computation from all its sources' subscriber lists. */
function cleanupComputation(comp: Computation): void {
	for (const source of comp._sources) {
		if (source._subscribers) {
			source._subscribers.delete(comp);
		}
	}
	comp._sources.clear();
}

/** Notify all subscribers of a signal/computed that its value changed. */
function notifySubscribers(node: { _subscribers: Set<Computation> }): void {
	// Copy subscribers to avoid mutation during iteration
	const subs = [...node._subscribers];
	for (const sub of subs) {
		sub._notify();
	}
}
