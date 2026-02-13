import { describe, it, expect } from "vitest";
import {
	formatUserMessage,
	formatAssistantMessage,
	formatMessage,
} from "../src/formatters/message.js";
import {
	formatToolCall,
	formatToolResult,
	formatToolSummary,
} from "../src/formatters/tool-call.js";
import {
	formatThinkingBlock,
	formatThinkingSummary,
} from "../src/formatters/thinking.js";
import type { Message, ToolUseBlock, ToolResultBlock } from "@takumi/core";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/** Strip ANSI escape sequences from a string for easier assertion. */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
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

function makeToolUseBlock(overrides?: Partial<ToolUseBlock>): ToolUseBlock {
	return {
		type: "tool_use",
		id: "tool-1",
		name: "read",
		input: {},
		...overrides,
	};
}

function makeToolResultBlock(overrides?: Partial<ToolResultBlock>): ToolResultBlock {
	return {
		type: "tool_result",
		toolUseId: "tool-1",
		content: "result text",
		isError: false,
		...overrides,
	};
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  formatters/message.ts                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("formatters/message", () => {
	/* ---- formatUserMessage ----------------------------------------------- */

	describe("formatUserMessage", () => {
		it("shows 'You' header", () => {
			const msg = makeMessage({ role: "user" });
			const output = stripAnsi(formatUserMessage(msg));
			expect(output).toContain("You");
		});

		it("includes text content", () => {
			const msg = makeMessage({
				role: "user",
				content: [{ type: "text", text: "Write a function" }],
			});
			const output = stripAnsi(formatUserMessage(msg));
			expect(output).toContain("Write a function");
		});

		it("includes multiple text blocks", () => {
			const msg = makeMessage({
				role: "user",
				content: [
					{ type: "text", text: "First paragraph" },
					{ type: "text", text: "Second paragraph" },
				],
			});
			const output = stripAnsi(formatUserMessage(msg));
			expect(output).toContain("First paragraph");
			expect(output).toContain("Second paragraph");
		});

		it("ignores non-text content blocks", () => {
			const msg = makeMessage({
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "image", mediaType: "image/png", data: "base64..." },
				],
			});
			const output = stripAnsi(formatUserMessage(msg));
			expect(output).toContain("hello");
			// Should not crash on image blocks
		});
	});

	/* ---- formatAssistantMessage ------------------------------------------ */

	describe("formatAssistantMessage", () => {
		it("shows 'Takumi' header", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "Hello!" }],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("Takumi");
		});

		it("includes text content", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "Here is the answer" }],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("Here is the answer");
		});

		it("shows thinking blocks (truncated)", () => {
			const longThinking = "a".repeat(200);
			const msg = makeMessage({
				role: "assistant",
				content: [{ type: "thinking", thinking: longThinking }],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("[thinking]");
			expect(output).toContain("...");
			// Thinking is truncated at 100 chars
			expect(output).not.toContain(longThinking);
		});

		it("shows tool_use blocks with tool name", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tu-1",
						name: "read_file",
						input: { path: "/tmp/file.txt" },
					},
				],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("[tool: read_file]");
		});

		it("shows tool_result success", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [
					{
						type: "tool_result",
						toolUseId: "tu-1",
						content: "file contents here",
						isError: false,
					},
				],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("[result]");
			expect(output).toContain("file contents here");
		});

		it("shows tool_result error", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [
					{
						type: "tool_result",
						toolUseId: "tu-1",
						content: "file not found",
						isError: true,
					},
				],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("[error]");
			expect(output).toContain("file not found");
		});

		it("truncates long tool_result content at 200 chars", () => {
			const longContent = "x".repeat(300);
			const msg = makeMessage({
				role: "assistant",
				content: [
					{
						type: "tool_result",
						toolUseId: "tu-1",
						content: longContent,
						isError: false,
					},
				],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			// Content is sliced at 200
			expect(output).not.toContain(longContent);
		});

		it("shows usage info when present", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
				usage: {
					inputTokens: 150,
					outputTokens: 42,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("150 in");
			expect(output).toContain("42 out");
		});

		it("does not show usage when not present", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).not.toContain(" in,");
			expect(output).not.toContain(" out)");
		});

		it("handles multiple content block types in one message", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Let me think about this." },
					{ type: "text", text: "Here is my answer." },
					{
						type: "tool_use",
						id: "tu-1",
						name: "bash",
						input: { command: "ls" },
					},
				],
			});
			const output = stripAnsi(formatAssistantMessage(msg));
			expect(output).toContain("Takumi");
			expect(output).toContain("[thinking]");
			expect(output).toContain("Here is my answer.");
			expect(output).toContain("[tool: bash]");
		});
	});

	/* ---- formatMessage --------------------------------------------------- */

	describe("formatMessage", () => {
		it("detects user role and formats as user message", () => {
			const msg = makeMessage({
				role: "user",
				content: [{ type: "text", text: "Hi" }],
			});
			const output = stripAnsi(formatMessage(msg));
			expect(output).toContain("You");
			expect(output).not.toContain("Takumi");
		});

		it("detects assistant role and formats as assistant message", () => {
			const msg = makeMessage({
				role: "assistant",
				content: [{ type: "text", text: "Hello!" }],
			});
			const output = stripAnsi(formatMessage(msg));
			expect(output).toContain("Takumi");
			expect(output).not.toContain("You");
		});
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  formatters/tool-call.ts                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("formatters/tool-call", () => {
	/* ---- formatToolCall -------------------------------------------------- */

	describe("formatToolCall", () => {
		it("shows tool name in bold", () => {
			const block = makeToolUseBlock({ name: "read" });
			const output = stripAnsi(formatToolCall(block));
			expect(output).toContain("read");
		});

		it("shows known tool icon for known tools", () => {
			const block = makeToolUseBlock({ name: "bash" });
			const output = formatToolCall(block);
			// bash maps to laptop icon
			expect(output).toContain("\u{1F4BB}");
		});

		it("shows gear icon for unknown tools", () => {
			const block = makeToolUseBlock({ name: "custom_tool" });
			const output = formatToolCall(block);
			expect(output).toContain("\u{2699}");
		});

		it("shows input arguments", () => {
			const block = makeToolUseBlock({
				name: "read",
				input: { path: "/tmp/file.txt" },
			});
			const output = stripAnsi(formatToolCall(block));
			expect(output).toContain("path:");
			expect(output).toContain("/tmp/file.txt");
		});

		it("truncates long string input values at 80 chars", () => {
			const longValue = "a".repeat(100);
			const block = makeToolUseBlock({
				name: "write",
				input: { content: longValue },
			});
			const output = stripAnsi(formatToolCall(block));
			// Truncated to 77 chars + "..."
			expect(output).toContain("...");
			expect(output).not.toContain(longValue);
		});

		it("does not truncate short values", () => {
			const shortValue = "short text";
			const block = makeToolUseBlock({
				name: "edit",
				input: { content: shortValue },
			});
			const output = stripAnsi(formatToolCall(block));
			expect(output).toContain(shortValue);
			expect(output).not.toContain("...");
		});

		it("JSON-stringifies non-string values", () => {
			const block = makeToolUseBlock({
				name: "bash",
				input: { timeout: 5000, verbose: true },
			});
			const output = stripAnsi(formatToolCall(block));
			expect(output).toContain("5000");
			expect(output).toContain("true");
		});

		it("shows multiple input key-value pairs", () => {
			const block = makeToolUseBlock({
				name: "edit",
				input: { path: "/tmp/a.ts", old: "foo", new: "bar" },
			});
			const output = stripAnsi(formatToolCall(block));
			expect(output).toContain("path:");
			expect(output).toContain("old:");
			expect(output).toContain("new:");
		});

		it("handles empty input object", () => {
			const block = makeToolUseBlock({ name: "read", input: {} });
			const output = stripAnsi(formatToolCall(block));
			// Should just show the tool name, no input lines
			expect(output).toContain("read");
		});
	});

	/* ---- formatToolResult ------------------------------------------------ */

	describe("formatToolResult", () => {
		it("shows 'Result:' header for success", () => {
			const block = makeToolResultBlock({ isError: false });
			const output = stripAnsi(formatToolResult(block));
			expect(output).toContain("Result:");
		});

		it("shows 'Error:' header for errors", () => {
			const block = makeToolResultBlock({ isError: true, content: "Permission denied" });
			const output = stripAnsi(formatToolResult(block));
			expect(output).toContain("Error:");
		});

		it("shows output content", () => {
			const block = makeToolResultBlock({ content: "File contents here" });
			const output = stripAnsi(formatToolResult(block));
			expect(output).toContain("File contents here");
		});

		it("truncates output at 20 lines", () => {
			const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
			const block = makeToolResultBlock({ content: lines.join("\n") });
			const output = stripAnsi(formatToolResult(block));

			// Should show first 20 lines
			expect(output).toContain("line 1");
			expect(output).toContain("line 20");

			// Should show "more lines" indicator
			expect(output).toContain("10 more lines");

			// Should NOT contain lines beyond 20
			expect(output).not.toContain("line 21");
		});

		it("does not truncate when output has <= 20 lines", () => {
			const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
			const block = makeToolResultBlock({ content: lines.join("\n") });
			const output = stripAnsi(formatToolResult(block));

			expect(output).toContain("line 15");
			expect(output).not.toContain("more lines");
		});

		it("handles single-line output", () => {
			const block = makeToolResultBlock({ content: "ok" });
			const output = stripAnsi(formatToolResult(block));
			expect(output).toContain("ok");
			expect(output).not.toContain("more lines");
		});

		it("handles empty content", () => {
			const block = makeToolResultBlock({ content: "" });
			const output = stripAnsi(formatToolResult(block));
			// Should at least show the header
			expect(output).toContain("Result:");
		});
	});

	/* ---- formatToolSummary ----------------------------------------------- */

	describe("formatToolSummary", () => {
		it("shows tool name", () => {
			const output = stripAnsi(formatToolSummary("read", 150, false));
			expect(output).toContain("read");
		});

		it("shows 'done' status for success", () => {
			const output = stripAnsi(formatToolSummary("bash", 100, false));
			expect(output).toContain("done");
		});

		it("shows 'failed' status for error", () => {
			const output = stripAnsi(formatToolSummary("bash", 100, true));
			expect(output).toContain("failed");
		});

		it("shows duration in ms for short operations", () => {
			const output = stripAnsi(formatToolSummary("read", 150, false));
			expect(output).toContain("150ms");
		});

		it("shows duration in seconds for long operations", () => {
			const output = stripAnsi(formatToolSummary("bash", 2500, false));
			expect(output).toContain("2.5s");
		});

		it("shows known tool icon", () => {
			const output = formatToolSummary("bash", 100, false);
			expect(output).toContain("\u{1F4BB}");
		});

		it("shows gear icon for unknown tool", () => {
			const output = formatToolSummary("custom_tool", 50, false);
			expect(output).toContain("\u{2699}");
		});

		it("handles zero duration", () => {
			const output = stripAnsi(formatToolSummary("read", 0, false));
			expect(output).toContain("0ms");
		});

		it("handles exactly 1000ms duration", () => {
			const output = stripAnsi(formatToolSummary("read", 1000, false));
			expect(output).toContain("1.0s");
		});
	});
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  formatters/thinking.ts                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("formatters/thinking", () => {
	/* ---- formatThinkingBlock --------------------------------------------- */

	describe("formatThinkingBlock", () => {
		it("shows thinking header", () => {
			const output = stripAnsi(formatThinkingBlock("Hello world"));
			expect(output).toContain("Thinking...");
		});

		it("shows full text in full mode (default)", () => {
			const thinking = "Step 1: Analyze the code.\nStep 2: Write tests.\nStep 3: Run them.";
			const output = stripAnsi(formatThinkingBlock(thinking));
			expect(output).toContain("Analyze the code");
			expect(output).toContain("Write tests");
			expect(output).toContain("Run them");
		});

		it("shows limited lines in collapsed mode", () => {
			const lines = Array.from({ length: 20 }, (_, i) => `Thinking step ${i + 1}`).join("\n");
			const output = stripAnsi(formatThinkingBlock(lines, { collapsed: true, collapsedLines: 3 }));

			// Should show first 3 lines
			expect(output).toContain("Thinking step 1");
			// Should show "more lines" indicator
			expect(output).toContain("more lines");
		});

		it("shows all lines in collapsed mode when content fits", () => {
			const thinking = "Short thought.";
			const output = stripAnsi(formatThinkingBlock(thinking, { collapsed: true, collapsedLines: 5 }));

			expect(output).toContain("Short thought");
			expect(output).not.toContain("more lines");
		});

		it("defaults collapsed to false", () => {
			const lines = Array.from({ length: 10 }, (_, i) => `Step ${i + 1}`).join("\n");
			const output = stripAnsi(formatThinkingBlock(lines));

			// In full mode, all lines should be present
			expect(output).toContain("Step 1");
			expect(output).toContain("Step 10");
			expect(output).not.toContain("more lines");
		});

		it("defaults collapsedLines to 3", () => {
			const lines = Array.from({ length: 10 }, (_, i) => `Step ${i + 1}`).join("\n");
			const output = stripAnsi(formatThinkingBlock(lines, { collapsed: true }));

			// Default is 3 collapsed lines
			expect(output).toContain("more lines");
		});

		it("respects maxWidth option", () => {
			// A very long single line should be wrapped
			const longLine = "a ".repeat(100);
			const output = formatThinkingBlock(longLine, { maxWidth: 40 });
			// Should produce multiple lines due to wrapping
			const lineCount = output.split("\n").length;
			// At minimum we get the header + some wrapped lines
			expect(lineCount).toBeGreaterThan(2);
		});

		it("defaults maxWidth to 80", () => {
			const thinking = "test";
			// Should not throw with defaults
			const output = formatThinkingBlock(thinking);
			expect(output).toBeDefined();
		});
	});

	/* ---- formatThinkingSummary ------------------------------------------- */

	describe("formatThinkingSummary", () => {
		it("shows thinking icon", () => {
			const output = formatThinkingSummary("Hello world");
			expect(output).toContain("\u{1F4AD}");
		});

		it("shows short text without truncation", () => {
			const output = stripAnsi(formatThinkingSummary("Short thought"));
			expect(output).toContain("Short thought");
			expect(output).not.toContain("...");
		});

		it("truncates at 60 characters", () => {
			const longText = "a".repeat(80);
			const output = stripAnsi(formatThinkingSummary(longText));
			// Should have 60 chars of content + "..."
			expect(output).toContain("...");
		});

		it("does not add ellipsis for exactly 60 char text", () => {
			const text = "a".repeat(60);
			const output = stripAnsi(formatThinkingSummary(text));
			expect(output).not.toContain("...");
		});

		it("replaces newlines with spaces", () => {
			const text = "Line one\nLine two\nLine three";
			const output = stripAnsi(formatThinkingSummary(text));
			expect(output).not.toContain("\n");
			expect(output).toContain("Line one Line two Line three");
		});

		it("returns single line output", () => {
			const output = formatThinkingSummary("Multi\nline\nthinking");
			// Output should be a single line (no newlines except those in ANSI codes)
			const stripped = stripAnsi(output);
			expect(stripped.split("\n")).toHaveLength(1);
		});
	});
});
