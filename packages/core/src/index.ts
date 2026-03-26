export { AlertEngine } from "./alert-engine.js";
export { ApprovalQueue, writeAuditExport } from "./approval-queue.js";
// ── P-Track: Approvals ────────────────────────────────────────────────────────
export type {
	ApprovalActor,
	ApprovalQueueSnapshot,
	ApprovalRecord,
	ApprovalStatus,
	AuditExportFormat,
	AuditExportOptions,
} from "./approval-types.js";
export { createApprovalId, createApprovalRecord, resetApprovalCounter } from "./approval-types.js";
export type { ArtifactQuery } from "./artifact-store.js";
// ── P-Track: Artifact Persistence ─────────────────────────────────────────────
export { ArtifactStore } from "./artifact-store.js";
export type {
	ArtifactKind,
	ArtifactProducer,
	HandoffArtifactMeta,
	HubArtifact,
	PlanArtifactMeta,
	ReflectionArtifactMeta,
	ValidationArtifactMeta,
} from "./artifact-types.js";
export { createArtifactId, createHubArtifact, resetArtifactCounter } from "./artifact-types.js";
// ── P-Track: Benchmark / Eval Gate ────────────────────────────────────────────
export type {
	BenchmarkAssertion,
	BenchmarkBaseline,
	BenchmarkCategory,
	BenchmarkMetrics,
	BenchmarkResult,
	BenchmarkTask,
	GateReport,
	GateThresholds,
	GateVerdict,
	GateViolation,
} from "./benchmark-types.js";
export { computeMetrics, DEFAULT_GATE_THRESHOLDS, evaluateGate } from "./benchmark-types.js";
export { DEFAULT_CONFIG, detectProviderFromModel, loadConfig, PROVIDER_ENDPOINTS } from "./config.js";
export {
	ANSI,
	KEY_CODES,
	LIMITS,
	TELEMETRY_CLOSE_PERCENT,
	TELEMETRY_DIR,
	TELEMETRY_HEARTBEAT_MS,
	TELEMETRY_NEAR_PERCENT,
	TELEMETRY_STALE_MS,
} from "./constants.js";
export {
	AgentError as AgentErrorClass,
	ConfigError,
	PermissionError,
	RenderError,
	TakumiError,
	ToolError,
} from "./errors.js";
export type {
	ExecAgentEventEnvelope,
	ExecArtifact,
	ExecBootstrapSnapshot,
	ExecBootstrapStatusEvent,
	ExecBootstrapTransport,
	ExecExitCode,
	ExecFailureCategory,
	ExecFailurePhase,
	ExecLaneSnapshot,
	ExecPostRunPolicy,
	ExecProtocolEvent,
	ExecRoutingBinding,
	ExecRunCompletedEvent,
	ExecRunFailedEvent,
	ExecRunStartedEvent,
	ExecSessionBinding,
	ExecSideAgentBootstrapSnapshot,
	ExecValidationSummary,
	SerializedError,
} from "./exec-protocol.js";
export {
	createAgentEventEnvelope,
	createBootstrapStatusEvent,
	createExecRunId,
	createRunCompletedEvent,
	createRunFailedEvent,
	createRunStartedEvent,
	EXEC_EXIT_CODES,
	EXEC_PROTOCOL,
	EXEC_PROTOCOL_VERSION,
	sanitizeAgentEvent,
	serializeError,
} from "./exec-protocol.js";
// ── P-Track: Handoff/Reattach ─────────────────────────────────────────────────
export type {
	HandoffArtifactRef,
	HandoffFileChange,
	HandoffPayload,
	HandoffRouteBinding,
	HandoffTarget,
	HandoffTargetKind,
	HandoffWorkState,
	ReattachResult,
} from "./handoff-types.js";
export { createHandoffId, resetHandoffCounter } from "./handoff-types.js";
export type { Logger } from "./logger.js";
export { createLogger, setLogLevel } from "./logger.js";
// ── P-Track: Observability ────────────────────────────────────────────────────
export type {
	AlertKind,
	AlertSeverity,
	AlertThresholds,
	DegradedRunEntry,
	FleetSummary,
	OperatorAlert,
	SessionSummary as ObservabilitySessionSummary,
} from "./observability-types.js";
export { createAlert, createAlertId, DEFAULT_ALERT_THRESHOLDS, resetAlertCounter } from "./observability-types.js";
export type {
	DockerIsolationConfig,
	MeshTopologyMode,
	OrchestrationConfig,
	OrchestrationMeshConfig,
	OrchestrationModelRoleOverrides,
	OrchestrationModelRoutingConfig,
	OrchestrationTaskType,
} from "./orchestration-types.js";
// ── Platform Detection & Cross-Platform Utilities ─────────────────────────────
export type { PlatformId, PlatformSummary, ShellId, TerminalId } from "./platform-detect.js";
export {
	collectPlatformSummary,
	currentPlatform,
	detectShell,
	detectTerminal,
	hasDocker,
	hasGit,
	hasTmux,
	IS_LINUX,
	IS_MACOS,
	IS_WINDOWS,
	isWSL,
	resolveCacheDir,
	resolveConfigDir,
} from "./platform-detect.js";
export {
	collectConfiguredProviders,
	loadMergedEnv,
	normalizeProviderName,
	PROVIDER_ENDPOINT_ENV_KEYS,
	PROVIDER_ENV_KEYS,
	resolveProviderCredential,
	resolveProviderEndpoint,
} from "./provider-env.js";
export type {
	BranchResult,
	FlatTreeEntry,
	SessionTreeManifest,
	SessionTreeNode,
} from "./session-tree.js";
export {
	branchSession,
	ensureNode,
	flattenTree,
	getAncestors,
	getDepth,
	getDescendants,
	getRoots,
	getSessionTree,
	getSiblings,
	linkChild,
	loadTreeManifest,
	registerInTree,
	removeNode,
	saveTreeManifest,
} from "./session-tree.js";
export type {
	AutoSaver,
	SessionData,
	SessionJsonlMessageRecord,
	SessionJsonlMetaRecord,
	SessionJsonlRecord,
	SessionSummary,
} from "./sessions.js";
export {
	createAutoSaver,
	deleteSession,
	exportSessionAsJsonl,
	forkSession,
	generateSessionId,
	importSessionFromJsonl,
	listSessions,
	loadSession,
	saveSession,
} from "./sessions.js";
export type { SideAgentConfig, SideAgentEvent, SideAgentInfo, SideAgentState } from "./side-agent-types.js";
export type {
	AgentDone,
	AgentError,
	AgentEvent,
	AgentStop,
	AgentTextDelta,
	AgentTextDone,
	AgentThinkingDelta,
	AgentThinkingDone,
	AgentToolResult,
	AgentToolUse,
	AgentUsageUpdate,
	Cell,
	ContentBlock,
	ImageBlock,
	KeyEvent,
	Message,
	MouseEvent,
	PackageConfig,
	PermissionDecision,
	PermissionEngine,
	PermissionRule,
	PluginConfig,
	Position,
	Rect,
	SessionInfo,
	Size,
	StatusBarConfig,
	TakumiConfig,
	TextBlock,
	ThemeConfig,
	ThinkingBlock,
	ToolContext,
	ToolDefinition,
	ToolResult,
	ToolResultBlock,
	ToolUseBlock,
	Usage,
} from "./types.js";
export { normalisePath, resolveExeName, winToWslPath, wslToWinPath } from "./win-paths.js";
