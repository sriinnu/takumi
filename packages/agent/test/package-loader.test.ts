import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAndLoadExtensions, discoverTakumiPackages, loadConventionFiles } from "../src/index.js";

function createPackage(root: string, name: string): string {
	const packageRoot = join(root, ".takumi", "packages", name);
	mkdirSync(join(packageRoot, "skills"), { recursive: true });
	writeFileSync(
		join(packageRoot, "package.json"),
		JSON.stringify(
			{
				name: `@takumi/${name}`,
				version: "0.0.1",
				takumi: {
					extensions: ["./index.mjs"],
					skills: ["./skills"],
					systemPrompt: "./system-prompt.md",
					toolRules: "./tool-rules.json",
					provenance: "local",
					capabilitiesRequested: ["workflow.review"],
					compatibility: {
						takumi: "^0.1.0",
						packageApi: "1",
					},
					evals: {
						coverage: ["smoke"],
					},
					maintainer: "Takumi Test",
				},
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(packageRoot, "index.mjs"),
		[
			"export default function extension(api) {",
			"  api.registerTool({",
			"    name: 'package_tool',",
			"    description: 'Tool from package',",
			"    inputSchema: { type: 'object', properties: {} },",
			"    requiresPermission: false,",
			"    category: 'read',",
			"    async execute() { return { output: 'ok', isError: false }; }",
			"  });",
			"}",
		].join("\n"),
	);
	writeFileSync(join(packageRoot, "system-prompt.md"), "Use package review heuristics.");
	writeFileSync(
		join(packageRoot, "tool-rules.json"),
		JSON.stringify([{ tool: "package_tool", requiresPermission: false }]),
	);
	writeFileSync(
		join(packageRoot, "skills", "review.md"),
		[
			"---",
			"name: Package Review",
			"description: Review package-provided workflows",
			"tags: package,workflow",
			"---",
			"Inspect package skills before reaching for project-specific changes.",
		].join("\n"),
	);
	return packageRoot;
}

describe("Takumi package discovery", () => {
	it("discovers project-local Takumi packages", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-discovery-"));
		try {
			createPackage(cwd, "review-kit");
			const result = discoverTakumiPackages([], cwd);
			expect(result.errors).toEqual([]);
			expect(result.packages).toHaveLength(1);
			expect(result.packages[0]?.packageName).toBe("@takumi/review-kit");
			expect(result.packages[0]?.extensions).toHaveLength(1);
			expect(result.packages[0]?.skillPaths).toHaveLength(1);
			expect(result.packages[0]?.governance.provenance).toBe("local");
			expect(result.packages[0]?.warnings).toEqual([]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("loads extension entry points exposed by Takumi packages", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-extension-"));
		try {
			createPackage(cwd, "review-kit");
			const result = await discoverAndLoadExtensions([], cwd);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(1);
			expect(result.extensions[0]?.tools.has("package_tool")).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("merges package conventions with project conventions", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-conventions-"));
		try {
			createPackage(cwd, "review-kit");
			mkdirSync(join(cwd, ".takumi", "skills"), { recursive: true });
			writeFileSync(join(cwd, ".takumi", "system-prompt.md"), "Project guidance wins last.");
			writeFileSync(
				join(cwd, ".takumi", "tool-rules.json"),
				JSON.stringify([{ tool: "write", requiresPermission: true }]),
			);
			writeFileSync(
				join(cwd, ".takumi", "skills", "local.md"),
				[
					"---",
					"name: Local Review",
					"description: Project local skill",
					"---",
					"Prefer local context when available.",
				].join("\n"),
			);

			const result = loadConventionFiles(cwd);
			expect(result.systemPromptAddon).toContain("Project guidance wins last.");
			expect(result.systemPromptAddon).toContain("Package: @takumi/review-kit");
			expect(result.systemPromptAddon?.indexOf("Package: @takumi/review-kit")).toBeLessThan(
				result.systemPromptAddon?.indexOf("Project guidance wins last.") ?? Number.MAX_SAFE_INTEGER,
			);
			expect(result.toolRules).toHaveLength(2);
			expect(result.skills.map((skill) => skill.name)).toEqual(
				expect.arrayContaining(["Package Review", "Local Review"]),
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
