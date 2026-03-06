import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrincipleMemory } from "../src/context/principles.js";

const TEST_DIR = join(tmpdir(), "takumi-principles-test");

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("PrincipleMemory", () => {
	it("learns reusable principles from successful turns", () => {
		const memory = new PrincipleMemory(TEST_DIR);
		memory.load();

		const learned = memory.observeTurn({
			request: "search the code, edit the file, and run tests",
			toolNames: ["grep", "read_file", "edit_file", "bash"],
			toolCategories: ["read", "read", "write", "execute"],
			hadError: false,
			finalResponse: "Verified with tests passed.",
		});

		expect(learned.length).toBeGreaterThanOrEqual(3);
		expect(memory.getAll().some((principle) => principle.text.includes("Inspect the relevant files"))).toBe(true);
		expect(memory.getAll().some((principle) => principle.text.includes("executable verification step"))).toBe(true);
	});

	it("does not learn from failing turns", () => {
		const memory = new PrincipleMemory(TEST_DIR);
		memory.load();

		const learned = memory.observeTurn({
			request: "fix the file",
			toolNames: ["edit_file"],
			toolCategories: ["write"],
			hadError: true,
		});

		expect(learned).toEqual([]);
		expect(memory.getAll()).toEqual([]);
	});

	it("recalls relevant principles and formats them for prompts", () => {
		const memory = new PrincipleMemory(TEST_DIR);
		memory.load();
		memory.observeTurn({
			request: "update the readme docs and verify the build",
			toolNames: ["read_file", "edit_file", "bash"],
			toolCategories: ["read", "write", "execute"],
			hadError: false,
			finalResponse: "Build passed and docs updated.",
		});

		const recalled = memory.recall("docs build verify", 3);
		const prompt = memory.formatForPrompt(recalled);

		expect(recalled.length).toBeGreaterThan(0);
		expect(prompt).toContain("## Self-Evolving Principles");
		expect(prompt).toContain("confidence");
	});

	it("persists principles to disk", () => {
		const memory = new PrincipleMemory(TEST_DIR);
		memory.load();
		memory.observeTurn({
			request: "read docs before editing",
			toolNames: ["read_file", "edit_file"],
			toolCategories: ["read", "write"],
			hadError: false,
		});
		memory.save();

		const reloaded = new PrincipleMemory(TEST_DIR);
		reloaded.load();
		expect(reloaded.getAll().length).toBeGreaterThan(0);
	});
});
