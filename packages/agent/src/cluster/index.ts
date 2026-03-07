/**
 * Cluster Orchestration — Multi-agent coordination.
 *
 * Exports Takumi's {@link ClusterOrchestrator} plus the five niyanta preset
 * plans so callers can pass them directly to `ClusterOrchestrator` without
 * importing `@yugenlab/chitragupta` themselves.
 */

// ── Niyanta preset plans (re-exported for convenience) ────────────────────────
export {
	BUG_HUNT_PLAN,
	CODE_REVIEW_PLAN,
	DOCUMENTATION_PLAN,
	REFACTOR_PLAN,
	TDD_PLAN,
} from "@yugenlab/chitragupta/niyanta";
// ── Agent Bus ─────────────────────────────────────────────────────────────────
export type { AgentBusOptions, MessageFilter, Subscription } from "./agent-bus.js";
export { AgentBus, buildCapabilityQuery, buildTaskRequest, buildTaskResult, createMessageId } from "./agent-bus.js";
// ── Agent Identity ────────────────────────────────────────────────────────────
export type { AgentProfile, CapabilityScore, TaskOutcome, TopologyWinRate } from "./agent-identity.js";
export { AgentProfileStore } from "./agent-identity.js";
export type { CheckpointSummary, ClusterCheckpoint } from "./checkpoint.js";
// ── Checkpoint ────────────────────────────────────────────────────────────────
export { CheckpointManager } from "./checkpoint.js";
// ── Chitragupta Bus Bridge ────────────────────────────────────────────────────
export type { BusBridgeStats, ChitraguptaBusBridgeOptions } from "./chitragupta-bus-bridge.js";
export { ChitraguptaBusBridge } from "./chitragupta-bus-bridge.js";
export type { IsolationContext, IsolationMode } from "./isolation.js";
// ── Isolation ─────────────────────────────────────────────────────────────────
export { createIsolationContext } from "./isolation.js";
export type { DeriveClusterConfigInput, MeshIntegrityStatus, MeshPolicyDecision } from "./mesh-policy.js";
export {
	adaptTopologyAfterRejection,
	deriveClusterConfig,
	getTopologyGuidance,
	shouldEscalateWeakConsensus,
} from "./mesh-policy.js";
export type { OrchestratorOptions } from "./orchestrator.js";
// ── Orchestrator ──────────────────────────────────────────────────────────────
export { ClusterOrchestrator } from "./orchestrator.js";
// ── Orchestrator Profile Helpers ──────────────────────────────────────────────
export { getProfileBiasedModel, inferRoutingCaps, lucyBiasTopology } from "./orchestrator-profile.js";
// ── Side Agent Registry ───────────────────────────────────────────────────────
export type { SideAgentListener } from "./side-agent-registry.js";
export { SideAgentRegistry } from "./side-agent-registry.js";
// ── Tmux Orchestrator ─────────────────────────────────────────────────────────
export type { TmuxWindow } from "./tmux-orchestrator.js";
export { TmuxOrchestrator } from "./tmux-orchestrator.js";
// ── Tree-of-Thoughts ─────────────────────────────────────────────────────────
export type { ThoughtNode, ToTConfig, ToTResult } from "./tot-planner.js";
export { totPlan } from "./tot-planner.js";
export type {
	AgentArtifact,
	AgentCapabilityQuery,
	AgentCapabilityResponse,
	AgentContext,
	AgentDiscoveryShare,
	AgentHeartbeat,
	AgentHelpRequest,
	AgentInstance,
	AgentMessage,
	AgentMessageType,
	AgentTaskRequest,
	AgentTaskResult,
	ClusterAgentUpdate,
	ClusterComplete,
	ClusterConfig,
	ClusterError,
	ClusterEvent,
	ClusterMoAComplete,
	ClusterPhaseChange,
	ClusterState,
	ClusterTopology,
	ClusterValidationComplete,
	ValidationFinding,
	ValidationResult,
	ValidationStrategy,
	WorkProduct,
} from "./types.js";
// ── Cluster types ─────────────────────────────────────────────────────────────
export {
	AgentMessagePriority,
	AgentRole,
	AgentStatus,
	ClusterPhase,
	ValidationDecision,
} from "./types.js";

// ── Worktree Pool ─────────────────────────────────────────────────────────────
export type { WorktreePoolOptions, WorktreeSlot } from "./worktree-pool.js";
export { WorktreePoolManager } from "./worktree-pool.js";
