/**
 * Agent Checkpoint / Resume (Phase 39)
 *
 * Serialises loop state to a JSON checkpoint that can be persisted to disk
 * or transmitted over the wire. Restoring from a checkpoint lets a crashed
 * or interrupted session resume where it left off.
 *
 * Checkpoint structure:
 *   - conversation messages (MessagePayload[])
 *   - turn counter
 *   - token totals
 *   - cost accumulator
 *   - system prompt & tool list snapshot
 *   - arbitrary metadata (model, provider, session ID, …)
 *
 * Designed to be opaque — callers store/retrieve the blob however they like.
 */

import { createLogger } from "@takumi/core";
import type { MessagePayload } from "./loop.js";

const log = createLogger("checkpoint");

// ── Types ────────────────────────────────────────────────────────────────────

export interface Checkpoint {
	/** Schema version for forward-compat. */
	version: 2;
	/** ISO-8601 timestamp of creation. */
	createdAt: string;
	/** Conversation history snapshot. */
	messages: MessagePayload[];
	/** How many turns the loop had completed. */
	turn: number;
	/** Cumulative token counts. */
	tokens: { input: number; output: number };
	/** Cumulative cost in USD. */
	costUsd: number;
	/** System prompt that was active. */
	systemPrompt: string;
	/** Snapshot of registered tool names (for drift detection). */
	toolNames: string[];
	/** Caller-supplied metadata (model, provider, session ID, etc.). */
	meta: Record<string, unknown>;
}

export interface CheckpointManagerConfig {
	/** Maximum number of checkpoints to retain (FIFO eviction). Default 5. */
	maxCheckpoints: number;
	/** Whether to deep-clone messages when creating (default true — safer). */
	deepClone: boolean;
}

const DEFAULT_CONFIG: CheckpointManagerConfig = {
	maxCheckpoints: 5,
	deepClone: true,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Deep-clone via JSON round-trip (safe for MessagePayload shapes). */
function clonePayloads(msgs: MessagePayload[]): MessagePayload[] {
	return JSON.parse(JSON.stringify(msgs)) as MessagePayload[];
}

/** Validate a parsed object looks like a Checkpoint. */
function isCheckpoint(obj: unknown): obj is Checkpoint {
	if (!obj || typeof obj !== "object") return false;
	const c = obj as Record<string, unknown>;
	return (
		c.version === 2 &&
		typeof c.createdAt === "string" &&
		Array.isArray(c.messages) &&
		typeof c.turn === "number" &&
		typeof c.costUsd === "number" &&
		typeof c.systemPrompt === "string" &&
		Array.isArray(c.toolNames)
	);
}

// ── AgentCheckpointManager ───────────────────────────────────────────────────

export class AgentCheckpointManager {
	private readonly config: CheckpointManagerConfig;
	private readonly store: Checkpoint[] = [];

	constructor(config?: Partial<CheckpointManagerConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ── Create / Capture ─────────────────────────────────────────────────────

	/**
	 * Capture the current loop state as a checkpoint.
	 * Returns the checkpoint and stores it internally.
	 */
	capture(
		messages: MessagePayload[],
		turn: number,
		tokens: { input: number; output: number },
		costUsd: number,
		systemPrompt: string,
		toolNames: string[],
		meta?: Record<string, unknown>,
	): Checkpoint {
		const checkpoint: Checkpoint = {
			version: 2,
			createdAt: new Date().toISOString(),
			messages: this.config.deepClone ? clonePayloads(messages) : messages,
			turn,
			tokens: { ...tokens },
			costUsd,
			systemPrompt,
			toolNames: [...toolNames],
			meta: meta ?? {},
		};

		this.store.push(checkpoint);

		// Evict oldest if over capacity
		while (this.store.length > this.config.maxCheckpoints) {
			this.store.shift();
		}

		log.info(`Checkpoint captured: turn=${turn}, messages=${messages.length}, cost=$${costUsd.toFixed(4)}`);
		return checkpoint;
	}

	// ── Restore ──────────────────────────────────────────────────────────────

	/**
	 * Restore state from a checkpoint.
	 * Returns a fresh (deep-cloned) copy of the checkpoint data so the
	 * caller can safely mutate it.
	 */
	restore(checkpoint: Checkpoint): {
		messages: MessagePayload[];
		turn: number;
		tokens: { input: number; output: number };
		costUsd: number;
		systemPrompt: string;
		toolNames: string[];
		meta: Record<string, unknown>;
	} {
		log.info(`Restoring checkpoint: turn=${checkpoint.turn}, messages=${checkpoint.messages.length}`);
		return {
			messages: clonePayloads(checkpoint.messages),
			turn: checkpoint.turn,
			tokens: { ...checkpoint.tokens },
			costUsd: checkpoint.costUsd,
			systemPrompt: checkpoint.systemPrompt,
			toolNames: [...checkpoint.toolNames],
			meta: { ...checkpoint.meta },
		};
	}

	// ── Query ────────────────────────────────────────────────────────────────

	/** Get the most recent checkpoint, or null. */
	latest(): Checkpoint | null {
		return this.store.length > 0 ? this.store[this.store.length - 1] : null;
	}

	/** Get checkpoint at a specific index (0 = oldest). */
	at(index: number): Checkpoint | null {
		return this.store[index] ?? null;
	}

	/** Number of stored checkpoints. */
	get count(): number {
		return this.store.length;
	}

	/** Return all stored checkpoints (oldest first). */
	all(): readonly Checkpoint[] {
		return this.store;
	}

	/** Clear all stored checkpoints. */
	clear(): void {
		this.store.length = 0;
		log.debug("Checkpoints cleared");
	}

	// ── Serialization ────────────────────────────────────────────────────────

	/** Serialise a checkpoint to a JSON string. */
	static serialise(checkpoint: Checkpoint): string {
		return JSON.stringify(checkpoint);
	}

	/**
	 * Deserialise a JSON string back to a Checkpoint.
	 * Returns null if the input is invalid.
	 */
	static deserialise(json: string): Checkpoint | null {
		try {
			const parsed: unknown = JSON.parse(json);
			if (isCheckpoint(parsed)) return parsed;
			log.warn("Deserialised object failed checkpoint validation");
			return null;
		} catch {
			log.warn("Failed to parse checkpoint JSON");
			return null;
		}
	}

	/**
	 * Detect tool drift: returns tool names present in the checkpoint
	 * but missing from the current registry, and vice-versa.
	 */
	static detectToolDrift(checkpoint: Checkpoint, currentToolNames: string[]): { added: string[]; removed: string[] } {
		const cpSet = new Set(checkpoint.toolNames);
		const curSet = new Set(currentToolNames);
		const added = currentToolNames.filter((t) => !cpSet.has(t));
		const removed = checkpoint.toolNames.filter((t) => !curSet.has(t));
		return { added, removed };
	}
}
