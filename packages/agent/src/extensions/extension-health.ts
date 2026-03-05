/**
 * Extension Health Monitor — Phase 52
 *
 * Tracks per-extension error rates, latencies, and lifecycles to enable
 * the Healing Layer (Level 5) from the Chitragupta binding spec.
 *
 * Capabilities:
 * - Sliding-window error rate per extension (5-min default)
 * - Per-event-type latency tracking (P50/P95/P99)
 * - Quarantine: disable extensions that exceed error thresholds
 * - Hibernate: mark idle extensions that haven't fired in configurable duration
 * - Health snapshot for `/healthx` and observation reporting
 *
 * Design:
 * - No timers — all state transitions happen on `record*()` calls.
 * - Quarantine / hibernate are reversible without process restart.
 * - Uses O(1) ring-buffer for sliding window, not array filtering.
 */

import { createLogger } from "@takumi/core";

const log = createLogger("extension-health");

// ── Configuration ────────────────────────────────────────────────────────────

export interface ExtensionHealthConfig {
	/** Sliding window duration (ms). Default: 5 min. */
	windowMs?: number;
	/** Max error rate (0-1) before auto-quarantine. Default: 0.5. */
	quarantineThreshold?: number;
	/** Min events in window before quarantine logic kicks in. Default: 5. */
	quarantineMinEvents?: number;
	/** Idle threshold (ms) before hibernation. Default: 10 min. */
	hibernateAfterMs?: number;
	/** Max quarantine duration (ms). Auto-reinstated after. Default: 30 min. */
	maxQuarantineMs?: number;
}

const DEFAULTS: Required<ExtensionHealthConfig> = {
	windowMs: 5 * 60_000,
	quarantineThreshold: 0.5,
	quarantineMinEvents: 5,
	hibernateAfterMs: 10 * 60_000,
	maxQuarantineMs: 30 * 60_000,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExtensionHealthSnapshot {
	extensionPath: string;
	status: "active" | "quarantined" | "hibernated";
	errorRate: number;
	totalEvents: number;
	totalErrors: number;
	windowEvents: number;
	windowErrors: number;
	lastEventAt: number | null;
	latencyP50Ms: number;
	latencyP95Ms: number;
	latencyP99Ms: number;
	quarantinedAt: number | null;
	hibernatedAt: number | null;
}

export type HealthEvent = {
	extensionPath: string;
	eventType: string;
	durationMs: number;
	success: boolean;
	timestamp: number;
};

export type HealthTransition =
	| { type: "quarantined"; extensionPath: string; errorRate: number; reason: string }
	| { type: "reinstated"; extensionPath: string; reason: string }
	| { type: "hibernated"; extensionPath: string; idleMs: number }
	| { type: "awakened"; extensionPath: string };

export type HealthTransitionListener = (transition: HealthTransition) => void;

// ── Ring buffer for sliding window ───────────────────────────────────────────

interface WindowEntry {
	timestamp: number;
	success: boolean;
	durationMs: number;
}

class SlidingWindow {
	private readonly entries: WindowEntry[] = [];
	private readonly maxMs: number;

	constructor(maxMs: number) {
		this.maxMs = maxMs;
	}

	push(entry: WindowEntry): void {
		this.entries.push(entry);
		this.evict(entry.timestamp);
	}

	private evict(now: number): void {
		const cutoff = now - this.maxMs;
		let i = 0;
		while (i < this.entries.length && this.entries[i].timestamp < cutoff) i++;
		if (i > 0) this.entries.splice(0, i);
	}

	stats(now: number): { count: number; errors: number; durations: number[] } {
		this.evict(now);
		let errors = 0;
		const durations: number[] = [];
		for (const e of this.entries) {
			if (!e.success) errors++;
			durations.push(e.durationMs);
		}
		return { count: this.entries.length, errors, durations };
	}
}

// ── Per-extension state ──────────────────────────────────────────────────────

interface ExtensionState {
	path: string;
	status: "active" | "quarantined" | "hibernated";
	totalEvents: number;
	totalErrors: number;
	lastEventAt: number | null;
	quarantinedAt: number | null;
	hibernatedAt: number | null;
	window: SlidingWindow;
	/** All latencies ever recorded (capped at 1000 for percentile accuracy). */
	latencies: number[];
}

// ── ExtensionHealthMonitor ───────────────────────────────────────────────────

export class ExtensionHealthMonitor {
	private readonly config: Required<ExtensionHealthConfig>;
	private readonly states = new Map<string, ExtensionState>();
	private readonly listeners = new Set<HealthTransitionListener>();

	constructor(config?: ExtensionHealthConfig) {
		this.config = { ...DEFAULTS, ...config };
	}

	// ── Recording ──────────────────────────────────────────────────────────────

	/** Record an event dispatched to an extension. */
	recordEvent(event: HealthEvent): void {
		const state = this.ensureState(event.extensionPath);
		state.totalEvents++;
		if (!event.success) state.totalErrors++;
		state.lastEventAt = event.timestamp;
		state.window.push({
			timestamp: event.timestamp,
			success: event.success,
			durationMs: event.durationMs,
		});

		// Cap latency buffer
		if (state.latencies.length < 1000) {
			state.latencies.push(event.durationMs);
		} else {
			// Reservoir sample — replace a random entry
			const idx = Math.floor(Math.random() * state.latencies.length);
			state.latencies[idx] = event.durationMs;
		}

		// If hibernated, awaken on activity
		if (state.status === "hibernated") {
			state.status = "active";
			state.hibernatedAt = null;
			this.notify({ type: "awakened", extensionPath: state.path });
		}

		// Check quarantine after recording
		this.evaluateQuarantine(state, event.timestamp);
	}

	// ── Quarantine ─────────────────────────────────────────────────────────────

	/** Manually quarantine an extension. */
	quarantine(extensionPath: string, reason: string): void {
		const state = this.ensureState(extensionPath);
		if (state.status === "quarantined") return;
		state.status = "quarantined";
		state.quarantinedAt = Date.now();
		log.warn(`Quarantined extension: ${extensionPath} — ${reason}`);
		this.notify({ type: "quarantined", extensionPath, errorRate: this.errorRate(state), reason });
	}

	/** Manually reinstate a quarantined extension. */
	reinstate(extensionPath: string): void {
		const state = this.states.get(extensionPath);
		if (!state || state.status !== "quarantined") return;
		state.status = "active";
		state.quarantinedAt = null;
		log.info(`Reinstated extension: ${extensionPath}`);
		this.notify({ type: "reinstated", extensionPath, reason: "manual" });
	}

	// ── Hibernation ────────────────────────────────────────────────────────────

	/**
	 * Check all extensions for idle hibernation.
	 * Caller should invoke periodically (e.g., after each agent turn).
	 */
	checkHibernation(now?: number): void {
		const ts = now ?? Date.now();
		for (const state of this.states.values()) {
			if (state.status !== "active") continue;
			if (state.lastEventAt === null) continue;
			const idleMs = ts - state.lastEventAt;
			if (idleMs >= this.config.hibernateAfterMs) {
				state.status = "hibernated";
				state.hibernatedAt = ts;
				log.info(`Hibernated idle extension: ${state.path} (idle ${Math.round(idleMs / 1000)}s)`);
				this.notify({ type: "hibernated", extensionPath: state.path, idleMs });
			}
		}
	}

	/**
	 * Check quarantined extensions for auto-reinstatement.
	 * Caller should invoke periodically.
	 */
	checkReinstatement(now?: number): void {
		const ts = now ?? Date.now();
		for (const state of this.states.values()) {
			if (state.status !== "quarantined" || state.quarantinedAt === null) continue;
			if (ts - state.quarantinedAt >= this.config.maxQuarantineMs) {
				state.status = "active";
				state.quarantinedAt = null;
				log.info(`Auto-reinstated extension: ${state.path} (max quarantine exceeded)`);
				this.notify({ type: "reinstated", extensionPath: state.path, reason: "timeout" });
			}
		}
	}

	// ── Queries ────────────────────────────────────────────────────────────────

	/** Check if an extension is allowed to receive events. */
	isActive(extensionPath: string): boolean {
		const state = this.states.get(extensionPath);
		if (!state) return true; // unknown extensions are allowed
		return state.status === "active";
	}

	/** Get health snapshot for a single extension. */
	getSnapshot(extensionPath: string, now?: number): ExtensionHealthSnapshot | null {
		const state = this.states.get(extensionPath);
		if (!state) return null;
		return this.buildSnapshot(state, now ?? Date.now());
	}

	/** Get health snapshots for all tracked extensions. */
	getAllSnapshots(now?: number): ExtensionHealthSnapshot[] {
		const ts = now ?? Date.now();
		return Array.from(this.states.values()).map((s) => this.buildSnapshot(s, ts));
	}

	/** Get just the quarantined extension paths. */
	getQuarantined(): string[] {
		return Array.from(this.states.values())
			.filter((s) => s.status === "quarantined")
			.map((s) => s.path);
	}

	/** Get just the hibernated extension paths. */
	getHibernated(): string[] {
		return Array.from(this.states.values())
			.filter((s) => s.status === "hibernated")
			.map((s) => s.path);
	}

	/** Total number of tracked extensions. */
	get trackedCount(): number {
		return this.states.size;
	}

	// ── Listeners ──────────────────────────────────────────────────────────────

	/** Subscribe to health transitions. Returns unsubscribe function. */
	onTransition(listener: HealthTransitionListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// ── Internals ──────────────────────────────────────────────────────────────

	private ensureState(extensionPath: string): ExtensionState {
		let state = this.states.get(extensionPath);
		if (!state) {
			state = {
				path: extensionPath,
				status: "active",
				totalEvents: 0,
				totalErrors: 0,
				lastEventAt: null,
				quarantinedAt: null,
				hibernatedAt: null,
				window: new SlidingWindow(this.config.windowMs),
				latencies: [],
			};
			this.states.set(extensionPath, state);
		}
		return state;
	}

	private evaluateQuarantine(state: ExtensionState, now: number): void {
		if (state.status === "quarantined") return;
		const { count, errors } = state.window.stats(now);
		if (count < this.config.quarantineMinEvents) return;
		const rate = errors / count;
		if (rate >= this.config.quarantineThreshold) {
			state.status = "quarantined";
			state.quarantinedAt = now;
			const reason = `Error rate ${(rate * 100).toFixed(0)}% (${errors}/${count}) exceeds threshold`;
			log.warn(`Auto-quarantined: ${state.path} — ${reason}`);
			this.notify({ type: "quarantined", extensionPath: state.path, errorRate: rate, reason });
		}
	}

	private errorRate(state: ExtensionState): number {
		if (state.totalEvents === 0) return 0;
		return state.totalErrors / state.totalEvents;
	}

	private buildSnapshot(state: ExtensionState, now: number): ExtensionHealthSnapshot {
		const windowStats = state.window.stats(now);
		const sorted = [...state.latencies].sort((a, b) => a - b);
		return {
			extensionPath: state.path,
			status: state.status,
			errorRate: windowStats.count > 0 ? windowStats.errors / windowStats.count : 0,
			totalEvents: state.totalEvents,
			totalErrors: state.totalErrors,
			windowEvents: windowStats.count,
			windowErrors: windowStats.errors,
			lastEventAt: state.lastEventAt,
			latencyP50Ms: percentile(sorted, 0.5),
			latencyP95Ms: percentile(sorted, 0.95),
			latencyP99Ms: percentile(sorted, 0.99),
			quarantinedAt: state.quarantinedAt,
			hibernatedAt: state.hibernatedAt,
		};
	}

	private notify(transition: HealthTransition): void {
		for (const listener of this.listeners) {
			try {
				listener(transition);
			} catch (err) {
				log.warn(`Health transition listener error: ${(err as Error).message}`);
			}
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.ceil(sorted.length * p) - 1;
	return sorted[Math.max(0, idx)];
}
