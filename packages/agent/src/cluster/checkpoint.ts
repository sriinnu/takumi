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

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChitraguptaBridge } from "@takumi/bridge";
import { createLogger, type OrchestrationConfig } from "@takumi/core";
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
const POLICY_MARKER_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClusterCheckpointPolicyMarkers {
	markerVersion: number;
	checkpointTopology: ClusterConfig["topology"];
	configuredDefaultTopology: ClusterConfig["topology"] | null;
	routePolicyHash: string | null;
	safetyPolicyHash: string | null;
}

export type ClusterCheckpointCompatibilityConflictKind =
	| "schema_version_mismatch"
	| "policy_marker_version_mismatch"
	| "route_policy_mismatch"
	| "safety_policy_mismatch";

export interface ClusterCheckpointCompatibilityConflict {
	kind: ClusterCheckpointCompatibilityConflictKind;
	expected: string;
	actual: string;
}

export interface ClusterCheckpointCompatibilityResult {
	ok: boolean;
	blocking: boolean;
	warnings: string[];
	conflicts: ClusterCheckpointCompatibilityConflict[];
	summary: string | null;
}

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
	/** Route/safety policy markers recorded when the checkpoint was saved. */
	policyMarkers?: ClusterCheckpointPolicyMarkers;
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

export function buildClusterCheckpointPolicyMarkers(
	config: ClusterConfig,
	orchestrationConfig?: OrchestrationConfig,
): ClusterCheckpointPolicyMarkers {
	return {
		markerVersion: POLICY_MARKER_VERSION,
		checkpointTopology: config.topology,
		configuredDefaultTopology: orchestrationConfig?.mesh?.defaultTopology ?? null,
		routePolicyHash: hashPolicySeed({
			checkpointTopology: config.topology,
			roles: [...config.roles],
			modelRouting: orchestrationConfig?.modelRouting ?? null,
			meshRouting: {
				defaultTopology: orchestrationConfig?.mesh?.defaultTopology ?? null,
				lucyAdaptiveTopology: orchestrationConfig?.mesh?.lucyAdaptiveTopology ?? null,
				scarlettAdaptiveTopology: orchestrationConfig?.mesh?.scarlettAdaptiveTopology ?? null,
			},
		}),
		safetyPolicyHash: hashPolicySeed({
			roles: [...config.roles],
			validationStrategy: config.validationStrategy,
			maxRetries: config.maxRetries,
			isolationMode: config.isolationMode ?? null,
			dockerConfig: config.dockerConfig ?? null,
			enabled: orchestrationConfig?.enabled ?? null,
			defaultMode: orchestrationConfig?.defaultMode ?? null,
			complexityThreshold: orchestrationConfig?.complexityThreshold ?? null,
			maxValidationRetries: orchestrationConfig?.maxValidationRetries ?? null,
			configuredIsolationMode: orchestrationConfig?.isolationMode ?? null,
			configuredDocker: orchestrationConfig?.docker ?? null,
			mesh: orchestrationConfig?.mesh ?? null,
			ensemble: orchestrationConfig?.ensemble ?? null,
			weightedVoting: orchestrationConfig?.weightedVoting ?? null,
			reflexion: orchestrationConfig?.reflexion ?? null,
			moA: orchestrationConfig?.moA ?? null,
			progressiveRefinement: orchestrationConfig?.progressiveRefinement ?? null,
			adaptiveTemperature: orchestrationConfig?.adaptiveTemperature ?? null,
		}),
	};
}

export function evaluateClusterCheckpointCompatibility(
	checkpoint: ClusterCheckpoint,
	orchestrationConfig?: OrchestrationConfig,
): ClusterCheckpointCompatibilityResult {
	const warnings: string[] = [];
	const conflicts: ClusterCheckpointCompatibilityConflict[] = [];
	if (checkpoint.version !== SCHEMA_VERSION) {
		conflicts.push({
			kind: "schema_version_mismatch",
			expected: String(SCHEMA_VERSION),
			actual: String(checkpoint.version),
		});
	}

	const savedMarkers = checkpoint.policyMarkers;
	if (!savedMarkers) {
		warnings.push("Checkpoint policy markers are missing; resume drift validation is partial.");
		return finishCompatibility(checkpoint.clusterId, warnings, conflicts);
	}

	if (savedMarkers.markerVersion !== POLICY_MARKER_VERSION) {
		conflicts.push({
			kind: "policy_marker_version_mismatch",
			expected: String(POLICY_MARKER_VERSION),
			actual: String(savedMarkers.markerVersion),
		});
	}

	const currentMarkers = buildClusterCheckpointPolicyMarkers(checkpoint.config, orchestrationConfig);
	if (
		savedMarkers.routePolicyHash &&
		currentMarkers.routePolicyHash &&
		savedMarkers.routePolicyHash !== currentMarkers.routePolicyHash
	) {
		conflicts.push({
			kind: "route_policy_mismatch",
			expected: savedMarkers.routePolicyHash,
			actual: currentMarkers.routePolicyHash,
		});
	}
	if (
		savedMarkers.safetyPolicyHash &&
		currentMarkers.safetyPolicyHash &&
		savedMarkers.safetyPolicyHash !== currentMarkers.safetyPolicyHash
	) {
		conflicts.push({
			kind: "safety_policy_mismatch",
			expected: savedMarkers.safetyPolicyHash,
			actual: currentMarkers.safetyPolicyHash,
		});
	}

	if (
		currentMarkers.configuredDefaultTopology &&
		savedMarkers.checkpointTopology !== currentMarkers.configuredDefaultTopology
	) {
		warnings.push(
			`Checkpoint topology ${savedMarkers.checkpointTopology} differs from the current default ${currentMarkers.configuredDefaultTopology}.`,
		);
	}

	if (!savedMarkers.routePolicyHash || !savedMarkers.safetyPolicyHash) {
		warnings.push("Checkpoint policy markers are incomplete; route/safety drift validation is partial.");
	}

	return finishCompatibility(checkpoint.clusterId, warnings, conflicts);
}

function finishCompatibility(
	clusterId: string,
	warnings: string[],
	conflicts: ClusterCheckpointCompatibilityConflict[],
): ClusterCheckpointCompatibilityResult {
	const blocking = conflicts.length > 0;
	return {
		ok: conflicts.length === 0,
		blocking,
		warnings,
		conflicts,
		summary: buildCompatibilitySummary(clusterId, warnings, conflicts),
	};
}

function buildCompatibilitySummary(
	clusterId: string,
	warnings: string[],
	conflicts: ClusterCheckpointCompatibilityConflict[],
): string | null {
	if (conflicts.length > 0) {
		return `Checkpoint compatibility blocked resume for ${clusterId}: ${conflicts.map(formatCompatibilityConflict).join("; ")}`;
	}
	if (warnings.length > 0) {
		return `Checkpoint compatibility warnings for ${clusterId}: ${warnings.join("; ")}`;
	}
	return null;
}

function formatCompatibilityConflict(conflict: ClusterCheckpointCompatibilityConflict): string {
	switch (conflict.kind) {
		case "schema_version_mismatch":
			return `schema version mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "policy_marker_version_mismatch":
			return `policy marker version mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "route_policy_mismatch":
			return `route policy mismatch (${conflict.expected} ≠ ${conflict.actual})`;
		case "safety_policy_mismatch":
			return `safety policy mismatch (${conflict.expected} ≠ ${conflict.actual})`;
	}
	return "unknown compatibility conflict";
}

function hashPolicySeed(seed: unknown): string | null {
	return createHash("sha256")
		.update(JSON.stringify(normalizeForHash(seed)))
		.digest("hex")
		.slice(0, 12);
}

function normalizeForHash(value: unknown): unknown {
	if (value === undefined) return null;
	if (Array.isArray(value)) return value.map((entry) => normalizeForHash(entry));
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, normalizeForHash(entry)]),
		);
	}
	return value;
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
	static fromState(state: ClusterState, orchestrationConfig?: OrchestrationConfig): ClusterCheckpoint {
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
			policyMarkers: buildClusterCheckpointPolicyMarkers(state.config, orchestrationConfig),
			savedAt: Date.now(),
		};
	}
}
