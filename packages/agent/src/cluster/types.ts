/**
 * Cluster Types - Core types for multi-agent orchestration
 */

import type { ExecutionLaneEnvelope } from "@takumi/bridge";
import type { DockerIsolationConfig, MeshTopologyMode } from "@takumi/core";
import type { MessagePayload } from "../loop.js";

// ── Agent-to-Agent Message Protocol ──────────────────────────────────────────

/** Priority levels for inter-agent messages. */
export enum AgentMessagePriority {
	LOW = 0,
	NORMAL = 1,
	HIGH = 2,
	CRITICAL = 3,
}

/** A task delegation request between agents. */
export interface AgentTaskRequest {
	type: "task_request";
	id: string;
	from: string;
	to: string | null;
	priority: AgentMessagePriority;
	description: string;
	constraints?: Record<string, unknown>;
	parentTaskId?: string;
	deadline?: number;
	timestamp: number;
}

/** Structured result returned upon task completion. */
export interface AgentTaskResult {
	type: "task_result";
	id: string;
	from: string;
	taskRequestId: string;
	success: boolean;
	summary: string;
	artifacts?: AgentArtifact[];
	metrics?: { durationMs: number; tokensUsed: number };
	timestamp: number;
}

/** An artifact produced by an agent (file, diff, data). */
export interface AgentArtifact {
	kind: "file" | "diff" | "json" | "text";
	path?: string;
	content: string;
}

/** A context/knowledge share between agents. */
export interface AgentDiscoveryShare {
	type: "discovery_share";
	id: string;
	from: string;
	topic: string;
	payload: Record<string, unknown>;
	timestamp: number;
}

/** An agent asking the bus for help on a subtask. */
export interface AgentHelpRequest {
	type: "help_request";
	id: string;
	from: string;
	description: string;
	requiredCapabilities?: string[];
	timestamp: number;
}

/** Query whether any agent has a given capability. */
export interface AgentCapabilityQuery {
	type: "capability_query";
	id: string;
	from: string;
	capability: string;
	timestamp: number;
}

/** Response to a capability query. */
export interface AgentCapabilityResponse {
	type: "capability_response";
	id: string;
	from: string;
	queryId: string;
	capabilities: string[];
	confidence: number;
	timestamp: number;
}

/** Periodic heartbeat from an active agent. */
export interface AgentHeartbeat {
	type: "heartbeat";
	from: string;
	status: AgentStatus;
	progress?: number;
	timestamp: number;
}

/** Union of all inter-agent messages. */
export type AgentMessage =
	| AgentTaskRequest
	| AgentTaskResult
	| AgentDiscoveryShare
	| AgentHelpRequest
	| AgentCapabilityQuery
	| AgentCapabilityResponse
	| AgentHeartbeat;

/** Extract the type literal from an AgentMessage. */
export type AgentMessageType = AgentMessage["type"];

// ── Agent Roles ──────────────────────────────────────────────────────────────

export enum AgentRole {
	/** Plans the task breakdown and approach */
	PLANNER = "PLANNER",
	/** Executes the actual work */
	WORKER = "WORKER",
	/** Validates requirements are met */
	VALIDATOR_REQUIREMENTS = "VALIDATOR_REQUIREMENTS",
	/** Validates code quality and patterns */
	VALIDATOR_CODE = "VALIDATOR_CODE",
	/** Validates security concerns */
	VALIDATOR_SECURITY = "VALIDATOR_SECURITY",
	/** Validates tests exist and pass */
	VALIDATOR_TESTS = "VALIDATOR_TESTS",
	/** Adversarial validator - tries to break it */
	VALIDATOR_ADVERSARIAL = "VALIDATOR_ADVERSARIAL",
}

// ── Cluster Configuration ────────────────────────────────────────────────────

export type ClusterTopology = MeshTopologyMode;

export type ValidationStrategy = "none" | "single" | "majority" | "all_approve";

export interface ClusterConfig {
	/** Agent roles in this cluster */
	roles: AgentRole[];
	/** Executable route bindings resolved for each cluster lane, when available. */
	laneEnvelopes?: Partial<Record<AgentRole, ExecutionLaneEnvelope>>;
	/** How agents are coordinated */
	topology: ClusterTopology;
	/** How validation results are aggregated */
	validationStrategy: ValidationStrategy;
	/** Maximum validation retry attempts */
	maxRetries: number;
	/** Task description */
	taskDescription: string;
	/**
	 * Execution sandbox for cluster agents.
	 * - `"none"` (default) — runs in the current directory.
	 * - `"worktree"` — isolated git worktree (medium safety).
	 * - `"docker"` — full Docker container (high safety).
	 */
	isolationMode?: "none" | "worktree" | "docker";
	/** Docker config; required when `isolationMode = "docker"`. */
	dockerConfig?: DockerIsolationConfig;
}

// ── Agent Instance ───────────────────────────────────────────────────────────

export enum AgentStatus {
	IDLE = "IDLE",
	THINKING = "THINKING",
	EXECUTING = "EXECUTING",
	WAITING = "WAITING",
	DONE = "DONE",
	ERROR = "ERROR",
}

export interface AgentInstance {
	/** Unique agent ID */
	id: string;
	/** Agent role */
	role: AgentRole;
	/** Current status */
	status: AgentStatus;
	/** Agent's conversation history */
	messages: MessagePayload[];
	/** Agent's context (what it knows) */
	context: AgentContext;
	/** Start time */
	startedAt: number;
	/** Completion time */
	completedAt: number | null;
	/** Error if failed */
	error: string | null;
}

export interface AgentContext {
	/** Task description (all agents get this) */
	taskDescription: string;
	/** Plan from planner (worker gets this) */
	plan?: string;
	/** Work product from worker (validators get this) */
	workProduct?: WorkProduct;
	/** Validation results from other validators (for aggregation) */
	validationResults?: ValidationResult[];
}

// ── Work Product ─────────────────────────────────────────────────────────────

export interface WorkProduct {
	/** Files modified */
	filesModified: string[];
	/** Git diff of changes */
	diff: string;
	/** Summary of what was done */
	summary: string;
	/** Test results */
	testResults?: {
		passed: boolean;
		output: string;
	};
	/** Build results */
	buildResults?: {
		success: boolean;
		output: string;
	};
	/** Heuristic score from evaluator (0-10) — used in ensemble mode */
	heuristicScore?: number;
	/** Ensemble or progressive refinement metadata */
	metadata?: {
		// Ensemble fields
		ensembleCandidates?: number;
		consensusScore?: number;
		avgScore?: number;
		// Progressive refinement fields
		iterations?: number;
		stopReason?: string;
		initialScore?: number;
		improvementRate?: number;
		// MoA fields
		moaRounds?: number;
		moaConsensus?: number;
		moaAverageConfidence?: number;
		[key: string]: unknown;
	};
}

// ── Validation ───────────────────────────────────────────────────────────────

export enum ValidationDecision {
	APPROVE = "APPROVE",
	REJECT = "REJECT",
	NEEDS_INFO = "NEEDS_INFO",
}

export interface ValidationResult {
	/** Validator agent ID */
	validatorId: string;
	/** Validator role */
	validatorRole: AgentRole;
	/** Decision */
	decision: ValidationDecision;
	/** Specific findings */
	findings: ValidationFinding[];
	/** Overall reasoning */
	reasoning: string;
	/** Confidence (0-1) */
	confidence: number;
}

export interface ValidationFinding {
	/** Severity: critical, major, minor, info */
	severity: "critical" | "major" | "minor" | "info";
	/** Category: requirements, code_quality, security, tests, performance */
	category: string;
	/** Description of the issue */
	description: string;
	/** File and line if applicable */
	location?: {
		file: string;
		line?: number;
	};
	/** Suggested fix */
	suggestion?: string;
}

// ── Cluster State ────────────────────────────────────────────────────────────

export enum ClusterPhase {
	INITIALIZING = "INITIALIZING",
	PLANNING = "PLANNING",
	EXECUTING = "EXECUTING",
	VALIDATING = "VALIDATING",
	FIXING = "FIXING",
	DONE = "DONE",
	FAILED = "FAILED",
}

export interface ClusterState {
	/** Cluster ID */
	id: string;
	/** Configuration */
	config: ClusterConfig;
	/** Current phase */
	phase: ClusterPhase;
	/** All agent instances */
	agents: Map<string, AgentInstance>;
	/** Current validation attempt */
	validationAttempt: number;
	/** Plan from planner */
	plan: string | null;
	/** Work product from worker */
	workProduct: WorkProduct | null;
	/** Validation results */
	validationResults: ValidationResult[];
	/** Final decision */
	finalDecision: ValidationDecision | null;
	/** Created at */
	createdAt: number;
	/** Updated at */
	updatedAt: number;
}

// ── Cluster Events ───────────────────────────────────────────────────────────

export type ClusterEvent =
	| ClusterPhaseChange
	| ClusterAgentUpdate
	| ClusterValidationComplete
	| ClusterMoAComplete
	| ClusterError
	| ClusterComplete
	| ClusterEnsembleComplete
	| ClusterProgressiveComplete;

export interface ClusterPhaseChange {
	type: "phase_change";
	clusterId: string;
	oldPhase: ClusterPhase;
	newPhase: ClusterPhase;
	timestamp: number;
}

export interface ClusterAgentUpdate {
	type: "agent_update";
	clusterId: string;
	agentId: string;
	role: AgentRole;
	status: AgentStatus;
	message?: string;
	timestamp: number;
}

export interface ClusterValidationComplete {
	type: "validation_complete";
	clusterId: string;
	attempt: number;
	results: ValidationResult[];
	decision: ValidationDecision;
	timestamp: number;
}

export interface ClusterError {
	type: "cluster_error";
	clusterId: string;
	error: string;
	agentId?: string;
	timestamp: number;
}

export interface ClusterComplete {
	type: "cluster_complete";
	clusterId: string;
	success: boolean;
	workProduct: WorkProduct | null;
	timestamp: number;
}

export interface ClusterEnsembleComplete {
	type: "ensemble_complete";
	clusterId: string;
	candidateCount: number;
	winnerId: string;
	timestamp: number;
}

export interface ClusterProgressiveComplete {
	type: "progressive_complete";
	clusterId: string;
	iterationCount: number;
	finalScore: number;
	stopReason: "target_reached" | "max_iterations" | "plateau";
	timestamp: number;
}

export interface ClusterMoAComplete {
	type: "moa_validation_complete";
	clusterId: string;
	rounds: number;
	finalDecision: ValidationDecision;
	consensus: number;
	averageConfidence: number;
	timestamp: number;
}
