import type { ToolDefinition, ToolResult } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildToolResult, buildUserMessage } from "../src/message.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		name: "read_file",
		description: "Read a file from disk.",
		inputSchema: { type: "object", properties: { path: { type: "string" } } },
		requiresPermission: false,
		category: "read",
		...overrides,
	};
}

// ── buildSystemPrompt ────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
	it("returns a valid prompt with no tools", () => {
		const result = buildSystemPrompt([]);

		expect(result).toContain("You are Takumi");
		expect(result).toContain("## Available Tools");
		// No tool headings
		expect(result).not.toContain("### ");
	});

	it("includes a single tool's name, description, and category", () => {
		const tool = makeTool({
			name: "write_file",
			description: "Write content to a file.",
			category: "write",
		});
		const result = buildSystemPrompt([tool]);

		expect(result).toContain("### write_file");
		expect(result).toContain("Write content to a file.");
		expect(result).toContain("Category: write");
	});

	it("includes all tools when given multiple", () => {
		const tools: ToolDefinition[] = [
			makeTool({ name: "read_file", category: "read" }),
			makeTool({ name: "search_code", category: "search" }),
			makeTool({ name: "exec_cmd", category: "execute" }),
		];
		const result = buildSystemPrompt(tools);

		expect(result).toContain("### read_file");
		expect(result).toContain("### search_code");
		expect(result).toContain("### exec_cmd");
		expect(result).toContain("Category: read");
		expect(result).toContain("Category: search");
		expect(result).toContain("Category: execute");
	});

	it("shows 'Requires user permission.' for tools that require permission", () => {
		const tool = makeTool({
			name: "exec_cmd",
			requiresPermission: true,
			category: "execute",
		});
		const result = buildSystemPrompt([tool]);

		expect(result).toContain("Requires user permission.");
	});

	it("does NOT show 'Requires user permission.' for tools that do not require it", () => {
		const tool = makeTool({
			name: "read_file",
			requiresPermission: false,
			category: "read",
		});
		const result = buildSystemPrompt([tool]);

		expect(result).not.toContain("Requires user permission.");
	});

	it("includes both permission and non-permission tools correctly", () => {
		const tools: ToolDefinition[] = [
			makeTool({ name: "read_file", requiresPermission: false }),
			makeTool({ name: "exec_cmd", requiresPermission: true, category: "execute" }),
		];
		const result = buildSystemPrompt(tools);

		// The prompt should contain the permission line exactly once
		const matches = result.match(/Requires user permission\./g);
		expect(matches).toHaveLength(1);
	});

	it("includes the system prompt guidelines section", () => {
		const result = buildSystemPrompt([]);

		expect(result).toContain("## Guidelines");
		expect(result).toContain("Be concise and direct");
		expect(result).toContain("Use tools to accomplish tasks");
		expect(result).toContain("absolute paths");
	});

	it("preserves tool description verbatim", () => {
		const desc = "This is a **special** tool with <html> chars & symbols!";
		const tool = makeTool({ description: desc });
		const result = buildSystemPrompt([tool]);

		expect(result).toContain(desc);
	});
});

// ── buildUserMessage ─────────────────────────────────────────────────────────

describe("buildUserMessage", () => {
	it("wraps simple text in a text content block", () => {
		const result = buildUserMessage("Hello, world!");

		expect(result).toEqual([{ type: "text", text: "Hello, world!" }]);
	});

	it("handles an empty string", () => {
		const result = buildUserMessage("");

		expect(result).toEqual([{ type: "text", text: "" }]);
	});

	it("handles multiline text", () => {
		const multiline = "line one\nline two\nline three";
		const result = buildUserMessage(multiline);

		expect(result).toEqual([{ type: "text", text: multiline }]);
		expect(result[0].text).toContain("\n");
	});

	it("returns a single-element array", () => {
		const result = buildUserMessage("test");

		expect(result).toHaveLength(1);
	});

	it("always has type 'text'", () => {
		const result = buildUserMessage("anything");

		expect(result[0].type).toBe("text");
	});

	it("preserves special characters", () => {
		const special = "café résumé naïve 日本語 🎯";
		const result = buildUserMessage(special);

		expect(result[0].text).toBe(special);
	});
});

// ── buildToolResult ──────────────────────────────────────────────────────────

describe("buildToolResult", () => {
	it("builds a success tool result", () => {
		const toolResult: ToolResult = {
			output: "File contents here.",
			isError: false,
		};
		const result = buildToolResult("toolu_abc123", toolResult);

		expect(result).toEqual({
			type: "tool_result",
			tool_use_id: "toolu_abc123",
			content: "File contents here.",
			is_error: false,
		});
	});

	it("builds an error tool result", () => {
		const toolResult: ToolResult = {
			output: "Error: file not found",
			isError: true,
		};
		const result = buildToolResult("toolu_err456", toolResult);

		expect(result).toEqual({
			type: "tool_result",
			tool_use_id: "toolu_err456",
			content: "Error: file not found",
			is_error: true,
		});
	});

	it("preserves the tool_use_id exactly", () => {
		const toolResult: ToolResult = { output: "ok", isError: false };
		const id = "toolu_very_long_id_with_special_chars_12345";
		const result = buildToolResult(id, toolResult);

		expect(result.tool_use_id).toBe(id);
	});

	it("always has type 'tool_result'", () => {
		const toolResult: ToolResult = { output: "", isError: false };
		const result = buildToolResult("toolu_x", toolResult);

		expect(result.type).toBe("tool_result");
	});

	it("handles empty output string", () => {
		const toolResult: ToolResult = { output: "", isError: false };
		const result = buildToolResult("toolu_empty", toolResult);

		expect(result.content).toBe("");
		expect(result.is_error).toBe(false);
	});

	it("maps isError to is_error (camelCase to snake_case)", () => {
		const errorResult: ToolResult = { output: "fail", isError: true };
		const successResult: ToolResult = { output: "ok", isError: false };

		expect(buildToolResult("a", errorResult).is_error).toBe(true);
		expect(buildToolResult("b", successResult).is_error).toBe(false);
	});

	it("handles multiline output", () => {
		const toolResult: ToolResult = {
			output: "line1\nline2\nline3",
			isError: false,
		};
		const result = buildToolResult("toolu_multi", toolResult);

		expect(result.content).toBe("line1\nline2\nline3");
	});
});
