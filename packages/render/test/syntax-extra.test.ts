/**
 * Tests for extended syntax highlighting — C/C++, Java, Ruby, SQL, Markdown.
 */

import { describe, it, expect } from "vitest";
import { tokenizeLine, LANGUAGE_MAP } from "../src/components/syntax.js";
import type { Token, TokenType } from "../src/components/syntax.js";

/** Helper: tokenize a line for a given language and return token types paired with text. */
function tok(line: string, lang: string): Array<[TokenType, string]> {
	const rules = LANGUAGE_MAP[lang];
	expect(rules).toBeDefined();
	const tokens = tokenizeLine(line, rules!);
	return tokens.map((t) => [t.type, t.text]);
}

/** Helper: find all tokens of a specific type. */
function tokensOfType(line: string, lang: string, type: TokenType): string[] {
	return tok(line, lang)
		.filter(([t]) => t === type)
		.map(([, text]) => text);
}

// ─── C / C++ ──────────────────────────────────────────────────────────────────

describe("C/C++ highlighting", () => {
	it("highlights C keywords", () => {
		const keywords = tokensOfType("if (x) return 0;", "c", "keyword");
		expect(keywords).toContain("if");
		expect(keywords).toContain("return");
	});

	it("highlights C++ keywords", () => {
		const keywords = tokensOfType("class Foo : public Bar {}", "cpp", "keyword");
		expect(keywords).toContain("class");
		expect(keywords).toContain("public");
	});

	it("highlights template and namespace", () => {
		const keywords = tokensOfType("template<typename T> namespace ns {}", "c++", "keyword");
		expect(keywords).toContain("template");
		expect(keywords).toContain("namespace");
	});

	it("highlights type keywords", () => {
		const types = tokensOfType("int x; char* p; void foo();", "c", "type");
		expect(types).toContain("int");
		expect(types).toContain("char");
		expect(types).toContain("void");
	});

	it("highlights C++ STL types", () => {
		const types = tokensOfType("vector<int> v; string s; shared_ptr<Foo> p;", "cpp", "type");
		expect(types).toContain("vector");
		expect(types).toContain("string");
		expect(types).toContain("shared_ptr");
	});

	it("highlights preprocessor directives", () => {
		const pp = tokensOfType("#include <stdio.h>", "c", "preprocessor");
		expect(pp.length).toBeGreaterThan(0);
		expect(pp[0]).toContain("#include");
	});

	it("highlights #define preprocessor", () => {
		const pp = tokensOfType("#define MAX 100", "c", "preprocessor");
		expect(pp.length).toBeGreaterThan(0);
		expect(pp[0]).toContain("#define");
	});

	it("highlights #ifdef preprocessor", () => {
		const pp = tokensOfType("#ifdef DEBUG", "c", "preprocessor");
		expect(pp.length).toBeGreaterThan(0);
		expect(pp[0]).toContain("#ifdef");
	});

	it("highlights single-line comments", () => {
		const comments = tokensOfType("int x; // this is a comment", "c", "comment");
		expect(comments.length).toBe(1);
		expect(comments[0]).toContain("// this is a comment");
	});

	it("highlights string literals", () => {
		const strings = tokensOfType('char* s = "hello world";', "c", "string");
		expect(strings).toContain('"hello world"');
	});

	it("highlights char literals", () => {
		const strings = tokensOfType("char c = 'A';", "c", "string");
		expect(strings).toContain("'A'");
	});

	it("highlights numbers", () => {
		const nums = tokensOfType("int x = 42; float y = 3.14;", "c", "number");
		expect(nums).toContain("42");
		expect(nums).toContain("3.14");
	});

	it("highlights hex numbers", () => {
		const nums = tokensOfType("int mask = 0xFF;", "c", "number");
		expect(nums).toContain("0xFF");
	});

	it("highlights operators", () => {
		const ops = tokensOfType("x = a + b; p->member;", "c", "operator");
		expect(ops.some((o) => o.includes("->"))).toBe(true);
	});

	it("highlights function calls", () => {
		const fns = tokensOfType("printf(\"hello\"); malloc(sizeof(int));", "c", "function");
		expect(fns).toContain("printf");
		expect(fns).toContain("malloc");
	});

	it("registers c, cpp, c++, cc, h, hpp aliases", () => {
		for (const alias of ["c", "cpp", "c++", "cc", "h", "hpp"]) {
			expect(LANGUAGE_MAP[alias]).toBeDefined();
		}
	});
});

// ─── Java ─────────────────────────────────────────────────────────────────────

describe("Java highlighting", () => {
	it("highlights Java keywords", () => {
		const keywords = tokensOfType("public class Main extends Base implements Runnable {}", "java", "keyword");
		expect(keywords).toContain("public");
		expect(keywords).toContain("class");
		expect(keywords).toContain("extends");
		expect(keywords).toContain("implements");
	});

	it("highlights access modifiers", () => {
		const keywords = tokensOfType("private static final int X = 1;", "java", "keyword");
		expect(keywords).toContain("private");
		expect(keywords).toContain("static");
		expect(keywords).toContain("final");
	});

	it("highlights control flow", () => {
		const keywords = tokensOfType("if (x) { return; } else { throw new Error(); }", "java", "keyword");
		expect(keywords).toContain("if");
		expect(keywords).toContain("return");
		expect(keywords).toContain("else");
		expect(keywords).toContain("throw");
		expect(keywords).toContain("new");
	});

	it("highlights annotations", () => {
		const anns = tokensOfType("@Override", "java", "annotation");
		expect(anns).toContain("@Override");
	});

	it("highlights @SuppressWarnings annotation", () => {
		const anns = tokensOfType('@SuppressWarnings("unchecked")', "java", "annotation");
		expect(anns).toContain("@SuppressWarnings");
	});

	it("highlights Java type keywords", () => {
		const types = tokensOfType("String s; Integer n; List<Map<String, Object>> data;", "java", "type");
		expect(types).toContain("String");
		expect(types).toContain("Integer");
		expect(types).toContain("List");
	});

	it("highlights primitive types as keywords", () => {
		const keywords = tokensOfType("int x; boolean flag; void method();", "java", "keyword");
		expect(keywords).toContain("int");
		expect(keywords).toContain("boolean");
		expect(keywords).toContain("void");
	});

	it("highlights string literals", () => {
		const strings = tokensOfType('String s = "hello\\nworld";', "java", "string");
		expect(strings.length).toBeGreaterThan(0);
		expect(strings[0]).toContain("hello");
	});

	it("highlights string with escape sequences", () => {
		const strings = tokensOfType('String s = "tab\\there";', "java", "string");
		expect(strings.length).toBeGreaterThan(0);
	});

	it("highlights comments", () => {
		const comments = tokensOfType("int x = 1; // important", "java", "comment");
		expect(comments.length).toBe(1);
		expect(comments[0]).toContain("// important");
	});

	it("highlights import/package as keywords", () => {
		const keywords = tokensOfType("import java.util.List;", "java", "keyword");
		expect(keywords).toContain("import");
	});
});

// ─── Ruby ─────────────────────────────────────────────────────────────────────

describe("Ruby highlighting", () => {
	it("highlights Ruby keywords", () => {
		const keywords = tokensOfType("def foo; end", "ruby", "keyword");
		expect(keywords).toContain("def");
		expect(keywords).toContain("end");
	});

	it("highlights class and module", () => {
		const keywords = tokensOfType("class Foo < Base; module Bar; end; end", "ruby", "keyword");
		expect(keywords).toContain("class");
		expect(keywords).toContain("module");
	});

	it("highlights do/yield keywords", () => {
		const keywords = tokensOfType("items.each do |item| yield item end", "ruby", "keyword");
		expect(keywords).toContain("do");
		expect(keywords).toContain("yield");
	});

	it("highlights require", () => {
		const keywords = tokensOfType('require "json"', "ruby", "keyword");
		expect(keywords).toContain("require");
	});

	it("highlights attr_accessor", () => {
		const keywords = tokensOfType("attr_accessor :name", "ruby", "keyword");
		expect(keywords).toContain("attr_accessor");
	});

	it("highlights symbols", () => {
		const symbols = tokensOfType(":name, :id, :created_at", "ruby", "symbol");
		expect(symbols).toContain(":name");
		expect(symbols).toContain(":id");
		expect(symbols).toContain(":created_at");
	});

	it("highlights string literals", () => {
		const strings = tokensOfType('puts "hello world"', "ruby", "string");
		expect(strings).toContain('"hello world"');
	});

	it("highlights single-quoted strings", () => {
		const strings = tokensOfType("puts 'single'", "ruby", "string");
		expect(strings).toContain("'single'");
	});

	it("highlights regex literals", () => {
		const tokens = tok("x =~ /pattern/i", "ruby");
		const regexTokens = tokens.filter(([t]) => t === "regex");
		expect(regexTokens.length).toBe(1);
		expect(regexTokens[0][1]).toContain("/pattern/");
	});

	it("highlights comments", () => {
		const comments = tokensOfType("x = 1 # comment here", "ruby", "comment");
		expect(comments.length).toBe(1);
		expect(comments[0]).toContain("# comment here");
	});

	it("highlights nil/true/false", () => {
		const keywords = tokensOfType("nil true false", "ruby", "keyword");
		expect(keywords).toContain("nil");
		expect(keywords).toContain("true");
		expect(keywords).toContain("false");
	});

	it("registers ruby and rb aliases", () => {
		expect(LANGUAGE_MAP["ruby"]).toBeDefined();
		expect(LANGUAGE_MAP["rb"]).toBeDefined();
		expect(LANGUAGE_MAP["ruby"]).toBe(LANGUAGE_MAP["rb"]);
	});
});

// ─── SQL ──────────────────────────────────────────────────────────────────────

describe("SQL highlighting", () => {
	it("highlights SELECT/FROM/WHERE (uppercase)", () => {
		const keywords = tokensOfType("SELECT * FROM users WHERE id = 1;", "sql", "keyword");
		expect(keywords).toContain("SELECT");
		expect(keywords).toContain("FROM");
		expect(keywords).toContain("WHERE");
	});

	it("highlights keywords case-insensitively", () => {
		const keywords = tokensOfType("select * from users where id = 1;", "sql", "keyword");
		expect(keywords).toContain("select");
		expect(keywords).toContain("from");
		expect(keywords).toContain("where");
	});

	it("highlights mixed-case keywords", () => {
		const keywords = tokensOfType("Select * From users Where id = 1;", "sql", "keyword");
		expect(keywords).toContain("Select");
		expect(keywords).toContain("From");
		expect(keywords).toContain("Where");
	});

	it("highlights INSERT/UPDATE/DELETE", () => {
		const keywords1 = tokensOfType("INSERT INTO users VALUES (1, 'name');", "sql", "keyword");
		expect(keywords1).toContain("INSERT");
		expect(keywords1).toContain("INTO");
		expect(keywords1).toContain("VALUES");

		const keywords2 = tokensOfType("UPDATE users SET name = 'foo';", "sql", "keyword");
		expect(keywords2).toContain("UPDATE");
		expect(keywords2).toContain("SET");

		const keywords3 = tokensOfType("DELETE FROM users WHERE id = 1;", "sql", "keyword");
		expect(keywords3).toContain("DELETE");
	});

	it("highlights JOIN keywords", () => {
		const keywords = tokensOfType("SELECT * FROM a INNER JOIN b ON a.id = b.id;", "sql", "keyword");
		expect(keywords).toContain("JOIN");
		expect(keywords).toContain("INNER");
		expect(keywords).toContain("ON");
	});

	it("highlights CREATE/ALTER/DROP", () => {
		const keywords = tokensOfType("CREATE TABLE users (id INT PRIMARY KEY);", "sql", "keyword");
		expect(keywords).toContain("CREATE");
		expect(keywords).toContain("TABLE");
		expect(keywords).toContain("PRIMARY");
		expect(keywords).toContain("KEY");
	});

	it("highlights string literals (single quotes)", () => {
		const strings = tokensOfType("SELECT * FROM users WHERE name = 'John';", "sql", "string");
		expect(strings).toContain("'John'");
	});

	it("highlights type keywords", () => {
		const types = tokensOfType("id INT, name VARCHAR, created TIMESTAMP", "sql", "type");
		// INT is case-insensitive
		expect(types.some((t) => t.toLowerCase() === "int")).toBe(true);
	});

	it("highlights line comments (--)", () => {
		const comments = tokensOfType("SELECT 1; -- get one", "sql", "comment");
		expect(comments.length).toBe(1);
		expect(comments[0]).toContain("-- get one");
	});

	it("highlights numbers", () => {
		const nums = tokensOfType("SELECT 42, 3.14 FROM dual;", "sql", "number");
		expect(nums).toContain("42");
		expect(nums).toContain("3.14");
	});

	it("registers sql, mysql, postgresql, postgres, sqlite aliases", () => {
		for (const alias of ["sql", "mysql", "postgresql", "postgres", "sqlite"]) {
			expect(LANGUAGE_MAP[alias]).toBeDefined();
		}
	});
});

// ─── Markdown ─────────────────────────────────────────────────────────────────

describe("Markdown highlighting", () => {
	it("highlights h1 headings", () => {
		const tokens = tok("# Hello World", "md");
		const headings = tokens.filter(([t]) => t === "heading");
		expect(headings.length).toBe(1);
		expect(headings[0][1]).toContain("# Hello World");
	});

	it("highlights h2 headings", () => {
		const tokens = tok("## Section Title", "md");
		const headings = tokens.filter(([t]) => t === "heading");
		expect(headings.length).toBe(1);
		expect(headings[0][1]).toContain("## Section Title");
	});

	it("highlights h3 through h6 headings", () => {
		for (const level of [3, 4, 5, 6]) {
			const prefix = "#".repeat(level);
			const tokens = tok(`${prefix} Title`, "md");
			const headings = tokens.filter(([t]) => t === "heading");
			expect(headings.length).toBe(1);
		}
	});

	it("highlights bold text", () => {
		const tokens = tok("This is **bold** text", "md");
		const boldTokens = tokens.filter(([t]) => t === "bold");
		expect(boldTokens.length).toBe(1);
		expect(boldTokens[0][1]).toContain("**bold**");
	});

	it("highlights italic text", () => {
		const tokens = tok("This is *italic* text", "md");
		const italicTokens = tokens.filter(([t]) => t === "italic");
		expect(italicTokens.length).toBe(1);
		expect(italicTokens[0][1]).toContain("*italic*");
	});

	it("highlights code spans", () => {
		const tokens = tok("Use `console.log` here", "md");
		const codeTokens = tokens.filter(([t]) => t === "string");
		expect(codeTokens.length).toBe(1);
		expect(codeTokens[0][1]).toContain("`console.log`");
	});

	it("highlights links", () => {
		const tokens = tok("Visit [Google](https://google.com) now", "md");
		const linkTokens = tokens.filter(([t]) => t === "link");
		expect(linkTokens.length).toBe(1);
		expect(linkTokens[0][1]).toContain("[Google]");
	});

	it("handles plain text lines", () => {
		const tokens = tok("Just plain text here", "md");
		expect(tokens.length).toBeGreaterThan(0);
		expect(tokens.every(([t]) => t === "plain")).toBe(true);
	});

	it("registers markdown and md aliases", () => {
		expect(LANGUAGE_MAP["markdown"]).toBeDefined();
		expect(LANGUAGE_MAP["md"]).toBeDefined();
		expect(LANGUAGE_MAP["markdown"]).toBe(LANGUAGE_MAP["md"]);
	});
});

// ─── Language registration ────────────────────────────────────────────────────

describe("Language registration", () => {
	it("has Go registered", () => {
		expect(LANGUAGE_MAP["go"]).toBeDefined();
		expect(LANGUAGE_MAP["golang"]).toBeDefined();
	});

	it("has Rust registered", () => {
		expect(LANGUAGE_MAP["rust"]).toBeDefined();
		expect(LANGUAGE_MAP["rs"]).toBeDefined();
	});

	it("has Bash registered", () => {
		expect(LANGUAGE_MAP["bash"]).toBeDefined();
		expect(LANGUAGE_MAP["sh"]).toBeDefined();
		expect(LANGUAGE_MAP["shell"]).toBeDefined();
		expect(LANGUAGE_MAP["zsh"]).toBeDefined();
	});

	it("has JSON/YAML registered", () => {
		expect(LANGUAGE_MAP["json"]).toBeDefined();
		expect(LANGUAGE_MAP["yaml"]).toBeDefined();
		expect(LANGUAGE_MAP["yml"]).toBeDefined();
	});

	it("has HTML/CSS registered", () => {
		expect(LANGUAGE_MAP["html"]).toBeDefined();
		expect(LANGUAGE_MAP["htm"]).toBeDefined();
		expect(LANGUAGE_MAP["css"]).toBeDefined();
		expect(LANGUAGE_MAP["scss"]).toBeDefined();
	});
});
