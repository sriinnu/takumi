/**
 * ChatView — the main chat interface combining message list and input.
 */

import type { KeyEvent, Message, Rect } from "@takumi/core";
import { createLogger } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component } from "@takumi/render";
import type { AgentRunner } from "../agent-runner.js";
import type { SlashCommandRegistry } from "../commands.js";
import { EditorPanel } from "../panels/editor.js";
import { HeaderPanel } from "../panels/header.js";
import { MessageListPanel } from "../panels/message-list.js";
import { StatusBarPanel } from "../panels/status-bar.js";
import type { AppState } from "../state.js";

const log = createLogger("chat-view");

export interface ChatViewProps {
	state: AppState;
	commands?: SlashCommandRegistry;
	projectRoot?: string;
}

export class ChatView extends Component {
	private state: AppState;
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
		this.commands = props.commands ?? null;

		this.header = new HeaderPanel({ state: this.state });
		this.messageList = new MessageListPanel({ state: this.state });
		this.editor = new EditorPanel({
			onSubmit: (text) => this.handleSubmit(text),
			commands: props.commands,
			projectRoot: props.projectRoot,
		});
		this.statusBar = new StatusBarPanel({ state: this.state });

		this.appendChild(this.header);
		this.appendChild(this.messageList);
		this.appendChild(this.editor);
		this.appendChild(this.statusBar);
	}

	/** Handle user message submission. */
	private handleSubmit(text: string): void {
		if (!text.trim()) return;

		// Try slash commands first
		if (text.startsWith("/") && this.commands) {
			this.commands.execute(text).then((handled) => {
				if (!handled) {
					log.warn(`Unknown command: ${text.split(" ")[0]}`);
				}
			});
			return;
		}

		const message: Message = {
			id: `msg-${Date.now()}`,
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};

		this.state.addMessage(message);
		this.state.turnCount.value++;

		// Kick off the agent loop if connected
		if (this.agentRunner) {
			this.agentRunner.submit(text).catch((err) => {
				log.error("Agent submit failed", err);
			});
		}
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

	/** Handle key events for the chat view. */
	handleKey(event: KeyEvent): boolean {
		// Delegate to the focused component
		return this.editor.handleKey(event);
	}

	render(screen: Screen, rect: Rect): void {
		// Layout: header (1 row) | messages (flex) | editor (3 rows) | status (1 row)
		const headerHeight = 1;
		const editorHeight = 3;
		const statusHeight = 1;
		const messageHeight = rect.height - headerHeight - editorHeight - statusHeight;

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
