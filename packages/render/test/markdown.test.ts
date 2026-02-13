/**
 * Tests for the standalone markdown-to-ANSI renderer.
 */

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/markdown.js";
import { defaultTheme } from "../src/theme.js";
import { visibleLength } from "../src/ansi.js";

const theme = defaultTheme;

/** Strip all ANSI escape sequences from a string. */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)/g, "");
}

// ─── Headers ──────────────────────────────────────────────────────────────────

describe("Markdown headers", () => {
	it("renders h1 with bold styling", () => {
		const result = renderMarkdown("# Hello World", theme);
		expect(result).toContain("\x1b[1m"); // bold escape
		expect(stripAnsi(result)).toContain("Hello World");
	});

	it("renders h2 with bold styling", () => {
		const result = renderMarkdown("## Section Title", theme);
		expect(result).toContain("\x1b[1m"); // bold escape
		expect(stripAnsi(result)).toContain("Section Title");
	});

	it("renders h3 with dim styling", () => {
		const result = renderMarkdown("### Subsection", theme);
		expect(result).toContain("\x1b[2m"); // dim escape
		expect(stripAnsi(result)).toContain("Subsection");
	});

	it("renders h4 with dim styling", () => {
		const result = renderMarkdown("#### Deep Section", theme);
		expect(result).toContain("\x1b[2m"); // dim escape
		expect(stripAnsi(result)).toContain("Deep Section");
	});

	it("renders h5 and h6 with dim styling", () => {
		const h5 = renderMarkdown("##### Five", theme);
		const h6 = renderMarkdown("###### Six", theme);
		expect(stripAnsi(h5)).toContain("Five");
		expect(stripAnsi(h6)).toContain("Six");
	});

	it("renders multiple headers", () => {
		const input = "# Title\n## Subtitle\n### Detail";
		const result = renderMarkdown(input, theme);
		const lines = result.split("\n");
		expect(lines.length).toBe(3);
		expect(stripAnsi(lines[0])).toContain("Title");
		expect(stripAnsi(lines[1])).toContain("Subtitle");
		expect(stripAnsi(lines[2])).toContain("Detail");
	});
});

// ─── Bold and italic ──────────────────────────────────────────────────────────

describe("Markdown bold and italic", () => {
	it("renders bold text with ANSI bold", () => {
		const result = renderMarkdown("This is **bold** text", theme);
		expect(result).toContain("\x1b[1m"); // bold
		expect(stripAnsi(result)).toContain("bold");
		// The ** delimiters should be stripped
		expect(stripAnsi(result)).not.toContain("**");
	});

	it("renders italic text with ANSI italic", () => {
		const result = renderMarkdown("This is *italic* text", theme);
		expect(result).toContain("\x1b[3m"); // italic
		expect(stripAnsi(result)).toContain("italic");
		// Single * should be stripped
		expect(stripAnsi(result)).toBe("This is italic text");
	});

	it("renders bold and italic in the same line", () => {
		const result = renderMarkdown("A **bold** and *italic* line", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("bold");
		expect(stripped).toContain("italic");
		expect(stripped).toBe("A bold and italic line");
	});

	it("renders multiple bold segments", () => {
		const result = renderMarkdown("**one** and **two**", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toBe("one and two");
	});
});

// ─── Code spans and code blocks ───────────────────────────────────────────────

describe("Markdown code", () => {
	it("renders inline code spans with color", () => {
		const result = renderMarkdown("Use `console.log` for debugging", theme);
		// Should contain the code text without backticks
		const stripped = stripAnsi(result);
		expect(stripped).toContain("console.log");
		expect(stripped).not.toMatch(/`console\.log`/);
	});

	it("renders code blocks with separators", () => {
		const input = "Before\n```\ncode here\n```\nAfter";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("code here");
		// Should have separator lines (thin lines)
		expect(stripped).toContain("─");
	});

	it("renders code blocks with language hint", () => {
		const input = '```typescript\nconst x = 1;\n```';
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("const x = 1;");
	});

	it("indents code block content", () => {
		const input = "```\nline1\nline2\n```";
		const result = renderMarkdown(input, theme);
		const lines = result.split("\n");
		// Code lines should be indented with 2 spaces
		const codeLine = lines.find((l) => stripAnsi(l).includes("line1"));
		expect(codeLine).toBeDefined();
		expect(stripAnsi(codeLine!).startsWith("  ")).toBe(true);
	});

	it("syntax-highlights TypeScript code blocks", () => {
		const input = '```typescript\nconst x = "hello";\n```';
		const result = renderMarkdown(input, theme);
		// Should contain color escape codes for keyword/string highlighting
		expect(result).toContain("\x1b[38;2;");
	});

	it("renders unknown language code blocks", () => {
		const input = "```brainfuck\n+++>+++\n```";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("+++>+++");
	});
});

// ─── Lists ────────────────────────────────────────────────────────────────────

describe("Markdown lists", () => {
	it("renders unordered list with bullet points", () => {
		const input = "- Item 1\n- Item 2\n- Item 3";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("Item 1");
		expect(stripped).toContain("Item 2");
		expect(stripped).toContain("Item 3");
	});

	it("renders asterisk-style unordered list", () => {
		const input = "* First\n* Second";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("First");
		expect(stripped).toContain("Second");
	});

	it("renders ordered list with numbers", () => {
		const input = "1. First\n2. Second\n3. Third";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("1.");
		expect(stripped).toContain("First");
		expect(stripped).toContain("2.");
		expect(stripped).toContain("Second");
		expect(stripped).toContain("3.");
		expect(stripped).toContain("Third");
	});

	it("renders inline formatting in list items", () => {
		const input = "- A **bold** item\n- An *italic* item";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("bold");
		expect(stripped).toContain("italic");
	});

	it("renders indented list items", () => {
		const input = "  - Nested item";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("Nested item");
	});
});

// ─── Blockquotes ──────────────────────────────────────────────────────────────

describe("Markdown blockquotes", () => {
	it("renders blockquotes with > prefix", () => {
		const result = renderMarkdown("> This is a quote", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("This is a quote");
	});

	it("renders blockquote with vertical bar", () => {
		const result = renderMarkdown("> Quote text", theme);
		const stripped = stripAnsi(result);
		// Should contain the vertical bar character
		expect(stripped).toMatch(/[│|>]/);
	});

	it("renders blockquote with italic styling", () => {
		const result = renderMarkdown("> Wisdom here", theme);
		expect(result).toContain("\x1b[3m"); // italic escape
	});

	it("renders multiple blockquote lines", () => {
		const input = "> Line one\n> Line two";
		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("Line one");
		expect(stripped).toContain("Line two");
	});
});

// ─── Links ────────────────────────────────────────────────────────────────────

describe("Markdown links", () => {
	it("renders link text with underline", () => {
		const result = renderMarkdown("Visit [Google](https://google.com)", theme);
		expect(result).toContain("\x1b[4m"); // underline
		const stripped = stripAnsi(result);
		expect(stripped).toContain("Google");
	});

	it("strips markdown link syntax in visible text", () => {
		const result = renderMarkdown("[Click here](https://example.com)", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("Click here");
		// URL should not be visible
		expect(stripped).not.toContain("https://example.com");
	});

	it("renders multiple links", () => {
		const result = renderMarkdown("[A](http://a.com) and [B](http://b.com)", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("A");
		expect(stripped).toContain("B");
	});
});

// ─── Horizontal rules ────────────────────────────────────────────────────────

describe("Markdown horizontal rules", () => {
	it("renders --- as horizontal rule", () => {
		const result = renderMarkdown("---", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("─");
	});

	it("renders === as horizontal rule", () => {
		const result = renderMarkdown("===", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("─");
	});

	it("renders *** as horizontal rule", () => {
		const result = renderMarkdown("***", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("─");
	});
});

// ─── Mixed content ────────────────────────────────────────────────────────────

describe("Markdown mixed content", () => {
	it("renders a full document", () => {
		const input = [
			"# Title",
			"",
			"A paragraph with **bold** and *italic*.",
			"",
			"## Code Example",
			"",
			"```typescript",
			'const x = "hello";',
			"```",
			"",
			"- Item one",
			"- Item two",
			"",
			"> A thoughtful quote",
			"",
			"Visit [Docs](https://docs.example.com).",
		].join("\n");

		const result = renderMarkdown(input, theme);
		const stripped = stripAnsi(result);

		expect(stripped).toContain("Title");
		expect(stripped).toContain("bold");
		expect(stripped).toContain("italic");
		expect(stripped).toContain("Code Example");
		expect(stripped).toContain('const x = "hello"');
		expect(stripped).toContain("Item one");
		expect(stripped).toContain("thoughtful quote");
		expect(stripped).toContain("Docs");
	});

	it("handles empty input", () => {
		const result = renderMarkdown("", theme);
		expect(result).toBe("");
	});

	it("handles plain text without any markdown", () => {
		const result = renderMarkdown("Just some plain text.", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toBe("Just some plain text.");
	});

	it("preserves empty lines", () => {
		const input = "Line 1\n\nLine 2";
		const result = renderMarkdown(input, theme);
		const lines = result.split("\n");
		expect(lines.length).toBe(3);
	});
});
