/**
 * AppState — centralized reactive application state using signals.
 * All UI components observe these signals and re-render when they change.
 */

import { SteeringQueue } from "@takumi/agent";
import type { ChitraguptaBridge, ChitraguptaHealth, VasanaTendency } from "@takumi/bridge";
import type { Message, PermissionDecision, Size, Usage } from "@takumi/core";
import type { ReadonlySignal, Signal } from "@takumi/render";
import { computed, signal } from "@takumi/render";
import { ValidationResultsDialog } from "./dialogs/validation-results.js";
import { ToolSpinner } from "./spinner.js";

// ── Cluster command channel type ──────────────────────────────────────────────
/**
 * Commands dispatched from slash commands / dialogs to CodingAgent.
 * CodingAgent observes `AppState.clusterCommand` via an effect and handles them.
 */
export type ClusterCommandEvent =
	| { type: "retry"; maxAttempts?: number }
	| { type: "validate" }
	| { type: "checkpoint_save" }
	| { type: "resume"; taskId: string }
	| { type: "isolation_set"; mode: "none" | "worktree" | "docker" };

export class AppState {
	// ── Conversation ──────────────────────────────────────────────────────────
	readonly messages: Signal<Message[]> = signal<Message[]>([]);
	readonly isStreaming: Signal<boolean> = signal(false);
	readonly streamingText: Signal<string> = signal("");
	readonly thinkingText: Signal<string> = signal("");

	// ── Usage tracking ────────────────────────────────────────────────────────
	readonly totalInputTokens: Signal<number> = signal(0);
	readonly totalOutputTokens: Signal<number> = signal(0);
	readonly totalCost: Signal<number> = signal(0);
	readonly turnCount: Signal<number> = signal(0);

	// ── Session ───────────────────────────────────────────────────────────────
	readonly sessionId: Signal<string> = signal("");
	readonly model: Signal<string> = signal("claude-sonnet-4-20250514");
	readonly provider: Signal<string> = signal("anthropic");
	readonly theme: Signal<string> = signal("default");

	// ── Thinking ──────────────────────────────────────────────────────────────
	readonly thinking: Signal<boolean> = signal(false);
	readonly thinkingBudget: Signal<number> = signal(10000);

	// ── UI state ──────────────────────────────────────────────────────────────
	readonly focusedPanel: Signal<string> = signal("input");
	readonly sidebarVisible: Signal<boolean> = signal(false);
	readonly terminalSize: Signal<Size> = signal({ width: 80, height: 24 });
	readonly showThinking: Signal<boolean> = signal(true);
	/**
	 * Dialog stack — each push opens a new modal on top of the previous;
	 * Esc pops the top. Use `pushDialog()` / `popDialog()` helpers.
	 */
	readonly dialogStack: Signal<string[]> = signal<string[]>([]);
	/**
	 * Legacy computed accessor — returns the top dialog name or null.
	 * Kept for backward-compat with existing render code; prefer `topDialog`.
	 */
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
	readonly pendingPermission: Signal<{
		tool: string;
		args: Record<string, unknown>;
		resolve: (decision: PermissionDecision) => void;
	} | null> = signal(null);

	// ── Tool call collapse tracking ───────────────────────────────────────────
	/** Track collapsed state of tool call blocks by tool_use ID */
	readonly collapsedTools: Signal<Set<string>> = signal(new Set<string>());

	// ── File tracking ─────────────────────────────────────────────────────────
	readonly modifiedFiles: Signal<string[]> = signal<string[]>([]);

	// ── File preview ─────────────────────────────────────────────────────────
	/** Currently previewed file path (empty = no preview). */
	readonly previewFile: Signal<string> = signal("");
	/** Whether the file preview pane is visible. */
	readonly previewVisible: Signal<boolean> = signal(false);

	// ── Coding agent ──────────────────────────────────────────────────────────
	readonly codingPhase: Signal<string> = signal("idle");

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

	// ── Chitragupta integration ───────────────────────────────────────────────
	readonly chitraguptaConnected: Signal<boolean> = signal(false);
	readonly chitraguptaBridge: Signal<ChitraguptaBridge | null> = signal(null);
	/**
	 * Formatted memory context loaded from Chitragupta on startup.
	 * Injected into agent system prompts to give the LLM project-level memory.
	 */
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
	/** Active predictions from Chitragupta. */
	readonly chitraguptaPredictions: Signal<Array<{ action: string; confidence: number }>> = signal([]);
	/** Queued evolve requests from Chitragupta. */
	readonly chitraguptaEvolveQueue: Signal<Array<Record<string, unknown>>> = signal([]);
	/**
	 * Cluster command channel — slash commands and dialogs write here;
	 * CodingAgent observes via an effect and handles immediately.
	 */
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
	/**
	 * Validation results dialog — opened by CodingAgent when multi-agent
	 * validation produces at least one REJECT. Callbacks are wired in CodingAgent.
	 */
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
	updateUsage(usage: Usage): void {
		this.totalInputTokens.value += usage.inputTokens;
		this.totalOutputTokens.value += usage.outputTokens;
		// Rough cost estimation (Sonnet pricing)
		const inputCost = (usage.inputTokens * 3) / 1_000_000;
		const outputCost = (usage.outputTokens * 15) / 1_000_000;
		const cacheReadDiscount = (usage.cacheReadTokens * 2.7) / 1_000_000; // 90% discount
		this.totalCost.value += inputCost + outputCost - cacheReadDiscount;
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
		this.turnCount.value = 0;
		this.activeTool.value = null;
		this.toolOutput.value = "";
		this.toolSpinner.reset();
		this.agentPhase.value = "idle";
		this.pendingPermission.value = null;
		this.collapsedTools.value = new Set<string>();
		this.modifiedFiles.value = [];
		this.previewFile.value = "";
		this.previewVisible.value = false;
		this.codingPhase.value = "idle";
		this.clusterPhase.value = "idle";
		this.clusterId.value = null;
		this.clusterAgentCount.value = 0;
		this.clusterValidationAttempt.value = 0;
		this.thinking.value = false;
		this.thinkingBudget.value = 10000;
		this.chitraguptaConnected.value = false;
		this.chitraguptaBridge.value = null;
		this.chitraguptaMemory.value = "";
		this.vasanaTendencies.value = [];
		this.chitraguptaHealth.value = null;
		this.vasanaLastRefresh.value = 0;
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
		this.steeringQueue.clear();
		this.steeringPending.value = 0;
	}
}
