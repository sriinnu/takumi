/**
 * Markdown and diff rendering helpers for the message list panel.
 */

import type { ContentBlock } from "@takumi/core";
import { getTheme, hexToRgb, isDiffContent, LANGUAGE_MAP, parseDiff, tokenizeLine, wrapText } from "@takumi/render";
import type { LineSegment, RenderedLine } from "./message-list-types.js";
import { rgbTo256 } from "./message-list-types.js";

/** Max chars to display for thinking blocks even when expanded. */
const THINKING_CHAR_CAP = 500;

/**
 * Render a non-tool content block into message-list lines.
 *
 * @param showThinking When false, thinking blocks render as a single collapsed
 *   summary line. When true, the text is still capped at {@link THINKING_CHAR_CAP}
 *   characters to prevent full-screen flooding.
 */
export function renderContentBlock(
	block: ContentBlock,
	width: number,
	role: "user" | "assistant",
	renderedLines: RenderedLine[],
	showThinking = false,
): void {
	switch (block.type) {
		case "text": {
			if (role === "assistant") {
				renderMarkdownBlock(block.text, width, renderedLines);
			} else {
				for (const line of wrapText(block.text, width)) {
					renderedLines.push({ text: line, fg: -1, bold: false, dim: false });
				}
			}
			break;
		}
		case "thinking": {
			const charCount = block.thinking.length;
			if (!showThinking) {
				// Collapsed — single summary line
				renderedLines.push({ text: `[thinking] (${charCount} chars, collapsed)`, fg: 8, bold: false, dim: true });
			} else {
				// Expanded but capped to prevent screen flooding
				renderedLines.push({ text: "[thinking]", fg: 8, bold: false, dim: true });
				const trimmed = charCount > THINKING_CHAR_CAP ? `${block.thinking.slice(-THINKING_CHAR_CAP)}…` : block.thinking;
				for (const line of wrapText(trimmed, width)) {
					renderedLines.push({ text: line, fg: 8, bold: false, dim: true });
				}
			}
			break;
		}
		case "tool_use": {
			renderedLines.push({ text: `[tool: ${block.name}]`, fg: 3, bold: true, dim: false });
			break;
		}
		case "tool_result": {
			if (!block.isError && isDiffContent(block.content)) {
				pushDiffLines(block.content.split("\n"), renderedLines);
			} else {
				const prefix = block.isError ? "[error] " : "[result] ";
				const fgColor = block.isError ? 1 : 2;
				for (const line of wrapText(prefix + block.content, width)) {
					renderedLines.push({ text: line, fg: fgColor, bold: false, dim: false });
				}
			}
			break;
		}
	}
}

/** Parse markdown text into styled RenderedLine entries. */
export function renderMarkdownBlock(text: string, width: number, renderedLines: RenderedLine[]): void {
	const theme = getTheme();
	const rawLines = text.split("\n");
	let inCodeBlock = false;
	let codeBlockLang = "";
	let codeBlockLines: string[] = [];

	for (const rawLine of rawLines) {
		if (rawLine.startsWith("```")) {
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeBlockLang = rawLine.slice(3).trim();
				codeBlockLines = [];
				continue;
			}

			inCodeBlock = false;
			const sep = "\u2500".repeat(Math.min(40, width));
			renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
			if (codeBlockLang === "diff" || (codeBlockLang === "" && isDiffContent(codeBlockLines.join("\n")))) {
				pushDiffLines(codeBlockLines, renderedLines);
			} else {
				for (const codeLine of codeBlockLines) {
					pushSyntaxHighlightedLine(codeLine, codeBlockLang, renderedLines);
				}
			}
			renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
			codeBlockLang = "";
			codeBlockLines = [];
			continue;
		}

		if (inCodeBlock) {
			codeBlockLines.push(rawLine);
			continue;
		}

		if (/^(?:---+|===+|\*\*\*+|___+)\s*$/.test(rawLine)) {
			const sep = "\u2500".repeat(Math.min(40, width));
			renderedLines.push({ text: sep, fg: 8, bold: false, dim: true });
			continue;
		}

		const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const headingText = headingMatch[2];
			const [hr, hg, hb] = hexToRgb(theme.primary);
			const fg256 = rgbTo256(hr, hg, hb);
			const segments = parseInlineMarkdown(headingText, theme).map((s) => ({
				...s,
				fg: fg256,
				bold: level <= 2,
				dim: level > 2,
			}));
			renderedLines.push({ text: headingText, fg: fg256, bold: level <= 2, dim: level > 2, segments });
			continue;
		}

		if (rawLine.startsWith("> ")) {
			const content = rawLine.slice(2);
			const [qr, qg, qb] = hexToRgb(theme.muted);
			const qfg = rgbTo256(qr, qg, qb);
			const segments: LineSegment[] = [
				{ text: "\u2502 ", fg: qfg, bg: -1, bold: false, dim: true, italic: false, underline: false },
				...parseInlineMarkdown(content, theme).map((s) => ({ ...s, italic: true })),
			];
			renderedLines.push({ text: `\u2502 ${content}`, fg: qfg, bold: false, dim: false, segments });
			continue;
		}

		const ulMatch = rawLine.match(/^(\s*)[*\-+]\s+(.*)/);
		if (ulMatch) {
			const indent = ulMatch[1];
			const content = ulMatch[2];
			const segments: LineSegment[] = [
				{ text: `${indent}\u2022 `, fg: 8, bg: -1, bold: false, dim: true, italic: false, underline: false },
				...parseInlineMarkdown(content, theme),
			];
			renderedLines.push({ text: `${indent}\u2022 ${content}`, fg: -1, bold: false, dim: false, segments });
			continue;
		}

		const olMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.*)/);
		if (olMatch) {
			const indent = olMatch[1];
			const num = olMatch[2];
			const content = olMatch[3];
			const segments: LineSegment[] = [
				{ text: `${indent}${num}. `, fg: 8, bg: -1, bold: false, dim: true, italic: false, underline: false },
				...parseInlineMarkdown(content, theme),
			];
			renderedLines.push({ text: `${indent}${num}. ${content}`, fg: -1, bold: false, dim: false, segments });
			continue;
		}

		if (rawLine.trim() === "") {
			renderedLines.push({ text: "", fg: -1, bold: false, dim: false });
			continue;
		}

		renderedLines.push({
			text: rawLine,
			fg: -1,
			bold: false,
			dim: false,
			segments: parseInlineMarkdown(rawLine, theme),
		});
	}
}

/** Push a syntax-highlighted code line as a segmented RenderedLine. */
function pushSyntaxHighlightedLine(codeLine: string, language: string, renderedLines: RenderedLine[]): void {
	const theme = getTheme();
	const rules = LANGUAGE_MAP[language.toLowerCase()];
	if (!rules) {
		const [cr, cg, cb] = hexToRgb(theme.syntaxString);
		const fg256 = rgbTo256(cr, cg, cb);
		renderedLines.push({
			text: `  ${codeLine}`,
			fg: fg256,
			bold: false,
			dim: false,
			segments: [
				{ text: `  ${codeLine}`, fg: fg256, bg: -1, bold: false, dim: false, italic: false, underline: false },
			],
		});
		return;
	}

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
		{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
	];
	for (const token of tokenizeLine(codeLine, rules)) {
		const [r, g, b] = hexToRgb(colorMap[token.type] ?? theme.foreground);
		segments.push({
			text: token.text,
			fg: rgbTo256(r, g, b),
			bg: -1,
			bold: token.type === "keyword",
			dim: false,
			italic: token.type === "comment",
			underline: false,
		});
	}

	renderedLines.push({ text: `  ${codeLine}`, fg: -1, bold: false, dim: false, segments });
}

/** Render diff-formatted lines with color-coded additions/deletions/context. */
function pushDiffLines(lines: string[], renderedLines: RenderedLine[]): void {
	const theme = getTheme();
	const files = parseDiff(lines.join("\n"));
	const [ar, ag, ab] = hexToRgb(theme.diffAdd);
	const addFg = rgbTo256(ar, ag, ab);
	const [rr, rg, rb] = hexToRgb(theme.diffRemove);
	const removeFg = rgbTo256(rr, rg, rb);
	const [hr, hg, hb] = hexToRgb(theme.diffHunkHeader);
	const hunkFg = rgbTo256(hr, hg, hb);
	const [mr, mg, mb] = hexToRgb(theme.muted);
	const mutedFg = rgbTo256(mr, mg, mb);

	if (files.length === 0) {
		for (const line of lines) {
			if (line.startsWith("+") && !line.startsWith("+++"))
				renderedLines.push({ text: `  ${line}`, fg: addFg, bold: false, dim: false });
			else if (line.startsWith("-") && !line.startsWith("---"))
				renderedLines.push({ text: `  ${line}`, fg: removeFg, bold: false, dim: false });
			else if (line.startsWith("@@")) renderedLines.push({ text: `  ${line}`, fg: hunkFg, bold: false, dim: true });
			else renderedLines.push({ text: `  ${line}`, fg: mutedFg, bold: false, dim: false });
		}
		return;
	}

	for (const file of files) {
		const filePath = file.newPath !== "/dev/null" ? file.newPath : file.oldPath;
		renderedLines.push({ text: `  ${filePath}`, fg: -1, bold: true, dim: false });
		for (const hunk of file.hunks) {
			renderedLines.push({ text: `  ${hunk.header}`, fg: hunkFg, bold: false, dim: true });
			for (const diffLine of hunk.lines) {
				switch (diffLine.type) {
					case "add":
						renderedLines.push({
							text: `  +${diffLine.content}`,
							fg: addFg,
							bold: false,
							dim: false,
							segments: [
								{ text: "  ", fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false },
								{ text: "+", fg: addFg, bg: -1, bold: false, dim: false, italic: false, underline: false },
								{ text: diffLine.content, fg: addFg, bg: 22, bold: false, dim: false, italic: false, underline: false },
							],
						});
						break;
					case "remove":
						renderedLines.push({
							text: `  -${diffLine.content}`,
							fg: removeFg,
							bold: false,
							dim: false,
							segments: [
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
							],
						});
						break;
					case "context":
						renderedLines.push({ text: `   ${diffLine.content}`, fg: -1, bold: false, dim: false });
						break;
					case "header":
						renderedLines.push({ text: `  ${diffLine.content}`, fg: mutedFg, bold: false, dim: true });
						break;
				}
			}
		}
	}
}

/** Parse inline markdown (bold, italic, code spans, links) into segments. */
function parseInlineMarkdown(text: string, theme: ReturnType<typeof getTheme>): LineSegment[] {
	const segments: LineSegment[] = [];
	let remaining = text;

	while (remaining.length > 0) {
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
		const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
		if (boldMatch) {
			segments.push({ text: boldMatch[1], fg: -1, bg: -1, bold: true, dim: false, italic: false, underline: false });
			remaining = remaining.slice(boldMatch[0].length);
			continue;
		}
		const italicMatch = remaining.match(/^\*([^*]+)\*/);
		if (italicMatch) {
			segments.push({ text: italicMatch[1], fg: -1, bg: -1, bold: false, dim: false, italic: true, underline: false });
			remaining = remaining.slice(italicMatch[0].length);
			continue;
		}
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
		const nextSpecial = remaining.search(/[`*[]/);
		if (nextSpecial === -1) {
			segments.push({ text: remaining, fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false });
			break;
		}
		if (nextSpecial === 0) {
			segments.push({ text: remaining[0], fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false });
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
