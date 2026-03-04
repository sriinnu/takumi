/**
 * Tests for Context Ripple DAG (Phase 29).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RippleDag } from "../src/context/ripple-dag.js";

const TEST_DIR = join(tmpdir(), "takumi-ripple-dag-test");

beforeEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(join(TEST_DIR, "src"), { recursive: true });
	mkdirSync(join(TEST_DIR, "src", "utils"), { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeSource(relPath: string, content: string): void {
	writeFileSync(join(TEST_DIR, relPath), content, "utf-8");
}

describe("RippleDag", () => {
	it("indexes files and builds the graph", () => {
		writeSource("src/types.ts", "export interface User { name: string; }");
		writeSource(
			"src/service.ts",
			'import type { User } from "./types.js";\nexport function getUser(): User { return { name: "a" }; }',
		);
		writeSource("src/app.ts", 'import { getUser } from "./service.js";\nconsole.log(getUser());');

		const dag = new RippleDag(TEST_DIR);
		dag.index([join(TEST_DIR, "src/types.ts"), join(TEST_DIR, "src/service.ts"), join(TEST_DIR, "src/app.ts")]);

		expect(dag.size).toBe(3);
	});

	it("computes direct dependents correctly", () => {
		writeSource("src/types.ts", "export interface Config { port: number; }");
		writeSource("src/server.ts", 'import type { Config } from "./types.js";\nexport function start(c: Config) {}');
		writeSource("src/main.ts", 'import { start } from "./server.js";\nstart({ port: 3000 });');

		const dag = new RippleDag(TEST_DIR);
		dag.index([join(TEST_DIR, "src/types.ts"), join(TEST_DIR, "src/server.ts"), join(TEST_DIR, "src/main.ts")]);

		// types.ts is imported by server.ts
		const deps = dag.directDependents("src/types.ts");
		expect(deps).toContain("src/server.ts");
	});

	it("computes transitive ripple", () => {
		writeSource("src/types.ts", "export type ID = string;");
		writeSource(
			"src/utils/validate.ts",
			'import type { ID } from "../types.js";\nexport function isValid(id: ID) { return true; }',
		);
		writeSource(
			"src/service.ts",
			'import { isValid } from "./utils/validate.js";\nexport function check() { isValid("x"); }',
		);

		const dag = new RippleDag(TEST_DIR);
		dag.index([
			join(TEST_DIR, "src/types.ts"),
			join(TEST_DIR, "src/utils/validate.ts"),
			join(TEST_DIR, "src/service.ts"),
		]);

		// Modify types.ts → should ripple to validate.ts → service.ts
		const result = dag.ripple("src/types.ts", 3);

		expect(result.source).toBe("src/types.ts");
		expect(result.affected).toContain("src/utils/validate.ts");
		// service.ts depends on validate.ts which depends on types.ts
		expect(result.affected).toContain("src/service.ts");
	});

	it("respects maxDepth", () => {
		writeSource("src/a.ts", "export const a = 1;");
		writeSource("src/b.ts", 'import { a } from "./a.js";');
		writeSource("src/c.ts", 'import { a } from "./b.js";');
		writeSource("src/d.ts", 'import { a } from "./c.js";');

		const dag = new RippleDag(TEST_DIR);
		dag.index([
			join(TEST_DIR, "src/a.ts"),
			join(TEST_DIR, "src/b.ts"),
			join(TEST_DIR, "src/c.ts"),
			join(TEST_DIR, "src/d.ts"),
		]);

		const shallow = dag.ripple("src/a.ts", 1);
		expect(shallow.affected.length).toBe(1);
		expect(shallow.affected).toContain("src/b.ts");
	});

	it("handles files with no imports", () => {
		writeSource("src/constants.ts", "export const PI = 3.14;");

		const dag = new RippleDag(TEST_DIR);
		dag.index([join(TEST_DIR, "src/constants.ts")]);

		expect(dag.size).toBe(1);
		const result = dag.ripple("src/constants.ts");
		expect(result.affected).toEqual([]);
	});

	it("handles dynamic imports", () => {
		writeSource("src/lazy.ts", "export const x = 1;");
		writeSource("src/loader.ts", 'const mod = await import("./lazy.js");');

		const dag = new RippleDag(TEST_DIR);
		dag.index([join(TEST_DIR, "src/lazy.ts"), join(TEST_DIR, "src/loader.ts")]);

		const deps = dag.directDependents("src/lazy.ts");
		expect(deps).toContain("src/loader.ts");
	});

	it("ignores bare specifiers (npm packages)", () => {
		writeSource("src/app.ts", 'import React from "react";\nimport { foo } from "./foo.js";');
		writeSource("src/foo.ts", "export const foo = 1;");

		const dag = new RippleDag(TEST_DIR);
		dag.index([join(TEST_DIR, "src/app.ts"), join(TEST_DIR, "src/foo.ts")]);

		// "react" should not be in the graph
		const node = dag.getNode("src/app.ts");
		expect(node).toBeDefined();
		const importPaths = [...(node?.imports ?? [])];
		expect(importPaths.every((p) => !p.includes("react"))).toBe(true);
	});

	it("directImports returns correct list", () => {
		writeSource("src/types.ts", "export type X = string;");
		writeSource("src/utils.ts", "export const u = 1;");
		writeSource("src/main.ts", 'import type { X } from "./types.js";\nimport { u } from "./utils.js";');

		const dag = new RippleDag(TEST_DIR);
		dag.index([join(TEST_DIR, "src/types.ts"), join(TEST_DIR, "src/utils.ts"), join(TEST_DIR, "src/main.ts")]);

		const imports = dag.directImports("src/main.ts");
		expect(imports.length).toBe(2);
	});
});
