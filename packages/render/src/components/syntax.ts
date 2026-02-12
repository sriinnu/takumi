/**
 * Syntax highlighter component.
 * Token-based highlighting for common programming languages.
 * No external dependencies — uses regex tokenizers.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { getTheme } from "../theme.js";
import { hexToRgb } from "../color.js";

export type TokenType =
	| "keyword"
	| "string"
	| "number"
	| "comment"
	| "function"
	| "type"
	| "operator"
	| "punctuation"
	| "plain";

interface Token {
	type: TokenType;
	text: string;
}

interface LanguageRules {
	keywords: Set<string>;
	typeKeywords: Set<string>;
	lineComment: string;
	blockCommentStart: string;
	blockCommentEnd: string;
	stringDelimiters: string[];
	operators: RegExp;
}

const TYPESCRIPT_RULES: LanguageRules = {
	keywords: new Set([
		"const", "let", "var", "function", "class", "return", "if", "else", "for", "while",
		"do", "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof",
		"in", "of", "try", "catch", "finally", "throw", "async", "await", "yield",
		"import", "export", "from", "default", "as", "extends", "implements",
		"interface", "type", "enum", "namespace", "abstract", "private", "protected",
		"public", "static", "readonly", "override", "satisfies", "declare",
		"true", "false", "null", "undefined", "void", "never", "this", "super",
	]),
	typeKeywords: new Set([
		"string", "number", "boolean", "object", "symbol", "bigint", "any", "unknown",
		"Array", "Map", "Set", "Promise", "Record", "Partial", "Required", "Readonly",
	]),
	lineComment: "//",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ["\"", "'", "`"],
	operators: /^(?:===|!==|=>|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
};

const PYTHON_RULES: LanguageRules = {
	keywords: new Set([
		"def", "class", "return", "if", "elif", "else", "for", "while", "break",
		"continue", "pass", "import", "from", "as", "try", "except", "finally",
		"raise", "with", "yield", "lambda", "and", "or", "not", "in", "is",
		"True", "False", "None", "async", "await", "global", "nonlocal",
	]),
	typeKeywords: new Set(["int", "float", "str", "bool", "list", "dict", "tuple", "set", "bytes"]),
	lineComment: "#",
	blockCommentStart: "\"\"\"",
	blockCommentEnd: "\"\"\"",
	stringDelimiters: ["\"", "'"],
	operators: /^(?:==|!=|<=|>=|<>|\*\*|\/\/|[+\-*/%=<>!&|^~@]+)/,
};

const LANGUAGE_MAP: Record<string, LanguageRules> = {
	typescript: TYPESCRIPT_RULES,
	ts: TYPESCRIPT_RULES,
	javascript: TYPESCRIPT_RULES,
	js: TYPESCRIPT_RULES,
	tsx: TYPESCRIPT_RULES,
	jsx: TYPESCRIPT_RULES,
	python: PYTHON_RULES,
	py: PYTHON_RULES,
};

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
				const fg256 = 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);

				screen.writeText(row, col, text, {
					fg: fg256,
					italic: token.type === "comment",
					bold: token.type === "keyword",
				});
				col += text.length;
			}
		}
	}
}

function tokenizeLine(line: string, rules: LanguageRules): Token[] {
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

		// Line comment
		if (line.slice(pos).startsWith(rules.lineComment)) {
			tokens.push({ type: "comment", text: line.slice(pos) });
			break;
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

		// Number
		const numMatch = line.slice(pos).match(/^(?:0[xXbBoO])?[\d_]+(?:\.[\d_]+)?(?:[eE][+-]?\d+)?n?/);
		if (numMatch && numMatch[0].length > 0 && /\d/.test(numMatch[0][0])) {
			tokens.push({ type: "number", text: numMatch[0] });
			pos += numMatch[0].length;
			continue;
		}

		// Operator
		const opMatch = line.slice(pos).match(rules.operators);
		if (opMatch) {
			tokens.push({ type: "operator", text: opMatch[0] });
			pos += opMatch[0].length;
			continue;
		}

		// Punctuation
		if (/[{}()\[\];,.]/.test(line[pos])) {
			tokens.push({ type: "punctuation", text: line[pos] });
			pos++;
			continue;
		}

		// Identifier / keyword
		const idMatch = line.slice(pos).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
		if (idMatch) {
			const word = idMatch[0];
			let type: TokenType = "plain";
			if (rules.keywords.has(word)) type = "keyword";
			else if (rules.typeKeywords.has(word)) type = "type";
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
