/**
 * AgentRunner — connects the TUI state to the agent loop.
 * Handles message submission, streaming, and state updates.
 */

import type { TakumiConfig, AgentEvent, Message, ToolDefinition, PermissionDecision } from "@takumi/core";
import { createLogger } from "@takumi/core";
import { agentLoop, PermissionEngine, type MessagePayload } from "@takumi/agent";
import { ToolRegistry } from "@takumi/agent";
import type { AppState } from "./state.js";

const log = createLogger("agent-runner");

export class AgentRunner {
	private state: AppState;
	private config: TakumiConfig;
	private tools: ToolRegistry;
	private history: MessagePayload[] = [];
	private abortController: AbortController | null = null;
	private sendMessageFn: (
		messages: MessagePayload[],
		system: string,
		tools?: ToolDefinition[],
	) => AsyncIterable<AgentEvent>;

	readonly permissions: PermissionEngine;

	constructor(
		state: AppState,
		config: TakumiConfig,
		sendMessageFn: (
			messages: MessagePayload[],
			system: string,
			tools?: ToolDefinition[],
		) => AsyncIterable<AgentEvent>,
		tools: ToolRegistry,
	) {
		this.state = state;
		this.config = config;
		this.sendMessageFn = sendMessageFn;
		this.tools = tools;

		// Set up permission engine with TUI prompt callback
		this.permissions = new PermissionEngine();
		this.permissions.setPromptCallback((tool, args) => this.promptPermission(tool, args));
	}

	/** Submit a user message and start the agent loop. */
	async submit(text: string): Promise<void> {
		if (this.state.isStreaming.value) {
			log.warn("Already streaming, ignoring submit");
			return;
		}

		this.state.isStreaming.value = true;
		this.state.streamingText.value = "";
		this.state.thinkingText.value = "";
		this.abortController = new AbortController();

		try {
			const loop = agentLoop(text, this.history, {
				sendMessage: this.sendMessageFn,
				tools: this.tools,
				systemPrompt: this.config.systemPrompt || undefined,
				maxTurns: this.config.maxTurns,
				signal: this.abortController.signal,
			});

			let fullText = "";
			let fullThinking = "";

			for await (const event of loop) {
				this.handleEvent(event);

				if (event.type === "text_delta") {
					fullText += event.text;
					this.state.streamingText.value = fullText;
				} else if (event.type === "thinking_delta") {
					fullThinking += event.text;
					this.state.thinkingText.value = fullThinking;
				} else if (event.type === "usage_update") {
					this.state.updateUsage(event.usage);
				} else if (event.type === "tool_use") {
					this.state.activeTool.value = event.name;
				} else if (event.type === "tool_result") {
					this.state.activeTool.value = null;
					this.state.toolOutput.value = event.output;
				} else if (event.type === "done" || event.type === "stop") {
					break;
				} else if (event.type === "error") {
					log.error("Agent error", event.error);
					break;
				}
			}

			// Finalize: add assistant message to state
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

				// Update history for next turn
				this.history.push({ role: "user", content: [{ type: "text", text }] });
				this.history.push({ role: "assistant", content: assistantMsg.content });
			}
		} catch (err) {
			log.error("Agent loop error", err);
		} finally {
			this.state.isStreaming.value = false;
			this.state.streamingText.value = "";
			this.state.thinkingText.value = "";
			this.state.activeTool.value = null;
			this.abortController = null;
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

	/** Clear conversation history (for /clear). */
	clearHistory(): void {
		this.history = [];
	}

	/** Check permissions before executing a tool. Returns true if allowed. */
	async checkToolPermission(tool: string, args: Record<string, unknown>): Promise<boolean> {
		const decision = await this.permissions.check(tool, args);
		if (!decision.allowed) {
			log.info(`Permission denied for ${tool}: ${decision.reason ?? "no reason"}`);
		}
		return decision.allowed;
	}

	/**
	 * Prompt the user for permission via the TUI dialog.
	 * Sets pendingPermission on the state and waits for the user to respond.
	 */
	private promptPermission(tool: string, args: Record<string, unknown>): Promise<PermissionDecision> {
		return new Promise<PermissionDecision>((resolve) => {
			this.state.pendingPermission.value = { tool, args, resolve };
			this.state.activeDialog.value = "permission";
		});
	}

	private handleEvent(event: AgentEvent): void {
		// Events are already yielded by the loop — this is for logging only
		if (event.type !== "text_delta" && event.type !== "thinking_delta") {
			log.debug("Agent event", { type: event.type });
		}
	}
}
