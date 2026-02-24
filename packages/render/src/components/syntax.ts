/**
 * Syntax highlighter component.
 * Token-based highlighting for common programming languages.
 * No external dependencies — uses regex tokenizers.
 */

import type { Rect } from "@takumi/core";
import { hexToRgb } from "../color.js";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { getTheme } from "../theme.js";
import { LANGUAGE_MAP, MARKDOWN_RULES } from "./syntax-rules.js";

export type TokenType =
	| "keyword"
	| "string"
	| "number"
	| "comment"
	| "function"
	| "type"
	| "operator"
	| "punctuation"
	| "preprocessor"
	| "annotation"
	| "symbol"
	| "regex"
	| "heading"
	| "bold"
	| "italic"
	| "link"
	| "plain";

export interface Token {
	type: TokenType;
	text: string;
}

export interface LanguageRules {
	keywords: Set<string>;
	typeKeywords: Set<string>;
	lineComment: string;
	blockCommentStart: string;
	blockCommentEnd: string;
	stringDelimiters: string[];
	operators: RegExp;
	/** Optional: match preprocessor directives like #include, #define */
	preprocessor?: RegExp;
	/** Optional: match annotations like @Override */
	annotation?: RegExp;
	/** Optional: match symbols like :name in Ruby */
	symbolPrefix?: string;
	/** Optional: match regex literals like /pattern/ in Ruby */
	regexDelimiter?: string;
	/** Case-insensitive keyword matching (for SQL) */
	caseInsensitive?: boolean;
}

export { LANGUAGE_MAP };

export interface SyntaxProps {
	key?: string;
	code: string;
	language: string;
	showLineNumbers?: boolean;
	startLine?: number;
}

export class Syntax extends Component {
	private props: SyntaxProps;
	private tokens: Token[][] = [];

	constructor(props: SyntaxProps) {
		super();
		this.props = props;
		this.key = props.key;
		this.tokenize();
	}

	update(code: string): void {
		this.props = { ...this.props, code };
		this.tokenize();
		this.markDirty();
	}

	private tokenize(): void {
		const rules = LANGUAGE_MAP[this.props.language.toLowerCase()];
		const lines = this.props.code.split("\n");

		if (!rules) {
			// No language rules — render as plain text
			this.tokens = lines.map((line) => [{ type: "plain" as TokenType, text: line }]);
			return;
		}

		this.tokens = lines.map((line) => tokenizeLine(line, rules));
	}

	render(screen: Screen, rect: Rect): void {
		const theme = getTheme();
		const showLineNums = this.props.showLineNumbers ?? true;
		const startLine = this.props.startLine ?? 1;
		const totalLines = this.tokens.length;
		const gutterWidth = showLineNums ? String(startLine + totalLines - 1).length + 2 : 0;

		const tokenColors: Record<TokenType, string> = {
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

		for (let i = 0; i < this.tokens.length && i < rect.height; i++) {
			const row = rect.y + i;

			// Line number gutter
			if (showLineNums) {
				const lineNum = String(startLine + i).padStart(gutterWidth - 1);
				screen.writeText(row, rect.x, lineNum, { fg: 8, dim: true });
				screen.writeText(row, rect.x + gutterWidth - 1, " ", {});
			}

			// Tokens
			let col = rect.x + gutterWidth;
			for (const token of this.tokens[i]) {
				if (col >= rect.x + rect.width) break;
				const maxChars = rect.x + rect.width - col;
				const text = token.text.slice(0, maxChars);
				const hexColor = tokenColors[token.type];
				const [r, g, b] = hexToRgb(hexColor);
				const fg256 = 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);

				screen.writeText(row, col, text, {
					fg: fg256,
					italic: token.type === "comment" || token.type === "italic",
					bold: token.type === "keyword" || token.type === "heading" || token.type === "bold",
					underline: token.type === "link",
				});
				col += text.length;
			}
		}
	}
}

/** Tokenize a single line of source code according to language rules. */
export function tokenizeLine(line: string, rules: LanguageRules): Token[] {
	// Special handling for Markdown
	if (rules === MARKDOWN_RULES) {
		return tokenizeMarkdownLine(line);
	}

	const tokens: Token[] = [];
	let pos = 0;

	while (pos < line.length) {
		// Skip whitespace (preserve it)
		if (/\s/.test(line[pos])) {
			let end = pos;
			while (end < line.length && /\s/.test(line[end])) end++;
			tokens.push({ type: "plain", text: line.slice(pos, end) });
			pos = end;
			continue;
		}

		// Preprocessor directives (C/C++)
		if (rules.preprocessor && pos === 0) {
			const ppMatch = line.match(rules.preprocessor);
			if (ppMatch) {
				tokens.push({ type: "preprocessor", text: ppMatch[0] });
				pos += ppMatch[0].length;
				continue;
			}
		}

		// Annotations (Java)
		if (rules.annotation) {
			const annMatch = line.slice(pos).match(rules.annotation);
			if (annMatch) {
				tokens.push({ type: "annotation", text: annMatch[0] });
				pos += annMatch[0].length;
				continue;
			}
		}

		// Line comment
		if (rules.lineComment && line.slice(pos).startsWith(rules.lineComment)) {
			tokens.push({ type: "comment", text: line.slice(pos) });
			break;
		}

		// Symbol (Ruby :name)
		if (rules.symbolPrefix && line[pos] === rules.symbolPrefix) {
			const symMatch = line.slice(pos).match(/^:[a-zA-Z_][a-zA-Z0-9_]*/);
			if (symMatch) {
				tokens.push({ type: "symbol", text: symMatch[0] });
				pos += symMatch[0].length;
				continue;
			}
		}

		// Regex literal (Ruby /pattern/)
		if (rules.regexDelimiter && line[pos] === rules.regexDelimiter) {
			// Only treat as regex if preceded by operator, opening paren, comma, or start of line
			// Skip whitespace-only plain tokens to find the real previous token
			let prevNonSpace: Token | null = null;
			for (let i = tokens.length - 1; i >= 0; i--) {
				if (tokens[i].type !== "plain" || tokens[i].text.trim() !== "") {
					prevNonSpace = tokens[i];
					break;
				}
			}
			const isRegexContext =
				!prevNonSpace ||
				prevNonSpace.type === "operator" ||
				prevNonSpace.type === "keyword" ||
				prevNonSpace.type === "punctuation" ||
				prevNonSpace.text === "(";
			if (isRegexContext) {
				let end = pos + 1;
				while (end < line.length) {
					if (line[end] === "\\" && end + 1 < line.length) {
						end += 2;
						continue;
					}
					if (line[end] === "/") {
						end++;
						// Consume flags
						while (end < line.length && /[gimxsu]/.test(line[end])) end++;
						break;
					}
					end++;
				}
				tokens.push({ type: "regex", text: line.slice(pos, end) });
				pos = end;
				continue;
			}
		}

		// String
		const strStart = rules.stringDelimiters.find((d) => line.slice(pos).startsWith(d));
		if (strStart) {
			let end = pos + strStart.length;
			while (end < line.length) {
				if (line[end] === "\\" && end + 1 < line.length) {
					end += 2;
					continue;
				}
				if (line.slice(end).startsWith(strStart)) {
					end += strStart.length;
					break;
				}
				end++;
			}
			tokens.push({ type: "string", text: line.slice(pos, end) });
			pos = end;
			continue;
		}

		// Number (hex: 0xFF, binary: 0b10, octal: 0o77, then decimal)
		const numMatch = line
			.slice(pos)
			.match(/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[\d_]+(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?)/);
		if (numMatch && numMatch[0].length > 0 && /\d/.test(numMatch[0][0])) {
			tokens.push({ type: "number", text: numMatch[0] });
			pos += numMatch[0].length;
			continue;
		}

		// Operator
		const opMatch = line.slice(pos).match(rules.operators);
		if (opMatch && opMatch[0].length > 0) {
			tokens.push({ type: "operator", text: opMatch[0] });
			pos += opMatch[0].length;
			continue;
		}

		// Punctuation
		if (/[{}()[\];,.]/.test(line[pos])) {
			tokens.push({ type: "punctuation", text: line[pos] });
			pos++;
			continue;
		}

		// Identifier / keyword
		const idMatch = line.slice(pos).match(/^[a-zA-Z_$][a-zA-Z0-9_$?]*/);
		if (idMatch) {
			const word = idMatch[0];
			let type: TokenType = "plain";
			const lookupWord = rules.caseInsensitive ? word.toLowerCase() : word;
			if (rules.keywords.has(lookupWord)) type = "keyword";
			else if (rules.caseInsensitive ? rules.typeKeywords.has(lookupWord) : rules.typeKeywords.has(word)) type = "type";
			// Check if followed by ( — then it's a function call
			else if (line[pos + word.length] === "(") type = "function";
			tokens.push({ type, text: word });
			pos += word.length;
			continue;
		}

		// Unknown character
		tokens.push({ type: "plain", text: line[pos] });
		pos++;
	}

	return tokens;
}

/** Tokenize a single line of Markdown. */
function tokenizeMarkdownLine(line: string): Token[] {
	const tokens: Token[] = [];

	// Heading
	const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
	if (headingMatch) {
		tokens.push({ type: "heading", text: line });
		return tokens;
	}

	// Parse inline content
	let pos = 0;
	while (pos < line.length) {
		// Code span
		if (line[pos] === "`") {
			const endTick = line.indexOf("`", pos + 1);
			if (endTick !== -1) {
				tokens.push({ type: "string", text: line.slice(pos, endTick + 1) });
				pos = endTick + 1;
				continue;
			}
		}

		// Bold **text**
		const boldMatch = line.slice(pos).match(/^\*\*([^*]+)\*\*/);
		if (boldMatch) {
			tokens.push({ type: "bold", text: boldMatch[0] });
			pos += boldMatch[0].length;
			continue;
		}

		// Italic *text*
		const italicMatch = line.slice(pos).match(/^\*([^*]+)\*/);
		if (italicMatch) {
			tokens.push({ type: "italic", text: italicMatch[0] });
			pos += italicMatch[0].length;
			continue;
		}

		// Link [text](url)
		const linkMatch = line.slice(pos).match(/^\[([^\]]+)\]\([^)]+\)/);
		if (linkMatch) {
			tokens.push({ type: "link", text: linkMatch[0] });
			pos += linkMatch[0].length;
			continue;
		}

		// Plain text
		const nextSpecial = line.slice(pos + 1).search(/[`*[]/);
		if (nextSpecial === -1) {
			tokens.push({ type: "plain", text: line.slice(pos) });
			break;
		}
		tokens.push({ type: "plain", text: line.slice(pos, pos + 1 + nextSpecial) });
		pos += 1 + nextSpecial;
	}

	return tokens;
}
