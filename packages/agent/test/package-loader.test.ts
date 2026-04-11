import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildPackageDoctorReport,
	buildPackageResourceViews,
	buildPackageRuntimeSnapshot,
	discoverAndLoadExtensions,
	discoverAndLoadExtensionsFromSnapshot,
	discoverTakumiPackages,
	formatPackageDetails,
	formatPackageDoctorReport,
	inspectTakumiPackages,
	loadConventionFiles,
	loadConventionFilesFromSnapshot,
	resolveTakumiPackageGraph,
	selectTakumiPackage,
} from "../src/index.js";

function writePackage(
	packageRoot: string,
	options: {
		packageName: string;
		toolName?: string;
		dependencies?: Record<string, string>;
	},
): string {
	const toolName = options.toolName ?? "package_tool";
	mkdirSync(join(packageRoot, "skills"), { recursive: true });
	writeFileSync(
		join(packageRoot, "package.json"),
		JSON.stringify(
			{
				name: options.packageName,
				version: "0.0.1",
				...(options.dependencies ? { dependencies: options.dependencies } : {}),
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
			`    name: '${toolName}',`,
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

function createProjectLocalPackage(root: string, name: string, toolName?: string): string {
	return writePackage(join(root, ".takumi", "packages", name), {
		packageName: `@takumi/${name}`,
		toolName,
	});
}

function writeWorkspaceManifest(root: string, dependencies?: Record<string, string>): void {
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify(
			{
				name: "takumi-package-workspace",
				version: "0.0.1",
				...(dependencies ? { dependencies } : {}),
			},
			null,
			2,
		),
	);
}

describe("Takumi package discovery", () => {
	it("discovers project-local Takumi packages", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-discovery-"));
		try {
			createProjectLocalPackage(cwd, "review-kit");
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

	it("builds resource views with extension-first and convention-last precedence ordering", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-resource-views-"));
		try {
			writeWorkspaceManifest(cwd, { "@takumi/dependency-kit": "0.0.1" });
			writePackage(join(cwd, "node_modules", "@takumi", "dependency-kit"), {
				packageName: "@takumi/dependency-kit",
				toolName: "dependency_tool",
			});
			createProjectLocalPackage(cwd, "review-kit", "project_tool");

			const views = buildPackageResourceViews(resolveTakumiPackageGraph({ workingDirectory: cwd, packages: [] }));

			expect(views.extensionEntryPoints.map((entry) => entry.packageName)).toEqual([
				"@takumi/review-kit",
				"@takumi/dependency-kit",
			]);
			expect(views.skillRoots.map((entry) => entry.packageName)).toEqual([
				"@takumi/dependency-kit",
				"@takumi/review-kit",
			]);
			expect(views.systemPrompts.map((entry) => entry.packageName)).toEqual([
				"@takumi/dependency-kit",
				"@takumi/review-kit",
			]);
			expect(views.toolRules.map((entry) => entry.packageName)).toEqual([
				"@takumi/dependency-kit",
				"@takumi/review-kit",
			]);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("loads extension entry points exposed by Takumi packages", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-extension-"));
		try {
			createProjectLocalPackage(cwd, "review-kit");
			const result = await discoverAndLoadExtensions([], cwd);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(1);
			expect(result.extensions[0]?.tools.has("package_tool")).toBe(true);
			expect(result.extensions[0]?.origin).toEqual({
				residency: "package",
				packageId: "@takumi/review-kit",
				packageName: "@takumi/review-kit",
				packageSource: "project",
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("reuses one package snapshot across extension and convention loaders", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-snapshot-"));
		try {
			writeWorkspaceManifest(cwd, { "@takumi/dependency-kit": "0.0.1" });
			writePackage(join(cwd, "node_modules", "@takumi", "dependency-kit"), {
				packageName: "@takumi/dependency-kit",
				toolName: "dependency_tool",
			});
			createProjectLocalPackage(cwd, "review-kit", "project_tool");

			const snapshot = buildPackageRuntimeSnapshot({ workingDirectory: cwd, packages: [] });
			expect(snapshot.report.errors).toEqual([]);
			expect(snapshot.views.extensionEntryPoints.map((entry) => entry.packageName)).toEqual([
				"@takumi/review-kit",
				"@takumi/dependency-kit",
			]);

			const extensionResult = await discoverAndLoadExtensionsFromSnapshot(snapshot, [], cwd);
			expect(extensionResult.errors).toEqual([]);
			expect(extensionResult.extensions).toHaveLength(2);
			expect(extensionResult.extensions.some((extension) => extension.tools.has("project_tool"))).toBe(true);
			expect(extensionResult.extensions.some((extension) => extension.tools.has("dependency_tool"))).toBe(true);
			expect(extensionResult.extensions.find((extension) => extension.tools.has("project_tool"))?.origin).toEqual({
				residency: "package",
				packageId: "@takumi/review-kit",
				packageName: "@takumi/review-kit",
				packageSource: "project",
			});
			expect(extensionResult.extensions.find((extension) => extension.tools.has("dependency_tool"))?.origin).toEqual({
				residency: "package",
				packageId: "@takumi/dependency-kit",
				packageName: "@takumi/dependency-kit",
				packageSource: "dependency",
			});

			const conventions = loadConventionFilesFromSnapshot(snapshot, cwd);
			expect(conventions.toolRules).toHaveLength(2);
			expect(conventions.skills).toHaveLength(1);
			expect(conventions.skills[0]?.path).toContain(join(".takumi", "packages", "review-kit", "skills"));
			expect(conventions.systemPromptAddon).toContain("Package: @takumi/dependency-kit");
			expect(conventions.systemPromptAddon).toContain("Package: @takumi/review-kit");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("discovers workspace-root and direct dependency Takumi packages", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-workspace-package-"));
		try {
			writePackage(cwd, {
				packageName: "@takumi/workspace-kit",
				toolName: "workspace_tool",
				dependencies: {
					"@takumi/dependency-kit": "0.0.1",
				},
			});
			writePackage(join(cwd, "node_modules", "@takumi", "dependency-kit"), {
				packageName: "@takumi/dependency-kit",
				toolName: "dependency_tool",
			});

			const result = discoverTakumiPackages([], cwd);
			expect(result.errors).toEqual([]);
			expect(result.packages.map((pkg) => pkg.packageName)).toEqual(
				expect.arrayContaining(["@takumi/workspace-kit", "@takumi/dependency-kit"]),
			);
			expect(result.packages.find((pkg) => pkg.packageName === "@takumi/workspace-kit")?.source).toBe("workspace");
			expect(result.packages.find((pkg) => pkg.packageName === "@takumi/dependency-kit")?.source).toBe("dependency");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("loads extension entry points from workspace-installed Takumi dependencies", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-dependency-extension-"));
		try {
			writePackage(cwd, {
				packageName: "@takumi/workspace-kit",
				toolName: "workspace_tool",
				dependencies: {
					"@takumi/dependency-kit": "0.0.1",
				},
			});
			writePackage(join(cwd, "node_modules", "@takumi", "dependency-kit"), {
				packageName: "@takumi/dependency-kit",
				toolName: "dependency_tool",
			});

			const result = await discoverAndLoadExtensions([], cwd);
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(2);
			expect(result.extensions.some((extension) => extension.tools.has("workspace_tool"))).toBe(true);
			expect(result.extensions.some((extension) => extension.tools.has("dependency_tool"))).toBe(true);
			expect(result.extensions.find((extension) => extension.tools.has("workspace_tool"))?.origin?.packageSource).toBe(
				"workspace",
			);
			expect(result.extensions.find((extension) => extension.tools.has("dependency_tool"))?.origin?.packageSource).toBe(
				"dependency",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("builds a shared inspection snapshot and selects packages by index or name", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-inspection-"));
		try {
			createProjectLocalPackage(cwd, "review-kit");
			const inspection = inspectTakumiPackages({ workingDirectory: cwd, packages: [] });
			expect(inspection.packages).toHaveLength(1);
			expect(selectTakumiPackage(inspection, "1")?.packageName).toBe("@takumi/review-kit");
			expect(selectTakumiPackage(inspection, "review-kit")?.packageName).toBe("@takumi/review-kit");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("builds shared package doctor and detail reports", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-report-"));
		try {
			createProjectLocalPackage(cwd, "review-kit");
			const inspection = inspectTakumiPackages({ workingDirectory: cwd, packages: [] });
			const report = buildPackageDoctorReport(inspection);
			expect(report.total).toBe(1);
			expect(report.ready).toBe(1);
			expect(report.degraded).toBe(0);
			expect(report.rejected).toBe(0);
			expect(formatPackageDetails(inspection.packages[0]!, inspection)).toContain("State:  ready");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("resolves duplicate logical packages by source precedence and surfaces shadowed candidates", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-resolver-"));
		try {
			writeWorkspaceManifest(cwd, { "@takumi/review-kit": "0.0.1" });
			writePackage(join(cwd, "node_modules", "@takumi", "review-kit"), {
				packageName: "@takumi/review-kit",
				toolName: "dependency_tool",
			});
			createProjectLocalPackage(cwd, "review-kit", "project_tool");

			const report = resolveTakumiPackageGraph({ workingDirectory: cwd, packages: [] });
			expect(report.packages).toHaveLength(1);
			expect(report.packages[0]?.source).toBe("project");
			expect(report.shadowedPackages).toHaveLength(1);
			expect(report.shadowedPackages[0]?.source).toBe("dependency");
			expect(report.conflicts.map((conflict) => conflict.kind)).toContain("shadowed-package");

			const inspection = inspectTakumiPackages({ workingDirectory: cwd, packages: [] });
			expect(inspection.packages).toHaveLength(1);
			expect(inspection.shadowedPackages).toHaveLength(1);
			expect(inspection.conflicts).toHaveLength(1);

			const doctor = buildPackageDoctorReport(inspection);
			expect(doctor.ready).toBe(0);
			expect(doctor.degraded).toBe(1);
			expect(doctor.rejected).toBe(0);
			expect(doctor.warning).toBe(1);
			expect(doctor.shadowed).toBe(1);
			expect(doctor.conflicts).toHaveLength(1);
			expect(formatPackageDetails(inspection.packages[0]!, inspection)).toContain("State:  degraded");

			const extensionResult = await discoverAndLoadExtensions([], cwd);
			expect(extensionResult.errors).toEqual([]);
			expect(extensionResult.extensions).toHaveLength(1);
			expect(extensionResult.extensions[0]?.tools.has("project_tool")).toBe(true);
			expect(extensionResult.extensions[0]?.tools.has("dependency_tool")).toBe(false);

			const conventions = loadConventionFiles(cwd);
			expect(conventions.skills).toHaveLength(1);
			expect(conventions.toolRules).toHaveLength(1);
			expect(conventions.loadedFiles.filter((file) => file.endsWith("system-prompt.md"))).toHaveLength(1);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("tracks rejected configured package inputs separately from discovered packages", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-rejected-"));
		try {
			createProjectLocalPackage(cwd, "review-kit");

			const inspection = inspectTakumiPackages({
				workingDirectory: cwd,
				packages: [{ name: "./missing-package" }],
			});
			const doctor = buildPackageDoctorReport(inspection);

			expect(doctor.total).toBe(1);
			expect(doctor.ready).toBe(1);
			expect(doctor.degraded).toBe(0);
			expect(doctor.rejected).toBe(1);
			expect(doctor.rejectedEntries[0]).toEqual({
				state: "rejected",
				path: "./missing-package",
				error: "Configured package path does not exist",
			});
			expect(formatPackageDoctorReport(doctor)).toContain("Rejected:");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("prefers canonical package config paths over the legacy name alias", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-config-path-"));
		try {
			writePackage(join(cwd, "vendor", "review-kit"), {
				packageName: "@takumi/vendor-review-kit",
				toolName: "vendor_tool",
			});

			const inspection = inspectTakumiPackages({
				workingDirectory: cwd,
				packages: [{ path: "./vendor/review-kit", name: "./missing-package" }],
			});

			expect(inspection.errors).toEqual([]);
			expect(inspection.packages.map((pkg) => pkg.packageName)).toContain("@takumi/vendor-review-kit");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("falls back to the legacy package alias when canonical path is blank", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-config-blank-path-"));
		try {
			writePackage(join(cwd, "vendor", "review-kit"), {
				packageName: "@takumi/vendor-review-kit",
				toolName: "vendor_tool",
			});

			const inspection = inspectTakumiPackages({
				workingDirectory: cwd,
				packages: [{ path: "   ", name: "./vendor/review-kit" }],
			});

			expect(inspection.errors).toEqual([]);
			expect(inspection.packages.map((pkg) => pkg.packageName)).toContain("@takumi/vendor-review-kit");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("treats numeric-ish package selectors as names when they are not plain indexes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-selector-"));
		try {
			createProjectLocalPackage(cwd, "alpha-kit", "alpha_tool");
			writePackage(join(cwd, ".takumi", "packages", "numeric-kit"), {
				packageName: "@takumi/10-review-kit",
				toolName: "numeric_tool",
			});

			const inspection = inspectTakumiPackages({ workingDirectory: cwd, packages: [] });
			expect(selectTakumiPackage(inspection, "10-review-kit")?.packageName).toBe("@takumi/10-review-kit");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("breaks same-source identity collisions deterministically by lexical root path", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-collision-"));
		try {
			writePackage(join(cwd, ".takumi", "packages", "a-review-kit"), {
				packageName: "@takumi/review-kit",
				toolName: "a_tool",
			});
			writePackage(join(cwd, ".takumi", "packages", "z-review-kit"), {
				packageName: "@takumi/review-kit",
				toolName: "z_tool",
			});

			const report = resolveTakumiPackageGraph({ workingDirectory: cwd, packages: [] });
			expect(report.packages).toHaveLength(1);
			expect(report.packages[0]?.rootPath.endsWith(join(".takumi", "packages", "a-review-kit"))).toBe(true);
			expect(report.shadowedPackages[0]?.rootPath.endsWith(join(".takumi", "packages", "z-review-kit"))).toBe(true);
			expect(report.conflicts.map((conflict) => conflict.kind)).toEqual(
				expect.arrayContaining(["shadowed-package", "same-tier-identity-collision"]),
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("merges package conventions with project conventions", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-conventions-"));
		try {
			createProjectLocalPackage(cwd, "review-kit");
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
