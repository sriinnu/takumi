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
	ArtifactImportStatus,
	ArtifactKind,
	ArtifactProducer,
	HandoffArtifactMeta,
	HubArtifact,
	PlanArtifactMeta,
	ReflectionArtifactMeta,
	ValidationArtifactMeta,
} from "./artifact-types.js";
export {
	createArtifactContentHash,
	createArtifactId,
	createHubArtifact,
	resetArtifactCounter,
} from "./artifact-types.js";
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
export {
	DEFAULT_CONFIG,
	detectProviderFromModel,
	getConfiguredPackagePaths,
	getConfiguredPluginPaths,
	loadConfig,
	normalizePackageConfigEntries,
	normalizePluginConfigEntries,
	PROVIDER_ENDPOINTS,
} from "./config.js";
export type { TakumiConfigPathEntry, TakumiConfigPathKind } from "./config-locations.js";
export {
	findExistingTakumiConfigPath,
	getGlobalTakumiConfigPaths,
	getProjectTakumiConfigPaths,
	getTakumiConfigSearchPaths,
	inspectTakumiConfigPaths,
} from "./config-locations.js";
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
	ExecLocalFallbackSnapshot,
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
// ── P-Track: Hook Execution Policy ────────────────────────────────────────────
export type { HookFailurePolicy, HookPolicyConfig, HookPolicyResult, HookWarning } from "./hook-policy.js";
export { DEFAULT_HOOK_POLICY, executeWithHookPolicy, resolveHookPolicy } from "./hook-policy.js";
export type {
	FormatIdeStatusOptions,
	IdeLauncherAvailability,
	IdeLauncherDefinition,
	IdeLauncherId,
	OpenInIdeOptions,
	OpenInIdeResult,
} from "./ide-launch.js";
export {
	detectAvailableIdeLaunchers,
	findIdeLauncher,
	formatIdeStatus,
	listIdeLauncherIds,
	listIdeLaunchers,
	openInIde,
	resolveConfiguredIdeSelector,
	resolveIdeTargetPath,
	selectIdeLauncher,
} from "./ide-launch.js";
export type { Logger } from "./logger.js";
export { createLogger, setLogLevel } from "./logger.js";
// ── Track 8: Mission State Model ──────────────────────────────────────────────
export type {
	MissionAuthority,
	MissionConstraints,
	MissionPhase,
	MissionState,
	MissionStopReason,
	MissionTransition,
	TransitionResult,
} from "./mission-state.js";
export {
	createMission,
	isMissionDegraded,
	isMissionTerminal,
	isTransitionAllowed,
	promoteArtifact,
	transitionMission,
} from "./mission-state.js";
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
export type {
	EnsuredTakumiProjectInstructionsFile,
	ProjectInstructionPathEntry,
	ProjectInstructionPathKind,
	TakumiProjectInstructionsInspection,
} from "./project-instructions-file.js";
export {
	buildTakumiProjectInstructionsTemplate,
	ensureTakumiProjectInstructionsFile,
	formatTakumiProjectInstructionsFile,
	formatTakumiProjectInstructionsInspection,
	getTakumiProjectInstructionsPath,
	inspectTakumiProjectInstructions,
	PROJECT_INSTRUCTION_FILES,
	tryRevealTakumiProjectInstructionsFile,
} from "./project-instructions-file.js";
export {
	collectConfiguredProviders,
	loadMergedEnv,
	normalizeProviderName,
	PROVIDER_ENDPOINT_ENV_KEYS,
	PROVIDER_ENV_KEYS,
	resolveProviderCredential,
	resolveProviderEndpoint,
} from "./provider-env.js";
// ── Safe JSON ─────────────────────────────────────────────────────────────────
export {
	JSON_MAX_CHECKPOINT,
	JSON_MAX_DAEMON,
	JSON_MAX_FILE,
	JSON_MAX_SSE_CHUNK,
	safeJsonParse,
	safeJsonParseOrNull,
} from "./safe-json.js";
export type {
	ContinuityAttachedPeer,
	ContinuityAttachGrant,
	ContinuityAuditEvent,
	ContinuityAuditEventKind,
	ContinuityCompanionRole,
	ContinuityExecutorLease,
	ContinuityExecutorLeaseState,
	ContinuityLeaseBlocker,
	ContinuityLeaseBlockerKind,
	ContinuityPeerKind,
	ContinuityPeerRole,
	ContinuityRuntimeRole,
	ContinuityWorkspaceFingerprint,
	ContinuityWorkspaceFingerprintTier,
	CreateContinuityAttachGrantInput,
	SessionContinuityState,
} from "./session-continuity.js";
export { createContinuityAttachGrant, generateContinuityNonce } from "./session-continuity.js";
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
	SessionArtifactPromotionState,
	SessionControlPlaneDegradedContext,
	SessionControlPlaneDegradedSourceKind,
	SessionControlPlaneDegradedSourceState,
	SessionControlPlaneLanePolicyState,
	SessionControlPlaneLaneState,
	SessionControlPlaneState,
	SessionControlPlaneSyncState,
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
export type {
	SideAgentConfig,
	SideAgentDispatchKind,
	SideAgentEvent,
	SideAgentInfo,
	SideAgentState,
} from "./side-agent-types.js";
// ── Track 7: Task Graph ───────────────────────────────────────────────────────
export type {
	GraphValidation,
	TaskGraph,
	TaskNode,
	TaskNodeKind,
	TaskNodeStatus,
} from "./task-graph.js";
export {
	addNode,
	createTaskGraph,
	createTaskNode,
	nodesByStatus,
	readyNodes,
	removeTaskNode,
	topologicalOrder,
	updateNodeStatus,
	validateGraph,
} from "./task-graph.js";
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
	NormalizedPackageConfigEntry,
	NormalizedPluginConfigEntry,
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
	TakumiModelPolicy,
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
export type {
	EnsuredTakumiConfigFile,
	TakumiConfigFileTarget,
	TakumiConfigInspection,
	TakumiConfigTemplate,
} from "./user-config-file.js";
export {
	buildTakumiConfigTemplate,
	ensureTakumiConfigFile,
	formatTakumiConfigFile,
	formatTakumiConfigInspection,
	getTakumiConfigPath,
	inspectTakumiUserConfig,
	tryRevealTakumiConfigFile,
} from "./user-config-file.js";
export { normalisePath, resolveExeName, winToWslPath, wslToWinPath } from "./win-paths.js";
