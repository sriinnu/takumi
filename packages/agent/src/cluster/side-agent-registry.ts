/**
 * SideAgentRegistry — Phase 21.4: Side Agents
 *
 * File-backed registry for tracking side agent lifecycle.
 * Persists state to `.takumi/side-agents/registry.json` and emits
 * events on every state transition so the TUI can react.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { SideAgentEvent, SideAgentInfo, SideAgentState } from "@takumi/core";
import {
	DEFAULT_SIDE_AGENT_REGISTRY_DIR,
	extractCounterValue,
	normalizeLoadedAgent,
	resolveSideAgentRegistryPath,
} from "./side-agent-registry-io.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type SideAgentListener = (event: SideAgentEvent) => void;

export interface SideAgentRegistryOptions {
	baseDir?: string;
	autoSave?: boolean;
}

// ── Allowed transitions map ───────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<SideAgentState, readonly SideAgentState[]> = {
	allocating_worktree: ["spawning_tmux", "failed"],
	spawning_tmux: ["starting", "failed"],
	starting: ["running", "failed"],
	running: ["waiting_user", "finishing", "failed", "crashed"],
	waiting_user: ["running", "finishing", "failed"],
	finishing: ["waiting_merge_lock", "failed"],
	waiting_merge_lock: ["done", "retrying_reconcile", "failed"],
	retrying_reconcile: ["waiting_merge_lock", "failed"],
	// Terminal states — no outgoing transitions.
	stopped: [],
	done: [],
	failed: [],
	crashed: [],
} as const;

const TERMINAL_STATES: ReadonlySet<SideAgentState> = new Set(["stopped", "done", "failed", "crashed"]);

// ── Registry ──────────────────────────────────────────────────────────────────

export class SideAgentRegistry {
	private agents: Map<string, SideAgentInfo> = new Map();
	private listeners: Set<SideAgentListener> = new Set();
	private registryPath: string;
	private counter = 0;
	private readonly autoSave: boolean;
	private persistChain: Promise<void> = Promise.resolve();
	private lastPersistError: Error | null = null;

	constructor(baseDirOrOptions?: string | SideAgentRegistryOptions, options?: SideAgentRegistryOptions) {
		const resolvedOptions =
			typeof baseDirOrOptions === "string"
				? { ...options, baseDir: baseDirOrOptions }
				: (baseDirOrOptions ?? options ?? {});
		const dir = resolvedOptions.baseDir ?? DEFAULT_SIDE_AGENT_REGISTRY_DIR;
		this.registryPath = resolveSideAgentRegistryPath(dir);
		this.autoSave = resolvedOptions.autoSave ?? false;
	}

	// ── CRUD ────────────────────────────────────────────────────────────────

	/** Register a new side agent and emit a spawned event. */
	register(info: SideAgentInfo): void {
		if (this.agents.has(info.id)) {
			throw new Error(`Side agent "${info.id}" is already registered`);
		}
		this.agents.set(info.id, { ...info });
		this.emit({ type: "agent_spawned", agent: { ...info } });
		this.scheduleSave();
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
		const removed = this.agents.delete(id);
		if (removed) {
			this.scheduleSave();
		}
		return removed;
	}

	/** Patch non-state fields on an existing agent record. */
	update(id: string, patch: Partial<Omit<SideAgentInfo, "id" | "state">>): SideAgentInfo {
		const agent = this.agents.get(id);
		if (!agent) {
			throw new Error(`Side agent "${id}" not found`);
		}
		Object.assign(agent, patch);
		agent.updatedAt = Date.now();
		this.scheduleSave();
		return { ...agent };
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
		if (newState === "stopped") {
			this.emit({ type: "agent_stopped", id, reason: error ?? "unknown" });
		}
		if (newState === "done") {
			this.emit({ type: "agent_completed", id, mergeResult: "success" });
		}
		this.scheduleSave();
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
		} catch (error) {
			const code = typeof error === "object" && error && "code" in error ? String(error.code) : null;
			if (code === "ENOENT") {
				// File doesn't exist yet — start fresh.
				return;
			}
			throw new Error(
				`Failed to read side-agent registry at "${this.registryPath}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			throw new Error(
				`Failed to parse side-agent registry at "${this.registryPath}": ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		if (!Array.isArray(parsed)) {
			throw new Error(`Failed to parse side-agent registry at "${this.registryPath}": registry root was not an array.`);
		}

		const nextAgents = new Map<string, SideAgentInfo>();
		let maxCounter = 0;
		for (const entry of parsed) {
			maxCounter = Math.max(maxCounter, extractCounterValue(entry));
			const normalized = normalizeLoadedAgent(entry);
			if (!normalized.agent || nextAgents.has(normalized.agent.id)) {
				continue;
			}
			nextAgents.set(normalized.agent.id, normalized.agent);
			const num = Number.parseInt(normalized.agent.id.replace(/^side-/, ""), 10);
			if (!Number.isNaN(num) && num > maxCounter) {
				maxCounter = num;
			}
		}

		this.agents = nextAgents;
		this.counter = maxCounter;
		this.persistChain = Promise.resolve();
		this.lastPersistError = null;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	/** Wait for any queued auto-save writes to settle. */
	async flushPersistence(): Promise<void> {
		// Flush any pending debounced save immediately
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
			this.persistChain = this.persistChain.then(
				() => this.persistNow(),
				() => this.persistNow(),
			);
		}
		await this.persistChain;
		if (this.lastPersistError) {
			throw new Error(`Failed to persist side-agent registry: ${this.lastPersistError.message}`);
		}
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
		// I allow emergency terminal states from any live lane so operator stop and
		// crash reconciliation do not get blocked by stale transitional state.
		if ((to === "crashed" || to === "stopped") && !TERMINAL_STATES.has(from)) {
			return;
		}

		const allowed = ALLOWED_TRANSITIONS[from];
		if (!allowed.includes(to)) {
			throw new Error(`Invalid side-agent transition: ${from} → ${to}`);
		}
	}

	/** Debounce timer — coalesces rapid mutations into a single disk write. */
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	private scheduleSave(): void {
		if (!this.autoSave) {
			return;
		}
		// Debounce: coalesce rapid mutations (e.g. register → transition → update)
		// into a single disk write after 100ms of quiet.
		if (this.debounceTimer) return;
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.persistChain = this.persistChain.then(
				() => this.persistNow(),
				() => this.persistNow(),
			);
		}, 100);
	}

	private async persistNow(): Promise<void> {
		try {
			await this.save();
			this.lastPersistError = null;
		} catch (error) {
			this.lastPersistError = error instanceof Error ? error : new Error(String(error));
		}
	}
}
