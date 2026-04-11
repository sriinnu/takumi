import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureTakumiProjectInstructionsFile,
	formatTakumiProjectInstructionsInspection,
	getTakumiProjectInstructionsPath,
	inspectTakumiProjectInstructions,
} from "@takumi/core";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("Takumi project instructions helpers", () => {
	it("creates TAKUMI.md at the project root even from a nested cwd", async () => {
		const projectDir = makeTempDir("takumi-init-project-");
		const nestedDir = join(projectDir, "apps", "desktop", "src");
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(join(projectDir, "package.json"), '{"name":"demo-app"}\n', "utf-8");

		const ensured = await ensureTakumiProjectInstructionsFile(nestedDir);
		const expectedPath = join(projectDir, "TAKUMI.md");

		expect(ensured.filePath).toBe(expectedPath);
		expect(existsSync(expectedPath)).toBe(true);
		expect(getTakumiProjectInstructionsPath(nestedDir)).toBe(expectedPath);
		expect(readFileSync(expectedPath, "utf-8")).toContain("# TAKUMI.md");
		expect(readFileSync(expectedPath, "utf-8")).toContain("demo-app");

		const inspection = inspectTakumiProjectInstructions(nestedDir);
		expect(inspection.projectRoot).toBe(projectDir);
		expect(inspection.activePath).toBe(expectedPath);
		expect(formatTakumiProjectInstructionsInspection(inspection)).toContain("Search order:");
	});

	it("reports the active instructions file according to Takumi precedence", () => {
		const projectDir = makeTempDir("takumi-init-precedence-");
		writeFileSync(join(projectDir, "package.json"), '{"name":"demo-app"}\n', "utf-8");
		writeFileSync(join(projectDir, "CLAUDE.md"), "# Claude\n", "utf-8");

		const inspection = inspectTakumiProjectInstructions(projectDir);
		expect(inspection.activePath).toBe(join(projectDir, "CLAUDE.md"));
		expect(inspection.defaultPath).toBe(join(projectDir, "TAKUMI.md"));

		writeFileSync(join(projectDir, "TAKUMI.md"), "# Takumi\n", "utf-8");
		const updated = inspectTakumiProjectInstructions(projectDir);
		expect(updated.activePath).toBe(join(projectDir, "TAKUMI.md"));
	});
});
