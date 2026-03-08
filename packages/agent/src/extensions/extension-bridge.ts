/**
 * Extension bridge — Phase 45
 *
 * Typed inter-extension event bus for cross-extension communication.
 * Extensions publish and subscribe to named events via `sho.bridge`.
 * One `ExtensionBridgeRegistry` instance is shared across all loaded extensions.
 *
 * Add TypeScript types for your events by augmenting ExtensionBridgeEvents:
 *
 *   declare module "@takumi/agent" {
 *     interface ExtensionBridgeEvents {
 *       "tps-meter:update": { tps: number; elapsed: number };
 *     }
 *   }
 *
 * Once declared, sho.bridge.publish / subscribe are fully typed for that key.
 *
 * Key format convention: "<extension-name>:<event-name>".
 * Subscribers across extensions get the payload on every publish call.
 * Bridge errors never propagate to the publisher — each subscriber is isolated.
 */

// ── Type-augmentation target ────────────────────────────────────────────────────

/**
 * Augment this interface to declare typed bridge events.
 *
 *   declare module "@takumi/agent" {
 *     interface ExtensionBridgeEvents {
 *       "my-ext:my-event": { value: number };
 *     }
 *   }
 */
export interface ExtensionBridgeEvents {}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Infers payload type from a declared bridge event key; falls back to `unknown`. */
export type BridgePayload<K extends string> = K extends keyof ExtensionBridgeEvents
	? ExtensionBridgeEvents[K]
	: unknown;

/** Handler for a bridge event. */
export type BridgeHandler<K extends string> = (data: BridgePayload<K>) => void;

// ── Interface ─────────────────────────────────────────────────────────────────────

/**
 * The bridge API on ExtensionAPI (`sho.bridge`).
 * Shared across all loaded extensions — a publish reaches all subscribers.
 */
export interface ExtensionBridge {
	/**
	 * Publish an event to all current subscribers of that event key.
	 * Silently dropped if no subscribers exist.
	 */
	publish<K extends string>(event: K, data: BridgePayload<K>): void;

	/**
	 * Subscribe to a named event from another extension.
	 * Returns an unsubscribe function — call it to stop receiving events.
	 *
	 * @example
	 *   const off = sho.bridge.subscribe("metrics:update", (data) => { ... });
	 *   // later:
	 *   off();
	 */
	subscribe<K extends string>(event: K, handler: BridgeHandler<K>): () => void;
}

// ── Runtime Implementation ────────────────────────────────────────────────────────

/**
 * Runtime shared registry. One instance is created per session and shared
 * across all loaded extensions. Extensions get it via `sho.bridge`.
 */
export class ExtensionBridgeRegistry implements ExtensionBridge {
	private readonly _subs = new Map<string, Set<(data: unknown) => void>>();

	publish<K extends string>(event: K, data: BridgePayload<K>): void {
		const handlers = this._subs.get(event);
		if (!handlers || handlers.size === 0) return;
		for (const handler of handlers) {
			try {
				handler(data as unknown);
			} catch {
				// Bridge errors never propagate — publishing extension is not
				// responsible for failures in subscriber extensions.
			}
		}
	}

	subscribe<K extends string>(event: K, handler: BridgeHandler<K>): () => void {
		let set = this._subs.get(event);
		if (!set) {
			set = new Set();
			this._subs.set(event, set);
		}
		const h = handler as (data: unknown) => void;
		set.add(h);
		return () => {
			set?.delete(h);
		};
	}

	/** Number of distinct event channels with at least one active subscriber. */
	get channelCount(): number {
		let count = 0;
		for (const set of this._subs.values()) {
			if (set.size > 0) count++;
		}
		return count;
	}
}
