/**
 * Tests for markdown rendering integration in the message display pipeline.
 * Verifies that:
 *   - Assistant text blocks get markdown formatting (headings, bold, italic, etc.)
 *   - Code blocks get syntax highlighting
 *   - User messages are NOT markdown-rendered
 *   - Tool outputs are NOT markdown-rendered
 *   - Edge cases are handled (empty content, long code blocks, unknown languages)
 */

import { describe, it, expect } from "vitest";
import {
	formatUserMessage,
	formatAssistantMessage,
	formatMessage,
} from "../src/formatters/message.js";
import { renderMarkdown, getTheme, setTheme, defaultTheme } from "@takumi/render";
import type { Message } from "@takumi/core";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Strip all ANSI escape sequences from a string for content assertions. */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Check if a string contains ANSI escape sequences. */
function hasAnsi(text: string): boolean {
	return /\x1b\[/.test(text);
}

function makeMessage(overrides?: Partial<Message>): Message {
	return {
		id: "msg-1",
		role: "user",
		content: [{ type: "text", text: "hello" }],
		timestamp: Date.now(),
		...overrides,
	};
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Assistant messages get markdown formatting                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("markdown rendering in assistant messages", () => {
	/* ---- Headers --------------------------------------------------------- */

	it("renders markdown headings with ANSI formatting", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "# Hello World" }],
		});
		const output = formatAssistantMessage(msg);
		// Should contain ANSI escapes (styled heading)
		expect(hasAnsi(output)).toBe(true);
		// Stripped content should have the heading text
		const stripped = stripAnsi(output);
		expect(stripped).toContain("Hello World");
	});

	it("renders h2 headings", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "## Section Title" }],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		expect(stripped).toContain("Section Title");
	});

	it("renders h3-h6 headings", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "### Subsection\n#### Deep\n##### Deeper\n###### Deepest" }],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		expect(stripped).toContain("Subsection");
		expect(stripped).toContain("Deep");
		expect(stripped).toContain("Deeper");
		expect(stripped).toContain("Deepest");
	});

	/* ---- Bold / Italic -------------------------------------------------- */

	it("renders bold text with ANSI bold codes", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "This is **bold** text" }],
		});
		const output = formatAssistantMessage(msg);
		// Should contain ANSI bold sequence \x1b[1m
		expect(output).toContain("\x1b[1m");
		const stripped = stripAnsi(output);
		expect(stripped).toContain("bold");
		expect(stripped).toContain("This is");
	});

	it("renders italic text with ANSI italic codes", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "This is *italic* text" }],
		});
		const output = formatAssistantMessage(msg);
		// Should contain ANSI italic sequence \x1b[3m
		expect(output).toContain("\x1b[3m");
		const stripped = stripAnsi(output);
		expect(stripped).toContain("italic");
	});

	/* ---- Inline code ---------------------------------------------------- */

	it("renders inline code with distinct styling", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "Use the `console.log` function" }],
		});
		const output = formatAssistantMessage(msg);
		// Should have ANSI styling around the code span
		expect(hasAnsi(output)).toBe(true);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("console.log");
		expect(stripped).toContain("Use the");
	});

	/* ---- Code blocks ---------------------------------------------------- */

	it("renders fenced code blocks with separator lines", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: "Here is code:\n```\nconst x = 1;\n```",
			}],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		// Separator lines (horizontal rule characters)
		expect(stripped).toContain("─");
		expect(stripped).toContain("const x = 1;");
	});

	it("renders code blocks with language-specific syntax highlighting", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: '```typescript\nconst x: string = "hello";\nfunction greet() {}\n```',
			}],
		});
		const output = formatAssistantMessage(msg);
		// Should contain ANSI color codes (syntax highlighting)
		expect(hasAnsi(output)).toBe(true);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("const");
		expect(stripped).toContain("string");
		expect(stripped).toContain("hello");
		expect(stripped).toContain("greet");
	});

	it("renders Python code with syntax highlighting", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: '```python\ndef hello():\n    return "world"\n```',
			}],
		});
		const output = formatAssistantMessage(msg);
		expect(hasAnsi(output)).toBe(true);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("def");
		expect(stripped).toContain("hello");
		expect(stripped).toContain("world");
	});

	/* ---- Lists ---------------------------------------------------------- */

	it("renders unordered lists with bullet markers", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "Items:\n- First\n- Second\n- Third" }],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		// Bullets are rendered as Unicode bullet character
		expect(stripped).toContain("\u2022");
		expect(stripped).toContain("First");
		expect(stripped).toContain("Second");
		expect(stripped).toContain("Third");
	});

	it("renders ordered lists", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "Steps:\n1. First\n2. Second\n3. Third" }],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		expect(stripped).toContain("1.");
		expect(stripped).toContain("2.");
		expect(stripped).toContain("3.");
		expect(stripped).toContain("First");
	});

	/* ---- Blockquotes ---------------------------------------------------- */

	it("renders blockquotes with vertical bar", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "> This is a quote" }],
		});
		const output = formatAssistantMessage(msg);
		expect(hasAnsi(output)).toBe(true);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("\u2502");
		expect(stripped).toContain("This is a quote");
	});

	/* ---- Links ---------------------------------------------------------- */

	it("renders links with underline styling", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "Visit [Google](https://google.com) for more" }],
		});
		const output = formatAssistantMessage(msg);
		// Underline ANSI code
		expect(output).toContain("\x1b[4m");
		const stripped = stripAnsi(output);
		expect(stripped).toContain("Google");
	});

	/* ---- Horizontal rules ----------------------------------------------- */

	it("renders horizontal rules as separator lines", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "Above\n---\nBelow" }],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		expect(stripped).toContain("─");
		expect(stripped).toContain("Above");
		expect(stripped).toContain("Below");
	});

	/* ---- Mixed content -------------------------------------------------- */

	it("renders mixed markdown content correctly", () => {
		const md = [
			"# Title",
			"",
			"Here is **bold** and *italic* text.",
			"",
			"```ts",
			"const x = 42;",
			"```",
			"",
			"- Item one",
			"- Item two",
		].join("\n");

		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: md }],
		});
		const output = formatAssistantMessage(msg);
		expect(hasAnsi(output)).toBe(true);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("Title");
		expect(stripped).toContain("bold");
		expect(stripped).toContain("italic");
		expect(stripped).toContain("const x = 42;");
		expect(stripped).toContain("Item one");
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  User messages are NOT markdown-rendered                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("user messages are not markdown-rendered", () => {
	it("preserves markdown syntax as-is in user messages", () => {
		const msg = makeMessage({
			role: "user",
			content: [{ type: "text", text: "# Not a heading\n**not bold**" }],
		});
		const output = formatUserMessage(msg);
		const stripped = stripAnsi(output);
		// The markdown syntax characters should be preserved literally
		expect(stripped).toContain("# Not a heading");
		expect(stripped).toContain("**not bold**");
	});

	it("does not apply ANSI bold for markdown bold syntax in user messages", () => {
		const msg = makeMessage({
			role: "user",
			content: [{ type: "text", text: "**important**" }],
		});
		const output = formatUserMessage(msg);
		// The only ANSI in user output should be from the "You" header
		// The text itself should not have bold ANSI applied to "important"
		const stripped = stripAnsi(output);
		expect(stripped).toContain("**important**");
	});

	it("does not syntax-highlight code blocks in user messages", () => {
		const msg = makeMessage({
			role: "user",
			content: [{ type: "text", text: "```ts\nconst x = 1;\n```" }],
		});
		const output = formatUserMessage(msg);
		const stripped = stripAnsi(output);
		// Backticks should be preserved literally
		expect(stripped).toContain("```ts");
		expect(stripped).toContain("const x = 1;");
		expect(stripped).toContain("```");
	});

	it("formatMessage routes user messages through plain text path", () => {
		const msg = makeMessage({
			role: "user",
			content: [{ type: "text", text: "# heading\n**bold**" }],
		});
		const output = formatMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("You");
		expect(stripped).toContain("# heading");
		expect(stripped).toContain("**bold**");
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Tool outputs are NOT markdown-rendered                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("tool outputs are not markdown-rendered", () => {
	it("tool_use blocks are not markdown-rendered", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tu-1",
					name: "read_file",
					input: { path: "# not-a-heading.md" },
				},
			],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("[tool: read_file]");
	});

	it("tool_result success blocks are not markdown-rendered", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [
				{
					type: "tool_result",
					toolUseId: "tu-1",
					content: "# This is **not** rendered as markdown",
					isError: false,
				},
			],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("[result]");
		// Markdown syntax should be preserved literally
		expect(stripped).toContain("# This is **not** rendered as markdown");
	});

	it("tool_result error blocks are not markdown-rendered", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [
				{
					type: "tool_result",
					toolUseId: "tu-1",
					content: "```Error: file not found```",
					isError: true,
				},
			],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("[error]");
		expect(stripped).toContain("Error: file not found");
	});

	it("thinking blocks are not markdown-rendered", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "# Step 1\n**Bold thinking**\n```code```",
				},
			],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("[thinking]");
		// Should show truncated raw text, not rendered markdown
		expect(stripped).toContain("# Step 1");
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Edge cases                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("markdown rendering edge cases", () => {
	it("handles empty text content", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "" }],
		});
		const output = formatAssistantMessage(msg);
		// Should not crash, should still have the header
		const stripped = stripAnsi(output);
		expect(stripped).toContain("Takumi");
	});

	it("handles text with only whitespace", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "   \n   \n   " }],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("Takumi");
	});

	it("handles very long code blocks", () => {
		const longCode = Array.from({ length: 200 }, (_, i) =>
			`const line${i} = ${i};`,
		).join("\n");
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: `\`\`\`typescript\n${longCode}\n\`\`\`` }],
		});
		const output = formatAssistantMessage(msg);
		expect(hasAnsi(output)).toBe(true);
		const stripped = stripAnsi(output);
		// First and last lines should be present
		expect(stripped).toContain("const line0 = 0;");
		expect(stripped).toContain("const line199 = 199;");
	});

	it("handles unknown language in code blocks gracefully", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: "```brainfuck\n++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.\n```",
			}],
		});
		const output = formatAssistantMessage(msg);
		// Should not crash
		const stripped = stripAnsi(output);
		expect(stripped).toContain("++++++++");
		// Should still have separator lines
		expect(stripped).toContain("─");
	});

	it("handles code block without language specifier", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: "```\nplain code here\n```",
			}],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("plain code here");
		expect(stripped).toContain("─");
	});

	it("handles unclosed code block (partial markdown)", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: "Before\n```typescript\nconst x = 1;\n// no closing fence",
			}],
		});
		// Should not crash — the renderMarkdown function handles this
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		expect(stripped).toContain("Before");
	});

	it("handles nested markdown-like syntax in code blocks", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: '```markdown\n# This is a heading\n**bold** and *italic*\n```',
			}],
		});
		const output = formatAssistantMessage(msg);
		const stripped = stripAnsi(output);
		// Inside code block, markdown syntax should be preserved as code
		expect(stripped).toContain("# This is a heading");
	});

	it("handles multiple text blocks in one assistant message", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [
				{ type: "text", text: "# First Block" },
				{ type: "text", text: "# Second Block" },
			],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		expect(stripped).toContain("First Block");
		expect(stripped).toContain("Second Block");
	});

	it("handles text with special characters that look like markdown", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{
				type: "text",
				text: "Price is $100 * 2 = $200. Use array[0] for first item.",
			}],
		});
		const output = formatAssistantMessage(msg);
		// Should not crash on incomplete markdown patterns
		const stripped = stripAnsi(output);
		expect(stripped).toContain("$100");
		expect(stripped).toContain("$200");
	});

	it("handles many consecutive empty lines", () => {
		const msg = makeMessage({
			role: "assistant",
			content: [{ type: "text", text: "Line 1\n\n\n\n\nLine 2" }],
		});
		const stripped = stripAnsi(formatAssistantMessage(msg));
		expect(stripped).toContain("Line 1");
		expect(stripped).toContain("Line 2");
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  renderMarkdown standalone function tests                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("renderMarkdown standalone", () => {
	it("renders plain text without modification", () => {
		const theme = getTheme();
		const result = renderMarkdown("Hello world", theme);
		const stripped = stripAnsi(result);
		expect(stripped).toBe("Hello world");
	});

	it("converts headers to styled output", () => {
		const theme = getTheme();
		const result = renderMarkdown("# Title", theme);
		expect(hasAnsi(result)).toBe(true);
		expect(stripAnsi(result)).toContain("Title");
	});

	it("renders code blocks with language", () => {
		const theme = getTheme();
		const result = renderMarkdown(
			'```ts\nconst x = "hello";\n```',
			theme,
		);
		expect(hasAnsi(result)).toBe(true);
		const stripped = stripAnsi(result);
		expect(stripped).toContain("const");
		expect(stripped).toContain("hello");
	});

	it("returns empty string for empty input", () => {
		const theme = getTheme();
		const result = renderMarkdown("", theme);
		expect(result).toBe("");
	});
});
