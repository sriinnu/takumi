/**
 * MessageListPanel — renders the scrollable list of conversation messages.
 *
 * This class intentionally focuses on panel orchestration (state, scrolling,
 * hit-testing, and viewport drawing). Markdown rendering and tool-block
 * rendering live in dedicated helper modules to keep this file maintainable.
 */

import type { Message, Rect, MouseEvent as TMouseEvent, ToolResultBlock } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect, measureText, wrapText } from "@takumi/render";
import type { AppState } from "../state.js";
import { renderContentBlock } from "./message-list-markdown.js";
import {
	buildPairedResultIds,
	buildToolResultMap,
	getToolArgSummary,
	renderToolBlock,
	truncateArg,
} from "./message-list-tools.js";
import type { LineSegment, RenderedLine } from "./message-list-types.js";

export interface MessageListPanelProps {
	state: AppState;
}

export class MessageListPanel extends Component {
	private readonly state: AppState;
	private scrollOffset = 0;
	private renderedLines: RenderedLine[] = [];
	private disposeEffect: (() => void) | null = null;

	/** Maps rendered line indices to tool_use IDs for click/enter toggles. */
	private toolBlockLineMap: Map<number, string> = new Map();

	/** Last rendered rect for hit-testing. */
	private lastRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor(props: MessageListPanelProps) {
		super();
		this.state = props.state;

		this.disposeEffect = effect(() => {
			void this.state.messages.value;
			void this.state.streamingText.value;
			void this.state.collapsedTools.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	/** Scroll to the bottom of the message list. */
	scrollToBottom(): void {
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

	/**
	 * Handle mouse-click collapse toggles for tool header lines.
	 * @returns true if the click was consumed by this panel
	 */
	handleClick(event: TMouseEvent): boolean {
		if (event.type !== "mousedown" || event.button !== 0) return false;

		const rect = this.lastRect;
		if (event.x < rect.x || event.x >= rect.x + rect.width || event.y < rect.y || event.y >= rect.y + rect.height) {
			return false;
		}

		const lineIdx = this.scrollOffset + (event.y - rect.y);
		const toolId = this.toolBlockLineMap.get(lineIdx);
		if (!toolId) return false;

		this.state.toggleToolCollapse(toolId);
		return true;
	}

	/** Handle Enter on focused line to toggle tool collapse when applicable. */
	handleEnter(focusedScreenRow: number): boolean {
		const lineIdx = this.scrollOffset + focusedScreenRow;
		const toolId = this.toolBlockLineMap.get(lineIdx);
		if (!toolId) return false;

		this.state.toggleToolCollapse(toolId);
		return true;
	}

	/** Test helper: get tool id at rendered line index. */
	getToolIdAtLine(lineIdx: number): string | undefined {
		return this.toolBlockLineMap.get(lineIdx);
	}

	/** Test helper: get rendered line count. */
	getRenderedLineCount(): number {
		return this.renderedLines.length;
	}

	/** Test helper: get rendered line by index. */
	getRenderedLine(idx: number): RenderedLine | undefined {
		return this.renderedLines[idx];
	}

	/**
	 * Build lines without painting to screen; useful for tests.
	 */
	buildLines(width: number): RenderedLine[] {
		this.renderedLines = [];
		this.toolBlockLineMap = new Map();

		const messages = this.state.messages.value;
		const resultMap = buildToolResultMap(messages);
		const pairedResultIds = buildPairedResultIds(messages, resultMap);

		for (const msg of messages) {
			this.renderMessage(msg, width, resultMap, pairedResultIds);
		}
		return this.renderedLines;
	}

	render(screen: Screen, rect: Rect): void {
		this.lastRect = { ...rect };
		const width = rect.width - 2;

		this.renderedLines = [];
		this.toolBlockLineMap = new Map();

		const messages = this.state.messages.value;
		const resultMap = buildToolResultMap(messages);
		const pairedResultIds = buildPairedResultIds(messages, resultMap);
		for (const msg of messages) {
			this.renderMessage(msg, width, resultMap, pairedResultIds);
		}

		if (this.state.isStreaming.value && this.state.streamingText.value) {
			this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
			for (const line of wrapText(this.state.streamingText.value, width)) {
				this.renderedLines.push({ text: line, fg: 12, bold: false, dim: false });
			}
		}

		const maxScroll = Math.max(0, this.renderedLines.length - rect.height);
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const startLine = this.scrollOffset;
		for (let i = 0; i < rect.height; i++) {
			const lineIdx = startLine + i;
			if (lineIdx >= this.renderedLines.length) break;

			const line = this.renderedLines[lineIdx];
			if (line.segments && line.segments.length > 0) {
				let col = rect.x + 1;
				for (const seg of line.segments) {
					if (col >= rect.x + rect.width) break;
					const maxChars = rect.x + rect.width - col;
					const text = seg.text.length > maxChars ? seg.text.slice(0, maxChars) : seg.text;
					screen.writeText(rect.y + i, col, text, {
						fg: seg.fg,
						bg: seg.bg,
						bold: seg.bold,
						dim: seg.dim,
						italic: seg.italic,
						underline: seg.underline,
					});
					col += measureText(text);
				}
			} else {
				screen.writeText(rect.y + i, rect.x + 1, line.text, {
					fg: line.fg,
					bold: line.bold,
					dim: line.dim,
				});
			}
		}
	}

	private renderMessage(
		message: Message,
		width: number,
		resultMap: Map<string, ToolResultBlock>,
		pairedResultIds: Set<string>,
	): void {
		if (message.role === "user") {
			this.renderedLines.push({ text: "You:", fg: 14, bold: true, dim: false });
		} else {
			this.renderedLines.push({ text: "Takumi:", fg: 12, bold: true, dim: false });
		}

		for (const block of message.content) {
			if (block.type === "tool_use") {
				renderToolBlock(
					this.state,
					block,
					resultMap.get(block.id) ?? null,
					width,
					this.renderedLines,
					this.toolBlockLineMap,
				);
				continue;
			}
			if (block.type === "tool_result" && pairedResultIds.has(block.toolUseId)) {
				continue;
			}
			renderContentBlock(block, width, message.role, this.renderedLines);
		}

		this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
	}
}

export type { LineSegment, RenderedLine };
export { getToolArgSummary, truncateArg };
