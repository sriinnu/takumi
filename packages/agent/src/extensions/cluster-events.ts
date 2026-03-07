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

/** Union of all cluster extension events. */
export type ClusterExtensionEvent =
	| ClusterStartEvent
	| ClusterPhaseChangeEvent
	| AgentSpawnEvent
	| AgentBusMessageEvent
	| AgentCompleteEvent;
