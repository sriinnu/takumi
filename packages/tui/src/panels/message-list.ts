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
import { formatInlineRouteSurface, formatInlineSyncSurface, getLatestRouteSummary } from "../operator-authority.js";
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

/** Cached rendered output for a single message. */
interface MessageRenderCache {
	lines: RenderedLine[];
	/** Tool block line mappings — offsets relative to message start. */
	toolMap: Array<[number, string]>;
	/** Width at time of render. */
	width: number;
	/** Whether this was rendered as "latest assistant" (with telemetry). */
	isLatest: boolean;
}

export class MessageListPanel extends Component {
	private readonly state: AppState;
	private scrollOffset = 0;
	private renderedLines: RenderedLine[] = [];
	private disposeEffect: (() => void) | null = null;

	/** Maps rendered line indices to tool_use IDs for click/enter toggles. */
	private toolBlockLineMap: Map<number, string> = new Map();

	/** Per-message render cache — avoids re-wrapping unchanged messages. */
	private messageCache = new WeakMap<Message, MessageRenderCache>();

	/** Last rendered rect for hit-testing. */
	private lastRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor(props: MessageListPanelProps) {
		super();
		this.state = props.state;

		this.disposeEffect = effect(() => {
			void this.state.messages.value;
			void this.state.streamingText.value;
			void this.state.collapsedTools.value;
			void this.state.routingDecisions.value;
			void this.state.chitraguptaSync.value;
			void this.state.canonicalSessionId.value;
			void this.state.provider.value;
			void this.state.model.value;
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
		const latestAssistantIndex = findLatestAssistantMessageIndex(messages);

		for (const [index, msg] of messages.entries()) {
			this.renderMessage(msg, width, resultMap, pairedResultIds, index === latestAssistantIndex);
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
		const latestAssistantIndex = findLatestAssistantMessageIndex(messages);
		for (const [index, msg] of messages.entries()) {
			const isLatest = index === latestAssistantIndex;
			const cached = this.messageCache.get(msg);

			if (cached && cached.width === width && cached.isLatest === isLatest) {
				// Cache hit — splice in cached lines and tool mappings
				const baseIdx = this.renderedLines.length;
				for (const line of cached.lines) this.renderedLines.push(line);
				for (const [offset, toolId] of cached.toolMap) {
					this.toolBlockLineMap.set(baseIdx + offset, toolId);
				}
			} else {
				// Cache miss — render and store
				const startIdx = this.renderedLines.length;
				const toolMapBefore = new Map(this.toolBlockLineMap);
				this.renderMessage(msg, width, resultMap, pairedResultIds, isLatest);

				// Extract lines and tool mappings produced by this message
				const lines = this.renderedLines.slice(startIdx);
				const toolMap: Array<[number, string]> = [];
				for (const [lineIdx, toolId] of this.toolBlockLineMap) {
					if (!toolMapBefore.has(lineIdx)) {
						toolMap.push([lineIdx - startIdx, toolId]);
					}
				}
				this.messageCache.set(msg, { lines, toolMap, width, isLatest });
			}
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
		showLatestTelemetry: boolean,
	): void {
		if (message.role === "user") {
			this.renderedLines.push(buildUserHeaderLine());
		} else {
			this.renderedLines.push(buildAssistantHeaderLine(this.state, message, showLatestTelemetry));
			if (showLatestTelemetry) {
				const routeLine = formatInlineRouteSurface(this.state);
				if (routeLine) {
					this.renderedLines.push(routeLine);
				}
				const syncLine = formatInlineSyncSurface(this.state);
				if (syncLine) {
					this.renderedLines.push(syncLine);
				}
			}
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

function buildUserHeaderLine(): RenderedLine {
	return buildHeaderLine({
		icon: "●",
		label: "You",
		fg: 14,
		badges: [{ label: "request", fg: 14, bg: 236, bold: true }],
	});
}

function buildAssistantHeaderLine(state: AppState, message: Message, showLatestTelemetry: boolean): RenderedLine {
	const badges: HeaderBadge[] = [];
	if (showLatestTelemetry) {
		const route = getLatestRouteSummary(state);
		badges.push({ label: state.provider.value || "provider", fg: 15, bg: 24, bold: true });
		badges.push({ label: compactModelLabel(state.model.value), fg: 15, bg: 238, bold: true });
		if (route) {
			badges.push({
				label: `${route.icon} ${route.authority === "engine" ? "engine" : "fallback"}`,
				fg: route.degraded ? 15 : route.fg,
				bg: route.degraded ? 52 : route.authority === "engine" ? 22 : 58,
				bold: true,
			});
			if (route.degraded) {
				badges.push({ label: "degraded", fg: 15, bg: 52, bold: true });
			}
		}
	}
	badges.push({ label: formatUsageSummary(message), fg: 8, bg: 236, bold: false, dim: true });

	return buildHeaderLine({
		icon: "◆",
		label: "Takumi",
		fg: 12,
		badges,
	});
}

interface HeaderBadge {
	label: string;
	fg: number;
	bg: number;
	bold?: boolean;
	dim?: boolean;
}

function buildHeaderLine(input: { icon: string; label: string; fg: number; badges: HeaderBadge[] }): RenderedLine {
	const segments: LineSegment[] = [
		{ text: `${input.icon} `, fg: input.fg, bg: -1, bold: true, dim: false, italic: false, underline: false },
		{ text: input.label, fg: input.fg, bg: -1, bold: true, dim: false, italic: false, underline: false },
	];
	const textParts = [`${input.icon} ${input.label}`];
	for (const badge of input.badges) {
		const badgeText = `[${badge.label}]`;
		textParts.push(badgeText);
		segments.push({ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false });
		segments.push({
			text: badgeText,
			fg: badge.fg,
			bg: badge.bg,
			bold: badge.bold ?? true,
			dim: badge.dim ?? false,
			italic: false,
			underline: false,
		});
	}
	return {
		text: textParts.join("  "),
		fg: input.fg,
		bold: true,
		dim: false,
		segments,
	};
}

function formatUsageSummary(message: Message): string {
	if (!message.usage) return "response";
	return `${message.usage.inputTokens} in • ${message.usage.outputTokens} out`;
}

function compactModelLabel(model: string): string {
	return truncateInlineLabel(model, 28);
}

function truncateInlineLabel(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars - 1)}…`;
}

function findLatestAssistantMessageIndex(messages: Message[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "assistant") return index;
	}
	return -1;
}

export type { LineSegment, RenderedLine };
export { getToolArgSummary, truncateArg };
