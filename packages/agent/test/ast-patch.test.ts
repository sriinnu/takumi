/**
 * Tests for AST-patch tool (Phase 28).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { astGrepHandler, astPatchHandler, extractDeclarations } from "../src/tools/ast-patch.js";

const TEST_DIR = join(tmpdir(), "takumi-ast-patch-test");

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true });
});

const SAMPLE_TS = `import { something } from "./dep.js";

export interface UserConfig {
	name: string;
	age: number;
}

export function greet(name: string): string {
	return "Hello " + name;
}

const VERSION = "1.0.0";

export class UserService {
	private users: Map<string, string> = new Map();

	add(name: string): void {
		this.users.set(name, name);
	}
}

type Status = "active" | "inactive";
`;

describe("extractDeclarations", () => {
	it("extracts all declaration types", () => {
		const decls = extractDeclarations(SAMPLE_TS);
		const names = decls.map((d) => d.name);

		expect(names).toContain("UserConfig");
		expect(names).toContain("greet");
		expect(names).toContain("VERSION");
		expect(names).toContain("UserService");
		expect(names).toContain("Status");
	});

	it("detects exported declarations", () => {
		const decls = extractDeclarations(SAMPLE_TS);
		const greet = decls.find((d) => d.name === "greet");
		const version = decls.find((d) => d.name === "VERSION");

		expect(greet?.exported).toBe(true);
		expect(version?.exported).toBe(false);
	});

	it("identifies correct kinds", () => {
		const decls = extractDeclarations(SAMPLE_TS);
		const kinds = Object.fromEntries(decls.map((d) => [d.name, d.kind]));

		expect(kinds.UserConfig).toBe("interface");
		expect(kinds.greet).toBe("function");
		expect(kinds.VERSION).toBe("const");
		expect(kinds.UserService).toBe("class");
		expect(kinds.Status).toBe("type");
	});

	it("returns correct line ranges", () => {
		const decls = extractDeclarations(SAMPLE_TS);
		const greet = decls.find((d) => d.name === "greet");

		expect(greet).toBeDefined();
		expect(greet!.startLine).toBeGreaterThan(0);
		expect(greet!.endLine).toBeGreaterThanOrEqual(greet!.startLine);
	});
});

describe("ast_grep handler", () => {
	it("lists all declarations in a file", async () => {
		const filePath = join(TEST_DIR, "sample.ts");
		writeFileSync(filePath, SAMPLE_TS);

		const result = await astGrepHandler({ file_path: filePath });

		expect(result.isError).toBe(false);
		expect(result.output).toContain("greet");
		expect(result.output).toContain("UserService");
		expect(result.output).toContain("UserConfig");
	});

	it("filters by name_pattern", async () => {
		const filePath = join(TEST_DIR, "sample.ts");
		writeFileSync(filePath, SAMPLE_TS);

		const result = await astGrepHandler({ file_path: filePath, name_pattern: "User" });

		expect(result.isError).toBe(false);
		expect(result.output).toContain("UserConfig");
		expect(result.output).toContain("UserService");
		expect(result.output).not.toContain("greet");
	});

	it("errors on missing file", async () => {
		const result = await astGrepHandler({ file_path: "/nonexistent/file.ts" });
		expect(result.isError).toBe(true);
	});
});

describe("ast_patch handler", () => {
	it("patches a function declaration", async () => {
		const filePath = join(TEST_DIR, "patch-target.ts");
		writeFileSync(filePath, SAMPLE_TS);

		const result = await astPatchHandler({
			file_path: filePath,
			declaration_name: "greet",
			new_body: `export function greet(name: string): string {
	return \`Howdy, \${name}!\`;
}`,
		});

		expect(result.isError).toBe(false);
		expect(result.output).toContain('Patched function "greet"');

		const patched = readFileSync(filePath, "utf-8");
		expect(patched).toContain("Howdy");
		expect(patched).not.toContain('"Hello "');
		// Other declarations should be intact
		expect(patched).toContain("UserService");
		expect(patched).toContain("UserConfig");
	});

	it("errors on unknown declaration", async () => {
		const filePath = join(TEST_DIR, "patch-target2.ts");
		writeFileSync(filePath, SAMPLE_TS);

		const result = await astPatchHandler({
			file_path: filePath,
			declaration_name: "nonexistent",
			new_body: "// nope",
		});

		expect(result.isError).toBe(true);
		expect(result.output).toContain("not found");
	});

	it("errors on missing file", async () => {
		const result = await astPatchHandler({
			file_path: "/nonexistent/file.ts",
			declaration_name: "foo",
			new_body: "// nope",
		});
		expect(result.isError).toBe(true);
	});
});
