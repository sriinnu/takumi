// Agent loop

export * from "./autocycle.js";
// Phase 39 — Agent Checkpoint / Resume
export type { Checkpoint, CheckpointManagerConfig } from "./checkpoint.js";
export { AgentCheckpointManager } from "./checkpoint.js";
export type {
	AgentSlot,
	AgentTopology,
	ClassificationResult,
	ClassifierOptions,
	// re-exported niyanta types — callers don't need a separate @yugenlab/chitragupta import
	OrchestrationPlan,
	OrchestratorTask,
	TaskClassification,
} from "./classifier.js";
// Task classifier (+ niyanta plan helpers)
export { TaskClassifier, TaskComplexity, TaskType } from "./classifier.js";
export type {
	AgentInstance,
	CheckpointSummary,
	ClusterCheckpoint,
	ClusterConfig,
	ClusterEvent,
	ClusterState,
	DeriveClusterConfigInput,
	IsolationContext,
	IsolationMode,
	MeshIntegrityStatus,
	MeshPolicyDecision,
	MuxAdapter,
	MuxErrorCode,
	MuxOperation,
	MuxOutcome,
	MuxWindow,
	Orchestrator,
	OrchestratorOptions,
	SideAgentAuditCode,
	SideAgentAuditIssue,
	SideAgentAuditSeverity,
	SideAgentListener,
	SideAgentRecoverySummary,
	SideAgentRegistryRepairMode,
	SideAgentRegistryRepairResult,
	SideAgentRegistrySnapshot,
	SideAgentRuntimeAudit,
	TmuxWindow,
	TmuxWindowLocator,
	TopologyWinRate,
	ValidationFinding,
	ValidationResult,
	WorkProduct,
	WorktreePoolOptions,
	WorktreeSlot,
} from "./cluster/index.js";
// Cluster orchestration
export {
	AgentRole,
	AgentStatus,
	adaptTopologyAfterRejection,
	auditSideAgentRuntime,
	CheckpointManager,
	ClusterOrchestrator,
	ClusterPhase,
	createMuxAdapter,
	deriveClusterConfig,
	executeMuxOperation,
	getTopologyGuidance,
	inferRoutingCaps,
	inspectPersistedSideAgentRegistry,
	MuxError,
	reconcilePersistedSideAgents,
	repairPersistedSideAgentRegistry,
	SideAgentRegistry,
	shouldEscalateWeakConsensus,
	TmuxOrchestrator,
	ValidationDecision,
	WorktreePoolManager,
} from "./cluster/index.js";
export { buildCognitiveState } from "./cognition/runtime.js";
export type {
	BuildCognitiveStateInput,
	CognitiveAwareness,
	CognitiveContextPressure,
	CognitiveDirective,
	CognitiveIntegrityStatus,
	CognitiveIntuition,
	CognitivePatternMatch,
	CognitivePrediction,
	CognitiveRoutingDecision,
	CognitiveSignalKind,
	CognitiveStance,
	CognitiveState,
	CognitiveSteeringBacklogItem,
	CognitiveWorkspace,
	CognitiveWorkspaceMode,
	IntuitionSignal,
} from "./cognition/types.js";
// Phase 41 — Adaptive System Prompt
export type {
	AdaptivePromptConfig,
	AdaptResult,
	PromptSection,
	TaskType as AdaptiveTaskType,
	ToolUsageProfile,
} from "./context/adaptive-prompt.js";
export { AdaptivePromptManager, classifyTask } from "./context/adaptive-prompt.js";
export type { TokenBudget } from "./context/budget.js";
export { allocateTokenBudget, estimateTokens, truncateToTokenBudget } from "./context/budget.js";
export type { ContextOptions, SystemPromptOptions } from "./context/builder.js";
// Context
export { buildContext, buildSystemPrompt as buildRichSystemPrompt } from "./context/builder.js";
export type { CompactOptions, CompactResult, PayloadCompactOptions } from "./context/compact.js";
export {
	compactHistory,
	compactMessages,
	compactMessagesDetailed,
	estimatePayloadTokens,
	estimateTotalPayloadTokens,
	shouldCompact,
} from "./context/compact.js";
export type { ExperienceArchive, ExperienceRecall, ToolRuntimeSnapshot } from "./context/experience-memory.js";
export { ExperienceMemory } from "./context/experience-memory.js";
// Codebase indexer (Phase 10 — RAG)
export type { CodebaseIndex, FileEntry, IndexedSymbol, IndexStats } from "./context/indexer.js";
export { buildIndex, indexStats, loadIndex } from "./context/indexer.js";
// Phase 33 — Agent Memory Hooks
export type { ExtractionEvent, Lesson, MemoryHooksConfig } from "./context/memory-hooks.js";
export { MemoryHooks } from "./context/memory-hooks.js";
export type { EvolvingPrinciple, PrincipleTurnSignal } from "./context/principles.js";
export { PrincipleMemory } from "./context/principles.js";
export type { ProjectContext, ProjectInfo } from "./context/project.js";
export {
	detectFramework,
	detectLanguage,
	detectPackageManager,
	detectProject,
	detectProjectContext,
} from "./context/project.js";
// Phase 34 — Prompt Cache Layer
export type { CacheEntry, CacheStats, PromptCacheConfig } from "./context/prompt-cache.js";
export { PromptCache } from "./context/prompt-cache.js";
// RAG query + formatting (Phase 10)
export type { RagOptions, RagResult } from "./context/rag.js";
export { formatRagContext, queryIndex } from "./context/rag.js";
// Phase 29 — Context Ripple DAG
export type { DagNode, RippleResult } from "./context/ripple-dag.js";
export { RippleDag } from "./context/ripple-dag.js";
// Phase 30 — Smart Context Window
export type { ContextItem, PackResult, ScoredItem, SmartContextConfig } from "./context/smart-context.js";
export { SmartContextWindow } from "./context/smart-context.js";
export type { SoulData } from "./context/soul.js";
export { formatSoulPrompt, loadSoul } from "./context/soul.js";
export { buildStrategyPrompt } from "./context/strategy-guide.js";
export type {
	HistoryCompactionPlan,
	HistoryCompactionResult,
	OptimizedPromptWindow,
	PromptContextSection,
} from "./context/window-optimizer.js";
export {
	buildHistoryCompactionPlan,
	estimateTurnHistoryTokens,
	maybeCompactHistory,
	optimizePromptWindow,
} from "./context/window-optimizer.js";
// LLM cost estimation + budget enforcement (Phase 11)
export type { BudgetGuardOptions, CostEstimate } from "./cost.js";
export { BudgetExceededError, BudgetGuard, estimateClusterCost, estimateCost, MODEL_PRICING } from "./cost.js";
// Phase 38 — Streaming Cost Tracker
export type { AlertLevel, CostSnapshot, CostTrackerConfig, TurnCost, UsageCostInput } from "./cost-tracker.js";
export { CostTracker, estimateUsageCost } from "./cost-tracker.js";
export type { ErrorCategory } from "./errors.js";
// Error types and categorization
export {
	ContextOverflowError,
	categorizeError,
	friendlyErrorMessage,
	isRetryable,
	ProviderUnavailableError,
} from "./errors.js";
export type { ExecBootstrapOptions, ExecBootstrapResult } from "./exec-bootstrap.js";
export { bootstrapChitraguptaForExec } from "./exec-bootstrap.js";
export * from "./extensions/public.js";
// Phase 26 — Guardian daemon
export type { GuardianConfig, GuardianEvent, GuardianSuggestion } from "./guardian.js";
export { Guardian } from "./guardian.js";
export type { AgentLoopOptions, MessagePayload } from "./loop.js";
export { agentLoop } from "./loop.js";
// Message building
export { buildSystemPrompt, buildToolResult, buildUserMessage } from "./message.js";
export type {
	EngineRouteClass,
	ModelRecommendation,
	ModelTier,
	ProviderFamily,
	RouterRole,
	TopicDomain,
} from "./model-router.js";
// Smart model router
export {
	inferProvider,
	MODEL_TIERS,
	ModelRouter,
	recommendRouteClass,
	syncModelTiersFromKosha,
} from "./model-router.js";
// Phase 49 — Observation Collector
export type { ObservationCollectorConfig } from "./observation-collector.js";
export { ObservationCollector } from "./observation-collector.js";
// Prompt template engine
export type { PromptTemplate, TemplateParams, TemplateValue } from "./prompt-template.js";
export { compileTemplate, renderTemplate } from "./prompt-template.js";
// Providers
export { DarpanaProvider } from "./providers/darpana.js";
export { DirectProvider } from "./providers/direct.js";
export type { FailoverEntry, FailoverProviderConfig, ProviderLike, ProviderStatus } from "./providers/failover.js";
export { FailoverProvider } from "./providers/failover.js";
export type { GeminiProviderConfig } from "./providers/gemini.js";
export { GeminiProvider } from "./providers/gemini.js";
export type { HandoffResult } from "./providers/handoff.js";
export { HandoffTransformer } from "./providers/handoff.js";
export type { OpenAIProviderConfig } from "./providers/openai.js";
export { OpenAIProvider } from "./providers/openai.js";
export type { RetryOptions } from "./retry.js";
// Retry logic
export {
	computeDelay,
	DEFAULT_RETRY_OPTIONS,
	getRetryAfterMs,
	isRetryableError,
	RetryableError,
	withRetry,
} from "./retry.js";
// Safety — allowlist
export type { AllowlistOverride } from "./safety/allowlist.js";
export { buildDefaultRules, mergeAllowlist, parseAllowlistConfig } from "./safety/allowlist.js";
export { PermissionEngine } from "./safety/permissions.js";
// Safety — sandbox
export { DANGEROUS_PATTERNS, SAFE_COMMANDS, validateCommand } from "./safety/sandbox.js";
// SDK embedding API
export type { SessionOptions, TakumiSession } from "./sdk.js";
export { createSession } from "./sdk.js";
// P-Track 3 — Structured Handoff/Reattach
export type { CreateHandoffInput, HandoffManagerConfig } from "./session-handoff.js";
export { HandoffManager } from "./session-handoff.js";
// Phase 48 — Steering Queue
export type {
	EnqueueOptions,
	OnEnqueueCallback,
	SteeringItem,
	SteeringPriorityLevel,
} from "./steering-queue.js";
export { SteeringPriority, SteeringQueue } from "./steering-queue.js";
// SSE stream parser
export { parseSSEStream } from "./stream.js";
export type { RoutingOverridePlan } from "./task-routing.js";
export { resolveRoutingOverrides as resolveTaskRoutingOverrides } from "./task-routing.js";
// Telemetry helpers (Phase 20)
export {
	calculateContextPressure,
	calculateContextPressureFromTokens,
	estimateMessagesTokens,
	renderLastAssistantHtml,
} from "./telemetry.js";
export { akashaDepositDefinition, akashaTracesDefinition, createAkashaHandlers } from "./tools/akasha.js";
export { askDefinition, createAskHandler } from "./tools/ask.js";
// Phase 28 — AST-aware patching
export {
	astGrepDefinition,
	astGrepHandler,
	astPatchDefinition,
	astPatchHandler,
	extractDeclarations,
} from "./tools/ast-patch.js";
export { bashDefinition, bashHandler } from "./tools/bash.js";
export { registerBuiltinTools } from "./tools/builtin.js";
// Phase 31 — Tool Compose Pipelines
export type { PipelineResult, PipelineSpec, PipelineStep, StepResult } from "./tools/compose.js";
export { composeDefinition, createComposeHandler, executePipeline } from "./tools/compose.js";
// Phase 32 — Semantic Diff Review
export type { DiffFinding, DiffReviewConfig, DiffReviewResult, FindingSeverity } from "./tools/diff-review.js";
export { diffReviewDefinition, diffReviewHandler, reviewDiff } from "./tools/diff-review.js";
export { editDefinition, editHandler } from "./tools/edit.js";
export { globDefinition, globHandler } from "./tools/glob.js";
export { grepDefinition, grepHandler } from "./tools/grep.js";
export type { McpConnection } from "./tools/mcp.js";
// MCP tool forwarding
export { discoverMcpTools } from "./tools/mcp.js";
// Built-in tools
export { readDefinition, readHandler } from "./tools/read.js";
export type { ToolHandler } from "./tools/registry.js";
// Tool registry
export { ToolRegistry } from "./tools/registry.js";
export type { RankedTool, ToolSelectionOptions } from "./tools/selection.js";
export { rankToolDefinitions, selectToolDefinitions } from "./tools/selection.js";
export * from "./tools/side-agent-exports.js";
// Phase 40 — Tool Result Cache
export type { CacheEntry as ToolCacheEntry, ToolCacheConfig, ToolCacheStats } from "./tools/tool-cache.js";
export { ToolResultCache } from "./tools/tool-cache.js";
// Phase 27 — Speculative worktrees
export {
	worktreeCreateDefinition,
	worktreeCreateHandler,
	worktreeDestroyDefinition,
	worktreeDestroyHandler,
	worktreeExecDefinition,
	worktreeExecHandler,
	worktreeMergeDefinition,
	worktreeMergeHandler,
} from "./tools/worktree.js";
export { writeDefinition, writeHandler } from "./tools/write.js";
