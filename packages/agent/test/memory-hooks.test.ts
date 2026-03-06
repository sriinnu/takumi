/**
 * Tests for Agent Memory Hooks (Phase 33).
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ExtractionEvent, MemoryHooks } from "../src/context/memory-hooks.js";

const TEST_DIR = join(tmpdir(), "takumi-memory-hooks-test");

function makeHooks(overrides: Record<string, unknown> = {}): MemoryHooks {
	return new MemoryHooks({ cwd: TEST_DIR, projectId: "test-project", ...overrides });
}

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("MemoryHooks", () => {
	it("starts with an empty lesson list", () => {
		const hooks = makeHooks();
		hooks.load();
		expect(hooks.getAll()).toHaveLength(0);
	});

	it("extracts a lesson from a tool_error_then_success event", () => {
		const hooks = makeHooks();
		hooks.load();
		const event: ExtractionEvent = {
			type: "tool_error_then_success",
			details: "running pnpm test, needed --run flag",
		};
		const lesson = hooks.extract(event);
		expect(lesson).not.toBeNull();
		expect(lesson!.text).toContain("pnpm test");
		expect(lesson!.category).toBe("error_pattern");
		expect(lesson!.confidence).toBe(1);
	});

	it("extracts a user_correction lesson", () => {
		const hooks = makeHooks();
		hooks.load();
		const lesson = hooks.extract({
			type: "user_correction",
			details: "use tabs not spaces",
		});
		expect(lesson).not.toBeNull();
		expect(lesson!.text).toBe("User prefers: use tabs not spaces");
		expect(lesson!.category).toBe("user_preference");
	});

	it("extracts a repeated_access lesson", () => {
		const hooks = makeHooks();
		hooks.load();
		const lesson = hooks.extract({
			type: "repeated_access",
			details: "",
			file: "src/index.ts",
		});
		expect(lesson).not.toBeNull();
		expect(lesson!.text).toBe("Important file: src/index.ts");
		expect(lesson!.category).toBe("project_knowledge");
	});

	it("extracts a config_discovery lesson", () => {
		const hooks = makeHooks();
		hooks.load();
		const lesson = hooks.extract({
			type: "config_discovery",
			details: "uses vitest not jest",
		});
		expect(lesson).not.toBeNull();
		expect(lesson!.text).toBe("Project config: uses vitest not jest");
	});

	it("returns null for events with insufficient detail", () => {
		const hooks = makeHooks();
		hooks.load();
		expect(hooks.extract({ type: "tool_error_then_success", details: "short" })).toBeNull();
		expect(hooks.extract({ type: "user_correction", details: "ok" })).toBeNull();
		expect(hooks.extract({ type: "repeated_access", details: "" })).toBeNull();
		expect(hooks.extract({ type: "config_discovery", details: "hi" })).toBeNull();
	});

	it("reinforces existing lessons instead of duplicating", () => {
		const hooks = makeHooks();
		hooks.load();
		const event: ExtractionEvent = { type: "user_correction", details: "prefer functional components" };
		const first = hooks.extract(event)!;
		expect(first.confidence).toBe(1);

		const second = hooks.extract(event)!;
		expect(second.id).toBe(first.id);
		expect(second.confidence).toBe(2);
		expect(hooks.getAll()).toHaveLength(1);
	});

	it("saves and loads lessons to/from disk", () => {
		const hooks = makeHooks();
		hooks.load();
		hooks.extract({ type: "user_correction", details: "prefer tabs over spaces" });
		hooks.extract({ type: "config_discovery", details: "uses biome for linting" });
		hooks.save();

		const filePath = join(TEST_DIR, ".takumi/memory/lessons.json");
		expect(existsSync(filePath)).toBe(true);

		const hooks2 = makeHooks();
		hooks2.load();
		expect(hooks2.getAll()).toHaveLength(2);
	});

	it("evicts lowest-confidence lessons when over limit", () => {
		const hooks = makeHooks({ maxLessons: 3 });
		hooks.load();

		hooks.extract({ type: "user_correction", details: "lesson one here" });
		hooks.extract({ type: "user_correction", details: "lesson two here please" });
		hooks.extract({ type: "user_correction", details: "lesson three right here" });

		// Reinforce the first to bump confidence
		hooks.extract({ type: "user_correction", details: "lesson one here" });

		// Adding a 4th should evict the lowest-confidence one
		hooks.extract({ type: "config_discovery", details: "lesson four is new info" });

		expect(hooks.getAll().length).toBeLessThanOrEqual(3);
	});

	it("recalls lessons relevant to a query", () => {
		const hooks = makeHooks();
		hooks.load();
		hooks.extract({ type: "user_correction", details: "prefer vitest over jest" });
		hooks.extract({ type: "config_discovery", details: "uses biome for linting" });
		hooks.extract({ type: "user_correction", details: "indentation should use tabs" });

		const results = hooks.recall("vitest");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].text).toContain("vitest");
	});

	it("recall ranks matching lessons higher than non-matching", () => {
		const hooks = makeHooks();
		hooks.load();
		hooks.extract({ type: "user_correction", details: "prefer functional components" });
		hooks.extract({ type: "config_discovery", details: "uses kubernetes for deployment" });

		const results = hooks.recall("kubernetes", 1);
		expect(results).toHaveLength(1);
		expect(results[0].text).toContain("kubernetes");
	});

	it("formatForPrompt returns a markdown string", () => {
		const hooks = makeHooks();
		hooks.load();
		hooks.extract({ type: "user_correction", details: "prefer functional components" });
		const lessons = hooks.getAll();
		const prompt = hooks.formatForPrompt(lessons);
		expect(prompt).toContain("## Lessons from previous sessions");
		expect(prompt).toContain("functional components");
	});

	it("formatForPrompt returns empty string for no lessons", () => {
		const hooks = makeHooks();
		expect(hooks.formatForPrompt([])).toBe("");
	});

	it("clear removes all lessons", () => {
		const hooks = makeHooks();
		hooks.load();
		hooks.extract({ type: "user_correction", details: "prefer functional components" });
		expect(hooks.getAll()).toHaveLength(1);
		hooks.clear();
		expect(hooks.getAll()).toHaveLength(0);
	});

	it("observeSuccess reinforces search-first and verification lessons", () => {
		const hooks = makeHooks();
		hooks.load();

		const lessons = hooks.observeSuccess("search the repo and run tests", ["grep", "bash"]);

		expect(lessons).toHaveLength(2);
		expect(hooks.getAll().some((lesson) => lesson.text.includes("search-first workflows"))).toBe(true);
		expect(hooks.getAll().some((lesson) => lesson.text.includes("executable command"))).toBe(true);
	});

	it("handles corrupted lessons file gracefully", () => {
		const dir = join(TEST_DIR, ".takumi/memory");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "lessons.json"), "not valid json{{{", "utf-8");

		const hooks = makeHooks();
		hooks.load(); // should not throw
		expect(hooks.getAll()).toHaveLength(0);
	});
});
