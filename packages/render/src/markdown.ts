/**
 * Markdown-to-ANSI renderer.
 * Converts Markdown text to styled terminal output for LLM responses.
 * Supports: headers, bold, italic, code spans, code blocks (syntax-highlighted),
 * lists (ordered/unordered), links, blockquotes, horizontal rules.
 */

import { bold, dim, fgRgb, italic, reset, underline } from "./ansi.js";
import { hexToRgb } from "./color.js";
import { LANGUAGE_MAP, tokenizeLine } from "./components/syntax.js";
import type { Theme } from "./theme.js";

/**
 * Render Markdown text to ANSI-styled terminal output.
 * Designed for rendering LLM responses in the terminal.
 */
export function renderMarkdown(text: string, theme: Theme): string {
	const lines = text.split("\n");
	const output: string[] = [];
	let inCodeBlock = false;
	let codeBlockLang = "";
	let codeBlockLines: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Code block toggle
		if (line.startsWith("```")) {
			if (!inCodeBlock) {
				inCodeBlock = true;
				codeBlockLang = line.slice(3).trim();
				codeBlockLines = [];
				continue;
			} else {
				// End of code block — render collected lines
				inCodeBlock = false;
				const separator = dim("─".repeat(40));
				output.push(separator);
				for (const codeLine of codeBlockLines) {
					const highlighted = highlightCodeLine(codeLine, codeBlockLang, theme);
					output.push(`  ${highlighted}${reset()}`);
				}
				output.push(separator);
				codeBlockLang = "";
				codeBlockLines = [];
				continue;
			}
		}

		if (inCodeBlock) {
			codeBlockLines.push(line);
			continue;
		}

		// Horizontal rule
		if (/^(?:---+|===+|\*\*\*+|___+)\s*$/.test(line)) {
			output.push(dim("─".repeat(40)));
			continue;
		}

		// Heading
		const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const text = headingMatch[2];
			const styledText = renderInline(text, theme);
			const [hr, hg, hb] = hexToRgb(theme.primary);
			if (level <= 2) {
				output.push(bold(fgRgb(hr, hg, hb) + styledText + reset()));
			} else {
				output.push(dim(fgRgb(hr, hg, hb) + styledText + reset()));
			}
			continue;
		}

		// Blockquote
		if (line.startsWith("> ")) {
			const [qr, qg, qb] = hexToRgb(theme.muted);
			const content = line.slice(2);
			const styledContent = renderInline(content, theme);
			output.push(`${dim(`${fgRgb(qr, qg, qb)}│`)} ${italic(styledContent)}${reset()}`);
			continue;
		}

		// Unordered list
		const ulMatch = line.match(/^(\s*)[*\-+]\s+(.*)/);
		if (ulMatch) {
			const indent = ulMatch[1];
			const content = ulMatch[2];
			const styledContent = renderInline(content, theme);
			output.push(`${indent}${dim("•")} ${styledContent}${reset()}`);
			continue;
		}

		// Ordered list
		const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
		if (olMatch) {
			const indent = olMatch[1];
			const num = olMatch[2];
			const content = olMatch[3];
			const styledContent = renderInline(content, theme);
			output.push(`${indent}${dim(`${num}.`)} ${styledContent}${reset()}`);
			continue;
		}

		// Empty line
		if (line.trim() === "") {
			output.push("");
			continue;
		}

		// Regular paragraph line
		output.push(renderInline(line, theme) + reset());
	}

	return output.join("\n");
}

/**
 * Render inline Markdown formatting to ANSI.
 * Handles: bold, italic, code spans, links.
 */
function renderInline(text: string, theme: Theme): string {
	let result = "";
	let remaining = text;

	while (remaining.length > 0) {
		// Inline code
		const codeMatch = remaining.match(/^`([^`]+)`/);
		if (codeMatch) {
			const [cr, cg, cb] = hexToRgb(theme.syntaxString);
			result += fgRgb(cr, cg, cb) + codeMatch[1] + reset();
			remaining = remaining.slice(codeMatch[0].length);
			continue;
		}

		// Bold **text**
		const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
		if (boldMatch) {
			result += bold(boldMatch[1]);
			remaining = remaining.slice(boldMatch[0].length);
			continue;
		}

		// Italic *text*
		const italicMatch = remaining.match(/^\*([^*]+)\*/);
		if (italicMatch) {
			result += italic(italicMatch[1]);
			remaining = remaining.slice(italicMatch[0].length);
			continue;
		}

		// Link [text](url)
		const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
		if (linkMatch) {
			const [lr, lg, lb] = hexToRgb(theme.info);
			result += underline(fgRgb(lr, lg, lb) + linkMatch[1]) + reset();
			remaining = remaining.slice(linkMatch[0].length);
			continue;
		}

		// Plain text — consume up to next special character
		const nextSpecial = remaining.search(/[`*[]/);
		if (nextSpecial === -1) {
			result += remaining;
			break;
		}
		if (nextSpecial === 0) {
			// Special char doesn't match any pattern — consume literally
			result += remaining[0];
			remaining = remaining.slice(1);
		} else {
			result += remaining.slice(0, nextSpecial);
			remaining = remaining.slice(nextSpecial);
		}
	}

	return result;
}

/**
 * Syntax-highlight a single line of code using the token-based highlighter.
 */
function highlightCodeLine(line: string, language: string, theme: Theme): string {
	const rules = LANGUAGE_MAP[language.toLowerCase()];
	if (!rules) {
		// No rules — return as-is with code color
		const [cr, cg, cb] = hexToRgb(theme.syntaxString);
		return fgRgb(cr, cg, cb) + line;
	}

	const tokens = tokenizeLine(line, rules);
	let result = "";

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

	for (const token of tokens) {
		const hex = colorMap[token.type] ?? theme.foreground;
		const [r, g, b] = hexToRgb(hex);
		result += fgRgb(r, g, b);
		if (token.type === "keyword") result += "\x1b[1m"; // bold
		if (token.type === "comment") result += "\x1b[3m"; // italic
		result += token.text;
		result += reset();
	}

	return result;
}
