import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTakumiPackages } from "@takumi/agent";
import { describe, expect, it } from "vitest";
import {
	buildPackageDoctorReport,
	findPackage,
	formatPackageDetails,
	scaffoldPackage,
	toPackageListView,
} from "../cli/packages.js";

function createPackage(root: string, name: string, broken = false): string {
	const packageRoot = join(root, ".takumi", "packages", name);
	mkdirSync(join(packageRoot, "skills"), { recursive: true });
	writeFileSync(
		join(packageRoot, "package.json"),
		JSON.stringify(
			{
				name: `@takumi/${name}`,
				version: "0.2.0",
				description: broken ? "Broken package" : "Workflow review kit",
				takumi: {
					extensions: ["./index.mjs"],
					skills: ["./skills"],
					systemPrompt: "./system-prompt.md",
					toolRules: "./tool-rules.json",
					provenance: "local",
					capabilitiesRequested: [broken ? "shell.execute" : "workflow.review"],
					compatibility: {
						takumi: "^0.1.0",
						packageApi: "1",
					},
					evals: {
						coverage: ["smoke"],
						suite: "unit",
					},
					maintainer: "Takumi Test",
				},
			},
			null,
			2,
		),
	);
	writeFileSync(join(packageRoot, "index.mjs"), "export default function extension() {}\n");
	writeFileSync(join(packageRoot, "skills", "review.md"), "# review\n");
	if (!broken) {
		writeFileSync(join(packageRoot, "system-prompt.md"), "Prefer package review heuristics.\n");
		writeFileSync(join(packageRoot, "tool-rules.json"), "[]\n");
	}
	return packageRoot;
}

describe("package CLI helpers", () => {
	it("builds doctor reports with package warnings", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-cli-"));
		try {
			createPackage(cwd, "review-kit");
			createPackage(cwd, "broken-kit", true);

			const result = discoverTakumiPackages([], cwd);
			const report = buildPackageDoctorReport(result);

			expect(report.total).toBe(2);
			expect(report.warning).toBe(1);
			expect(report.ready).toBe(1);
			expect(report.errors).toEqual([]);

			const brokenView = report.packages.find((pkg) => pkg.name === "@takumi/broken-kit");
			expect(brokenView?.provenance).toBe("local");
			expect(brokenView?.warnings).toEqual(
				expect.arrayContaining([
					expect.stringContaining("Missing system prompt"),
					expect.stringContaining("Missing tool rules"),
					expect.stringContaining("Unverified package requests privileged capabilities"),
				]),
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("formats package details and supports basename lookup", () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-details-"));
		try {
			createPackage(cwd, "review-kit");
			const result = discoverTakumiPackages([], cwd);
			const pkg = findPackage(result.packages, "review-kit");

			expect(pkg?.packageName).toBe("@takumi/review-kit");

			const details = formatPackageDetails(pkg!);
			expect(details).toContain("@takumi/review-kit@0.2.0");
			expect(details).toContain("Declared extensions:");
			expect(details).toContain("Declared system prompt: ./system-prompt.md");
			expect(details).toContain("Declared tool rules: ./tool-rules.json");

			const view = toPackageListView(pkg!);
			expect(view.resources.extensions).toBe(1);
			expect(view.resources.skills).toBe(1);
			expect(view.description).toBe("Workflow review kit");
			expect(view.compatibility.takumi).toBe("^0.1.0");
			expect(view.evals.coverage).toEqual(["smoke"]);
			expect(view.maintainer).toBe("Takumi Test");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("scaffolds a local package skeleton", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-scaffold-"));
		try {
			const rootPath = await scaffoldPackage("review-kit", cwd);

			expect(rootPath).toBe(join(cwd, ".takumi", "packages", "review-kit"));
			expect(existsSync(join(rootPath, "package.json"))).toBe(true);
			expect(existsSync(join(rootPath, "index.mjs"))).toBe(true);
			expect(existsSync(join(rootPath, "skills", "package-skill.md"))).toBe(true);

			const manifest = JSON.parse(readFileSync(join(rootPath, "package.json"), "utf-8")) as {
				name: string;
				takumi: {
					extensions: string[];
					skills: string[];
					provenance: string;
					compatibility: { takumi: string; packageApi: string };
				};
			};
			expect(manifest.name).toBe("@takumi/review-kit");
			expect(manifest.takumi.extensions).toEqual(["./index.mjs"]);
			expect(manifest.takumi.skills).toEqual(["./skills"]);
			expect(manifest.takumi.provenance).toBe("local");
			expect(manifest.takumi.compatibility.takumi).toBe("^0.1.0");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("keeps scaffold output inside the local package root", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "takumi-package-scaffold-safe-"));
		try {
			const rootPath = await scaffoldPackage("review/../../kit", cwd);
			expect(rootPath.startsWith(join(cwd, ".takumi", "packages"))).toBe(true);
			expect(rootPath).toContain(join(cwd, ".takumi", "packages", "review-kit"));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});