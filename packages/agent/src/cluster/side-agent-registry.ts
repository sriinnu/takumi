/**
 * SideAgentRegistry — Phase 21.4: Side Agents
 *
 * File-backed registry for tracking side agent lifecycle.
 * Persists state to `.takumi/side-agents/registry.json` and emits
 * events on every state transition so the TUI can react.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SideAgentEvent, SideAgentInfo, SideAgentState } from "@takumi/core";

// ── Public types ──────────────────────────────────────────────────────────────

export type SideAgentListener = (event: SideAgentEvent) => void;

// ── Allowed transitions map ───────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<SideAgentState, readonly SideAgentState[]> = {
	allocating_worktree: ["spawning_tmux"],
	spawning_tmux: ["starting"],
	starting: ["running"],
	running: ["waiting_user", "finishing", "failed", "crashed"],
	waiting_user: ["running", "finishing"],
	finishing: ["waiting_merge_lock", "failed"],
	waiting_merge_lock: ["done", "retrying_reconcile", "failed"],
	retrying_reconcile: ["waiting_merge_lock", "failed"],
	// Terminal states — no outgoing transitions (except crashed, handled separately)
	done: [],
	failed: [],
	crashed: [],
} as const;

const TERMINAL_STATES: ReadonlySet<SideAgentState> = new Set(["done", "failed", "crashed"]);

const DEFAULT_REGISTRY_DIR = ".takumi/side-agents";
const REGISTRY_FILENAME = "registry.json";

// ── Registry ──────────────────────────────────────────────────────────────────

export class SideAgentRegistry {
	private agents: Map<string, SideAgentInfo> = new Map();
	private listeners: Set<SideAgentListener> = new Set();
	private registryPath: string;
	private counter = 0;

	constructor(baseDir?: string) {
		const dir = baseDir ?? DEFAULT_REGISTRY_DIR;
		this.registryPath = join(dir, REGISTRY_FILENAME);
	}

	// ── CRUD ────────────────────────────────────────────────────────────────

	/** Register a new side agent and emit a spawned event. */
	register(info: SideAgentInfo): void {
		if (this.agents.has(info.id)) {
			throw new Error(`Side agent "${info.id}" is already registered`);
		}
		this.agents.set(info.id, { ...info });
		this.emit({ type: "agent_spawned", agent: { ...info } });
	}

	/** Look up a single agent by ID. */
	get(id: string): SideAgentInfo | undefined {
		const agent = this.agents.get(id);
		return agent ? { ...agent } : undefined;
	}

	/** Return a snapshot of every registered agent. */
	getAll(): SideAgentInfo[] {
		return [...this.agents.values()].map((a) => ({ ...a }));
	}

	/** Return agents whose current state matches any of the provided states. */
	getByState(...states: SideAgentState[]): SideAgentInfo[] {
		const wanted = new Set(states);
		return [...this.agents.values()].filter((a) => wanted.has(a.state)).map((a) => ({ ...a }));
	}

	/** Remove an agent from the registry. Returns `true` if it existed. */
	remove(id: string): boolean {
		return this.agents.delete(id);
	}

	// ── State machine ───────────────────────────────────────────────────────

	/** Transition an agent to a new state with validation. */
	transition(id: string, newState: SideAgentState, error?: string): void {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Side agent "${id}" not found`);
		}

		const from = agent.state;
		this.validateTransition(from, newState);

		agent.state = newState;
		agent.updatedAt = Date.now();
		if (error !== undefined) {
			agent.error = error;
		}

		this.emit({ type: "agent_state_changed", id, from, to: newState });

		if (newState === "failed" || newState === "crashed") {
			this.emit({ type: "agent_failed", id, error: error ?? "unknown" });
		}
		if (newState === "done") {
			this.emit({ type: "agent_completed", id, mergeResult: "success" });
		}
	}

	// ── Events ──────────────────────────────────────────────────────────────

	/** Subscribe to side-agent events. Returns an unsubscribe function. */
	on(listener: SideAgentListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Emit an event to every listener. */
	private emit(event: SideAgentEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	// ── Persistence ─────────────────────────────────────────────────────────

	/** Persist the registry to disk as JSON. */
	async save(): Promise<void> {
		const dir = dirname(this.registryPath);
		await mkdir(dir, { recursive: true });
		const data = JSON.stringify([...this.agents.values()], null, "\t");
		await writeFile(this.registryPath, data, "utf-8");
	}

	/** Load the registry from disk, replacing in-memory state. */
	async load(): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(this.registryPath, "utf-8");
		} catch {
			// File doesn't exist yet — start fresh.
			return;
		}

		const entries: SideAgentInfo[] = JSON.parse(raw);
		this.agents.clear();
		let maxCounter = 0;
		for (const entry of entries) {
			this.agents.set(entry.id, entry);
			const num = Number.parseInt(entry.id.replace(/^side-/, ""), 10);
			if (!Number.isNaN(num) && num > maxCounter) {
				maxCounter = num;
			}
		}
		this.counter = maxCounter;
	}

	// ── Helpers ─────────────────────────────────────────────────────────────

	/** Generate the next sequential ID (e.g. `side-1`, `side-2`). */
	nextId(): string {
		this.counter += 1;
		return `side-${this.counter}`;
	}

	/** Count of agents that are **not** in a terminal state. */
	activeCount(): number {
		let count = 0;
		for (const agent of this.agents.values()) {
			if (!TERMINAL_STATES.has(agent.state)) {
				count += 1;
			}
		}
		return count;
	}

	// ── Internal ────────────────────────────────────────────────────────────

	private validateTransition(from: SideAgentState, to: SideAgentState): void {
		// "crashed" is always reachable from any non-terminal state
		if (to === "crashed" && !TERMINAL_STATES.has(from)) {
			return;
		}

		const allowed = ALLOWED_TRANSITIONS[from];
		if (!allowed.includes(to)) {
			throw new Error(`Invalid side-agent transition: ${from} → ${to}`);
		}
	}
}
