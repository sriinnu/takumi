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

const TYPESCRIPT_RULES: LanguageRules = {
	keywords: new Set([
		"const",
		"let",
		"var",
		"function",
		"class",
		"return",
		"if",
		"else",
		"for",
		"while",
		"do",
		"switch",
		"case",
		"break",
		"continue",
		"new",
		"delete",
		"typeof",
		"instanceof",
		"in",
		"of",
		"try",
		"catch",
		"finally",
		"throw",
		"async",
		"await",
		"yield",
		"import",
		"export",
		"from",
		"default",
		"as",
		"extends",
		"implements",
		"interface",
		"type",
		"enum",
		"namespace",
		"abstract",
		"private",
		"protected",
		"public",
		"static",
		"readonly",
		"override",
		"satisfies",
		"declare",
		"true",
		"false",
		"null",
		"undefined",
		"void",
		"never",
		"this",
		"super",
	]),
	typeKeywords: new Set([
		"string",
		"number",
		"boolean",
		"object",
		"symbol",
		"bigint",
		"any",
		"unknown",
		"Array",
		"Map",
		"Set",
		"Promise",
		"Record",
		"Partial",
		"Required",
		"Readonly",
	]),
	lineComment: "//",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ['"', "'", "`"],
	operators: /^(?:===|!==|=>|&&|\|\||[+\-*/%=<>!&|^~?:]+)/,
};

const PYTHON_RULES: LanguageRules = {
	keywords: new Set([
		"def",
		"class",
		"return",
		"if",
		"elif",
		"else",
		"for",
		"while",
		"break",
		"continue",
		"pass",
		"import",
		"from",
		"as",
		"try",
		"except",
		"finally",
		"raise",
		"with",
		"yield",
		"lambda",
		"and",
		"or",
		"not",
		"in",
		"is",
		"True",
		"False",
		"None",
		"async",
		"await",
		"global",
		"nonlocal",
	]),
	typeKeywords: new Set(["int", "float", "str", "bool", "list", "dict", "tuple", "set", "bytes"]),
	lineComment: "#",
	blockCommentStart: '"""',
	blockCommentEnd: '"""',
	stringDelimiters: ['"', "'"],
	operators: /^(?:==|!=|<=|>=|<>|\*\*|\/\/|[+\-*/%=<>!&|^~@]+)/,
};

const GO_RULES: LanguageRules = {
	keywords: new Set([
		"break",
		"case",
		"chan",
		"const",
		"continue",
		"default",
		"defer",
		"else",
		"fallthrough",
		"for",
		"func",
		"go",
		"goto",
		"if",
		"import",
		"interface",
		"map",
		"package",
		"range",
		"return",
		"select",
		"struct",
		"switch",
		"type",
		"var",
		"true",
		"false",
		"nil",
		"iota",
	]),
	typeKeywords: new Set([
		"bool",
		"byte",
		"complex64",
		"complex128",
		"error",
		"float32",
		"float64",
		"int",
		"int8",
		"int16",
		"int32",
		"int64",
		"rune",
		"string",
		"uint",
		"uint8",
		"uint16",
		"uint32",
		"uint64",
		"uintptr",
		"any",
	]),
	lineComment: "//",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ['"', "'", "`"],
	operators: /^(?:<<|>>|&\^|:=|&&|\|\||[+\-*/%=<>!&|^~]+)/,
};

const RUST_RULES: LanguageRules = {
	keywords: new Set([
		"as",
		"async",
		"await",
		"break",
		"const",
		"continue",
		"crate",
		"dyn",
		"else",
		"enum",
		"extern",
		"false",
		"fn",
		"for",
		"if",
		"impl",
		"in",
		"let",
		"loop",
		"match",
		"mod",
		"move",
		"mut",
		"pub",
		"ref",
		"return",
		"self",
		"Self",
		"static",
		"struct",
		"super",
		"trait",
		"true",
		"type",
		"unsafe",
		"use",
		"where",
		"while",
		"yield",
	]),
	typeKeywords: new Set([
		"bool",
		"char",
		"f32",
		"f64",
		"i8",
		"i16",
		"i32",
		"i64",
		"i128",
		"isize",
		"u8",
		"u16",
		"u32",
		"u64",
		"u128",
		"usize",
		"str",
		"String",
		"Vec",
		"Box",
		"Option",
		"Result",
		"HashMap",
		"HashSet",
	]),
	lineComment: "//",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ['"'],
	operators: /^(?:::|->::|=>|&&|\|\||[+\-*/%=<>!&|^~?]+)/,
};

const BASH_RULES: LanguageRules = {
	keywords: new Set([
		"if",
		"then",
		"else",
		"elif",
		"fi",
		"for",
		"while",
		"do",
		"done",
		"case",
		"esac",
		"in",
		"function",
		"return",
		"exit",
		"local",
		"export",
		"source",
		"alias",
		"unalias",
		"set",
		"unset",
		"shift",
		"break",
		"continue",
		"declare",
		"readonly",
		"typeset",
		"eval",
		"exec",
		"trap",
		"wait",
		"true",
		"false",
	]),
	typeKeywords: new Set([]),
	lineComment: "#",
	blockCommentStart: "",
	blockCommentEnd: "",
	stringDelimiters: ['"', "'"],
	operators: /^(?:\|\||&&|;;|[|&<>!;=]+)/,
};

const JSON_RULES: LanguageRules = {
	keywords: new Set(["true", "false", "null"]),
	typeKeywords: new Set([]),
	lineComment: "",
	blockCommentStart: "",
	blockCommentEnd: "",
	stringDelimiters: ['"'],
	operators: /^[:]/,
};

const YAML_RULES: LanguageRules = {
	keywords: new Set(["true", "false", "null", "yes", "no", "on", "off"]),
	typeKeywords: new Set([]),
	lineComment: "#",
	blockCommentStart: "",
	blockCommentEnd: "",
	stringDelimiters: ['"', "'"],
	operators: /^[:\-|>]/,
};

const HTML_RULES: LanguageRules = {
	keywords: new Set([
		"html",
		"head",
		"body",
		"div",
		"span",
		"p",
		"a",
		"img",
		"ul",
		"ol",
		"li",
		"table",
		"tr",
		"td",
		"th",
		"form",
		"input",
		"button",
		"select",
		"option",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"script",
		"style",
		"link",
		"meta",
		"title",
		"header",
		"footer",
		"nav",
		"main",
		"section",
		"article",
		"aside",
	]),
	typeKeywords: new Set([]),
	lineComment: "",
	blockCommentStart: "<!--",
	blockCommentEnd: "-->",
	stringDelimiters: ['"', "'"],
	operators: /^[=<>/]+/,
};

const CSS_RULES: LanguageRules = {
	keywords: new Set([
		"display",
		"position",
		"color",
		"background",
		"margin",
		"padding",
		"border",
		"font",
		"width",
		"height",
		"top",
		"left",
		"right",
		"bottom",
		"flex",
		"grid",
		"align",
		"justify",
		"transform",
		"transition",
		"animation",
		"none",
		"auto",
		"inherit",
		"initial",
		"unset",
		"important",
	]),
	typeKeywords: new Set([]),
	lineComment: "",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ['"', "'"],
	operators: /^[:;{}]+/,
};

const C_RULES: LanguageRules = {
	keywords: new Set([
		"auto",
		"break",
		"case",
		"const",
		"continue",
		"default",
		"do",
		"else",
		"enum",
		"extern",
		"for",
		"goto",
		"if",
		"inline",
		"register",
		"restrict",
		"return",
		"sizeof",
		"static",
		"struct",
		"switch",
		"typedef",
		"union",
		"volatile",
		"while",
		// C++ additions
		"class",
		"template",
		"namespace",
		"using",
		"virtual",
		"override",
		"final",
		"public",
		"private",
		"protected",
		"new",
		"delete",
		"try",
		"catch",
		"throw",
		"noexcept",
		"constexpr",
		"decltype",
		"nullptr",
		"this",
		"operator",
		"friend",
		"explicit",
		"mutable",
		"static_cast",
		"dynamic_cast",
		"reinterpret_cast",
		"const_cast",
		"typeid",
		"typename",
		"true",
		"false",
		"NULL",
	]),
	typeKeywords: new Set([
		"int",
		"char",
		"void",
		"float",
		"double",
		"long",
		"short",
		"unsigned",
		"signed",
		"bool",
		"size_t",
		"ssize_t",
		"ptrdiff_t",
		"intptr_t",
		"uint8_t",
		"uint16_t",
		"uint32_t",
		"uint64_t",
		"int8_t",
		"int16_t",
		"int32_t",
		"int64_t",
		"FILE",
		"string",
		"vector",
		"map",
		"set",
		"list",
		"queue",
		"stack",
		"shared_ptr",
		"unique_ptr",
		"weak_ptr",
		"pair",
		"tuple",
		"array",
		"wchar_t",
		"char16_t",
		"char32_t",
	]),
	lineComment: "//",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ['"', "'"],
	operators: /^(?:->|<<|>>|&&|\|\||::|\+\+|--|[+\-*/%=<>!&|^~?:]+)/,
	preprocessor: /^#\s*(?:include|define|undef|ifdef|ifndef|if|elif|else|endif|pragma|error|warning|line)\b.*/,
};

const JAVA_RULES: LanguageRules = {
	keywords: new Set([
		"abstract",
		"assert",
		"boolean",
		"break",
		"byte",
		"case",
		"catch",
		"char",
		"class",
		"const",
		"continue",
		"default",
		"do",
		"double",
		"else",
		"enum",
		"extends",
		"final",
		"finally",
		"float",
		"for",
		"goto",
		"if",
		"implements",
		"import",
		"instanceof",
		"int",
		"interface",
		"long",
		"native",
		"new",
		"package",
		"private",
		"protected",
		"public",
		"return",
		"short",
		"static",
		"strictfp",
		"super",
		"switch",
		"synchronized",
		"this",
		"throw",
		"throws",
		"transient",
		"try",
		"void",
		"volatile",
		"while",
		"true",
		"false",
		"null",
		"var",
		"yield",
		"record",
		"sealed",
		"permits",
		"non-sealed",
	]),
	typeKeywords: new Set([
		"String",
		"Integer",
		"Long",
		"Float",
		"Double",
		"Character",
		"Boolean",
		"Object",
		"Class",
		"List",
		"ArrayList",
		"Map",
		"HashMap",
		"Set",
		"HashSet",
		"Optional",
		"Stream",
		"Collection",
		"Iterable",
		"Comparable",
		"Serializable",
		"Exception",
		"RuntimeException",
		"Throwable",
		"Thread",
		"Runnable",
	]),
	lineComment: "//",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ['"', "'"],
	operators: /^(?:->|>>>|>>|<<|&&|\|\||\+\+|--|instanceof\b|[+\-*/%=<>!&|^~?:]+)/,
	annotation: /^@[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/,
};

const RUBY_RULES: LanguageRules = {
	keywords: new Set([
		"alias",
		"and",
		"begin",
		"break",
		"case",
		"class",
		"def",
		"defined?",
		"do",
		"else",
		"elsif",
		"end",
		"ensure",
		"false",
		"for",
		"if",
		"in",
		"module",
		"next",
		"nil",
		"not",
		"or",
		"redo",
		"rescue",
		"retry",
		"return",
		"self",
		"super",
		"then",
		"true",
		"undef",
		"unless",
		"until",
		"when",
		"while",
		"yield",
		"require",
		"require_relative",
		"include",
		"extend",
		"prepend",
		"attr_reader",
		"attr_writer",
		"attr_accessor",
		"raise",
		"puts",
		"print",
		"p",
		"private",
		"protected",
		"public",
		"lambda",
		"proc",
		"block_given?",
	]),
	typeKeywords: new Set([
		"Array",
		"Hash",
		"String",
		"Integer",
		"Float",
		"Symbol",
		"Proc",
		"Range",
		"Regexp",
		"IO",
		"File",
		"Dir",
		"Time",
		"Struct",
		"Numeric",
		"Comparable",
		"Enumerable",
		"Kernel",
		"Object",
		"NilClass",
		"TrueClass",
		"FalseClass",
	]),
	lineComment: "#",
	blockCommentStart: "=begin",
	blockCommentEnd: "=end",
	stringDelimiters: ['"', "'"],
	operators: /^(?:=>|<=>|&&|\|\||\.\.\.|\.\.|[+\-*/%=<>!&|^~?:]+)/,
	symbolPrefix: ":",
	regexDelimiter: "/",
};

const SQL_RULES: LanguageRules = {
	keywords: new Set([
		"select",
		"from",
		"where",
		"insert",
		"into",
		"values",
		"update",
		"set",
		"delete",
		"create",
		"alter",
		"drop",
		"table",
		"index",
		"view",
		"database",
		"schema",
		"grant",
		"revoke",
		"commit",
		"rollback",
		"savepoint",
		"join",
		"inner",
		"left",
		"right",
		"outer",
		"cross",
		"full",
		"on",
		"and",
		"or",
		"not",
		"in",
		"between",
		"like",
		"is",
		"null",
		"exists",
		"having",
		"group",
		"by",
		"order",
		"asc",
		"desc",
		"limit",
		"offset",
		"union",
		"all",
		"intersect",
		"except",
		"distinct",
		"as",
		"case",
		"when",
		"then",
		"else",
		"end",
		"if",
		"begin",
		"declare",
		"cursor",
		"fetch",
		"open",
		"close",
		"with",
		"recursive",
		"returns",
		"function",
		"procedure",
		"trigger",
		"primary",
		"key",
		"foreign",
		"references",
		"constraint",
		"unique",
		"check",
		"default",
		"auto_increment",
		"true",
		"false",
	]),
	typeKeywords: new Set([
		"int",
		"integer",
		"smallint",
		"bigint",
		"tinyint",
		"float",
		"double",
		"decimal",
		"numeric",
		"real",
		"char",
		"varchar",
		"text",
		"nchar",
		"nvarchar",
		"ntext",
		"binary",
		"varbinary",
		"blob",
		"clob",
		"date",
		"time",
		"datetime",
		"timestamp",
		"boolean",
		"bool",
		"serial",
		"uuid",
		"json",
		"jsonb",
		"xml",
		"array",
	]),
	lineComment: "--",
	blockCommentStart: "/*",
	blockCommentEnd: "*/",
	stringDelimiters: ["'"],
	operators: /^(?:<>|!=|>=|<=|::|[+\-*/%=<>!|]+)/,
	caseInsensitive: true,
};

const MARKDOWN_RULES: LanguageRules = {
	keywords: new Set([]),
	typeKeywords: new Set([]),
	lineComment: "",
	blockCommentStart: "",
	blockCommentEnd: "",
	stringDelimiters: [],
	operators: /^$/,
};

export const LANGUAGE_MAP: Record<string, LanguageRules> = {
	typescript: TYPESCRIPT_RULES,
	ts: TYPESCRIPT_RULES,
	javascript: TYPESCRIPT_RULES,
	js: TYPESCRIPT_RULES,
	tsx: TYPESCRIPT_RULES,
	jsx: TYPESCRIPT_RULES,
	python: PYTHON_RULES,
	py: PYTHON_RULES,
	go: GO_RULES,
	golang: GO_RULES,
	rust: RUST_RULES,
	rs: RUST_RULES,
	bash: BASH_RULES,
	sh: BASH_RULES,
	shell: BASH_RULES,
	zsh: BASH_RULES,
	json: JSON_RULES,
	yaml: YAML_RULES,
	yml: YAML_RULES,
	html: HTML_RULES,
	htm: HTML_RULES,
	xml: HTML_RULES,
	css: CSS_RULES,
	scss: CSS_RULES,
	c: C_RULES,
	cpp: C_RULES,
	"c++": C_RULES,
	cc: C_RULES,
	h: C_RULES,
	hpp: C_RULES,
	java: JAVA_RULES,
	ruby: RUBY_RULES,
	rb: RUBY_RULES,
	sql: SQL_RULES,
	mysql: SQL_RULES,
	postgresql: SQL_RULES,
	postgres: SQL_RULES,
	sqlite: SQL_RULES,
	markdown: MARKDOWN_RULES,
	md: MARKDOWN_RULES,
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
