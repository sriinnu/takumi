/**
 * Tests for the codebase indexer and RAG context injector.
 */

import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIndex, indexStats, loadIndex } from "../src/context/indexer.js";
import { formatRagContext, queryIndex } from "../src/context/rag.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "takumi-rag-test-"));
});

afterEach(async () => {
	await rm(tmpDir, { recursive: true, force: true });
});

async function writeSource(relPath: string, content: string): Promise<void> {
	const fullPath = join(tmpDir, relPath);
	await mkdir(dirname(fullPath), { recursive: true });
	await writeFile(fullPath, content, "utf-8");
}

// ── indexer ───────────────────────────────────────────────────────────────────

describe("buildIndex", () => {
	it("returns an index with root and builtAt", async () => {
		await writeSource("foo.ts", "export function hello() {}");
		const index = await buildIndex(tmpDir);
		expect(index.root).toBe(tmpDir);
		expect(index.builtAt).toBeGreaterThan(0);
	});

	it("extracts function symbols from TypeScript", async () => {
		await writeSource("utils.ts", "export async function parseArgs(input: string) {\n  return input;\n}");
		const index = await buildIndex(tmpDir);
		const syms = index.files.flatMap((f) => f.symbols);
		const fn = syms.find((s) => s.name === "parseArgs");
		expect(fn).toBeDefined();
		expect(fn?.kind).toBe("function");
	});

	it("extracts class symbols", async () => {
		await writeSource("engine.ts", "export class QueryEngine {\n  run() {}\n}");
		const index = await buildIndex(tmpDir);
		const syms = index.files.flatMap((f) => f.symbols);
		expect(syms.find((s) => s.name === "QueryEngine" && s.kind === "class")).toBeDefined();
	});

	it("extracts interface symbols", async () => {
		await writeSource("types.ts", "export interface UserConfig {\n  name: string;\n}");
		const index = await buildIndex(tmpDir);
		const syms = index.files.flatMap((f) => f.symbols);
		expect(syms.find((s) => s.name === "UserConfig" && s.kind === "interface")).toBeDefined();
	});

	it("extracts type aliases", async () => {
		await writeSource("types.ts", "export type Status = 'ok' | 'error';");
		const index = await buildIndex(tmpDir);
		const syms = index.files.flatMap((f) => f.symbols);
		expect(syms.find((s) => s.name === "Status" && s.kind === "type")).toBeDefined();
	});

	it("skips node_modules directory", async () => {
		await writeFile(join(tmpDir, "node_modules"), "", "utf-8").catch(() => {});
		const index = await buildIndex(tmpDir);
		const paths = index.files.map((f) => f.relPath);
		expect(paths.every((p) => !p.includes("node_modules"))).toBe(true);
	});

	it("persists index to .takumi/index.json", async () => {
		await writeSource("a.ts", "export function a() {}");
		await buildIndex(tmpDir);
		const raw = readFileSync(join(tmpDir, ".takumi/index.json"), "utf-8");
		const stored = JSON.parse(raw);
		expect(stored.root).toBe(tmpDir);
	});

	it("uses cached entries on second run (same mtime)", async () => {
		await writeSource("b.ts", "export function b() {}");
		const first = await buildIndex(tmpDir);
		const second = await buildIndex(tmpDir);
		expect(second.files[0]?.symbols).toEqual(first.files[0]?.symbols);
	});

	it("force=true bypasses cache", async () => {
		await writeSource("c.ts", "export function c() {}");
		await buildIndex(tmpDir);
		const rebuilt = await buildIndex(tmpDir, true);
		expect(rebuilt.builtAt).toBeGreaterThan(0);
	});
});

describe("loadIndex", () => {
	it("returns null when no index exists", () => {
		expect(loadIndex(tmpDir)).toBeNull();
	});

	it("loads the index after buildIndex", async () => {
		await writeSource("d.ts", "export const d = 1;");
		await buildIndex(tmpDir);
		const loaded = loadIndex(tmpDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.root).toBe(tmpDir);
	});
});

describe("indexStats", () => {
	it("counts files and symbols", async () => {
		await writeSource("e.ts", "export function e() {}\nexport class E {}");
		const index = await buildIndex(tmpDir);
		const stats = indexStats(index);
		expect(stats.files).toBeGreaterThan(0);
		expect(stats.symbols).toBeGreaterThan(0);
		expect(stats.builtAt).toBeInstanceOf(Date);
	});
});

// ── RAG ───────────────────────────────────────────────────────────────────────

describe("queryIndex", () => {
	it("returns empty array for empty index", () => {
		const index = { root: tmpDir, builtAt: 0, files: [] };
		expect(queryIndex(index, "find user config")).toEqual([]);
	});

	it("returns empty array for empty query", async () => {
		await writeSource("f.ts", "export function fetchUser() {}");
		const index = await buildIndex(tmpDir);
		expect(queryIndex(index, "")).toEqual([]);
	});

	it("ranks exact name match highest", async () => {
		await writeSource(
			"auth.ts",
			[
				"export function parseToken(t: string) {}",
				"export function verifyUser(id: string) {}",
				"export function hashPassword(p: string) {}",
			].join("\n"),
		);
		const index = await buildIndex(tmpDir);
		const results = queryIndex(index, "verifyUser");
		expect(results[0]?.symbol.name).toBe("verifyUser");
	});

	it("splits camelCase query terms for matching", async () => {
		await writeSource("db.ts", "export function getUserById(id: string) {}");
		const index = await buildIndex(tmpDir);
		const results = queryIndex(index, "getUserById");
		expect(results.length).toBeGreaterThan(0);
		expect(results[0]?.symbol.name).toBe("getUserById");
	});

	it("respects topK option", async () => {
		await writeSource("many.ts", Array.from({ length: 20 }, (_, i) => `export function fn${i}() {}`).join("\n"));
		const index = await buildIndex(tmpDir);
		const results = queryIndex(index, "fn", { topK: 3 });
		expect(results.length).toBeLessThanOrEqual(3);
	});

	it("filters by minScore", async () => {
		await writeSource("irrelevant.ts", "export function completelyUnrelated() {}");
		const index = await buildIndex(tmpDir);
		const results = queryIndex(index, "xyzzy_no_match", { minScore: 5 });
		expect(results).toEqual([]);
	});
});

describe("formatRagContext", () => {
	it("returns empty string for no results", () => {
		expect(formatRagContext([])).toBe("");
	});

	it("includes file path and symbol name in output", async () => {
		await writeSource("services/user.ts", "export function getUser(id: string) {}");
		const index = await buildIndex(tmpDir);
		const results = queryIndex(index, "getUser");
		const context = formatRagContext(results);
		expect(context).toContain("getUser");
		expect(context).toContain("services/user.ts");
	});

	it("groups results by file", async () => {
		await writeSource("lib.ts", "export function alpha() {}\nexport function beta() {}");
		const index = await buildIndex(tmpDir);
		const results = queryIndex(index, "alpha beta", { topK: 5 });
		const context = formatRagContext(results);
		const fileHeadings = (context.match(/\*\*[^*]+\*\*/g) ?? []).length;
		// Both symbols are in the same file — should only appear once as heading
		expect(fileHeadings).toBe(1);
	});
});
