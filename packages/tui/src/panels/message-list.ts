/**
 * MessageListPanel — renders the scrollable list of conversation messages.
 */

import type { Rect, Message, ContentBlock } from "@takumi/core";
import { Component } from "@takumi/render";
import type { Screen } from "@takumi/render";
import { wrapText, measureText } from "@takumi/render";
import { effect } from "@takumi/render";
import type { AppState } from "../state.js";

export interface MessageListPanelProps {
	state: AppState;
}

export class MessageListPanel extends Component {
	private state: AppState;
	private scrollOffset = 0;
	private renderedLines: RenderedLine[] = [];
	private disposeEffect: (() => void) | null = null;

	constructor(props: MessageListPanelProps) {
		super();
		this.state = props.state;

		// Re-render when messages change
		this.disposeEffect = effect(() => {
			const _msgs = this.state.messages.value;
			const _streaming = this.state.streamingText.value;
			this.markDirty();
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	/** Scroll to the bottom of the message list. */
	scrollToBottom(): void {
		// Will be calculated during render
		this.scrollOffset = Number.MAX_SAFE_INTEGER;
		this.markDirty();
	}

	/** Scroll up by a number of lines. */
	scrollUp(lines: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - lines);
		this.markDirty();
	}

	/** Scroll down by a number of lines. */
	scrollDown(lines: number): void {
		this.scrollOffset += lines;
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		const messages = this.state.messages.value;
		const width = rect.width - 2; // padding

		// Flatten messages into rendered lines
		this.renderedLines = [];
		for (const msg of messages) {
			this.renderMessage(msg, width);
		}

		// Add streaming text if active
		if (this.state.isStreaming.value && this.state.streamingText.value) {
			this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
			const lines = wrapText(this.state.streamingText.value, width);
			for (const line of lines) {
				this.renderedLines.push({ text: line, fg: 12, bold: false, dim: false });
			}
		}

		// Clamp scroll offset
		const maxScroll = Math.max(0, this.renderedLines.length - rect.height);
		if (this.scrollOffset > maxScroll) {
			this.scrollOffset = maxScroll;
		}

		// Render visible lines
		const startLine = this.scrollOffset;
		for (let i = 0; i < rect.height; i++) {
			const lineIdx = startLine + i;
			if (lineIdx >= this.renderedLines.length) break;

			const line = this.renderedLines[lineIdx];
			screen.writeText(rect.y + i, rect.x + 1, line.text, {
				fg: line.fg,
				bold: line.bold,
				dim: line.dim,
			});
		}
	}

	private renderMessage(message: Message, width: number): void {
		// Role header
		if (message.role === "user") {
			this.renderedLines.push({ text: "You:", fg: 14, bold: true, dim: false });
		} else {
			this.renderedLines.push({ text: "Takumi:", fg: 12, bold: true, dim: false });
		}

		// Content blocks
		for (const block of message.content) {
			this.renderContentBlock(block, width);
		}

		// Blank line between messages
		this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
	}

	private renderContentBlock(block: ContentBlock, width: number): void {
		switch (block.type) {
			case "text": {
				const lines = wrapText(block.text, width);
				for (const line of lines) {
					this.renderedLines.push({ text: line, fg: -1, bold: false, dim: false });
				}
				break;
			}
			case "thinking": {
				this.renderedLines.push({ text: "[thinking]", fg: 8, bold: false, dim: true });
				const lines = wrapText(block.thinking, width);
				for (const line of lines) {
					this.renderedLines.push({ text: line, fg: 8, bold: false, dim: true });
				}
				break;
			}
			case "tool_use": {
				this.renderedLines.push({
					text: `[tool: ${block.name}]`,
					fg: 3,
					bold: true,
					dim: false,
				});
				break;
			}
			case "tool_result": {
				const prefix = block.isError ? "[error] " : "[result] ";
				const fg = block.isError ? 1 : 2;
				const lines = wrapText(prefix + block.content, width);
				for (const line of lines) {
					this.renderedLines.push({ text: line, fg, bold: false, dim: false });
				}
				break;
			}
		}
	}
}

interface RenderedLine {
	text: string;
	fg: number;
	bold: boolean;
	dim: boolean;
}
