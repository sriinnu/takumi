// Agent loop

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
	IsolationContext,
	IsolationMode,
	OrchestratorOptions,
	ValidationFinding,
	ValidationResult,
	WorkProduct,
} from "./cluster/index.js";
// Cluster orchestration
export {
	AgentRole,
	AgentStatus,
	CheckpointManager,
	ClusterOrchestrator,
	ClusterPhase,
	ValidationDecision,
} from "./cluster/index.js";
export type { TokenBudget } from "./context/budget.js";
export { allocateTokenBudget, estimateTokens, truncateToTokenBudget } from "./context/budget.js";
export type { ContextOptions, SystemPromptOptions } from "./context/builder.js";
// Context
export { buildContext, buildSystemPrompt as buildRichSystemPrompt } from "./context/builder.js";
export type { CompactOptions, CompactResult, PayloadCompactOptions } from "./context/compact.js";
export {
	compactHistory,
	compactMessages,
	estimatePayloadTokens,
	estimateTotalPayloadTokens,
	shouldCompact,
} from "./context/compact.js";
// Codebase indexer (Phase 10 — RAG)
export type { CodebaseIndex, FileEntry, IndexedSymbol, IndexStats } from "./context/indexer.js";
export { buildIndex, indexStats, loadIndex } from "./context/indexer.js";
// Phase 33 — Agent Memory Hooks
export type { ExtractionEvent, Lesson, MemoryHooksConfig } from "./context/memory-hooks.js";
export { MemoryHooks } from "./context/memory-hooks.js";
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
// LLM cost estimation + budget enforcement (Phase 11)
export type { BudgetGuardOptions, CostEstimate } from "./cost.js";
export { BudgetExceededError, BudgetGuard, estimateClusterCost, estimateCost, MODEL_PRICING } from "./cost.js";
export type { ErrorCategory } from "./errors.js";
// Error types and categorization
export {
	ContextOverflowError,
	categorizeError,
	friendlyErrorMessage,
	isRetryable,
	ProviderUnavailableError,
} from "./errors.js";
// Phase 26 — Guardian daemon
export type { GuardianConfig, GuardianEvent, GuardianSuggestion } from "./guardian.js";
export { Guardian } from "./guardian.js";
export type { AgentLoopOptions, MessagePayload } from "./loop.js";
export { agentLoop } from "./loop.js";
// Message building
export { buildSystemPrompt, buildToolResult, buildUserMessage } from "./message.js";
export type { ModelRecommendation, ModelTier, ProviderFamily, RouterRole } from "./model-router.js";
// Smart model router
export { inferProvider, MODEL_TIERS, ModelRouter, syncModelTiersFromKosha } from "./model-router.js";
// Providers
export { DarpanaProvider } from "./providers/darpana.js";
export { DirectProvider } from "./providers/direct.js";
export type { FailoverEntry, FailoverProviderConfig, ProviderLike, ProviderStatus } from "./providers/failover.js";
export { FailoverProvider } from "./providers/failover.js";
export type { GeminiProviderConfig } from "./providers/gemini.js";
export { GeminiProvider } from "./providers/gemini.js";
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
// SSE stream parser
export { parseSSEStream } from "./stream.js";
// Telemetry helpers (Phase 20)
export { calculateContextPressure, estimateMessagesTokens, renderLastAssistantHtml } from "./telemetry.js";
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
export type { SideAgentToolDeps } from "./tools/side-agent.js";
export {
	agentCheckDefinition,
	agentSendDefinition,
	agentStartDefinition,
	agentWaitAnyDefinition,
	createAgentCheckHandler,
	createAgentSendHandler,
	createAgentStartHandler,
	createAgentWaitAnyHandler,
	registerSideAgentTools,
} from "./tools/side-agent.js";
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
