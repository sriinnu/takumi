/**
 * MessageListPanel — renders the scrollable list of conversation messages.
 * Assistant text blocks are parsed through the markdown renderer for rich
 * formatting (headings, bold, italic, code blocks with syntax highlighting).
 *
 * Tool call blocks (tool_use + tool_result) are rendered as collapsible units
 * with compact one-line summaries when collapsed and full detail when expanded.
 */

import type {
	ContentBlock,
	Message,
	Rect,
	MouseEvent as TMouseEvent,
	ToolResultBlock,
	ToolUseBlock,
} from "@takumi/core";
import type { Screen } from "@takumi/render";
import {
	Component,
	effect,
	getTheme,
	hexToRgb,
	isDiffContent,
	LANGUAGE_MAP,
	measureText,
	parseDiff,
	tokenizeLine,
	wrapText,
} from "@takumi/render";
import type { AppState } from "../state.js";

/** Maximum lines of tool result content shown in expanded view. */
const MAX_EXPANDED_RESULT_LINES = 30;

export interface MessageListPanelProps {
	state: AppState;
}

export class MessageListPanel extends Component {
	private state: AppState;
	private scrollOffset = 0;
	private renderedLines: RenderedLine[] = [];
	private disposeEffect: (() => void) | null = null;

	/**
	 * Maps rendered line indices to tool_use IDs.
	 * Used for click/key-based collapse toggling.
	 */
	private toolBlockLineMap: Map<number, string> = new Map();

	/** Last rendered rect for hit-testing. */
	private lastRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor(props: MessageListPanelProps) {
		super();
		this.state = props.state;

		// Re-render when messages or collapse state change
		this.disposeEffect = effect(() => {
			const _msgs = this.state.messages.value;
			const _streaming = this.state.streamingText.value;
			const _collapsed = this.state.collapsedTools.value;
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

	/**
	 * Handle a mouse click event. If the click lands on a tool block header
	 * line, toggle its collapsed state.
	 * @returns true if the click was handled
	 */
	handleClick(event: TMouseEvent): boolean {
		if (event.type !== "mousedown" || event.button !== 0) return false;

		const rect = this.lastRect;
		// Check if click is within our bounds
		if (event.x < rect.x || event.x >= rect.x + rect.width || event.y < rect.y || event.y >= rect.y + rect.height) {
			return false;
		}

		// Convert screen Y to rendered line index
		const lineIdx = this.scrollOffset + (event.y - rect.y);
		const toolId = this.toolBlockLineMap.get(lineIdx);
		if (toolId) {
			this.state.toggleToolCollapse(toolId);
			return true;
		}
		return false;
	}

	/**
	 * Handle Enter key on the currently focused line.
	 * If the focused line is a tool block header, toggle collapse.
	 * @param focusedScreenRow The screen row that has focus (relative to rect)
	 * @returns true if the key was handled
	 */
	handleEnter(focusedScreenRow: number): boolean {
		const lineIdx = this.scrollOffset + focusedScreenRow;
		const toolId = this.toolBlockLineMap.get(lineIdx);
		if (toolId) {
			this.state.toggleToolCollapse(toolId);
			return true;
		}
		return false;
	}

	/**
	 * Get the tool ID at a specific rendered line index (for testing).
	 */
	getToolIdAtLine(lineIdx: number): string | undefined {
		return this.toolBlockLineMap.get(lineIdx);
	}

	/**
	 * Get the total number of rendered lines (for testing).
	 */
	getRenderedLineCount(): number {
		return this.renderedLines.length;
	}

	/**
	 * Get a rendered line by index (for testing).
	 */
	getRenderedLine(idx: number): RenderedLine | undefined {
		return this.renderedLines[idx];
	}

	/**
	 * Build the rendered lines without actually painting to screen.
	 * Useful for testing the layout logic.
	 */
	buildLines(width: number): RenderedLine[] {
		this.renderedLines = [];
		this.toolBlockLineMap = new Map();
		const messages = this.state.messages.value;
		const resultMap = this.buildToolResultMap(messages);
		const pairedResultIds = this.buildPairedResultIds(messages, resultMap);
		for (const msg of messages) {
			this.renderMessage(msg, width, messages, resultMap, pairedResultIds);
		}
		return this.renderedLines;
	}

	render(screen: Screen, rect: Rect): void {
		this.lastRect = { ...rect };
		const messages = this.state.messages.value;
		const width = rect.width - 2; // padding

		// Flatten messages into rendered lines
		this.renderedLines = [];
		this.toolBlockLineMap = new Map();
		const resultMap = this.buildToolResultMap(messages);
		const pairedResultIds = this.buildPairedResultIds(messages, resultMap);
		for (const msg of messages) {
			this.renderMessage(msg, width, messages, resultMap, pairedResultIds);
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
			if (line.segments && line.segments.length > 0) {
				// Rich rendering: multiple styled segments per line
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
				// Simple rendering: uniform style for the whole line
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
		_allMessages: Message[],
		resultMap: Map<string, ToolResultBlock>,
		pairedResultIds: Set<string>,
	): void {
		// Role header
		if (message.role === "user") {
			this.renderedLines.push({ text: "You:", fg: 14, bold: true, dim: false });
		} else {
			this.renderedLines.push({ text: "Takumi:", fg: 12, bold: true, dim: false });
		}

		// Content blocks
		for (const block of message.content) {
			if (block.type === "tool_use") {
				const result = resultMap.get(block.id);
				this.renderToolBlock(block, result ?? null, width);
			} else if (block.type === "tool_result") {
				// Skip if already rendered as part of a tool_use pair
				if (pairedResultIds.has(block.toolUseId)) {
					continue;
				}
				// Orphan tool_result (no matching tool_use) — render standalone
				this.renderContentBlock(block, width, message.role);
			} else {
				this.renderContentBlock(block, width, message.role);
			}
		}

		// Blank line between messages
		this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
	}

	/**
	 * Build a map from tool_use ID to its matching ToolResultBlock
	 * across all messages in the conversation.
	 */
	private buildToolResultMap(allMessages: Message[]): Map<string, ToolResultBlock> {
		const map = new Map<string, ToolResultBlock>();
		for (const msg of allMessages) {
			for (const block of msg.content) {
				if (block.type === "tool_result") {
					map.set(block.toolUseId, block);
				}
			}
		}
		return map;
	}

	/**
	 * Build a set of tool_use IDs that have both a tool_use and a matching tool_result.
	 * Tool_result blocks with these IDs should be skipped (they are rendered
	 * as part of the collapsible tool block on the tool_use side).
	 */
	private buildPairedResultIds(allMessages: Message[], resultMap: Map<string, ToolResultBlock>): Set<string> {
		const paired = new Set<string>();
		for (const msg of allMessages) {
			for (const block of msg.content) {
				if (block.type === "tool_use" && resultMap.has(block.id)) {
					paired.add(block.id);
				}
			}
		}
		return paired;
	}

	/**
	 * Render a paired tool_use + tool_result as a collapsible block.
	 */
	private renderToolBlock(toolUse: ToolUseBlock, toolResult: ToolResultBlock | null, width: number): void {
		const theme = getTheme();
		const [pr, pg, pb] = hexToRgb(theme.primary);
		const primaryFg = rgbTo256(pr, pg, pb);
		const [sr, sg, sb] = hexToRgb(theme.success);
		const successFg = rgbTo256(sr, sg, sb);
		const [er, eg, eb] = hexToRgb(theme.error);
		const errorFg = rgbTo256(er, eg, eb);
		const [wr, wg, wb] = hexToRgb(theme.warning);
		const warningFg = rgbTo256(wr, wg, wb);
		const [mr, mg, mb] = hexToRgb(theme.muted);
		const mutedFg = rgbTo256(mr, mg, mb);

		const isRunning = toolResult === null;
		const isError = toolResult?.isError ?? false;

		// Determine if collapsed: running tools always expanded,
		// completed tools default to collapsed unless toggled open
		let collapsed: boolean;
		if (isRunning) {
			collapsed = false;
		} else {
			// Default: completed tools are collapsed unless user expanded them.
			// We store expanded tools in collapsedTools when they're collapsed.
			// Wait — the signal is called collapsedTools and stores IDs of collapsed tools.
			// Completed tools should default to collapsed, so if NOT in the set, they're collapsed by default.
			// Actually, let's think about this differently:
			// - The set tracks which tools the user has explicitly toggled.
			// - For completed tools: collapsed by default. If in set = user expanded it (not collapsed).
			// - Wait, that's inverted from the name "collapsedTools".
			//
			// The simplest approach: collapsedTools contains IDs that ARE collapsed.
			// For completed tools we auto-add them. For the toggle, we remove.
			// But that requires adding on completion which is complex.
			//
			// Better: isToolCollapsed returns true if in the set.
			// Default behavior for completed: collapsed = !isToolCollapsed (collapsed unless toggled)
			// No — let's just use the set directly. If the ID is NOT in the set,
			// completed tools are collapsed (default). If the ID IS in the set,
			// they've been toggled to expanded.
			// This means collapsedTools is actually "expandedTools" for completed.
			//
			// Let's rename the mental model: the set contains tools whose state has been toggled.
			// For completed tools: default is collapsed, so being in set = expanded.
			// toggleToolCollapse toggles presence in set, so clicking a collapsed completed
			// tool adds it to set (expanded), clicking again removes (collapsed again).
			// isToolCollapsed for completed = NOT in set.
			collapsed = !this.state.isToolCollapsed(toolUse.id);
		}

		// Get the primary argument value for the compact display
		const argSummary = getToolArgSummary(toolUse);

		// Header line index for click mapping
		const headerLineIdx = this.renderedLines.length;

		if (collapsed) {
			// ── Collapsed: single compact line ──
			const arrow = "\u25B6"; // ▶
			const statusChar = isError ? "\u2717" : "\u2713"; // ✗ or ✓
			const statusFg = isError ? errorFg : successFg;

			// Build: ▶ toolname  argSummary                    ✓
			const toolNamePart = toolUse.name;
			const argPart = argSummary ? truncateArg(argSummary, Math.max(10, width - toolNamePart.length - 10)) : "";

			const segments: LineSegment[] = [
				{ text: `${arrow} `, fg: mutedFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
				{ text: toolNamePart, fg: primaryFg, bg: -1, bold: true, dim: false, italic: false, underline: false },
				{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
				{ text: argPart, fg: mutedFg, bg: -1, bold: false, dim: true, italic: false, underline: false },
			];

			// Pad to push status indicator to the right
			const usedWidth = 2 + toolNamePart.length + 2 + argPart.length;
			const padLen = Math.max(1, width - usedWidth - 2);
			segments.push({
				text: " ".repeat(padLen),
				fg: -1,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
			});
			segments.push({
				text: statusChar,
				fg: statusFg,
				bg: -1,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
			});

			const lineText = `${arrow} ${toolNamePart}  ${argPart}${" ".repeat(padLen)}${statusChar}`;
			this.renderedLines.push({
				text: lineText,
				fg: mutedFg,
				bold: false,
				dim: false,
				segments,
			});
			this.toolBlockLineMap.set(headerLineIdx, toolUse.id);
		} else {
			// ── Expanded (or running) ──
			const arrow = isRunning ? "\u27F3" : "\u25BC"; // ⟳ or ▼
			const arrowFg = isRunning ? warningFg : mutedFg;

			// Header line
			const toolNamePart = toolUse.name;
			const argPart = argSummary ? truncateArg(argSummary, Math.max(10, width - toolNamePart.length - 10)) : "";

			const headerSegments: LineSegment[] = [
				{ text: `${arrow} `, fg: arrowFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
				{ text: toolNamePart, fg: primaryFg, bg: -1, bold: true, dim: false, italic: false, underline: false },
				{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
				{ text: argPart, fg: mutedFg, bg: -1, bold: false, dim: true, italic: false, underline: false },
			];

			// If completed, add status at end
			if (!isRunning) {
				const statusChar = isError ? "\u2717" : "\u2713";
				const statusFg = isError ? errorFg : successFg;
				const usedWidth = 2 + toolNamePart.length + 2 + argPart.length;
				const padLen = Math.max(1, width - usedWidth - 2);
				headerSegments.push({
					text: " ".repeat(padLen),
					fg: -1,
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				});
				headerSegments.push({
					text: statusChar,
					fg: statusFg,
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				});
			}

			this.renderedLines.push({
				text: `${arrow} ${toolNamePart}  ${argPart}`,
				fg: mutedFg,
				bold: false,
				dim: false,
				segments: headerSegments,
			});
			this.toolBlockLineMap.set(headerLineIdx, toolUse.id);

			if (isRunning) {
				// Running: show spinner message
				this.pushPrefixedLine("\u2502 Running...", warningFg, mutedFg);
			} else {
				// Show tool arguments
				const input = toolUse.input;
				const inputEntries = Object.entries(input);
				if (inputEntries.length > 0) {
					for (const [key, value] of inputEntries) {
						const strVal = typeof value === "string" ? value : JSON.stringify(value);
						const truncated = strVal.length > 60 ? `${strVal.slice(0, 57)}...` : strVal;
						this.pushPrefixedLine(`\u2502 ${key}: ${truncated}`, -1, mutedFg);
					}
				}

				// Separator
				const sep = "\u2500".repeat(Math.min(40, width - 4));
				this.pushPrefixedLine(`\u2502 ${sep}`, -1, mutedFg);

				// Show tool result content
				if (toolResult) {
					const content = toolResult.content;
					if (content) {
						// Check if the result content looks like a diff
						if (!isError && isDiffContent(content)) {
							const diffTheme = getTheme();
							const diffContentLines = content.split("\n");
							const showLines = Math.min(diffContentLines.length, MAX_EXPANDED_RESULT_LINES);
							const displayLines = diffContentLines.slice(0, showLines);
							// Render diff lines within the tool block (prefixed with bar)
							for (const dl of displayLines) {
								if (dl.startsWith("+") && !dl.startsWith("+++")) {
									const [dar, dag, dab] = hexToRgb(diffTheme.diffAdd);
									this.pushPrefixedLine(`\u2502 ${dl}`, rgbTo256(dar, dag, dab), mutedFg);
								} else if (dl.startsWith("-") && !dl.startsWith("---")) {
									const [drr, drg, drb] = hexToRgb(diffTheme.diffRemove);
									this.pushPrefixedLine(`\u2502 ${dl}`, rgbTo256(drr, drg, drb), mutedFg);
								} else if (dl.startsWith("@@")) {
									const [dhr, dhg, dhb] = hexToRgb(diffTheme.diffHunkHeader);
									this.pushPrefixedLine(`\u2502 ${dl}`, rgbTo256(dhr, dhg, dhb), mutedFg);
								} else {
									this.pushPrefixedLine(`\u2502 ${dl}`, -1, mutedFg);
								}
							}
							if (diffContentLines.length > MAX_EXPANDED_RESULT_LINES) {
								this.pushPrefixedLine(
									`\u2502 (showing ${showLines} of ${diffContentLines.length} lines)`,
									mutedFg,
									mutedFg,
								);
							}
						} else {
							const contentLines = content.split("\n");
							const totalLines = contentLines.length;
							const showLines = Math.min(totalLines, MAX_EXPANDED_RESULT_LINES);
							const contentFg = isError ? errorFg : -1;

							for (let i = 0; i < showLines; i++) {
								this.pushPrefixedLine(`\u2502 ${contentLines[i]}`, contentFg, mutedFg);
							}

							if (totalLines > MAX_EXPANDED_RESULT_LINES) {
								this.pushPrefixedLine(`\u2502 (showing ${showLines} of ${totalLines} lines)`, mutedFg, mutedFg);
							}
						}
					} else {
						this.pushPrefixedLine("\u2502 (empty result)", mutedFg, mutedFg);
					}
				}
			}
		}
	}

	/**
	 * Push a line with a vertical bar prefix (for expanded tool content).
	 */
	private pushPrefixedLine(text: string, contentFg: number, barFg: number): void {
		// The text already includes the "│ " prefix
		const barPart = text.slice(0, 2); // "│ "
		const contentPart = text.slice(2);

		const segments: LineSegment[] = [
			{ text: barPart, fg: barFg, bg: -1, bold: false, dim: true, italic: false, underline: false },
			{ text: contentPart, fg: contentFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
		];

		this.renderedLines.push({
			text,
			fg: contentFg,
			bold: false,
			dim: false,
			segments,
		});
	}

	private renderContentBlock(block: ContentBlock, width: number, role: "user" | "assistant"): void {
		switch (block.type) {
			case "text": {
				if (role === "assistant") {
					// Parse assistant text through the markdown renderer
					this.renderMarkdownBlock(block.text, width);
				} else {
					// User messages render as plain text
					const lines = wrapText(block.text, width);
					for (const line of lines) {
						this.renderedLines.push({ text: line, fg: -1, bold: false, dim: false });
					}
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
				// Standalone tool_use (should not normally reach here — handled in renderMessage)
				this.renderedLines.push({
					text: `[tool: ${block.name}]`,
					fg: 3,
					bold: true,
					dim: false,
				});
				break;
			}
			case "tool_result": {
				// Orphan tool_result (no matching tool_use found)
				// Check if tool result content looks like a diff
				if (!block.isError && isDiffContent(block.content)) {
					const diffTheme = getTheme();
					const diffContentLines = block.content.split("\n");
					this.pushDiffLines(diffContentLines, diffTheme, width);
				} else {
					const prefix = block.isError ? "[error] " : "[result] ";
					const fgColor = block.isError ? 1 : 2;
					const lines = wrapText(prefix + block.content, width);
					for (const line of lines) {
						this.renderedLines.push({ text: line, fg: fgColor, bold: false, dim: false });
					}
				}
				break;
			}
		}
	}

	/**
	 * Parse markdown text into styled RenderedLine entries.
	 * Handles: headings, bold, italic, code spans, code blocks (with syntax
	 * highlighting), lists (ordered/unordered), links, blockquotes, HR.
	 */
	private renderMarkdownBlock(text: string, width: number): void {
		const theme = getTheme();
		const rawLines = text.split("\n");
		let inCodeBlock = false;
		let codeBlockLang = "";
		let codeBlockLines: string[] = [];

		for (const rawLine of rawLines) {
			// Code block toggle
			if (rawLine.startsWith("```")) {
				if (!inCodeBlock) {
					inCodeBlock = true;
					codeBlockLang = rawLine.slice(3).trim();
					codeBlockLines = [];
					continue;
				}
				// End of code block — emit separator + highlighted lines + separator
				inCodeBlock = false;
				const sep = "\u2500".repeat(Math.min(40, width));
				this.renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
				if (codeBlockLang === "diff" || (codeBlockLang === "" && isDiffContent(codeBlockLines.join("\n")))) {
					this.pushDiffLines(codeBlockLines, theme, width);
				} else {
					for (const codeLine of codeBlockLines) {
						this.pushSyntaxHighlightedLine(codeLine, codeBlockLang, theme, width);
					}
				}
				this.renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
				codeBlockLang = "";
				codeBlockLines = [];
				continue;
			}

			if (inCodeBlock) {
				codeBlockLines.push(rawLine);
				continue;
			}

			// Horizontal rule
			if (/^(?:---+|===+|\*\*\*+|___+)\s*$/.test(rawLine)) {
				const sep = "\u2500".repeat(Math.min(40, width));
				this.renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
				continue;
			}

			// Heading
			const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)/);
			if (headingMatch) {
				const level = headingMatch[1].length;
				const headingText = headingMatch[2];
				const [hr, hg, hb] = hexToRgb(theme.primary);
				const fg256 = rgbTo256(hr, hg, hb);
				const segments = this.parseInlineMarkdown(headingText, theme);
				// Override heading segments with heading color + style
				const headingSegments: LineSegment[] = segments.map((s) => ({
					...s,
					fg: fg256,
					bold: level <= 2,
					dim: level > 2,
				}));
				this.renderedLines.push({
					text: headingText,
					fg: fg256,
					bold: level <= 2,
					dim: level > 2,
					segments: headingSegments,
				});
				continue;
			}

			// Blockquote
			if (rawLine.startsWith("> ")) {
				const content = rawLine.slice(2);
				const [qr, qg, qb] = hexToRgb(theme.muted);
				const qfg = rgbTo256(qr, qg, qb);
				const contentSegments = this.parseInlineMarkdown(content, theme);
				const segments: LineSegment[] = [
					{ text: "\u2502 ", fg: qfg, bg: -1, bold: false, dim: true, italic: false, underline: false },
					...contentSegments.map((s) => ({ ...s, italic: true })),
				];
				this.renderedLines.push({
					text: `\u2502 ${content}`,
					fg: qfg,
					bold: false,
					dim: false,
					segments,
				});
				continue;
			}

			// Unordered list
			const ulMatch = rawLine.match(/^(\s*)[*\-+]\s+(.*)/);
			if (ulMatch) {
				const indent = ulMatch[1];
				const content = ulMatch[2];
				const contentSegments = this.parseInlineMarkdown(content, theme);
				const segments: LineSegment[] = [
					{ text: `${indent}\u2022 `, fg: 8, bg: -1, bold: false, dim: true, italic: false, underline: false },
					...contentSegments,
				];
				this.renderedLines.push({
					text: `${indent}\u2022 ${content}`,
					fg: -1,
					bold: false,
					dim: false,
					segments,
				});
				continue;
			}

			// Ordered list
			const olMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.*)/);
			if (olMatch) {
				const indent = olMatch[1];
				const num = olMatch[2];
				const content = olMatch[3];
				const contentSegments = this.parseInlineMarkdown(content, theme);
				const segments: LineSegment[] = [
					{ text: `${indent}${num}. `, fg: 8, bg: -1, bold: false, dim: true, italic: false, underline: false },
					...contentSegments,
				];
				this.renderedLines.push({
					text: `${indent}${num}. ${content}`,
					fg: -1,
					bold: false,
					dim: false,
					segments,
				});
				continue;
			}

			// Empty line
			if (rawLine.trim() === "") {
				this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
				continue;
			}

			// Regular paragraph — parse inline markdown formatting
			const segments = this.parseInlineMarkdown(rawLine, theme);
			this.renderedLines.push({
				text: rawLine,
				fg: -1,
				bold: false,
				dim: false,
				segments,
			});
		}
	}

	/**
	 * Push a syntax-highlighted code line as a segmented RenderedLine.
	 */
	private pushSyntaxHighlightedLine(
		codeLine: string,
		language: string,
		theme: ReturnType<typeof getTheme>,
		_width: number,
	): void {
		const rules = LANGUAGE_MAP[language.toLowerCase()];
		if (!rules) {
			// No syntax rules — render as code-colored plain text
			const [cr, cg, cb] = hexToRgb(theme.syntaxString);
			const fg256 = rgbTo256(cr, cg, cb);
			this.renderedLines.push({
				text: `  ${codeLine}`,
				fg: fg256,
				bold: false,
				dim: false,
				segments: [
					{
						text: `  ${codeLine}`,
						fg: fg256,
						bg: -1,
						bold: false,
						dim: false,
						italic: false,
						underline: false,
					},
				],
			});
			return;
		}

		const tokens = tokenizeLine(codeLine, rules);
		const colorMap: Record<string, string> = {
			keyword: theme.syntaxKeyword,
			string: theme.syntaxString,
			number: theme.syntaxNumber,
			comment: theme.syntaxComment,
			function: theme.syntaxFunction,
			type: theme.syntaxType,
			operator: theme.syntaxOperator,
			punctuation: theme.syntaxPunctuation,
			preprocessor: theme.syntaxKeyword,
			annotation: theme.syntaxFunction,
			symbol: theme.syntaxString,
			regex: theme.syntaxString,
			heading: theme.syntaxKeyword,
			bold: theme.foreground,
			italic: theme.foreground,
			link: theme.syntaxFunction,
			plain: theme.foreground,
		};

		const segments: LineSegment[] = [
			// 2-space indent for code block content
			{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
		];

		for (const token of tokens) {
			const hex = colorMap[token.type] ?? theme.foreground;
			const [r, g, b] = hexToRgb(hex);
			const fg256 = rgbTo256(r, g, b);
			segments.push({
				text: token.text,
				fg: fg256,
				bg: -1,
				bold: token.type === "keyword",
				dim: false,
				italic: token.type === "comment",
				underline: false,
			});
		}

		this.renderedLines.push({
			text: `  ${codeLine}`,
			fg: -1,
			bold: false,
			dim: false,
			segments,
		});
	}

	/**
	 * Render diff-formatted lines with color-coded additions, deletions, and context.
	 * Uses parseDiff to parse the unified diff, then renders each line with appropriate colors.
	 */
	private pushDiffLines(lines: string[], theme: ReturnType<typeof getTheme>, _width: number): void {
		const diffText = lines.join("\n");
		const files = parseDiff(diffText);

		const [ar, ag, ab] = hexToRgb(theme.diffAdd);
		const addFg = rgbTo256(ar, ag, ab);
		const [rr, rg, rb] = hexToRgb(theme.diffRemove);
		const removeFg = rgbTo256(rr, rg, rb);
		const [hr, hg, hb] = hexToRgb(theme.diffHunkHeader);
		const hunkFg = rgbTo256(hr, hg, hb);
		const [mr, mg, mb] = hexToRgb(theme.muted);
		const mutedFg = rgbTo256(mr, mg, mb);

		if (files.length === 0) {
			// Could not parse as structured diff — render raw lines with basic coloring
			for (const line of lines) {
				if (line.startsWith("+") && !line.startsWith("+++")) {
					this.renderedLines.push({ text: `  ${line}`, fg: addFg, bold: false, dim: false });
				} else if (line.startsWith("-") && !line.startsWith("---")) {
					this.renderedLines.push({ text: `  ${line}`, fg: removeFg, bold: false, dim: false });
				} else if (line.startsWith("@@")) {
					this.renderedLines.push({ text: `  ${line}`, fg: hunkFg, bold: false, dim: true });
				} else {
					this.renderedLines.push({ text: `  ${line}`, fg: mutedFg, bold: false, dim: false });
				}
			}
			return;
		}

		for (const file of files) {
			// File header
			const filePath = file.newPath !== "/dev/null" ? file.newPath : file.oldPath;
			this.renderedLines.push({
				text: `  ${filePath}`,
				fg: -1,
				bold: true,
				dim: false,
			});

			for (const hunk of file.hunks) {
				// Hunk header
				this.renderedLines.push({
					text: `  ${hunk.header}`,
					fg: hunkFg,
					bold: false,
					dim: true,
				});

				// Diff lines
				for (const diffLine of hunk.lines) {
					switch (diffLine.type) {
						case "add": {
							const segments: LineSegment[] = [
								{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
								{ text: "+", fg: addFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
								{ text: diffLine.content, fg: addFg, bg: 22, bold: false, dim: false, italic: false, underline: false },
							];
							this.renderedLines.push({
								text: `  +${diffLine.content}`,
								fg: addFg,
								bold: false,
								dim: false,
								segments,
							});
							break;
						}
						case "remove": {
							const segments: LineSegment[] = [
								{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
								{ text: "-", fg: removeFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
								{
									text: diffLine.content,
									fg: removeFg,
									bg: 52,
									bold: false,
									dim: false,
									italic: false,
									underline: false,
								},
							];
							this.renderedLines.push({
								text: `  -${diffLine.content}`,
								fg: removeFg,
								bold: false,
								dim: false,
								segments,
							});
							break;
						}
						case "context": {
							this.renderedLines.push({
								text: `   ${diffLine.content}`,
								fg: -1,
								bold: false,
								dim: false,
							});
							break;
						}
						case "header": {
							this.renderedLines.push({
								text: `  ${diffLine.content}`,
								fg: mutedFg,
								bold: false,
								dim: true,
							});
							break;
						}
					}
				}
			}
		}
	}

	/**
	 * Parse inline markdown (bold, italic, code spans, links) into segments.
	 */
	private parseInlineMarkdown(text: string, theme: ReturnType<typeof getTheme>): LineSegment[] {
		const segments: LineSegment[] = [];
		let remaining = text;

		while (remaining.length > 0) {
			// Inline code `text`
			const codeMatch = remaining.match(/^`([^`]+)`/);
			if (codeMatch) {
				const [cr, cg, cb] = hexToRgb(theme.syntaxString);
				segments.push({
					text: codeMatch[1],
					fg: rgbTo256(cr, cg, cb),
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				});
				remaining = remaining.slice(codeMatch[0].length);
				continue;
			}

			// Bold **text**
			const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
			if (boldMatch) {
				segments.push({
					text: boldMatch[1],
					fg: -1,
					bg: -1,
					bold: true,
					dim: false,
					italic: false,
					underline: false,
				});
				remaining = remaining.slice(boldMatch[0].length);
				continue;
			}

			// Italic *text*
			const italicMatch = remaining.match(/^\*([^*]+)\*/);
			if (italicMatch) {
				segments.push({
					text: italicMatch[1],
					fg: -1,
					bg: -1,
					bold: false,
					dim: false,
					italic: true,
					underline: false,
				});
				remaining = remaining.slice(italicMatch[0].length);
				continue;
			}

			// Link [text](url)
			const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
			if (linkMatch) {
				const [lr, lg, lb] = hexToRgb(theme.info);
				segments.push({
					text: linkMatch[1],
					fg: rgbTo256(lr, lg, lb),
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: true,
				});
				remaining = remaining.slice(linkMatch[0].length);
				continue;
			}

			// Plain text — consume up to next special character
			const nextSpecial = remaining.search(/[`*[]/);
			if (nextSpecial === -1) {
				segments.push({
					text: remaining,
					fg: -1,
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				});
				break;
			}
			if (nextSpecial === 0) {
				// Special char doesn't match any pattern — consume literally
				segments.push({
					text: remaining[0],
					fg: -1,
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				});
				remaining = remaining.slice(1);
			} else {
				segments.push({
					text: remaining.slice(0, nextSpecial),
					fg: -1,
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				});
				remaining = remaining.slice(nextSpecial);
			}
		}

		return segments;
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert RGB (0-255) to a 256-color palette index. */
function rgbTo256(r: number, g: number, b: number): number {
	return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}

/**
 * Extract a compact argument summary from a tool_use block's input.
 * Returns the first string value (path, command, file_path, pattern, etc.)
 * or an empty string if nothing suitable is found.
 */
export function getToolArgSummary(toolUse: ToolUseBlock): string {
	const input = toolUse.input;
	// Prioritized keys for summary display
	const priorityKeys = ["file_path", "path", "command", "pattern", "query", "url", "glob", "old_string", "content"];
	for (const key of priorityKeys) {
		if (key in input && typeof input[key] === "string") {
			return input[key] as string;
		}
	}
	// Fall back to first string value
	for (const value of Object.values(input)) {
		if (typeof value === "string") return value;
	}
	return "";
}

/**
 * Truncate an argument string to fit within maxLen characters.
 */
export function truncateArg(arg: string, maxLen: number): string {
	// Replace newlines with spaces for compact display
	const clean = arg.replace(/\n/g, " ");
	if (clean.length <= maxLen) return clean;
	if (maxLen <= 3) return clean.slice(0, maxLen);
	return `${clean.slice(0, maxLen - 3)}...`;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LineSegment {
	text: string;
	fg: number;
	bg: number;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
}

export interface RenderedLine {
	text: string;
	fg: number;
	bold: boolean;
	dim: boolean;
	/** When set, render using per-segment styles instead of uniform line style. */
	segments?: LineSegment[];
}
