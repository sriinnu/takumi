/**
 * Tests for AdaptivePromptManager (Phase 41)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AdaptivePromptManager, classifyTask, type TaskType } from "../src/context/adaptive-prompt.js";

const SAMPLE_PROMPT = [
	"# Identity",
	"You are Takumi, an AI coding assistant.",
	"",
	"# Available Tools",
	"## read_file",
	"Read a file from disk.",
	"Category: read",
	"",
	"## write_file",
	"Write content to a file.",
	"Category: write",
	"",
	"# Project Context",
	"Project: takumi",
	"Language: TypeScript",
	"Framework: Node.js",
	"",
	"# Instructions",
	"Be concise. Use tools. Verify changes.",
	"",
	"# Environment",
	"Platform: darwin",
	"Date: 2025-01-01",
].join("\n");

describe("classifyTask()", () => {
	const cases: [string, TaskType][] = [
		["fix this bug in the parser", "debug"],
		["please review my PR", "review"],
		["find where the config is loaded", "search"],
		["implement a new cache layer", "code"],
		["explain how hooks work", "chat"],
		["asdf qwerty zxcv", "unknown"],
	];

	for (const [input, expected] of cases) {
		it(`classifies "${input}" as ${expected}`, () => {
			expect(classifyTask(input)).toBe(expected);
		});
	}
});

describe("AdaptivePromptManager", () => {
	let manager: AdaptivePromptManager;

	beforeEach(() => {
		manager = new AdaptivePromptManager({ maxTokens: 4096 });
	});

	describe("parseSections()", () => {
		it("parses heading-delimited sections", () => {
			const sections = manager.parseSections(SAMPLE_PROMPT);
			const ids = sections.map((s) => s.id);
			expect(ids).toContain("identity");
			expect(ids).toContain("available-tools");
			expect(ids).toContain("project-context");
			expect(ids).toContain("instructions");
			expect(ids).toContain("environment");
		});

		it("assigns higher priority to identity and tools", () => {
			const sections = manager.parseSections(SAMPLE_PROMPT);
			const identity = sections.find((s) => s.id === "identity")!;
			const env = sections.find((s) => s.id === "environment")!;
			expect(identity.priority).toBeGreaterThan(env.priority);
		});

		it("marks identity and tools as non-optional", () => {
			const sections = manager.parseSections(SAMPLE_PROMPT);
			const identity = sections.find((s) => s.id === "identity")!;
			const tools = sections.find((s) => s.id === "available-tools")!;
			expect(identity.optional).toBe(false);
			expect(tools.optional).toBe(false);
		});

		it("marks other sections as optional", () => {
			const sections = manager.parseSections(SAMPLE_PROMPT);
			const env = sections.find((s) => s.id === "environment")!;
			expect(env.optional).toBe(true);
		});
	});

	describe("adapt()", () => {
		it("includes all sections when budget is generous", () => {
			const result = manager.adapt(SAMPLE_PROMPT, "code");
			expect(result.droppedSections).toHaveLength(0);
			expect(result.includedSections.length).toBeGreaterThanOrEqual(5);
		});

		it("drops optional sections under tight budget", () => {
			const tight = new AdaptivePromptManager({ maxTokens: 50 });
			const result = tight.adapt(SAMPLE_PROMPT, "code");
			expect(result.droppedSections.length).toBeGreaterThan(0);
			// Identity should always survive
			expect(result.includedSections).toContain("identity");
		});

		it("returns correct taskType in result", () => {
			const result = manager.adapt(SAMPLE_PROMPT, "debug");
			expect(result.taskType).toBe("debug");
		});

		it("returns non-empty prompt", () => {
			const result = manager.adapt(SAMPLE_PROMPT, "search");
			expect(result.prompt.length).toBeGreaterThan(0);
		});

		it("estimated tokens does not exceed maxTokens", () => {
			const result = manager.adapt(SAMPLE_PROMPT, "code");
			expect(result.estimatedTokens).toBeLessThanOrEqual(4096);
		});
	});

	describe("adaptForMessage()", () => {
		it("classifies and adapts in one call", () => {
			const result = manager.adaptForMessage(SAMPLE_PROMPT, "find the bug in auth.ts");
			// "find" → search or "bug" → debug — either is valid
			expect(["debug", "search"]).toContain(result.taskType);
			expect(result.prompt.length).toBeGreaterThan(0);
		});
	});

	describe("tool usage tracking", () => {
		it("records tool usage counts", () => {
			manager.recordToolUsage("read_file");
			manager.recordToolUsage("read_file");
			manager.recordToolUsage("grep");
			const profile = manager.getToolProfile();
			expect(profile.counts.read_file).toBe(2);
			expect(profile.counts.grep).toBe(1);
			expect(profile.total).toBe(3);
		});

		it("returns a copy, not internal state", () => {
			manager.recordToolUsage("read_file");
			const p1 = manager.getToolProfile();
			manager.recordToolUsage("read_file");
			const p2 = manager.getToolProfile();
			expect(p1.total).toBe(1);
			expect(p2.total).toBe(2);
		});
	});

	describe("edge cases", () => {
		it("handles empty prompt", () => {
			const result = manager.adapt("", "code");
			expect(result.includedSections).toHaveLength(1); // preamble
			expect(result.prompt).toBe("");
		});

		it("handles prompt with no headings", () => {
			const result = manager.adapt("Just some text without headings.", "chat");
			expect(result.includedSections).toContain("preamble");
		});

		it("handles unknown task type", () => {
			const result = manager.adapt(SAMPLE_PROMPT, "unknown");
			expect(result.taskType).toBe("unknown");
			expect(result.prompt.length).toBeGreaterThan(0);
		});
	});
});
