/**
 * @file checkpoint.ts
 * @module cluster/checkpoint
 *
 * Cluster checkpoint persistence — save and restore cluster state across crashes.
 *
 * ## Storage backends (in priority order)
 * 1. **Chitragupta Akasha** — knowledge graph deposit if bridge is connected.
 * 2. **Local filesystem** — `~/.takumi/checkpoints/<clusterId>.json` as fallback.
 *
 * ## Why two backends?
 * Chitragupta gives us searchable, semantic memory (useful for "/resume last
 * authentication task") while the local file is always available without a
 * running MCP server.
 *
 * ## Resume flow
 * ```
 * CheckpointManager.load(clusterId)
 *   → ClusterOrchestrator.resumeFromCheckpoint(checkpoint)
 *     → sets this.state from persisted snapshot
 *     → calls execute() which skips already-completed phases
 * ```
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChitraguptaBridge } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type {
	ClusterConfig,
	ClusterPhase,
	ClusterState,
	ValidationDecision,
	ValidationResult,
	WorkProduct,
} from "./types.js";

const log = createLogger("cluster-checkpoint");

/** Schema version — increment when the shape changes. */
const SCHEMA_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Serialisable snapshot of a cluster at a point in time. */
export interface ClusterCheckpoint {
	/** Schema version for forward-compatibility checks. */
	version: number;
	/** Unique cluster identifier. */
	clusterId: string;
	/** Phase the cluster was in when the checkpoint was taken. */
	phase: ClusterPhase;
	/** Original cluster configuration. */
	config: ClusterConfig;
	/** How many validation rounds have been attempted. */
	validationAttempt: number;
	/** The PLANNER's output, or `null` if planning hasn't completed. */
	plan: string | null;
	/** The WORKER's work product, or `null` if execution hasn't completed. */
	workProduct: WorkProduct | null;
	/** Accumulated validation results across all attempts. */
	validationResults: ValidationResult[];
	/** Final aggregated decision, or `null` if validation isn't complete. */
	finalDecision: ValidationDecision | null;
	/** Unix timestamp (ms) when this checkpoint was saved. */
	savedAt: number;
}

/** Lightweight listing entry returned by {@link CheckpointManager.list}. */
export interface CheckpointSummary {
	clusterId: string;
	phase: ClusterPhase;
	savedAt: number;
	taskDescription: string;
}

// ─── CheckpointManager ───────────────────────────────────────────────────────

/**
 * Manages cluster checkpoints — save, load, list, and delete.
 *
 * Instantiate once per {@link ClusterOrchestrator} and inject the optional
 * Chitragupta bridge.  All methods are safe to call when no bridge is present.
 *
 * @example
 * ```ts
 * const mgr = new CheckpointManager({ chitragupta });
 * await mgr.save(checkpoint);
 * const cp = await mgr.load("cluster-123");
 * ```
 */
export class CheckpointManager {
	private readonly dir: string;
	private readonly chitragupta?: ChitraguptaBridge;

	/**
	 * @param opts.chitragupta - Optional Chitragupta bridge for Akasha persistence.
	 * @param opts.dir         - Override the local checkpoint directory.
	 */
	constructor(opts: { chitragupta?: ChitraguptaBridge; dir?: string } = {}) {
		this.chitragupta = opts.chitragupta;
		this.dir = opts.dir ?? join(homedir(), ".takumi", "checkpoints");
	}

	/**
	 * Save a checkpoint to both Chitragupta and the local filesystem.
	 * Failures are logged but never thrown — checkpoints are best-effort.
	 */
	async save(checkpoint: ClusterCheckpoint): Promise<void> {
		const payload = JSON.stringify({ ...checkpoint, version: SCHEMA_VERSION });

		// 1. Local file (always attempted — fastest recovery path)
		try {
			await mkdir(this.dir, { recursive: true });
			await writeFile(join(this.dir, `${checkpoint.clusterId}.json`), payload, "utf8");
			log.debug(`Checkpoint written locally: ${checkpoint.clusterId} @ ${checkpoint.phase}`);
		} catch (err) {
			log.warn("Local checkpoint write failed", err);
		}

		// 2. Chitragupta Akasha (async, non-blocking)
		if (this.chitragupta?.isConnected) {
			this.chitragupta
				.akashaDeposit(payload, "cluster_checkpoint", ["orchestration", checkpoint.clusterId, checkpoint.phase])
				.catch((err: unknown) => log.warn("Akasha checkpoint deposit failed", err));
		}
	}

	/**
	 * Load a checkpoint by cluster ID.
	 * Tries the local filesystem first (faster), then Chitragupta.
	 *
	 * @param clusterId - The cluster ID to look up.
	 * @returns The checkpoint, or `null` if not found.
	 */
	async load(clusterId: string): Promise<ClusterCheckpoint | null> {
		// 1. Try local file
		try {
			const raw = await readFile(join(this.dir, `${clusterId}.json`), "utf8");
			const cp = JSON.parse(raw) as ClusterCheckpoint;
			if (cp.clusterId === clusterId) {
				log.info(`Checkpoint loaded locally: ${clusterId} @ ${cp.phase}`);
				return cp;
			}
		} catch {
			/* not found locally — try Akasha */
		}

		// 2. Try Chitragupta Akasha
		if (this.chitragupta?.isConnected) {
			try {
				const traces = await this.chitragupta.akashaTraces(`cluster_checkpoint ${clusterId}`, 5);
				for (const trace of traces) {
					try {
						const cp = JSON.parse(trace.content) as ClusterCheckpoint;
						if (cp.clusterId === clusterId) {
							log.info(`Checkpoint loaded from Akasha: ${clusterId} @ ${cp.phase}`);
							return cp;
						}
					} catch {
						/* malformed trace — skip */
					}
				}
			} catch (err) {
				log.warn("Akasha checkpoint lookup failed", err);
			}
		}

		log.debug(`No checkpoint found for cluster ${clusterId}`);
		return null;
	}

	/**
	 * List all locally stored checkpoints, sorted newest-first.
	 *
	 * @returns Summary entries — lightweight, no full state deserialized.
	 */
	async list(): Promise<CheckpointSummary[]> {
		try {
			const files = await readdir(this.dir);
			const summaries: CheckpointSummary[] = [];
			for (const f of files.filter((f) => f.endsWith(".json"))) {
				try {
					const raw = await readFile(join(this.dir, f), "utf8");
					const cp = JSON.parse(raw) as ClusterCheckpoint;
					summaries.push({
						clusterId: cp.clusterId,
						phase: cp.phase,
						savedAt: cp.savedAt,
						taskDescription: cp.config?.taskDescription ?? "",
					});
				} catch {
					/* corrupt file — skip */
				}
			}
			return summaries.sort((a, b) => b.savedAt - a.savedAt);
		} catch {
			return [];
		}
	}

	/**
	 * Delete a local checkpoint file.
	 * Silently succeeds if the file does not exist.
	 *
	 * @param clusterId - The cluster ID whose checkpoint to remove.
	 */
	async delete(clusterId: string): Promise<void> {
		try {
			await rm(join(this.dir, `${clusterId}.json`), { force: true });
			log.debug(`Checkpoint deleted: ${clusterId}`);
		} catch (err) {
			log.warn("Checkpoint delete failed", err);
		}
	}

	/**
	 * Convert a {@link ClusterState} into a {@link ClusterCheckpoint} snapshot.
	 * This is a pure helper — does not persist anything.
	 */
	static fromState(state: ClusterState): ClusterCheckpoint {
		return {
			version: SCHEMA_VERSION,
			clusterId: state.id,
			phase: state.phase,
			config: state.config,
			validationAttempt: state.validationAttempt,
			plan: state.plan,
			workProduct: state.workProduct,
			validationResults: state.validationResults,
			finalDecision: state.finalDecision,
			savedAt: Date.now(),
		};
	}
}
