/**
 * MessageListPanel — renders the scrollable list of conversation messages.
 * Assistant text blocks are parsed through the markdown renderer for rich
 * formatting (headings, bold, italic, code blocks with syntax highlighting).
 */

import type { Rect, Message, ContentBlock } from "@takumi/core";
import { Component } from "@takumi/render";
import type { Screen } from "@takumi/render";
import { wrapText, measureText, getTheme, hexToRgb } from "@takumi/render";
import { tokenizeLine, LANGUAGE_MAP } from "@takumi/render";
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

	private renderMessage(message: Message, width: number): void {
		// Role header
		if (message.role === "user") {
			this.renderedLines.push({ text: "You:", fg: 14, bold: true, dim: false });
		} else {
			this.renderedLines.push({ text: "Takumi:", fg: 12, bold: true, dim: false });
		}

		// Content blocks
		for (const block of message.content) {
			this.renderContentBlock(block, width, message.role);
		}

		// Blank line between messages
		this.renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
	}

	private renderContentBlock(
		block: ContentBlock,
		width: number,
		role: "user" | "assistant",
	): void {
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
				const fgColor = block.isError ? 1 : 2;
				const lines = wrapText(prefix + block.content, width);
				for (const line of lines) {
					this.renderedLines.push({ text: line, fg: fgColor, bold: false, dim: false });
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
				const sep = "─".repeat(Math.min(40, width));
				this.renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
				for (const codeLine of codeBlockLines) {
					this.pushSyntaxHighlightedLine(codeLine, codeBlockLang, theme, width);
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
				const sep = "─".repeat(Math.min(40, width));
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
				const headingSegments: LineSegment[] = segments.map(s => ({
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
					{ text: "│ ", fg: qfg, bg: -1, bold: false, dim: true, italic: false, underline: false },
					...contentSegments.map(s => ({ ...s, italic: true })),
				];
				this.renderedLines.push({
					text: `│ ${content}`,
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
					{ text: `${indent}• `, fg: 8, bg: -1, bold: false, dim: true, italic: false, underline: false },
					...contentSegments,
				];
				this.renderedLines.push({
					text: `${indent}• ${content}`,
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
				segments: [{
					text: `  ${codeLine}`,
					fg: fg256,
					bg: -1,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
				}],
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
	 * Parse inline markdown (bold, italic, code spans, links) into segments.
	 */
	private parseInlineMarkdown(
		text: string,
		theme: ReturnType<typeof getTheme>,
	): LineSegment[] {
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
			const nextSpecial = remaining.search(/[`*\[]/);
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

/** Convert RGB (0-255) to a 256-color palette index. */
function rgbTo256(r: number, g: number, b: number): number {
	return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
}

interface LineSegment {
	text: string;
	fg: number;
	bg: number;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
}

interface RenderedLine {
	text: string;
	fg: number;
	bold: boolean;
	dim: boolean;
	/** When set, render using per-segment styles instead of uniform line style. */
	segments?: LineSegment[];
}
