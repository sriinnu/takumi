/**
 * AgentRunner — connects the TUI state to the agent loop.
 * Handles message submission, streaming, and state updates.
 */

import {
	agentLoop,
	buildSkillsPrompt,
	buildStrategyPrompt,
	type ConventionFiles,
	calculateContextPressure,
	ExperienceMemory,
	type ExtensionEvent,
	type ExtensionRunner,
	MemoryHooks,
	type MessagePayload,
	ObservationCollector,
	PermissionEngine,
	PrincipleMemory,
	type SteeringQueue,
	type ToolRegistry,
} from "@takumi/agent";
import type { AgentEvent, Message, PermissionDecision, TakumiConfig, ToolDefinition } from "@takumi/core";
import { createLogger } from "@takumi/core";
import { hydrateRunnerCognition, materializeWorkspaceDirectives } from "./agent-runner-cognition.js";
import { getBoundSessionId } from "./chitragupta-executor-runtime.js";
import type { AppState } from "./state.js";

const log = createLogger("agent-runner");

export class AgentRunner {
	private state: AppState;
	private config: TakumiConfig;
	private tools: ToolRegistry;
	private history: MessagePayload[] = [];
	private abortController: AbortController | null = null;
	private spinnerTimer: ReturnType<typeof setInterval> | null = null;
	private toolStartTimes = new Map<string, number>();
	/** Prevents multiple consolidation triggers within a single submission. */
	private consolidationTriggered = false;
	private sendMessageFn: (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
		signal?: AbortSignal,
		options?: { model?: string },
	) => AsyncIterable<AgentEvent>;

	private extensionRunner: ExtensionRunner | null;
	private conventionFiles: ConventionFiles | null;
	private steeringQueue: SteeringQueue | null;
	private experienceMemory = new ExperienceMemory();
	private memoryHooks = new MemoryHooks({ cwd: process.cwd() });
	private principleMemory = new PrincipleMemory(process.cwd());

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
	) {
		this.state = state;
		this.config = config;
		this.sendMessageFn = sendMessageFn;
		this.tools = tools;
		this.extensionRunner = extensionRunner ?? null;
		this.conventionFiles = conventionFiles ?? null;
		this.steeringQueue = steeringQueue ?? null;
		this.tools.setPermissionChecker((tool, args) => this.getToolPermissionDecision(tool, args));
		this.memoryHooks.load();
		this.principleMemory.load();

		// Set up permission engine with TUI prompt callback
		this.permissions = new PermissionEngine();
		this.permissions.setPromptCallback((tool, args) => this.promptPermission(tool, args));
	}

	getTools(): ToolRegistry {
		return this.tools;
	}

	emitExtensionEvent = (event: ExtensionEvent): Promise<void> => this.extensionRunner?.emit(event) ?? Promise.resolve();

	/** Submit a user message and start the agent loop. */
	async submit(text: string, options?: { images?: Array<{ mediaType: string; data: string }> }): Promise<void> {
		if (this.state.isStreaming.value) {
			log.warn("Already streaming, ignoring submit");
			return;
		}

		this.state.isStreaming.value = true;
		this.state.streamingText.value = "";
		this.state.thinkingText.value = "";
		this.state.agentPhase.value = "Thinking...";
		this.abortController = new AbortController();
		this.startSpinnerTimer();

		try {
			// Enrich system prompt with Chitragupta project memory when available.
			// Memories are fetched once on startup and stored in state; this injects
			// them before each submit so the LLM has persistent project context.
			const memoryContext = this.state.chitraguptaMemory.value;
			let basePrompt = this.config.systemPrompt || undefined;

			// Phase 45 — append convention system-prompt addon
			if (this.conventionFiles?.systemPromptAddon) {
				basePrompt = `${basePrompt ?? ""}\n\n## Project Conventions\n${this.conventionFiles.systemPromptAddon}`.trim();
			}

			let predictiveContext = "";
			if (this.state.chitraguptaObserver.value && this.state.sessionId.value) {
				try {
					predictiveContext = await hydrateRunnerCognition(this.state);
				} catch (err) {
					log.debug(`Chitragupta pre-turn prediction failed: ${(err as Error).message}`);
				}
			}
			materializeWorkspaceDirectives(this.state);

			const promptSections = [
				basePrompt ?? "",
				memoryContext ? `## Project Memory (from Chitragupta)\n${memoryContext}` : "",
				buildSkillsPrompt(this.conventionFiles?.skills ?? [], text) ?? this.conventionFiles?.skillsPromptAddon ?? "",
				this.experienceMemory.buildPromptSection() ?? "",
				buildStrategyPrompt(text, this.tools.getDefinitions(), this.experienceMemory) ?? "",
				renderToolRoutingHints(text, this.tools.getDefinitions(), this.experienceMemory),
				predictiveContext,
			].filter(Boolean);
			const enrichedPrompt = promptSections.length > 0 ? promptSections.join("\n\n").trim() : undefined;

			// Phase 49 — observation collector for Chitragupta intelligence
			const collector = this.state.sessionId.value
				? new ObservationCollector({ sessionId: getBoundSessionId(this.state) })
				: undefined;
			const selectedModel = this.state.model.value.trim() || undefined;

			const loop = agentLoop({ text, images: options?.images }, this.history, {
				sendMessage: this.sendMessageFn,
				model: selectedModel,
				tools: this.tools,
				checkToolPermission: (tool, args) => this.getToolPermissionDecision(tool, args),
				systemPrompt: enrichedPrompt,
				maxTurns: this.config.maxTurns,
				signal: this.abortController.signal,
				extensionRunner: this.extensionRunner ?? undefined,
				steeringQueue: this.steeringQueue ?? undefined,
				observationCollector: collector,
				experienceMemory: this.experienceMemory,
				memoryHooks: this.memoryHooks,
				principleMemory: this.principleMemory,
			});

			let fullText = "";
			let fullThinking = "";

			for await (const event of loop) {
				this.handleEvent(event);

				if (event.type === "text_delta") {
					fullText += event.text;
					this.state.streamingText.value = fullText;
					this.state.agentPhase.value = "Thinking...";
				} else if (event.type === "thinking_delta") {
					fullThinking += event.text;
					this.state.thinkingText.value = fullThinking;
					this.state.agentPhase.value = "Thinking...";
				} else if (event.type === "usage_update") {
					this.state.updateUsage(event.usage);
					// Phase 20.4: Calculate and propagate context pressure
					const ctxWindow = this.state.contextWindow.value;
					const pressure = calculateContextPressure(this.history, ctxWindow);
					this.state.contextPercent.value = pressure.percent;
					this.state.contextPressure.value = pressure.pressure;
					this.state.contextTokens.value = pressure.tokens;
					this.state.contextWindow.value = pressure.contextWindow;

					// Auto-consolidation: trigger once per submit when pressure is near_limit (95%+)
					if (pressure.pressure === "near_limit" && !this.consolidationTriggered) {
						this.consolidationTriggered = true;
						const bridge = this.state.chitraguptaBridge.value;
						if (bridge?.isConnected) {
							const project = process.cwd().split("/").pop() ?? "unknown";
							log.info(`Auto-consolidation triggered (pressure: ${pressure.percent.toFixed(1)}%)`);
							this.state.consolidationInProgress.value = true;
							void bridge
								.consolidationRun(project)
								.catch((err) => {
									log.debug(`Auto-consolidation failed: ${(err as Error).message}`);
								})
								.finally(() => {
									this.state.consolidationInProgress.value = false;
								});
						}
					}
				} else if (event.type === "tool_use") {
					this.state.activeTool.value = event.name;
					this.state.agentPhase.value = `Running ${event.name}...`;
					// Summarize tool args for spinner display
					const argSummary = summarizeToolArgs(event.name, event.input);
					this.state.toolSpinner.start(event.id, event.name, argSummary);
					this.toolStartTimes.set(event.id, Date.now());
				} else if (event.type === "tool_result") {
					this.state.activeTool.value = null;
					this.state.toolOutput.value = event.output;
					this.state.agentPhase.value = "Waiting for response...";
					// Complete the spinner entry
					const startTime = this.toolStartTimes.get(event.id) ?? Date.now();
					const durationMs = Date.now() - startTime;
					this.state.toolSpinner.complete(event.id, !event.isError, durationMs);
					this.toolStartTimes.delete(event.id);
				} else if (event.type === "done" || event.type === "stop") {
					break;
				} else if (event.type === "error") {
					log.error("Agent error", event.error);
					break;
				}
			}

			// Finalize: add assistant message to UI state.
			// NOTE: this.history is already fully updated by agentLoop (it mutates
			// history in-place, including all tool-call / tool-result turns).
			// We only need to push the assistant message into the *display* state.
			if (fullText) {
				const assistantMsg: Message = {
					id: `msg-${Date.now()}`,
					role: "assistant",
					content: [],
					timestamp: Date.now(),
				};

				if (fullThinking) {
					assistantMsg.content.push({ type: "thinking", thinking: fullThinking });
				}
				assistantMsg.content.push({ type: "text", text: fullText });

				this.state.addMessage(assistantMsg);

				// Auto-deposit to Akasha after successful work
				const bridge = this.state.chitraguptaBridge.value;
				if (bridge?.isConnected && fullText.length > 100) {
					void bridge
						.akashaDeposit(fullText.slice(0, 2000), "agent_response", [process.cwd().split("/").pop() ?? "unknown"])
						.catch(() => {
							/* best-effort */
						});
				}
			}

			// Phase 49 — flush observation events to ChitraguptaObserver
			if (collector && collector.pending > 0) {
				const observer = this.state.chitraguptaObserver.value;
				if (observer) {
					const events = collector.flush();
					void observer
						.observeBatch(events)
						.then((r) => {
							if (r.accepted > 0) this.state.observationFlushCount.value++;
						})
						.catch(() => {
							/* best-effort */
						});
				}
			}
		} catch (err) {
			log.error("Agent loop error", err);
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
	}

	/** Clear conversation history (for /clear). */
	clearHistory(): void {
		this.history = [];
		this.experienceMemory.clear();
		this.toolStartTimes.clear();
		this.consolidationTriggered = false;
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
	}

	/** Check permissions before executing a tool. Returns true if allowed. */
	async checkToolPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
		const decision = await this.getToolPermissionDecision(tool, args);
		if (!decision.allowed) {
			log.info(`Permission denied for ${tool}: ${decision.reason ?? "no reason"}`);
		}
		return decision.allowed;
	}

	async getToolPermissionDecision(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
		return this.permissions.check(tool, args);
	}

	/**
	 * Prompt the user for permission via the TUI dialog.
	 * Sets pendingPermission on the state and waits for the user to respond.
	 */
	private promptPermission(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
		return new Promise<PermissionDecision>((resolve) => {
			this.state.pendingPermission.value = { tool, args, resolve };
			this.state.pushDialog("permission");
		});
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

	private handleEvent(event: AgentEvent): void {
		// Events are already yielded by the loop — this is for logging only
		if (event.type !== "text_delta" && event.type !== "thinking_delta") {
			log.debug("Agent event", { type: event.type });
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Summarize tool arguments for display in the spinner line.
 */
function summarizeToolArgs(toolName: string, input: Record<string, unknown>): string {
	switch (toolName) {
		case "bash":
		case "execute": {
			const cmd = input.command ?? input.cmd ?? "";
			return String(cmd);
		}
		case "read":
		case "write":
		case "edit": {
			const path = input.file_path ?? input.path ?? input.filename ?? "";
			return String(path);
		}
		case "glob":
		case "grep": {
			const pattern = input.pattern ?? input.query ?? "";
			return String(pattern);
		}
		default: {
			// Show first string-valued argument
			for (const val of Object.values(input)) {
				if (typeof val === "string" && val.length > 0) {
					return val;
				}
			}
			return "";
		}
	}
}

function renderToolRoutingHints(text: string, tools: ToolDefinition[], memory: ExperienceMemory): string {
	const ranked = memory
		.rankTools(tools, text)
		.filter((entry) => entry.score > 0)
		.slice(0, 3);
	if (ranked.length === 0) {
		return "";
	}

	return [
		"## Dynamic Tool Ranking",
		...ranked.map((entry, index) => `${index + 1}. ${entry.name} — ${entry.reason}`),
	].join("\n");
}
