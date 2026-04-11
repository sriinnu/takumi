/**
 * Public extension-system exports for the agent package.
 *
 * I keep these in a dedicated barrel so `src/index.ts` can stay under the LOC guard
 * without weakening the public API surface.
 */

// Phase 45 — Convention file loader
export type { ConventionFiles, ToolRule } from "./convention-loader.js";
export { loadConventionFiles, loadConventionFilesFromSnapshot } from "./convention-loader.js";
// Phase 45 — defineExtension() named factory helper
export type { AnnotatedFactory, ExtensionManifest } from "./define-extension.js";
export { defineExtension, EXTENSION_MANIFEST_SYMBOL, getExtensionManifest } from "./define-extension.js";
// Phase 45 — Extension bridge (typed inter-extension event bus)
export type { BridgeHandler, BridgePayload, ExtensionBridge, ExtensionBridgeEvents } from "./extension-bridge.js";
export { ExtensionBridgeRegistry } from "./extension-bridge.js";
// Phase 52 — Extension Health Monitor
export type {
	ExtensionHealthConfig,
	ExtensionHealthSnapshot,
	HealthEvent,
	HealthTransition,
	HealthTransitionListener,
} from "./extension-health.js";
export { ExtensionHealthMonitor } from "./extension-health.js";
export {
	discoverAndLoadExtensions,
	discoverAndLoadExtensionsFromSnapshot,
	loadExtensionFromFactory,
	loadExtensions,
} from "./extension-loader.js";
export type {
	ExtensionAPIActions,
	ExtensionCommandActions,
	ExtensionContextActions,
	ExtensionErrorListener,
	SessionContextActions,
	UIContextActions,
} from "./extension-runner.js";
export { ExtensionRunner } from "./extension-runner.js";
export type { ExtensionStorage, ExtensionStorageValue } from "./extension-storage.js";
// Phase 45 — Per-tool typed events and type guards
export type {
	BashToolCallEvent,
	EditToolCallEvent,
	GlobToolCallEvent,
	GrepToolCallEvent,
	ReadToolCallEvent,
	WriteToolCallEvent,
} from "./extension-tool-events.js";
export { isToolCallForTool } from "./extension-tool-events.js";
// Phase 42-44 — Extension System
export type {
	AgentEndEvent,
	AgentLoopEvent,
	AgentProfileUpdatedEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeProviderRequestEvent,
	BeforeProviderRequestResult,
	ClusterBudgetEvent,
	ClusterEndEvent,
	ClusterExtensionEvent,
	ClusterTopologyAdaptEvent,
	ClusterValidationAttemptEvent,
	ContextEvent,
	ContextEventResult,
	ContextUsage,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionError,
	ExtensionEvent,
	ExtensionEventType,
	ExtensionFactory,
	ExtensionHandler,
	ExtensionResidency,
	ExtensionSession,
	ExtensionToolDefinition,
	ExtensionUI,
	InputEvent,
	InputEventResult,
	InputSource,
	LoadExtensionsResult,
	LoadedExtension,
	LoadedExtensionOrigin,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ModelSelectEvent,
	NotifyLevel,
	PickItem,
	RegisteredCommand,
	RegisteredShortcut,
	SabhaEscalationEvent,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionCompactEvent,
	SessionEntry,
	SessionEvent,
	SessionShutdownEvent,
	SessionSnapshot,
	SessionStartEvent,
	SessionSwitchEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	ToolResultEvent,
	ToolResultEventResult,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashResult,
	WidgetRenderer,
} from "./extension-types.js";
export type {
	PackageDiagnosticView,
	PackageDoctorReport,
	PackageInspection,
	PackageListView,
	PackageRejectedEntry,
	PackageState,
} from "./package-inspection.js";
export {
	buildPackageDoctorReport,
	buildPackageInspection,
	findPackage,
	formatPackageDetails,
	formatPackageDoctorReport,
	inspectTakumiPackages,
	selectTakumiPackage,
	toPackageListView,
} from "./package-inspection.js";
export type {
	LoadedTakumiPackage,
	LoadTakumiPackagesResult,
	TakumiPackageResources,
	TakumiPackageSource,
} from "./package-loader.js";
export { discoverTakumiPackages } from "./package-loader.js";
export type { PackageResolverConflict, PackageResolverReport, ResolvedTakumiPackage } from "./package-resolver.js";
export {
	getConfiguredTakumiPackagePaths,
	resolveTakumiPackageCandidates,
	resolveTakumiPackageGraph,
} from "./package-resolver.js";
export type { PackageResourcePathEntry, PackageResourceViews } from "./package-resource-views.js";
export { buildPackageResourceViews } from "./package-resource-views.js";
export type { PackageRuntimeSnapshot } from "./package-runtime-snapshot.js";
export { buildPackageRuntimeSnapshot, buildPackageRuntimeSnapshotFromPaths } from "./package-runtime-snapshot.js";
// Phase 53 — Extension Self-Authoring
export type {
	AuthorResult,
	ExtensionCommandSpec,
	ExtensionEventSpec,
	ExtensionSpec,
	ExtensionToolSpec,
	GeneratedManifest,
	ValidationIssue,
	ValidationResult as ExtensionValidationResult,
} from "./self-author.js";
export { generateExtensionSource, SelfAuthor, validateExtensionSource } from "./self-author.js";
export type { LoadedSkill, LoadedSkillsResult, SkillRoot, SkillSource } from "./skills-loader.js";
export { buildSkillsPrompt, loadSkills, selectSkillsForPrompt } from "./skills-loader.js";
