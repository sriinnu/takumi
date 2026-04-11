/**
 * AgentRunner — connects the TUI state to the agent loop.
 * Handles message submission, streaming, and state updates.
 */

import {
	BudgetGuard,
	type ConventionFiles,
	CostTracker,
	ExperienceMemory,
	type ExtensionEvent,
	type ExtensionRunner,
	MemoryHooks,
	type MessagePayload,
	PermissionEngine,
	PrincipleMemory,
	type SteeringQueue,
	type ToolRegistry,
} from "@takumi/agent";
import type { AgentEvent, Message, PermissionDecision, TakumiConfig, ToolDefinition, ToolResult } from "@takumi/core";
import { createLogger, normalizeProviderName } from "@takumi/core";
import { syncPendingChitraguptaSessionTurns } from "../chitragupta/chitragupta-session-sync.js";
import type { PendingTrackedFileTool } from "../file-tracking.js";
import type { AppState } from "../state.js";
import { executeCommandTool } from "./agent-runner-command-tools.js";
import { requestToolPermission } from "./agent-runner-permissions.js";
import { runAgentRunnerSubmit } from "./agent-runner-submit.js";
import type { InteractiveSubmitSendMessage } from "./interactive-submit-route.js";

const log = createLogger("agent-runner");

export interface AgentRunnerRuntimeOptions {
	resolveProviderSendMessage?: (providerName: string) => Promise<InteractiveSubmitSendMessage | null>;
}

export class AgentRunner {
	private state: AppState;
	private config: TakumiConfig;
	private tools: ToolRegistry;
	private history: MessagePayload[] = [];
	private abortController: AbortController | null = null;
	private spinnerTimer: ReturnType<typeof setInterval> | null = null;
	private toolStartTimes = new Map<string, number>();
	private pendingTrackedFileTools = new Map<string, PendingTrackedFileTool[]>();
	/** Prevents multiple consolidation triggers within a single submission. */
	private consolidationTriggered = false;
	private sendMessageFn: (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<AgentEvent>;
	private readonly providerSendMessageCache = new Map<string, InteractiveSubmitSendMessage>();
	private readonly resolveProviderSendMessage?: AgentRunnerRuntimeOptions["resolveProviderSendMessage"];

	private extensionRunner: ExtensionRunner | null;
	private conventionFiles: ConventionFiles | null;
	private steeringQueue: SteeringQueue | null;
	private experienceMemory = new ExperienceMemory();
	private memoryHooks = new MemoryHooks({ cwd: process.cwd() });
	private principleMemory = new PrincipleMemory(process.cwd());
	private costTracker: CostTracker;
	private budgetGuard: BudgetGuard;

	readonly permissions: PermissionEngine;

	constructor(
		state: AppState,
		config: TakumiConfig,
		sendMessageFn: (
			messages: MessagePayload[],
			system: string,
			tools?: ToolDefinition[],
			signal?: AbortSignal,
			options?: { model?: string },
		) => AsyncIterable<AgentEvent>,
		tools: ToolRegistry,
		extensionRunner?: ExtensionRunner,
		conventionFiles?: ConventionFiles,
		steeringQueue?: SteeringQueue,
		runtime?: AgentRunnerRuntimeOptions,
	) {
		this.state = state;
		this.config = config;
		this.sendMessageFn = sendMessageFn;
		this.tools = tools;
		this.extensionRunner = extensionRunner ?? null;
		this.conventionFiles = conventionFiles ?? null;
		this.steeringQueue = steeringQueue ?? null;
		this.resolveProviderSendMessage = runtime?.resolveProviderSendMessage;
		this.tools.setPermissionChecker((tool, args) => this.getToolPermissionDecision(tool, args));
		this.memoryHooks.load();
		this.principleMemory.load();
		this.costTracker = this.createCostTracker();
		this.budgetGuard = this.createBudgetGuard();
		this.state.setCostSnapshot(this.costTracker.snapshot());

		// Set up permission engine with TUI prompt callback
		this.permissions = new PermissionEngine();
		this.permissions.setPromptCallback((tool, args) => requestToolPermission(this.state, tool, args));
	}

	getTools(): ToolRegistry {
		return this.tools;
	}

	emitExtensionEvent = (event: ExtensionEvent): Promise<void> => this.extensionRunner?.emit(event) ?? Promise.resolve();

	/** Submit a user message and start the agent loop. */
	async submit(text: string, options?: { images?: Array<{ mediaType: string; data: string }> }): Promise<void> {
		if (this.state.isStreaming.value) {
			log.warn("Already streaming, ignoring submit");
			this.addAssistantTextMessage(
				"The current run is still active. I ignored the new submit instead of interleaving it.",
			);
			return;
		}

		this.state.isStreaming.value = true;
		this.state.streamingText.value = "";
		this.state.thinkingText.value = "";
		this.state.agentPhase.value = "Thinking...";
		this.abortController = new AbortController();
		this.startSpinnerTimer();
		this.pendingTrackedFileTools.clear();

		try {
			await runAgentRunnerSubmit({
				state: this.state,
				config: this.config,
				tools: this.tools,
				history: this.history,
				text,
				images: options?.images,
				signal: this.abortController.signal,
				defaultSendMessage: this.sendMessageFn,
				resolveProviderSendMessage: (providerName) => this.getProviderSendMessageFn(providerName),
				extensionRunner: this.extensionRunner,
				conventionFiles: this.conventionFiles,
				steeringQueue: this.steeringQueue,
				experienceMemory: this.experienceMemory,
				memoryHooks: this.memoryHooks,
				principleMemory: this.principleMemory,
				costTracker: this.costTracker,
				buildBudgetGuard: (modelOverride) => this.createBudgetGuard(modelOverride),
				setBudgetGuard: (guard) => {
					this.budgetGuard = guard;
				},
				emitExtensionEvent: this.emitExtensionEvent,
				toolStartTimes: this.toolStartTimes,
				pendingTrackedFileTools: this.pendingTrackedFileTools,
				isConsolidationTriggered: () => this.consolidationTriggered,
				markConsolidationTriggered: () => {
					this.consolidationTriggered = true;
				},
				getToolPermissionDecision: (tool, args) => this.getToolPermissionDecision(tool, args),
				onEvent: (event) => this.handleEvent(event),
				onRuntimeError: (error) => this.presentRuntimeError(error),
			});
		} catch (err) {
			log.error("Agent loop error", err);
			this.presentRuntimeError(err);
		} finally {
			this.memoryHooks.save();
			this.principleMemory.save();
			this.state.isStreaming.value = false;
			this.state.streamingText.value = "";
			this.state.thinkingText.value = "";
			this.state.activeTool.value = null;
			this.state.agentPhase.value = "idle";
			this.stopSpinnerTimer();
			this.abortController = null;
			this.pendingTrackedFileTools.clear();
			this.consolidationTriggered = false;
		}
	}

	/** Cancel the current stream. */
	cancel(): void {
		this.abortController?.abort();
	}

	/** Check if currently streaming. */
	get isRunning(): boolean {
		return this.state.isStreaming.value;
	}

	/**
	 * Expose the underlying sendMessage function so {@link CodingAgent} can
	 * forward it to the cluster orchestrator without unsafe bracket notation.
	 */
	getSendMessageFn(): (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<AgentEvent> {
		return this.sendMessageFn;
	}

	/**
	 * Replace the provider's sendMessage function at runtime.
	 * Used by the /provider slash command to hot-swap the active AI provider.
	 */
	setSendMessageFn(
		fn: (
			messages: MessagePayload[],
			system: string,
			tools?: ToolDefinition[],
			signal?: AbortSignal,
			options?: { model?: string },
		) => AsyncIterable<AgentEvent>,
	): void {
		this.sendMessageFn = fn;
		this.providerSendMessageCache.clear();
	}

	/** Clear conversation history (for /clear). */
	clearHistory(): void {
		this.history = [];
		this.experienceMemory.clear();
		this.toolStartTimes.clear();
		this.pendingTrackedFileTools.clear();
		this.consolidationTriggered = false;
		this.state.clearFileTracking();
		this.resetCostTrackerFromState();
	}

	/** Rebuild runner history from persisted UI messages after a session restore. */
	hydrateHistory(messages: Message[]): void {
		this.clearHistory();
		this.history = messages.map((message) => ({
			role: message.role,
			content: message.content.map((block) => {
				switch (block.type) {
					case "tool_result":
						return {
							type: "tool_result",
							tool_use_id: block.toolUseId,
							content: block.content,
							is_error: block.isError,
						};
					default:
						return block;
				}
			}),
		}));
		this.pendingTrackedFileTools.clear();
		this.resetCostTrackerFromState();
	}

	/** Check permissions before executing a tool. Returns true if allowed. */
	async checkToolPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
		const decision = await this.getToolPermissionDecision(tool, args);
		if (!decision.allowed) {
			log.info(`Permission denied for ${tool}: ${decision.reason ?? "no reason"}`);
		}
		return decision.allowed;
	}

	async executeCommandTool(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
		return executeCommandTool({
			toolName: tool,
			input: args,
			tools: this.tools,
			extensionRunner: this.extensionRunner,
			observer: this.state.chitraguptaObserver.value,
			sessionId: this.state.sessionId.value || null,
			getPermissionDecision: (name, input) => this.getToolPermissionDecision(name, input),
			recordToolUse: (name, input, result) => this.experienceMemory.recordToolUse(name, input, result),
			onObservationFlush: () => this.state.observationFlushCount.value++,
		});
	}

	async getToolPermissionDecision(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
		return this.permissions.check(tool, args);
	}

	/** Start the spinner animation timer (80ms interval). */
	private startSpinnerTimer(): void {
		if (this.spinnerTimer) return;
		this.spinnerTimer = setInterval(() => {
			if (this.state.toolSpinner.isRunning) {
				this.state.toolSpinner.theme = this.state.theme.value;
				this.state.toolSpinner.tick();
			}
		}, 80);
	}

	/** Stop the spinner animation timer. */
	private stopSpinnerTimer(): void {
		if (this.spinnerTimer) {
			clearInterval(this.spinnerTimer);
			this.spinnerTimer = null;
		}
	}

	private createCostTracker(): CostTracker {
		return new CostTracker({
			model: this.state.model.value.trim() || this.config.model || "claude-sonnet-4-20250514",
			budgetUsd: this.config.maxCostUsd ?? Number.POSITIVE_INFINITY,
			initialInputTokens: this.state.totalInputTokens.value,
			initialOutputTokens: this.state.totalOutputTokens.value,
			initialUsd: this.state.totalCost.value,
		});
	}

	private createBudgetGuard(modelOverride?: string): BudgetGuard {
		return new BudgetGuard({
			model: modelOverride?.trim() || this.state.model.value.trim() || this.config.model || "claude-sonnet-4-20250514",
			limitUsd: this.config.maxCostUsd ?? Number.POSITIVE_INFINITY,
			initialSpentUsd: this.state.totalCost.value,
		});
	}

	private resetCostTrackerFromState(): void {
		this.costTracker = this.createCostTracker();
		this.budgetGuard = this.createBudgetGuard();
		this.state.setCostSnapshot(this.costTracker.snapshot());
	}

	private async getProviderSendMessageFn(providerName: string): Promise<InteractiveSubmitSendMessage | null> {
		const normalizedProvider = normalizeProviderName(providerName) ?? providerName;
		const currentProvider = normalizeProviderName(this.state.provider.value) ?? this.state.provider.value;
		if (normalizedProvider === currentProvider) {
			return this.sendMessageFn;
		}

		const cached = this.providerSendMessageCache.get(normalizedProvider);
		if (cached) {
			return cached;
		}

		if (!this.resolveProviderSendMessage) {
			return null;
		}

		const sendMessage = await this.resolveProviderSendMessage(normalizedProvider);
		if (sendMessage) {
			this.providerSendMessageCache.set(normalizedProvider, sendMessage);
		}
		return sendMessage;
	}

	setBudgetLimit(limitUsd?: number): void {
		this.config.maxCostUsd = limitUsd;
		const snapshot = this.costTracker.setBudgetUsd(limitUsd ?? Number.POSITIVE_INFINITY);
		this.state.setCostSnapshot(snapshot);
		this.budgetGuard.setLimitUsd(limitUsd ?? Number.POSITIVE_INFINITY);
	}

	private handleEvent(event: AgentEvent): void {
		// Events are already yielded by the loop — this is for logging only
		if (event.type !== "text_delta" && event.type !== "thinking_delta") {
			log.debug("Agent event", { type: event.type });
		}
	}

	private presentRuntimeError(error: unknown): void {
		const detail = formatRuntimeError(error);
		this.addAssistantTextMessage(`Run failed.\n${detail}`);
	}

	private addAssistantTextMessage(text: string): void {
		const message: Message = {
			id: `msg-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
			sessionTurn: true,
		};
		this.state.addMessage(message);
		void syncPendingChitraguptaSessionTurns(this.state, this.emitExtensionEvent);
	}
}

function formatRuntimeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message.trim() || error.name;
	}
	if (typeof error === "string") {
		return error.trim() || "Unknown runtime error";
	}
	try {
		return JSON.stringify(error);
	} catch {
		return "Unknown runtime error";
	}
}
