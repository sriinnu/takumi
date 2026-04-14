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
// ── Authority Leasing ─────────────────────────────────────────────────────────
export type { AuthorityLease, LeaseErrorCode } from "./authority-lease.js";
export { AuthorityLeaseManager, LeaseError } from "./authority-lease.js";
export type { CheckpointSummary, ClusterCheckpoint } from "./checkpoint.js";
// ── Checkpoint ────────────────────────────────────────────────────────────────
export { CheckpointManager } from "./checkpoint.js";
// ── Chitragupta Bus Bridge ────────────────────────────────────────────────────
export type { BusBridgeStats, ChitraguptaBusBridgeOptions } from "./chitragupta-bus-bridge.js";
export { ChitraguptaBusBridge } from "./chitragupta-bus-bridge.js";
// ── Dispatch Log ──────────────────────────────────────────────────────────────
export type { DispatchErrorCode, DispatchRecord } from "./dispatch-log.js";
export { DispatchError, DispatchLog, DispatchStatus } from "./dispatch-log.js";
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
// ── MuxAdapter ────────────────────────────────────────────────────────────────
export type { MuxAdapter, MuxOperation, MuxOutcome, MuxWindow } from "./mux-adapter.js";
export { createMuxAdapter, executeMuxOperation, MuxError } from "./mux-adapter.js";
export type { OrchestratorOptions } from "./orchestrator.js";
// ── Orchestrator ──────────────────────────────────────────────────────────────
export { ClusterOrchestrator } from "./orchestrator.js";
// ── Orchestrator Factory ──────────────────────────────────────────────────────
export { createOrchestrator, type Orchestrator } from "./orchestrator-factory.js";
// ── Orchestrator Profile Helpers ──────────────────────────────────────────────
export { getProfileBiasedModel, inferRoutingCaps, lucyBiasTopology } from "./orchestrator-profile.js";
// ── Process Orchestrator (tmux fallback) ──────────────────────────────────────
export type { ProcessWindow } from "./process-orchestrator.js";
export { ProcessOrchestrator } from "./process-orchestrator.js";
export type {
	SideAgentAuditCode,
	SideAgentAuditIssue,
	SideAgentAuditSeverity,
	SideAgentRuntimeAudit,
} from "./side-agent-audit.js";
export { auditSideAgentRuntime } from "./side-agent-audit.js";
export type { SideAgentRecoverySummary } from "./side-agent-recovery.js";
export { reconcilePersistedSideAgents } from "./side-agent-recovery.js";
// ── Side Agent Registry ───────────────────────────────────────────────────────
export type { SideAgentListener } from "./side-agent-registry.js";
export { SideAgentRegistry } from "./side-agent-registry.js";
export type { SideAgentRegistrySnapshot } from "./side-agent-registry-io.js";
export { inspectPersistedSideAgentRegistry } from "./side-agent-registry-io.js";
export type { SideAgentRegistryRepairMode, SideAgentRegistryRepairResult } from "./side-agent-registry-repair.js";
export { repairPersistedSideAgentRegistry } from "./side-agent-registry-repair.js";
// ── Tmux Orchestrator ─────────────────────────────────────────────────────────
export type { TmuxWindow, TmuxWindowLocator } from "./tmux-orchestrator.js";
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
