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
export type { CheckpointSummary, ClusterCheckpoint } from "./checkpoint.js";
// ── Checkpoint ────────────────────────────────────────────────────────────────
export { CheckpointManager } from "./checkpoint.js";
export type { IsolationContext, IsolationMode } from "./isolation.js";

// ── Isolation ─────────────────────────────────────────────────────────────────
export { createIsolationContext } from "./isolation.js";
export type { OrchestratorOptions } from "./orchestrator.js";
// ── Orchestrator ──────────────────────────────────────────────────────────────
export { ClusterOrchestrator } from "./orchestrator.js";
export type {
	AgentContext,
	AgentInstance,
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
	AgentRole,
	AgentStatus,
	ClusterPhase,
	ValidationDecision,
} from "./types.js";
