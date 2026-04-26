/**
 * AppState — centralized reactive application state using signals.
 * All UI components observe these signals and re-render when they change.
 */

import {
	buildCognitiveState,
	type CognitiveState,
	type AlertLevel as CostAlertLevel,
	type CostSnapshot,
	estimateUsageCost,
	SteeringQueue,
} from "@takumi/agent";
import type {
	CapabilityDescriptor,
	CapabilityHealthSnapshot,
	ChitraguptaBridge,
	ChitraguptaHealth,
	ChitraguptaObserver,
	RoutingDecision,
	VasanaTendency,
} from "@takumi/bridge";
import {
	AlertEngine,
	ApprovalQueue,
	DEFAULT_ALERT_THRESHOLDS,
	type HandoffFileChange,
	type Message,
	type PermissionDecision,
	type SessionArtifactPromotionState,
	type SessionControlPlaneDegradedContext,
	type SessionControlPlaneLaneState,
	type SessionControlPlaneSyncState,
	type Size,
	type Usage,
} from "@takumi/core";
import type { ReadonlySignal, Signal } from "@takumi/render";
import { computed, signal } from "@takumi/render";
import type { PendingPermissionRequest } from "./agent/permission-request.js";
import { resetRecentDirectiveHistory } from "./chitragupta/chitragupta-runtime-helpers.js";
import { cloneProviderModelCatalog, PROVIDER_MODELS } from "./completion.js";
import type {
	ContinuityAttachedPeer,
	ContinuityAttachGrant,
	ContinuityAuditEvent,
	ContinuityExecutorLease,
} from "./continuity/continuity-types.js";
import { ValidationResultsDialog } from "./dialogs/validation-results.js";
import { appendTrackedChange, appendTrackedRead } from "./file-tracking.js";
import type { ScarlettIntegrityReport } from "./scarlett-runtime.js";
import { buildScarlettIntegrityReport } from "./scarlett-runtime.js";
import { SideLaneStore } from "./side-lane-store.js";
import { ToolSpinner } from "./spinner.js";
import { buildCostTelemetryText, formatUsdPerMinute } from "./state-cost.js";

// ── Cluster command channel type ──────────────────────────────────────────────
/** Commands dispatched from slash commands / dialogs to CodingAgent. */
export type ClusterCommandEvent =
	| { type: "retry"; maxAttempts?: number }
	| { type: "validate" }
	| { type: "checkpoint_save" }
	| { type: "resume"; taskId: string }
	| { type: "isolation_set"; mode: "none" | "worktree" | "docker" };

export class AppState {
	approvalQueue: ApprovalQueue = new ApprovalQueue();
	alertEngine: AlertEngine = new AlertEngine();
	readonly acknowledgedAlerts: Signal<Set<string>> = signal(new Set<string>());

	constructor() {
		this.steeringQueue.onSizeChanged((size) => {
			this.steeringPending.value = size;
		});
	}
	// ── Conversation ──────────────────────────────────────────────────────────
	readonly messages: Signal<Message[]> = signal<Message[]>([]);
	readonly isStreaming: Signal<boolean> = signal(false);
	readonly streamingText: Signal<string> = signal("");
	readonly thinkingText: Signal<string> = signal("");
	// ── Usage tracking ────────────────────────────────────────────────────────
	readonly totalInputTokens: Signal<number> = signal(0);
	readonly totalOutputTokens: Signal<number> = signal(0);
	readonly totalCost: Signal<number> = signal(0);
	readonly costSnapshot: Signal<CostSnapshot | null> = signal<CostSnapshot | null>(null);
	readonly turnCount: Signal<number> = signal(0);
	// ── Session ───────────────────────────────────────────────────────────────
	readonly sessionId: Signal<string> = signal("");
	readonly canonicalSessionId: Signal<string> = signal("");
	readonly controlPlaneLanes: Signal<SessionControlPlaneLaneState[]> = signal<SessionControlPlaneLaneState[]>([]);
	readonly chitraguptaSync: Signal<SessionControlPlaneSyncState> = signal<SessionControlPlaneSyncState>({
		status: "idle",
	});
	readonly continuityGrants: Signal<ContinuityAttachGrant[]> = signal<ContinuityAttachGrant[]>([]);
	readonly continuityPeers: Signal<ContinuityAttachedPeer[]> = signal<ContinuityAttachedPeer[]>([]);
	readonly continuityEvents: Signal<ContinuityAuditEvent[]> = signal<ContinuityAuditEvent[]>([]);
	readonly continuityLease: Signal<ContinuityExecutorLease | null> = signal<ContinuityExecutorLease | null>(null);
	readonly degradedExecutionContext: Signal<SessionControlPlaneDegradedContext | null> = signal(null);
	readonly artifactPromotion: Signal<SessionArtifactPromotionState> = signal<SessionArtifactPromotionState>({
		status: "idle",
	});
	readonly model: Signal<string> = signal("claude-sonnet-4-20250514");
	readonly provider: Signal<string> = signal("anthropic");
	readonly sideAgentPreferredModel: Signal<string> = signal("");
	readonly availableProviderModels: Signal<Record<string, string[]>> = signal(
		cloneProviderModelCatalog(PROVIDER_MODELS),
	);
	readonly theme: Signal<string> = signal("default");
	// ── Thinking ──────────────────────────────────────────────────────────────
	readonly thinking: Signal<boolean> = signal(false);
	readonly thinkingBudget: Signal<number> = signal(10000);

	// ── UI state ──────────────────────────────────────────────────────────────
	readonly focusedPanel: Signal<string> = signal("input");
	readonly sidebarVisible: Signal<boolean> = signal(false);
	readonly terminalSize: Signal<Size> = signal({ width: 80, height: 24 });
	readonly showThinking: Signal<boolean> = signal(false);
	/** Dialog stack — each push opens a new modal on top of the previous; Esc pops the top. */
	readonly dialogStack: Signal<string[]> = signal<string[]>([]);
	/** Legacy computed accessor — returns the top dialog name or null; prefer `topDialog`. */
	readonly activeDialog: ReadonlySignal<string | null> = computed(() => {
		const stack = this.dialogStack.value;
		return stack.length > 0 ? stack[stack.length - 1] : null;
	});

	// ── Tool execution ────────────────────────────────────────────────────────
	readonly activeTool: Signal<string | null> = signal(null);
	readonly toolOutput: Signal<string> = signal("");
	readonly toolSpinner: ToolSpinner = new ToolSpinner();

	// ── Agent phase indicator ─────────────────────────────────────────────────
	readonly agentPhase: Signal<string> = signal("idle");

	// ── Permissions ───────────────────────────────────────────────────────────
	/** Visible permission card (null = none). Concurrent requests queue below. */
	readonly pendingPermission: Signal<PendingPermissionRequest | null> = signal(null);
	/** FIFO of requests waiting for the visible card to resolve — input handler promotes head. */
	readonly pendingPermissionQueue: Signal<PendingPermissionRequest[]> = signal<PendingPermissionRequest[]>([]);

	// ── Tool call collapse tracking ───────────────────────────────────────────
	/** Track collapsed state of tool call blocks by tool_use ID */
	readonly collapsedTools: Signal<Set<string>> = signal(new Set<string>());

	// ── File tracking ─────────────────────────────────────────────────────────
	readonly readFiles: Signal<string[]> = signal<string[]>([]);
	readonly fileChanges: Signal<HandoffFileChange[]> = signal<HandoffFileChange[]>([]);
	readonly modifiedFiles: Signal<string[]> = signal<string[]>([]);

	// ── File preview ─────────────────────────────────────────────────────────
	/** Currently previewed file path (empty = no preview). */
	readonly previewFile: Signal<string> = signal("");
	/** Whether the file preview pane is visible. */
	readonly previewVisible: Signal<boolean> = signal(false);

	// ── Coding agent ──────────────────────────────────────────────────────────
	readonly codingPhase: Signal<string> = signal("idle");

	// ── Autocycle agent ──────────────────────────────────────────────────────
	readonly autocyclePhase: Signal<string> = signal("idle");
	readonly autocycleIteration: Signal<number> = signal(0);
	readonly autocycleMaxIterations: Signal<number> = signal(0);
	readonly autocycleMetric: Signal<number | null> = signal(null);

	// ── Cluster orchestration ─────────────────────────────────────────────────
	/** Current cluster phase (PLANNING / EXECUTING / VALIDATING / FIXING / DONE). */
	readonly clusterPhase: Signal<string> = signal("idle");
	/** Active cluster ID, null when no cluster is running. */
	readonly clusterId: Signal<string | null> = signal(null);
	/** Number of agents in the active cluster. */
	readonly clusterAgentCount: Signal<number> = signal(0);
	/** How many validation retry rounds have been attempted. */
	readonly clusterValidationAttempt: Signal<number> = signal(0);
	/** Isolation mode for cluster execution. */
	readonly isolationMode: Signal<"none" | "worktree" | "docker"> = signal("none");
	/** Stable registry of spawned workflow side lanes. */
	readonly sideLanes: SideLaneStore = new SideLaneStore();

	// ── Chitragupta integration ───────────────────────────────────────────────
	readonly chitraguptaConnected: Signal<boolean> = signal(false);
	readonly chitraguptaBridge: Signal<ChitraguptaBridge | null> = signal(null);
	/** Formatted memory context loaded from Chitragupta on startup for agent prompts. */
	readonly chitraguptaMemory: Signal<string> = signal("");
	/** Number of knowledge deposits made to Akasha mesh in this session. */
	readonly akashaDeposits: Signal<number> = signal(0);
	/** Number of active agents in the Akasha p2p mesh (local + remote). */
	readonly akashaMeshSize: Signal<number> = signal(1);
	/** Last activity timestamp for Akasha mesh updates. */
	readonly akashaLastActivity: Signal<number> = signal(0);
	/** Crystallized behavioral tendencies from Chitragupta smriti (Vasana engine). */
	readonly vasanaTendencies: Signal<VasanaTendency[]> = signal<VasanaTendency[]>([]);
	/** Aggregate health snapshot from Chitragupta (Pancha-Kosha scoring). */
	readonly chitraguptaHealth: Signal<ChitraguptaHealth | null> = signal<ChitraguptaHealth | null>(null);
	/** Unix ms timestamp of the last vasana tendencies refresh. */
	readonly vasanaLastRefresh: Signal<number> = signal(0);

	// ── Phase 49-51: Observation & Intelligence ──────────────────────────────
	/** ChitraguptaObserver instance for observation dispatch and prediction queries. */
	readonly chitraguptaObserver: Signal<ChitraguptaObserver | null> = signal(null);
	/** Number of observation batches flushed to Chitragupta in this session. */
	readonly observationFlushCount: Signal<number> = signal(0);
	/** Latest capability inventory known from the Chitragupta control plane. */
	readonly controlPlaneCapabilities: Signal<CapabilityDescriptor[]> = signal<CapabilityDescriptor[]>([]);
	/** Latest capability health snapshots, including Takumi's local adapter health. */
	readonly capabilityHealthSnapshots: Signal<CapabilityHealthSnapshot[]> = signal<CapabilityHealthSnapshot[]>([]);
	/** Recent routing decisions retained for diagnostics and Scarlett-style integrity views. */
	readonly routingDecisions: Signal<RoutingDecision[]> = signal<RoutingDecision[]>([]);
	/** Derived Scarlett integrity report over bridge, routing, anomaly, and capability state. */
	readonly scarlettIntegrityReport: ReadonlySignal<ScarlettIntegrityReport> = computed(() =>
		buildScarlettIntegrityReport({
			connected: this.chitraguptaConnected.value,
			capabilities: this.controlPlaneCapabilities.value,
			snapshots: this.capabilityHealthSnapshots.value,
			routingDecisions: this.routingDecisions.value,
			anomaly: this.chitraguptaAnomaly.value,
			health: this.chitraguptaHealth.value,
		}),
	);

	// ── Chitragupta push notification state (Phase 45) ────────────────────────
	/** Latest anomaly alert from Chitragupta daemon. */
	readonly chitraguptaAnomaly: Signal<{
		severity: string;
		details: string;
		suggestion: string | null;
		at: number;
	} | null> = signal(null);
	/** Latest detected pattern from Chitragupta. */
	readonly chitraguptaLastPattern: Signal<{ type: string; confidence: number; at: number } | null> = signal(null);
	/** Pattern matches retrieved from Chitragupta queries. */
	readonly chitraguptaPatternMatches: Signal<
		Array<{ id?: number; type: string; confidence: number; occurrences?: number; lastSeen?: number }>
	> = signal([]);
	/** Active predictions from Chitragupta. */
	readonly chitraguptaPredictions: Signal<
		Array<{
			type?: string;
			action: string;
			confidence: number;
			risk?: number;
			reasoning?: string;
			suggestion?: string;
			files?: string[];
		}>
	> = signal([]);
	readonly lastSabhaId: Signal<string> = signal("");
	/** Queued evolve requests from Chitragupta. */
	readonly chitraguptaEvolveQueue: Signal<Array<Record<string, unknown>>> = signal([]);
	/** Derived cognition state over awareness, intuition, and workspace steering. */
	readonly cognitiveState: ReadonlySignal<CognitiveState> = computed(() =>
		buildCognitiveState({
			connected: this.chitraguptaConnected.value,
			integrityStatus: this.scarlettIntegrityReport.value.status,
			integritySummary: this.scarlettIntegrityReport.value.summary,
			anomaly: this.chitraguptaAnomaly.value,
			predictions: this.chitraguptaPredictions.value,
			patternMatches: this.chitraguptaPatternMatches.value,
			lastPattern: this.chitraguptaLastPattern.value,
			routingDecisions: this.routingDecisions.value.map((decision) => ({
				selected: decision.selected !== null,
				degraded: decision.degraded,
				reason: decision.reason,
				capabilityId: decision.selected?.id,
			})),
			contextPressure: this.contextPressure.value,
			contextPercent: this.contextPercent.value,
			agentPhase: this.agentPhase.value,
			clusterPhase: this.clusterPhase.value,
			steeringPending: this.steeringPending.value,
			steeringQueue:
				this.steeringPending.value > 0
					? this.steeringQueue.snapshot().map((item) => ({ text: item.text, priority: item.priority }))
					: [],
			observationFlushCount: this.observationFlushCount.value,
			evolveQueueLength: this.chitraguptaEvolveQueue.value.length,
		}),
	);
	/** Cluster command channel observed by CodingAgent. */
	readonly clusterCommand: Signal<ClusterCommandEvent | null> = signal<ClusterCommandEvent | null>(null);

	// ── Replay (Phase 19) ─────────────────────────────────────────────────────
	/** Whether the UI is in session replay mode. */
	readonly replayMode: Signal<boolean> = signal(false);
	/** Current turn index during replay navigation. */
	readonly replayIndex: Signal<number> = signal(0);
	/** Full list of messages loaded for replay. */
	readonly replayTurns: Signal<Message[]> = signal<Message[]>([]);
	/** Session ID of the session being replayed. */
	readonly replaySessionId: Signal<string> = signal("");

	// ── Context pressure (Phase 20.4) ─────────────────────────────────────────
	/** Current context window usage percentage (0-100+). */
	readonly contextPercent: Signal<number> = signal(0);
	/** Context pressure level: normal | approaching_limit | near_limit | at_limit. */
	readonly contextPressure: Signal<string> = signal("normal");
	/** Total tokens in context window. */
	readonly contextTokens: Signal<number> = signal(0);
	/** Max context window size for current model. */
	readonly contextWindow: Signal<number> = signal(200000);

	// ── Steering queue (Phase 48) ─────────────────────────────────────────────
	/** Priority queue for injecting directives into the agent loop mid-run. */
	readonly steeringQueue: SteeringQueue = new SteeringQueue();
	/** Number of pending items in the steering queue (for UI display). */
	readonly steeringPending: Signal<number> = signal(0);

	// ── Consolidation (auto-triggered on near_limit pressure) ─────────────────
	/** Whether a consolidation run is currently in progress. */
	readonly consolidationInProgress: Signal<boolean> = signal(false);

	// ── Dialog instances ──────────────────────────────────────────────────────
	/** Validation results dialog opened by CodingAgent for multi-agent review failures. */
	readonly validationResultsDialog: ValidationResultsDialog = new ValidationResultsDialog();

	// ── Computed values ───────────────────────────────────────────────────────

	readonly messageCount: ReadonlySignal<number> = computed(() => this.messages.value.length);

	readonly totalTokens: ReadonlySignal<number> = computed(
		() => this.totalInputTokens.value + this.totalOutputTokens.value,
	);

	readonly formattedCost: ReadonlySignal<string> = computed(() => {
		const cost = this.totalCost.value;
		if (cost < 0.01) return `$${cost.toFixed(4)}`;
		return `$${cost.toFixed(2)}`;
	});

	readonly costRatePerMinute: ReadonlySignal<number> = computed(() => this.costSnapshot.value?.ratePerMinute ?? 0);

	readonly costProjectedUsd: ReadonlySignal<number> = computed(
		() => this.costSnapshot.value?.projectedUsd ?? this.totalCost.value,
	);

	readonly costBudgetFraction: ReadonlySignal<number> = computed(() => this.costSnapshot.value?.budgetFraction ?? 0);

	readonly costAlertLevel: ReadonlySignal<CostAlertLevel> = computed(
		() => this.costSnapshot.value?.alertLevel ?? "none",
	);

	readonly hasCostSpike: ReadonlySignal<boolean> = computed(
		() => this.costRatePerMinute.value >= DEFAULT_ALERT_THRESHOLDS.costSpikeWarningPerMin,
	);

	readonly formattedCostRate: ReadonlySignal<string> = computed(() => formatUsdPerMinute(this.costRatePerMinute.value));

	readonly costTelemetryText: ReadonlySignal<string> = computed(() => {
		return buildCostTelemetryText({
			tokens: this.totalTokens.value,
			formattedCost: this.formattedCost.value,
			formattedCostRate: this.formattedCostRate.value,
			alertLevel: this.costAlertLevel.value,
			hasCostSpike: this.hasCostSpike.value,
			budgetFraction: this.costBudgetFraction.value,
		});
	});

	readonly availableProviders: ReadonlySignal<string[]> = computed(() =>
		Object.keys(this.availableProviderModels.value).sort(),
	);

	readonly statusText: ReadonlySignal<string> = computed(() => {
		const clusterId = this.clusterId.value;
		if (clusterId) {
			const phase = this.clusterPhase.value || "idle";
			const agents = this.clusterAgentCount.value;
			const attempt = this.clusterValidationAttempt.value;
			const attemptText = attempt > 0 ? ` | attempt ${attempt}` : "";
			return `🤖 Cluster [${String(phase).toUpperCase()}] — ${agents} agent${agents === 1 ? "" : "s"}${attemptText}`;
		}
		if (this.isStreaming.value) {
			const phase = this.agentPhase.value;
			if (phase && phase !== "idle") return phase;
			const tool = this.activeTool.value;
			return tool ? `Running ${tool}...` : "Thinking...";
		}
		return "Ready";
	});

	// ── Methods ───────────────────────────────────────────────────────────────

	/** Push a dialog name onto the dialog stack (opens it on top of any current dialog). */
	pushDialog(name: string): void {
		this.dialogStack.value = [...this.dialogStack.value, name];
	}

	/** Pop the top dialog off the stack (closes it, revealing the one beneath). */
	popDialog(): void {
		const stack = this.dialogStack.value;
		if (stack.length > 0) this.dialogStack.value = stack.slice(0, -1);
	}

	/** Returns the name of the currently active (top) dialog, or null. */
	get topDialog(): string | null {
		const stack = this.dialogStack.value;
		return stack.length > 0 ? stack[stack.length - 1] : null;
	}

	/** Dismiss all open dialogs. */
	clearDialogs(): void {
		this.dialogStack.value = [];
	}

	/** Add a message to the conversation. */
	addMessage(message: Message): void {
		this.messages.value = [...this.messages.value, message];
	}

	recordFileRead(filePath: string): void {
		this.readFiles.value = appendTrackedRead(this.readFiles.value, filePath);
	}

	recordFileChange(filePath: string, status: HandoffFileChange["status"] = "modified"): void {
		const next = appendTrackedChange(this.fileChanges.value, filePath, status);
		this.fileChanges.value = next;
		this.modifiedFiles.value = next.map((entry) => entry.path);
	}

	clearFileTracking(): void {
		this.readFiles.value = [];
		this.fileChanges.value = [];
		this.modifiedFiles.value = [];
	}

	getFileTrackingSnapshot(): Pick<
		{ filesChanged: HandoffFileChange[]; filesRead: string[] },
		"filesChanged" | "filesRead"
	> {
		return {
			filesChanged: this.fileChanges.value.map((entry) => ({ ...entry })),
			filesRead: [...this.readFiles.value],
		};
	}

	/** Toggle the collapsed state of a tool call block. */
	toggleToolCollapse(id: string): void {
		const next = new Set(this.collapsedTools.value);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		this.collapsedTools.value = next;
	}

	/** Check if a tool call block is collapsed. */
	isToolCollapsed(id: string): boolean {
		return this.collapsedTools.value.has(id);
	}

	/** Update usage counters from an API response. */
	updateUsage(usage: Usage, model = this.model.value): void {
		this.totalInputTokens.value += usage.inputTokens;
		this.totalOutputTokens.value += usage.outputTokens;
		this.totalCost.value += estimateUsageCost(usage, model);
	}

	setCostSnapshot(snapshot: CostSnapshot | null): void {
		this.costSnapshot.value = snapshot;
		if (!snapshot) return;
		this.totalInputTokens.value = snapshot.totalInputTokens;
		this.totalOutputTokens.value = snapshot.totalOutputTokens;
		this.totalCost.value = snapshot.totalUsd;
	}

	setAvailableProviderModels(catalog: Record<string, string[]>, authority: "merge" | "strict" = "merge"): void {
		this.availableProviderModels.value =
			authority === "strict"
				? cloneProviderModelCatalog(catalog)
				: {
						...cloneProviderModelCatalog(PROVIDER_MODELS),
						...cloneProviderModelCatalog(catalog),
					};
	}

	/** Reset all state for a new session. */
	reset(): void {
		this.messages.value = [];
		this.isStreaming.value = false;
		this.streamingText.value = "";
		this.thinkingText.value = "";
		this.totalInputTokens.value = 0;
		this.totalOutputTokens.value = 0;
		this.totalCost.value = 0;
		this.costSnapshot.value = null;
		this.turnCount.value = 0;
		this.canonicalSessionId.value = "";
		this.controlPlaneLanes.value = [];
		this.chitraguptaSync.value = { status: "idle" };
		this.continuityGrants.value = [];
		this.continuityPeers.value = [];
		this.continuityEvents.value = [];
		this.continuityLease.value = null;
		this.degradedExecutionContext.value = null;
		this.artifactPromotion.value = { status: "idle" };
		this.sideAgentPreferredModel.value = "";
		this.activeTool.value = null;
		this.toolOutput.value = "";
		this.toolSpinner.reset();
		this.agentPhase.value = "idle";
		this.pendingPermission.value = null;
		this.pendingPermissionQueue.value = [];
		this.collapsedTools.value = new Set<string>();
		this.clearFileTracking();
		this.previewFile.value = "";
		this.previewVisible.value = false;
		this.codingPhase.value = "idle";
		this.autocyclePhase.value = "idle";
		this.autocycleIteration.value = 0;
		this.autocycleMaxIterations.value = 0;
		this.autocycleMetric.value = null;
		this.clusterPhase.value = "idle";
		this.clusterId.value = null;
		this.clusterAgentCount.value = 0;
		this.clusterValidationAttempt.value = 0;
		this.sideLanes.clear();
		this.thinking.value = false;
		this.thinkingBudget.value = 10000;
		this.chitraguptaConnected.value = false;
		this.chitraguptaBridge.value = null;
		this.chitraguptaMemory.value = "";
		this.vasanaTendencies.value = [];
		this.chitraguptaHealth.value = null;
		this.vasanaLastRefresh.value = 0;
		this.chitraguptaObserver.value = null;
		this.observationFlushCount.value = 0;
		this.controlPlaneCapabilities.value = [];
		this.capabilityHealthSnapshots.value = [];
		this.routingDecisions.value = [];
		this.chitraguptaAnomaly.value = null;
		this.chitraguptaLastPattern.value = null;
		this.chitraguptaPatternMatches.value = [];
		this.chitraguptaPredictions.value = [];
		this.lastSabhaId.value = "";
		this.chitraguptaEvolveQueue.value = [];
		this.dialogStack.value = [];
		this.clusterCommand.value = null;
		this.akashaDeposits.value = 0;
		this.akashaMeshSize.value = 1;
		this.akashaLastActivity.value = 0;
		this.replayMode.value = false;
		this.replayIndex.value = 0;
		this.replayTurns.value = [];
		this.replaySessionId.value = "";
		this.contextPercent.value = 0;
		this.contextPressure.value = "normal";
		this.contextTokens.value = 0;
		this.contextWindow.value = 200000;
		this.consolidationInProgress.value = false;
		this.approvalQueue = new ApprovalQueue();
		this.alertEngine = new AlertEngine();
		this.acknowledgedAlerts.value = new Set<string>();
		this.steeringQueue.clear();
		this.steeringPending.value = 0;
		resetRecentDirectiveHistory();
	}
}
