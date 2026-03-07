/**
 * Agent Identity — persistent capability profiles for agents.
 *
 * Tracks what each agent is good at across sessions so the orchestrator
 * can make smarter delegation + model routing decisions.
 *
 * Profiles are stored as JSON in `~/.takumi/agent-profiles.json` and
 * loaded on startup. The Thompson sampling bandit in `orchestrator-bandit.ts`
 * can optionally consume profile scores to bias strategy selection.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLogger } from "@takumi/core";
import type { AgentRole } from "./types.js";

const log = createLogger("agent-identity");

// ── Profile Types ────────────────────────────────────────────────────────────

/** A capability tag with a confidence score. */
export interface CapabilityScore {
	/** Capability name (e.g. "typescript", "security-review", "testing"). */
	name: string;
	/** Rolling success rate 0–1. */
	successRate: number;
	/** Total attempts tracked. */
	attempts: number;
	/** Exponentially-weighted latency in ms. */
	avgLatencyMs: number;
}

/** Persistent profile for an agent identity. */
export interface AgentProfile {
	/** Unique profile ID (derived from role + model). */
	id: string;
	/** Agent role. */
	role: AgentRole;
	/** Model used (e.g. "claude-sonnet-4-20250514"). */
	model: string;
	/** Capability scores keyed by capability name. */
	capabilities: Map<string, CapabilityScore>;
	/** Total tasks completed. */
	tasksCompleted: number;
	/** Total tasks failed. */
	tasksFailed: number;
	/** Created timestamp. */
	createdAt: number;
	/** Last updated timestamp. */
	updatedAt: number;
}

/** Outcome of a task to feed back into a profile. */
export interface TaskOutcome {
	role: AgentRole;
	model: string;
	success: boolean;
	capabilities: string[];
	durationMs: number;
	tokensUsed: number;
}

// ── Serialization helpers ────────────────────────────────────────────────────

interface ProfileJSON {
	id: string;
	role: AgentRole;
	model: string;
	capabilities: Record<string, CapabilityScore>;
	tasksCompleted: number;
	tasksFailed: number;
	createdAt: number;
	updatedAt: number;
}

function profileToJSON(p: AgentProfile): ProfileJSON {
	const caps: Record<string, CapabilityScore> = {};
	for (const [k, v] of p.capabilities) caps[k] = v;
	return { ...p, capabilities: caps };
}

function profileFromJSON(j: ProfileJSON): AgentProfile {
	const capabilities = new Map<string, CapabilityScore>();
	for (const [k, v] of Object.entries(j.capabilities)) capabilities.set(k, v);
	return { ...j, capabilities };
}

// ── Exponential moving average ───────────────────────────────────────────────

const EMA_ALPHA = 0.3;

function ema(prev: number, next: number): number {
	return EMA_ALPHA * next + (1 - EMA_ALPHA) * prev;
}

// ── AgentProfileStore ────────────────────────────────────────────────────────

// ── Topology win-rate entry ─────────────────────────────────────────────────

export interface TopologyWinRate {
	topology: string;
	winRate: number;
	total: number;
}

// ── AgentProfileStore ────────────────────────────────────────────────────────

export class AgentProfileStore {
	private readonly profiles = new Map<string, AgentProfile>();
	private readonly topologyStats = new Map<string, { wins: number; total: number }>();
	private readonly filePath: string;
	private dirty = false;

	constructor(filePath?: string) {
		this.filePath = filePath ?? join(process.env.HOME ?? "~", ".takumi", "agent-profiles.json");
		this.load();
	}

	// ── CRUD ──────────────────────────────────────────────────────────────────

	/** Get or create a profile for the given role+model combo. */
	getOrCreate(role: AgentRole, model: string): AgentProfile {
		const id = profileId(role, model);
		let profile = this.profiles.get(id);
		if (!profile) {
			const now = Date.now();
			profile = {
				id,
				role,
				model,
				capabilities: new Map(),
				tasksCompleted: 0,
				tasksFailed: 0,
				createdAt: now,
				updatedAt: now,
			};
			this.profiles.set(id, profile);
			this.dirty = true;
		}
		return profile;
	}

	/** Get a profile by ID. */
	get(id: string): AgentProfile | undefined {
		return this.profiles.get(id);
	}

	/** List all profiles. */
	list(): AgentProfile[] {
		return Array.from(this.profiles.values());
	}

	// ── Feedback ──────────────────────────────────────────────────────────────

	/** Record a task outcome and update the relevant profile. */
	recordOutcome(outcome: TaskOutcome): AgentProfile {
		const profile = this.getOrCreate(outcome.role, outcome.model);

		if (outcome.success) {
			profile.tasksCompleted++;
		} else {
			profile.tasksFailed++;
		}

		for (const cap of outcome.capabilities) {
			const existing = profile.capabilities.get(cap);
			if (existing) {
				existing.successRate = ema(existing.successRate, outcome.success ? 1 : 0);
				existing.attempts++;
				existing.avgLatencyMs = ema(existing.avgLatencyMs, outcome.durationMs);
			} else {
				profile.capabilities.set(cap, {
					name: cap,
					successRate: outcome.success ? 1 : 0,
					attempts: 1,
					avgLatencyMs: outcome.durationMs,
				});
			}
		}

		profile.updatedAt = Date.now();
		this.dirty = true;
		return profile;
	}
	// ── Topology tracking ───────────────────────────────────────────────────

	/** Record the success/failure of a cluster topology run. */
	recordTopologyOutcome(topology: string, success: boolean): void {
		const entry = this.topologyStats.get(topology) ?? { wins: 0, total: 0 };
		if (success) entry.wins++;
		entry.total++;
		this.topologyStats.set(topology, entry);
		this.dirty = true;
	}

	/** Win rate for a topology (0–1). Returns 0.5 (neutral) if no data. */
	topologyWinRate(topology: string): number {
		const entry = this.topologyStats.get(topology);
		if (!entry || entry.total === 0) return 0.5;
		return entry.wins / entry.total;
	}

	/** All topology win-rates, sorted by win rate descending. */
	topologyRates(): TopologyWinRate[] {
		return Array.from(this.topologyStats.entries())
			.map(([topology, { wins, total }]) => ({
				topology,
				winRate: total === 0 ? 0.5 : wins / total,
				total,
			}))
			.sort((a, b) => b.winRate - a.winRate);
	}
	// ── Query ─────────────────────────────────────────────────────────────────

	/**
	 * Find profiles with a given capability, ranked by success rate desc.
	 * Optionally filter by minimum attempts.
	 */
	findByCapability(capability: string, minAttempts = 1): AgentProfile[] {
		return this.list()
			.filter((p) => {
				const cap = p.capabilities.get(capability);
				return cap && cap.attempts >= minAttempts;
			})
			.sort((a, b) => {
				const aScore = a.capabilities.get(capability)!.successRate;
				const bScore = b.capabilities.get(capability)!.successRate;
				return bScore - aScore;
			});
	}

	/**
	 * Score a profile for a set of required capabilities.
	 * Returns 0–1 (1 = perfect match across all capabilities).
	 */
	scoreForTask(profileId: string, requiredCapabilities: string[]): number {
		const profile = this.profiles.get(profileId);
		if (!profile || requiredCapabilities.length === 0) return 0;

		let total = 0;
		let matched = 0;
		for (const cap of requiredCapabilities) {
			const score = profile.capabilities.get(cap);
			if (score && score.attempts >= 1) {
				total += score.successRate;
				matched++;
			}
		}
		return matched === 0 ? 0 : total / requiredCapabilities.length;
	}

	/**
	 * Return the best model for a role.
	 *
	 * If `capabilities` are provided the model with the highest capability-match
	 * score wins. Falls back to overall task success rate. Returns `undefined`
	 * when no data is available (caller should use its default).
	 */
	bestModelForRole(role: AgentRole, capabilities: string[] = []): string | undefined {
		const candidates = this.list().filter((p) => p.role === role && p.tasksCompleted >= 1);
		if (candidates.length === 0) return undefined;

		if (capabilities.length > 0) {
			const scored = candidates
				.map((p) => ({ model: p.model, score: this.scoreForTask(p.id, capabilities) }))
				.sort((a, b) => b.score - a.score);
			if (scored[0].score > 0) return scored[0].model;
		}

		// Fallback: sort by overall task success rate
		candidates.sort((a, b) => {
			const aRate = a.tasksCompleted / Math.max(1, a.tasksCompleted + a.tasksFailed);
			const bRate = b.tasksCompleted / Math.max(1, b.tasksCompleted + b.tasksFailed);
			return bRate - aRate;
		});
		return candidates[0]?.model;
	}

	// ── Persistence ───────────────────────────────────────────────────────────

	private load(): void {
		try {
			if (!existsSync(this.filePath)) return;
			const raw = readFileSync(this.filePath, "utf-8");
			const data = JSON.parse(raw) as ProfileJSON[];
			for (const j of data) {
				const profile = profileFromJSON(j);
				this.profiles.set(profile.id, profile);
			}
			log.info(`Loaded ${this.profiles.size} agent profiles`);
		} catch (err) {
			log.warn("Failed to load agent profiles", err);
		}
	}

	/** Persist dirty profiles to disk. */
	save(): void {
		if (!this.dirty) return;
		try {
			const dir = dirname(this.filePath);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const data = this.list().map(profileToJSON);
			writeFileSync(this.filePath, JSON.stringify(data, null, "\t"), "utf-8");
			this.dirty = false;
			log.debug(`Saved ${data.length} agent profiles`);
		} catch (err) {
			log.error("Failed to save agent profiles", err);
		}
	}

	/** Number of tracked profiles. */
	get size(): number {
		return this.profiles.size;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function profileId(role: AgentRole, model: string): string {
	return `${role.toLowerCase()}:${model}`;
}
