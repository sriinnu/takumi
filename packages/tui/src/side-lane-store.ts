/**
 * SideLaneStore — centralized state for workflow-driven side lanes.
 *
 * I keep lightweight, durable snapshots for native side-agent lanes so the
 * TUI can render them outside transient chat messages and workflow macros can
 * include them in follow-up context.
 */

import type { Signal } from "@takumi/render";
import { signal } from "@takumi/render";

/** Response type returned by a native side-lane query. */
export type SideLaneResponseType = "structured" | "raw" | "";

/** Snapshot of one live or recently-used side lane. */
export interface SideLaneSnapshot {
	id: string;
	commandName: string;
	title: string;
	state: string;
	tmuxWindow: string;
	branch: string;
	worktree: string;
	model: string;
	recentOutput: string;
	lastQuery: string;
	responseType: SideLaneResponseType;
	responseSummary: string;
	error: string | null;
	updatedAt: number;
}

/** Partial update used to create or refresh a side-lane snapshot. */
export type SideLaneSnapshotInput = Pick<SideLaneSnapshot, "id"> & Partial<Omit<SideLaneSnapshot, "id">>;

const DEFAULT_SNAPSHOT: Omit<SideLaneSnapshot, "id" | "updatedAt"> = {
	commandName: "/lane",
	title: "workflow side lane",
	state: "starting",
	tmuxWindow: "",
	branch: "",
	worktree: "",
	model: "",
	recentOutput: "",
	lastQuery: "",
	responseType: "",
	responseSummary: "",
	error: null,
};

/**
 * Compact digest used in prompts and diagnostics.
 *
 * I keep the format intentionally terse so it can fit into prompt context
 * without turning every workflow macro into a lane dump.
 */
export function formatSideLaneDigest(lane: SideLaneSnapshot): string {
	const state = lane.state.trim().toLowerCase() || "unknown";
	const target = lane.tmuxWindow || lane.branch || lane.id;
	return `${lane.commandName}:${state}@${target}`;
}

/**
 * Minimal store around a signal so the rest of the TUI can observe lane
 * changes without each command inventing its own bookkeeping.
 */
export class SideLaneStore {
	readonly entries: Signal<SideLaneSnapshot[]> = signal<SideLaneSnapshot[]>([]);

	/** Remove all tracked side lanes. */
	clear(): void {
		this.entries.value = [];
	}

	/** Return the most recently updated lanes first. */
	list(limit = this.entries.value.length): SideLaneSnapshot[] {
		return this.entries.value.slice(0, limit);
	}

	/** Resolve a lane by id, tmux window, or command name; defaults to the newest lane. */
	find(selector?: string): SideLaneSnapshot | null {
		if (this.entries.value.length === 0) {
			return null;
		}
		const normalized = selector?.trim().toLowerCase();
		if (!normalized || normalized === "latest") {
			return this.entries.value[0] ?? null;
		}
		return (
			this.entries.value.find(
				(lane) =>
					lane.id.toLowerCase() === normalized ||
					lane.tmuxWindow.toLowerCase() === normalized ||
					lane.commandName.toLowerCase() === normalized,
			) ?? null
		);
	}

	/** Create or merge a side-lane snapshot. */
	upsert(input: SideLaneSnapshotInput): SideLaneSnapshot {
		const existing = this.entries.value.find((lane) => lane.id === input.id);
		const next: SideLaneSnapshot = {
			id: input.id,
			commandName: input.commandName ?? existing?.commandName ?? DEFAULT_SNAPSHOT.commandName,
			title: input.title ?? existing?.title ?? DEFAULT_SNAPSHOT.title,
			state: input.state ?? existing?.state ?? DEFAULT_SNAPSHOT.state,
			tmuxWindow: input.tmuxWindow ?? existing?.tmuxWindow ?? DEFAULT_SNAPSHOT.tmuxWindow,
			branch: input.branch ?? existing?.branch ?? DEFAULT_SNAPSHOT.branch,
			worktree: input.worktree ?? existing?.worktree ?? DEFAULT_SNAPSHOT.worktree,
			model: input.model ?? existing?.model ?? DEFAULT_SNAPSHOT.model,
			recentOutput: input.recentOutput ?? existing?.recentOutput ?? DEFAULT_SNAPSHOT.recentOutput,
			lastQuery: input.lastQuery ?? existing?.lastQuery ?? DEFAULT_SNAPSHOT.lastQuery,
			responseType: input.responseType ?? existing?.responseType ?? DEFAULT_SNAPSHOT.responseType,
			responseSummary: input.responseSummary ?? existing?.responseSummary ?? DEFAULT_SNAPSHOT.responseSummary,
			error: input.error === undefined ? (existing?.error ?? DEFAULT_SNAPSHOT.error) : input.error,
			updatedAt: input.updatedAt ?? Date.now(),
		};

		// I keep the newest lane first because the sidebar is the main operator view.
		const rest = this.entries.value.filter((lane) => lane.id !== input.id);
		this.entries.value = [next, ...rest].sort((left, right) => right.updatedAt - left.updatedAt);
		return next;
	}
}
