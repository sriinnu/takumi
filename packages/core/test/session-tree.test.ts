/**
 * Tests for Phase 46 — Session Tree
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionTreeManifest } from "../src/session-tree.js";
import {
	branchSession,
	ensureNode,
	flattenTree,
	getAncestors,
	getDepth,
	getDescendants,
	getRoots,
	getSiblings,
	linkChild,
	loadTreeManifest,
	registerInTree,
	removeNode,
	saveTreeManifest,
} from "../src/session-tree.js";
import { saveSession } from "../src/sessions.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "takumi-tree-test-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function emptyManifest(): SessionTreeManifest {
	return { version: 1, nodes: {}, updatedAt: Date.now() };
}

function makeSession(id: string, messages: Array<{ id: string; role: "user" | "assistant"; text: string }>) {
	return {
		id,
		title: `Session ${id}`,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		model: "test-model",
		messages: messages.map((m) => ({
			id: m.id,
			role: m.role as "user" | "assistant",
			content: [{ type: "text" as const, text: m.text }],
			timestamp: Date.now(),
		})),
		tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
	};
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

describe("Tree Manifest I/O", () => {
	it("returns empty manifest when no file exists", async () => {
		const manifest = await loadTreeManifest(dir);
		expect(manifest.version).toBe(1);
		expect(Object.keys(manifest.nodes)).toHaveLength(0);
	});

	it("round-trips save and load", async () => {
		const manifest = emptyManifest();
		ensureNode(manifest, "s1", "Session 1");
		await saveTreeManifest(manifest, dir);
		const loaded = await loadTreeManifest(dir);
		expect(loaded.nodes.s1).toBeDefined();
		expect(loaded.nodes.s1.label).toBe("Session 1");
	});
});

// ── Node Operations ──────────────────────────────────────────────────────────

describe("Node Operations", () => {
	it("ensureNode creates root node", () => {
		const m = emptyManifest();
		const node = ensureNode(m, "s1", "My Session");
		expect(node.id).toBe("s1");
		expect(node.parentId).toBeNull();
		expect(node.children).toEqual([]);
		expect(node.label).toBe("My Session");
	});

	it("ensureNode is idempotent", () => {
		const m = emptyManifest();
		ensureNode(m, "s1", "First");
		ensureNode(m, "s1", "Second");
		expect(m.nodes.s1.label).toBe("First");
	});

	it("linkChild establishes parent-child relationship", () => {
		const m = emptyManifest();
		ensureNode(m, "p", "Parent");
		ensureNode(m, "c", "Child");
		linkChild(m, "p", "c");
		expect(m.nodes.c.parentId).toBe("p");
		expect(m.nodes.p.children).toContain("c");
	});

	it("linkChild is idempotent for children array", () => {
		const m = emptyManifest();
		ensureNode(m, "p", "Parent");
		ensureNode(m, "c", "Child");
		linkChild(m, "p", "c");
		linkChild(m, "p", "c");
		expect(m.nodes.p.children.filter((id) => id === "c")).toHaveLength(1);
	});

	it("removeNode re-parents children", () => {
		const m = emptyManifest();
		ensureNode(m, "root", "Root");
		ensureNode(m, "mid", "Middle");
		ensureNode(m, "leaf", "Leaf");
		linkChild(m, "root", "mid");
		linkChild(m, "mid", "leaf");

		removeNode(m, "mid");
		expect(m.nodes.mid).toBeUndefined();
		expect(m.nodes.leaf.parentId).toBe("root");
		expect(m.nodes.root.children).toContain("leaf");
	});
});

// ── Tree Traversal ───────────────────────────────────────────────────────────

describe("Tree Traversal", () => {
	function buildTestTree(): SessionTreeManifest {
		// root → [a, b], a → [a1, a2], b → [b1]
		const m = emptyManifest();
		ensureNode(m, "root", "Root");
		ensureNode(m, "a", "A");
		ensureNode(m, "b", "B");
		ensureNode(m, "a1", "A1");
		ensureNode(m, "a2", "A2");
		ensureNode(m, "b1", "B1");
		linkChild(m, "root", "a");
		linkChild(m, "root", "b");
		linkChild(m, "a", "a1");
		linkChild(m, "a", "a2");
		linkChild(m, "b", "b1");
		return m;
	}

	it("getRoots returns root nodes", () => {
		const m = buildTestTree();
		const roots = getRoots(m);
		expect(roots).toHaveLength(1);
		expect(roots[0].id).toBe("root");
	});

	it("getAncestors returns path to root", () => {
		const m = buildTestTree();
		const ancestors = getAncestors(m, "a1");
		expect(ancestors.map((n) => n.id)).toEqual(["a", "root"]);
	});

	it("getAncestors returns empty for root", () => {
		const m = buildTestTree();
		expect(getAncestors(m, "root")).toEqual([]);
	});

	it("getDescendants returns all children BFS", () => {
		const m = buildTestTree();
		const desc = getDescendants(m, "root");
		expect(desc.map((n) => n.id).sort()).toEqual(["a", "a1", "a2", "b", "b1"]);
	});

	it("getSiblings returns same-level nodes excluding self", () => {
		const m = buildTestTree();
		const siblings = getSiblings(m, "a");
		expect(siblings.map((n) => n.id)).toEqual(["b"]);
	});

	it("getSiblings returns root siblings", () => {
		const m = emptyManifest();
		ensureNode(m, "r1", "R1");
		ensureNode(m, "r2", "R2");
		const siblings = getSiblings(m, "r1");
		expect(siblings.map((n) => n.id)).toEqual(["r2"]);
	});

	it("getDepth returns correct nesting level", () => {
		const m = buildTestTree();
		expect(getDepth(m, "root")).toBe(0);
		expect(getDepth(m, "a")).toBe(1);
		expect(getDepth(m, "a1")).toBe(2);
	});
});

// ── Flatten for Rendering ────────────────────────────────────────────────────

describe("flattenTree", () => {
	it("produces correct DFS order with prefixes", () => {
		const m = emptyManifest();
		ensureNode(m, "root", "Root");
		ensureNode(m, "a", "A");
		ensureNode(m, "b", "B");
		linkChild(m, "root", "a");
		linkChild(m, "root", "b");

		const flat = flattenTree(m);
		expect(flat.map((e) => e.id)).toEqual(["root", "a", "b"]);
		expect(flat[0].depth).toBe(0);
		expect(flat[0].prefix).toBe("");
		expect(flat[1].depth).toBe(1);
		expect(flat[1].prefix).toContain("├");
		expect(flat[2].depth).toBe(1);
		expect(flat[2].prefix).toContain("└");
		expect(flat[2].isLast).toBe(true);
	});

	it("handles empty tree", () => {
		const flat = flattenTree(emptyManifest());
		expect(flat).toEqual([]);
	});

	it("handles multiple roots", () => {
		const m = emptyManifest();
		ensureNode(m, "r1", "R1");
		ensureNode(m, "r2", "R2");
		const flat = flattenTree(m);
		expect(flat).toHaveLength(2);
	});
});

// ── High-Level Operations ────────────────────────────────────────────────────

describe("branchSession", () => {
	it("creates a branched session with truncated messages", async () => {
		const session = makeSession("base", [
			{ id: "m1", role: "user", text: "Hello" },
			{ id: "m2", role: "assistant", text: "Hi there" },
			{ id: "m3", role: "user", text: "Do the thing" },
			{ id: "m4", role: "assistant", text: "Done" },
		]);
		await saveSession(session, dir);

		const result = await branchSession("base", 2, "Alternate path", dir);
		expect(result).not.toBeNull();
		expect(result!.parentSessionId).toBe("base");
		expect(result!.branchPoint).toBe(2);

		// Verify tree manifest
		const manifest = await loadTreeManifest(dir);
		expect(manifest.nodes.base).toBeDefined();
		expect(manifest.nodes[result!.newSessionId]).toBeDefined();
		expect(manifest.nodes[result!.newSessionId].parentId).toBe("base");
		expect(manifest.nodes[result!.newSessionId].branchPoint).toBe(2);
		expect(manifest.nodes.base.children).toContain(result!.newSessionId);
	});

	it("returns null for non-existent source", async () => {
		const result = await branchSession("doesnt-exist", 0, undefined, dir);
		expect(result).toBeNull();
	});

	it("clamps branchPoint to message count", async () => {
		const session = makeSession("short", [{ id: "m1", role: "user", text: "Hello" }]);
		await saveSession(session, dir);

		const result = await branchSession("short", 999, undefined, dir);
		expect(result).not.toBeNull();
		expect(result!.branchPoint).toBe(1);
	});
});

describe("registerInTree", () => {
	it("adds an existing session as a root node", async () => {
		const node = await registerInTree("legacy-session", "My Legacy", dir);
		expect(node.id).toBe("legacy-session");
		expect(node.parentId).toBeNull();
		expect(node.label).toBe("My Legacy");

		const manifest = await loadTreeManifest(dir);
		expect(manifest.nodes["legacy-session"]).toBeDefined();
	});
});

describe("getSessionTree", () => {
	it("returns the full manifest", async () => {
		await registerInTree("s1", "S1", dir);
		await registerInTree("s2", "S2", dir);
		const tree = await loadTreeManifest(dir);
		expect(Object.keys(tree.nodes)).toHaveLength(2);
	});
});
