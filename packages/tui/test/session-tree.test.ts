/**
 * Tests for Phase 47 — Session Tree Commands + Tree Renderer
 */

import type { FlatTreeEntry } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { renderTree } from "../src/commands/app-commands-tree.js";

describe("renderTree", () => {
	it("renders empty tree message", () => {
		const result = renderTree([], "s1");
		expect(result).toBe("(No sessions in tree)");
	});

	it("renders single root with marker", () => {
		const entries: FlatTreeEntry[] = [
			{ id: "s1", label: "Main", depth: 0, hasChildren: false, isLast: true, prefix: "" },
		];
		const result = renderTree(entries, "s1");
		expect(result).toContain("Main");
		expect(result).toContain("◀");
		expect(result).toContain("s1");
	});

	it("renders tree with children and highlights current", () => {
		const entries: FlatTreeEntry[] = [
			{ id: "root", label: "Root", depth: 0, hasChildren: true, isLast: true, prefix: "" },
			{ id: "a", label: "Branch A", depth: 1, hasChildren: false, isLast: false, prefix: "├── " },
			{ id: "b", label: "Branch B", depth: 1, hasChildren: false, isLast: true, prefix: "└── " },
		];
		const result = renderTree(entries, "a");
		expect(result).toContain("├── Branch A");
		expect(result).toContain("└── Branch B");
		// Only "a" should have the marker
		const lines = result.split("\n");
		expect(lines[1]).toContain("◀");
		expect(lines[2]).not.toContain("◀");
	});

	it("truncates long session IDs", () => {
		const entries: FlatTreeEntry[] = [
			{
				id: "session-2026-01-01-abcdef1234567890",
				label: "Long ID",
				depth: 0,
				hasChildren: false,
				isLast: true,
				prefix: "",
			},
		];
		const result = renderTree(entries);
		expect(result).toContain("...");
	});

	it("renders without marker when no current session", () => {
		const entries: FlatTreeEntry[] = [
			{ id: "s1", label: "Session", depth: 0, hasChildren: false, isLast: true, prefix: "" },
		];
		const result = renderTree(entries);
		expect(result).not.toContain("◀");
	});
});

describe("Session tree command registration", () => {
	it("exports registerSessionTreeCommands", async () => {
		const mod = await import("../src/commands/app-commands-tree.js");
		expect(typeof mod.registerSessionTreeCommands).toBe("function");
	});
});

describe("App commands wires tree commands", () => {
	it("exports registerAppCommands", async () => {
		const mod = await import("../src/commands/app-commands.js");
		expect(typeof mod.registerAppCommands).toBe("function");
	});
});
