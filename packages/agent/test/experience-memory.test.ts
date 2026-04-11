import type { ToolDefinition } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { buildStrategyPrompt, compactMessagesDetailed, ExperienceMemory, type MessagePayload } from "../src/index.js";

function makeTool(name: string, description: string, category: ToolDefinition["category"]): ToolDefinition {
	return {
		name,
		description,
		category,
		inputSchema: { type: "object", properties: {} },
		requiresPermission: false,
	};
}

describe("ExperienceMemory", () => {
	it("archives compaction summaries and renders runtime prompt state", () => {
		const memory = new ExperienceMemory();
		const compacted: MessagePayload[] = [
			{ role: "user", content: [{ type: "text", text: "Inspect src/app.ts" }] },
			{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "read_file", input: { path: "src/app.ts" } }] },
		];

		memory.archiveCompaction("Investigated src/app.ts before editing.", compacted, []);
		memory.recordToolUse("read_file", { path: "src/app.ts" }, { output: "export const ok = true;", isError: false });

		const prompt = memory.buildPromptSection();
		expect(prompt).toContain("Indexed Experience Memory");
		expect(prompt).toContain("MEM-001");
		expect(prompt).toContain("read_file");
		expect(prompt).toContain("src/app.ts");
	});

	it("finds relevant archives by file, tool, and summary overlap", () => {
		const memory = new ExperienceMemory();
		memory.archiveCompaction(
			"Updated src/config.ts after tracing the env loader.",
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "cfg-1", name: "write_file", input: { path: "src/config.ts" } }],
				},
			],
			[],
		);
		memory.archiveCompaction(
			"Reviewed README wording for docs cleanup.",
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "docs-1", name: "read_file", input: { path: "README.md" } }],
				},
			],
			[],
		);

		const recalled = memory.findRelevantArchives("fix the config loader in src/config.ts");

		expect(recalled[0]?.archive.summary).toContain("src/config.ts");
		expect(recalled[0]?.reason).toContain("src/config.ts");
		expect(recalled.some((entry) => entry.archive.summary.includes("README"))).toBe(false);
	});

	it("builds a selective rehydration section instead of dumping unrelated archives", () => {
		const memory = new ExperienceMemory();
		memory.archiveCompaction(
			"Investigated flaky tests in src/cache.ts.",
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "cache-1", name: "grep", input: { path: "src/cache.ts" } }],
				},
			],
			[],
		);
		memory.archiveCompaction(
			"Edited docs/reference.md to explain the CLI.",
			[
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "docs-1", name: "write_file", input: { path: "docs/reference.md" } }],
				},
			],
			[],
		);

		const prompt = memory.buildRehydrationPromptSection("debug cache invalidation in src/cache.ts");

		expect(prompt).toContain("Relevant Archived Experience");
		expect(prompt).toContain("src/cache.ts");
		expect(prompt).not.toContain("docs/reference.md");
	});

	it("ranks tools using query overlap and recent runtime state", () => {
		const memory = new ExperienceMemory();
		memory.recordToolUse("read_file", { path: "README.md" }, { output: "docs", isError: false });

		const ranked = memory.rankTools(
			[
				makeTool("read_file", "Read file contents from disk", "read"),
				makeTool("bash", "Run tests and build commands", "execute"),
			],
			"read the README and check the docs",
		);

		expect(ranked[0]?.name).toBe("read_file");
		expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? -1);
	});

	it("buildFileAwarenessSummary returns null when no tool state recorded", () => {
		const memory = new ExperienceMemory();
		expect(memory.buildFileAwarenessSummary()).toBeNull();
	});

	it("buildFileAwarenessSummary categorizes written and read files", () => {
		const memory = new ExperienceMemory();
		memory.recordToolUse("write_file", { path: "src/app.ts" }, { output: "ok", isError: false });
		memory.recordToolUse("read_file", { path: "src/config.ts" }, { output: "contents", isError: false });
		memory.recordToolUse("edit_file", { path: "src/utils.ts" }, { output: "ok", isError: false });

		const summary = memory.buildFileAwarenessSummary();
		expect(summary).not.toBeNull();
		expect(summary).toContain("src/app.ts");
		expect(summary).toContain("src/config.ts");
	});

	it("buildFileAwarenessSummary includes failed tools", () => {
		const memory = new ExperienceMemory();
		memory.recordToolUse("write_file", { path: "locked.ts" }, { output: "EPERM", isError: true });

		const summary = memory.buildFileAwarenessSummary();
		expect(summary).not.toBeNull();
		expect(summary).toContain("locked.ts");
	});
});

describe("buildStrategyPrompt", () => {
	it("includes ranked tools and strategy guidance", () => {
		const memory = new ExperienceMemory();
		memory.recordToolUse("grep", { path: "src" }, { output: "match", isError: false });

		const prompt = buildStrategyPrompt(
			"find the failing symbol and verify the fix",
			[makeTool("grep", "Search the codebase", "read"), makeTool("bash", "Run tests and build commands", "execute")],
			memory,
		);

		expect(prompt).toContain("Strategy-Guided Loop");
		expect(prompt).toContain("grep");
		expect(prompt).toContain("verification step");
	});
});

describe("compactMessagesDetailed", () => {
	it("returns summary metadata alongside compacted messages", () => {
		const messages: MessagePayload[] = [
			{ role: "user", content: [{ type: "text", text: "Open the project" }] },
			{ role: "assistant", content: [{ type: "text", text: "Inspecting it now" }] },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tc-1", name: "read_file", input: { path: "README.md" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tc-1", content: "Takumi docs", is_error: false }],
			},
			{ role: "assistant", content: [{ type: "text", text: "Ready to update" }] },
		];

		const result = compactMessagesDetailed(messages, { preserveRecent: 2 });

		expect(result.summary).toContain("Previous conversation summary:");
		expect(result.compactedMessages).toHaveLength(3);
		expect(result.keptMessages).toHaveLength(2);
		expect(result.messages[0]?.role).toBe("user");
	});

	it("preserves file operation references in compaction summary", () => {
		const messages: MessagePayload[] = [
			{ role: "user", content: [{ type: "text", text: "Edit the config" }] },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tc-1", name: "write_file", input: { path: "src/config.ts" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tc-1", content: "written", is_error: false }],
			},
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tc-2", name: "read_file", input: { filePath: "src/app.ts" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tc-2", content: "contents", is_error: false }],
			},
			{ role: "assistant", content: [{ type: "text", text: "Done with the changes" }] },
			{ role: "user", content: [{ type: "text", text: "Thanks" }] },
		];

		const result = compactMessagesDetailed(messages, { preserveRecent: 2 });

		expect(result.summary).toContain("Files touched");
		expect(result.summary).toContain("src/config.ts");
		expect(result.summary).toContain("src/app.ts");
		expect(result.summary).toContain("write_file");
		expect(result.summary).toContain("read_file");
	});

	it("deduplicates identical file operations in summary", () => {
		const messages: MessagePayload[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tc-1", name: "read_file", input: { path: "foo.ts" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tc-1", content: "v1", is_error: false }],
			},
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tc-2", name: "read_file", input: { path: "foo.ts" } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tc-2", content: "v2", is_error: false }],
			},
			{ role: "assistant", content: [{ type: "text", text: "done" }] },
			{ role: "user", content: [{ type: "text", text: "ok" }] },
		];

		const result = compactMessagesDetailed(messages, { preserveRecent: 2 });

		// "read_file → foo.ts" should appear only once
		const matches = result.summary.match(/read_file → foo\.ts/g);
		expect(matches).toHaveLength(1);
	});

	it("skips file operations section when no tool_use blocks exist", () => {
		const messages: MessagePayload[] = [
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "Hi there" }] },
			{ role: "user", content: [{ type: "text", text: "What can you do?" }] },
			{ role: "assistant", content: [{ type: "text", text: "I can help" }] },
		];

		const result = compactMessagesDetailed(messages, { preserveRecent: 2 });

		expect(result.summary).not.toContain("Files touched");
	});
});
