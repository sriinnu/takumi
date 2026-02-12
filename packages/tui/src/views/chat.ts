/**
 * ChatView — the main chat interface combining message list and input.
 */

import type { Rect, Message, KeyEvent } from "@takumi/core";
import { Component, Box, Input, Scroll } from "@takumi/render";
import type { Screen } from "@takumi/render";
import type { AppState } from "../state.js";
import { MessageListPanel } from "../panels/message-list.js";
import { EditorPanel } from "../panels/editor.js";
import { StatusBarPanel } from "../panels/status-bar.js";
import { HeaderPanel } from "../panels/header.js";

export interface ChatViewProps {
	state: AppState;
}

export class ChatView extends Component {
	private state: AppState;
	private header: HeaderPanel;
	private messageList: MessageListPanel;
	private editor: EditorPanel;
	private statusBar: StatusBarPanel;

	constructor(props: ChatViewProps) {
		super();
		this.state = props.state;

		this.header = new HeaderPanel({ state: this.state });
		this.messageList = new MessageListPanel({ state: this.state });
		this.editor = new EditorPanel({
			onSubmit: (text) => this.handleSubmit(text),
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

		const message: Message = {
			id: `msg-${Date.now()}`,
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		};

		this.state.addMessage(message);
		this.state.turnCount.value++;
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
