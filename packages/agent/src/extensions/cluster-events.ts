/**
 * Cluster extension events — emitted by multi-agent orchestration
 * and consumed by the extension system.
 *
 * Separated from extension-types.ts to keep file sizes within the
 * 450-line LOC guard.
 */

import type { AgentMessage } from "../cluster/types.js";

// ── Cluster / Multi-Agent Events ─────────────────────────────────────────────

/** Fired when a multi-agent cluster starts. */
export interface ClusterStartEvent {
	type: "cluster_start";
	clusterId: string;
	agentCount: number;
	topology: string;
}

/** Fired when the cluster transitions between phases. */
export interface ClusterPhaseChangeEvent {
	type: "cluster_phase_change";
	clusterId: string;
	oldPhase: string;
	newPhase: string;
}

/** Fired when an agent is spawned in the cluster. */
export interface AgentSpawnEvent {
	type: "agent_spawn";
	clusterId: string;
	agentId: string;
	role: string;
}

/** Fired when an inter-agent message is published on the bus. */
export interface AgentBusMessageEvent {
	type: "agent_message";
	message: AgentMessage;
}

/** Fired when a cluster agent completes its work. */
export interface AgentCompleteEvent {
	type: "agent_complete";
	clusterId: string;
	agentId: string;
	role: string;
	success: boolean;
}

// ── Cluster End ───────────────────────────────────────────────────────────────

/** Fires when the cluster finishes — whether it succeeded, was rejected, or threw. */
export interface ClusterEndEvent {
	type: "cluster_end";
	clusterId: string;
	success: boolean;
	topology: string;
	agentCount: number;
	durationMs: number;
	validationAttempts: number;
	/** Combined input + output tokens across all cluster agents. */
	totalTokens: number;
	/** Unhandled exception message when success is false and an error was thrown. */
	error?: string;
}

// ── Topology Adaptation ───────────────────────────────────────────────────────

/** Fires when Lucy or Scarlett reroutes the active topology mid-run. */
export interface ClusterTopologyAdaptEvent {
	type: "cluster_topology_adapt";
	clusterId: string;
	fromTopology: string;
	toTopology: string;
	/** What drove the change. */
	reason: "profile_bias" | "validation_rejection" | "scarlett_guard";
	validationAttempt: number;
}

// ── Validation Attempt ────────────────────────────────────────────────────────

/** Fires at the conclusion of each mesh validation cycle. */
export interface ClusterValidationAttemptEvent {
	type: "cluster_validation_attempt";
	clusterId: string;
	attempt: number;
	approvals: number;
	rejections: number;
	decision: "APPROVE" | "REJECT" | "NEEDS_REVISION";
	/** Pre-screen heuristic score (0–10), available when the evaluator ran. */
	heuristicScore?: number;
}

// ── Agent Profile Update ──────────────────────────────────────────────────────

/** Fires after agent capability profiles are persisted at the end of a cluster run. */
export interface AgentProfileUpdatedEvent {
	type: "agent_profile_updated";
	clusterId: string;
	profiles: Array<{
		id: string;
		role: string;
		model: string;
		success: boolean;
		topCapabilities: string[];
	}>;
	/** Whether the topology win-rate table was updated. */
	topologyWinRateUpdated: boolean;
}

// ── Budget ────────────────────────────────────────────────────────────────────

/** Fires when cumulative token spend crosses a warning or exceeded threshold. */
export interface ClusterBudgetEvent {
	type: "cluster_budget";
	clusterId: string;
	level: "warning" | "exceeded";
	totalTokensUsed: number;
	/** Rough USD cost at standard list pricing. */
	estimatedCostUsd: number;
}

// ── Sabha Escalation ──────────────────────────────────────────────────────────

/** Fires when weak mesh consensus triggers a Sabha escalation attempt. */
export interface SabhaEscalationEvent {
	type: "sabha_escalation";
	clusterId: string;
	topic: string;
	reason: string;
	approvals: number;
	rejections: number;
	validationAttempt: number;
	/** True when sabhaAsk() was actually invoked; false when no observer was available. */
	escalated: boolean;
}

// ── Union ─────────────────────────────────────────────────────────────────────

/** Union of all cluster extension events. */
export type ClusterExtensionEvent =
	| ClusterStartEvent
	| ClusterPhaseChangeEvent
	| AgentSpawnEvent
	| AgentBusMessageEvent
	| AgentCompleteEvent
	| ClusterEndEvent
	| ClusterTopologyAdaptEvent
	| ClusterValidationAttemptEvent
	| AgentProfileUpdatedEvent
	| ClusterBudgetEvent
	| SabhaEscalationEvent;
