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
});
