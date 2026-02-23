/**
 * Markdown renderer component.
 * Parses a subset of Markdown and renders it to styled terminal cells.
 * Supports: headings, bold, italic, code, code blocks, lists, links, blockquotes.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { measureText } from "../text.js";

interface StyledLine {
	segments: Array<{
		text: string;
		bold?: boolean;
		dim?: boolean;
		italic?: boolean;
		underline?: boolean;
		fg?: number;
		bg?: number;
	}>;
}

export interface MarkdownProps {
	key?: string;
	content: string;
	codeColor?: number;
	headingColor?: number;
	linkColor?: number;
	quoteColor?: number;
}

export class Markdown extends Component {
	private props: MarkdownProps;
	private lines: StyledLine[] = [];

	constructor(props: MarkdownProps) {
		super();
		this.props = props;
		this.key = props.key;
		this.parseContent();
	}

	update(content: string): void {
		this.props = { ...this.props, content };
		this.parseContent();
		this.markDirty();
	}

	private parseContent(): void {
		const codeColor = this.props.codeColor ?? 2;
		const headingColor = this.props.headingColor ?? 5;
		const linkColor = this.props.linkColor ?? 4;
		const quoteColor = this.props.quoteColor ?? 8;

		this.lines = [];
		const rawLines = this.props.content.split("\n");
		let inCodeBlock = false;

		for (const line of rawLines) {
			// Code block toggle
			if (line.startsWith("```")) {
				inCodeBlock = !inCodeBlock;
				if (inCodeBlock) {
					this.lines.push({ segments: [{ text: "─".repeat(40), fg: 8, dim: true }] });
				} else {
					this.lines.push({ segments: [{ text: "─".repeat(40), fg: 8, dim: true }] });
				}
				continue;
			}

			// Inside code block
			if (inCodeBlock) {
				this.lines.push({ segments: [{ text: `  ${line}`, fg: codeColor }] });
				continue;
			}

			// Headings
			const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
			if (headingMatch) {
				const level = headingMatch[1].length;
				const text = headingMatch[2];
				this.lines.push({
					segments: [{ text: `${"#".repeat(level)} ${text}`, bold: true, fg: headingColor }],
				});
				continue;
			}

			// Blockquotes
			if (line.startsWith("> ")) {
				this.lines.push({
					segments: [
						{ text: "│ ", fg: quoteColor, dim: true },
						{ text: line.slice(2), italic: true, fg: quoteColor },
					],
				});
				continue;
			}

			// Unordered list items
			const listMatch = line.match(/^(\s*)[*\-+]\s+(.*)/);
			if (listMatch) {
				const indent = listMatch[1];
				const text = listMatch[2];
				this.lines.push({
					segments: [{ text: `${indent}• `, fg: 8 }, ...this.parseInline(text, linkColor, codeColor)],
				});
				continue;
			}

			// Ordered list items
			const orderedMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
			if (orderedMatch) {
				const indent = orderedMatch[1];
				const text = orderedMatch[2];
				const num = line.match(/(\d+)/)?.[1] ?? "1";
				this.lines.push({
					segments: [{ text: `${indent}${num}. `, fg: 8 }, ...this.parseInline(text, linkColor, codeColor)],
				});
				continue;
			}

			// Empty line
			if (line.trim() === "") {
				this.lines.push({ segments: [{ text: "" }] });
				continue;
			}

			// Regular paragraph line — parse inline formatting
			this.lines.push({ segments: this.parseInline(line, linkColor, codeColor) });
		}
	}

	private parseInline(text: string, linkColor: number, codeColor: number): StyledLine["segments"] {
		const segments: StyledLine["segments"] = [];
		let remaining = text;

		while (remaining.length > 0) {
			// Inline code
			const codeMatch = remaining.match(/^`([^`]+)`/);
			if (codeMatch) {
				segments.push({ text: codeMatch[1], fg: codeColor });
				remaining = remaining.slice(codeMatch[0].length);
				continue;
			}

			// Bold
			const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
			if (boldMatch) {
				segments.push({ text: boldMatch[1], bold: true });
				remaining = remaining.slice(boldMatch[0].length);
				continue;
			}

			// Italic
			const italicMatch = remaining.match(/^\*([^*]+)\*/);
			if (italicMatch) {
				segments.push({ text: italicMatch[1], italic: true });
				remaining = remaining.slice(italicMatch[0].length);
				continue;
			}

			// Link [text](url)
			const linkMatch = remaining.match(/^\[([^\]]+)\]\([^)]+\)/);
			if (linkMatch) {
				segments.push({ text: linkMatch[1], fg: linkColor, underline: true });
				remaining = remaining.slice(linkMatch[0].length);
				continue;
			}

			// Plain text — consume up to the next special character
			const nextSpecial = remaining.search(/[`*[]/);
			if (nextSpecial === -1) {
				segments.push({ text: remaining });
				break;
			}
			if (nextSpecial === 0) {
				// Special char doesn't match any pattern, consume it literally
				segments.push({ text: remaining[0] });
				remaining = remaining.slice(1);
			} else {
				segments.push({ text: remaining.slice(0, nextSpecial) });
				remaining = remaining.slice(nextSpecial);
			}
		}

		return segments;
	}

	render(screen: Screen, rect: Rect): void {
		let row = rect.y;

		for (const line of this.lines) {
			if (row >= rect.y + rect.height) break;

			let col = rect.x;
			for (const seg of line.segments) {
				if (col >= rect.x + rect.width) break;
				const maxChars = rect.x + rect.width - col;
				const text = seg.text.slice(0, maxChars);
				screen.writeText(row, col, text, {
					fg: seg.fg ?? -1,
					bg: seg.bg ?? -1,
					bold: seg.bold ?? false,
					dim: seg.dim ?? false,
					italic: seg.italic ?? false,
					underline: seg.underline ?? false,
				});
				col += measureText(text);
			}
			row++;
		}
	}
}
