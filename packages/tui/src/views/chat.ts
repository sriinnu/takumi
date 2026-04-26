/**
 * ChatView — the main chat interface combining message list and input.
 * I keep message submission honest, so the transcript only shows messages
 * that were really sent and queued steering is called out explicitly.
 */

import { SteeringPriority } from "@takumi/agent";
import type { KeyEvent, Message, Rect, TakumiConfig } from "@takumi/core";
import { createLogger, KEY_CODES } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component } from "@takumi/render";
import type { AgentRunner } from "../agent/agent-runner.js";
import { syncPendingChitraguptaSessionTurns } from "../chitragupta/chitragupta-session-sync.js";
import type { SlashCommandRegistry } from "../commands/commands.js";
import { EditorPanel } from "../panels/editor.js";
import { HeaderPanel } from "../panels/header.js";
import { MessageListPanel } from "../panels/message-list.js";
import { StatusBarPanel } from "../panels/status-bar.js";
import type { AppState } from "../state.js";

const log = createLogger("chat-view");

export interface ChatViewProps {
	state: AppState;
	config: TakumiConfig;
	commands?: SlashCommandRegistry;
	projectRoot?: string;
}

export class ChatView extends Component {
	private state: AppState;
	private config: TakumiConfig;
	private header: HeaderPanel;
	private messageList: MessageListPanel;
	private editor: EditorPanel;
	private statusBar: StatusBarPanel;
	private commands: SlashCommandRegistry | null;

	/** Set this to connect the chat to the agent loop. */
	agentRunner: AgentRunner | null = null;

	constructor(props: ChatViewProps) {
		super();
		this.state = props.state;
		this.config = props.config;
		this.commands = props.commands ?? null;

		this.header = new HeaderPanel({ state: this.state, config: this.config });
		this.messageList = new MessageListPanel({ state: this.state });
		this.editor = new EditorPanel({
			onSubmit: (text) => this.handleSubmit(text),
			commands: props.commands,
			projectRoot: props.projectRoot,
			getProviderCatalog: () => this.state.availableProviderModels.value,
			getCurrentProvider: () => this.state.provider.value,
		});
		this.statusBar = new StatusBarPanel({ state: this.state, config: this.config });

		this.appendChild(this.header);
		this.appendChild(this.messageList);
		this.appendChild(this.editor);
		this.appendChild(this.statusBar);
	}

	/** Handle user message submission and report whether I accepted it. */
	private handleSubmit(text: string): boolean {
		if (!text.trim()) return true;

		// Try slash commands first
		if (text.startsWith("/") && this.commands) {
			this.commands.execute(text).then((handled) => {
				if (!handled) {
					log.warn(`Unknown command: ${text.split(" ")[0]}`);
				}
			});
			return true;
		}

		if (this.state.isStreaming.value) {
			return this.enqueueSteering(text);
		}

		const message: Message = {
			id: `msg-${Date.now()}`,
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
			sessionTurn: true,
		};

		this.state.addMessage(message);
		this.state.turnCount.value++;
		void syncPendingChitraguptaSessionTurns(this.state, this.agentRunner?.emitExtensionEvent);

		// Kick off the agent loop if connected
		if (this.agentRunner) {
			this.agentRunner.submit(text).catch((err) => {
				log.error("Agent submit failed", err);
				this.addAssistantText("I failed to submit your message. Check the runtime status and try again.");
			});
		}
		return true;
	}

	/** Queue a user message as steering instead of lying about a sent turn. */
	private enqueueSteering(text: string): boolean {
		const queueId = this.state.steeringQueue.enqueue(text, {
			priority: SteeringPriority.NORMAL,
			metadata: { source: "composer" },
		});
		if (!queueId) {
			this.addAssistantText("The steering queue is full. I kept your draft in the composer instead of dropping it.");
			return false;
		}
		this.addAssistantText(`Queued your message for the active run as steering (${queueId}).`);
		return true;
	}

	/** Add an assistant text message to the transcript. */
	private addAssistantText(text: string): void {
		this.state.addMessage({
			id: `msg-${Date.now()}`,
			role: "assistant",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
	}

	/** Scroll the message list by a number of lines (+down, -up). */
	scrollMessages(lines: number): void {
		if (lines > 0) {
			this.messageList.scrollDown(lines);
		} else {
			this.messageList.scrollUp(-lines);
		}
	}

	/** Get the current editor input value. */
	getEditorValue(): string {
		return this.editor.getValue();
	}

	/** Return the selected editor text, or null when nothing is selected. */
	getSelectedText(): string | null {
		return this.editor.getSelectedText();
	}

	/** Whether the editor currently has an active selection. */
	hasSelection(): boolean {
		return this.editor.hasSelection();
	}

	/** Insert text at the editor cursor (pastes). */
	insertText(text: string): void {
		this.editor.insertText(text);
	}

	/** Handle key events for the chat view. */
	handleKey(event: KeyEvent): boolean {
		if (event.raw === KEY_CODES.PAGE_UP) {
			this.scrollMessages(-10);
			return true;
		}
		if (event.raw === KEY_CODES.PAGE_DOWN) {
			this.scrollMessages(10);
			return true;
		}
		return this.editor.handleKey(event);
	}

	render(screen: Screen, rect: Rect): void {
		// Layout: header (1 row) | messages (flex) | editor (auto) | status (1 row)
		const headerHeight = 1;
		const editorHeight = this.editor.getPreferredHeight();
		const statusHeight = 1;
		const messageHeight = Math.max(1, rect.height - headerHeight - editorHeight - statusHeight);

		// Render sub-panels
		this.header.render(screen, {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: headerHeight,
		});

		if (messageHeight > 0) {
			this.messageList.render(screen, {
				x: rect.x,
				y: rect.y + headerHeight,
				width: rect.width,
				height: messageHeight,
			});
		}

		this.editor.render(screen, {
			x: rect.x,
			y: rect.y + headerHeight + messageHeight,
			width: rect.width,
			height: editorHeight,
		});

		this.statusBar.render(screen, {
			x: rect.x,
			y: rect.y + rect.height - statusHeight,
			width: rect.width,
			height: statusHeight,
		});
	}
}
