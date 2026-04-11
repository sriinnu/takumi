import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureTakumiConfigFile,
	formatTakumiConfigInspection,
	getTakumiConfigPath,
	inspectTakumiUserConfig,
} from "@takumi/core";
import { afterEach, describe, expect, it } from "vitest";

const originalConfigDir = process.env.TAKUMI_CONFIG_DIR;
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
	if (originalConfigDir === undefined) delete process.env.TAKUMI_CONFIG_DIR;
	else process.env.TAKUMI_CONFIG_DIR = originalConfigDir;
});

describe("Takumi config file helpers", () => {
	it("creates a global config file when no active config exists", async () => {
		const projectDir = makeTempDir("takumi-project-");
		const configDir = makeTempDir("takumi-user-");
		process.env.TAKUMI_CONFIG_DIR = configDir;

		const ensured = await ensureTakumiConfigFile("active", projectDir);
		const expectedPath = join(configDir, "config.json");

		expect(ensured.created).toBe(true);
		expect(ensured.filePath).toBe(expectedPath);
		expect(existsSync(expectedPath)).toBe(true);
		expect(readFileSync(expectedPath, "utf-8")).toContain('"model"');

		const inspection = inspectTakumiUserConfig(projectDir);
		expect(inspection.activePath).toBe(expectedPath);
		expect(formatTakumiConfigInspection(inspection)).toContain(expectedPath);
	});

	it("creates a project-local config on demand", async () => {
		const projectDir = makeTempDir("takumi-project-");
		const configDir = makeTempDir("takumi-user-");
		process.env.TAKUMI_CONFIG_DIR = configDir;

		const ensured = await ensureTakumiConfigFile("project", projectDir);
		const expectedPath = join(projectDir, ".takumi", "config.json");

		expect(ensured.filePath).toBe(expectedPath);
		expect(existsSync(expectedPath)).toBe(true);
		expect(getTakumiConfigPath("project", projectDir)).toBe(expectedPath);
	});

	it("prefers the highest-priority existing config file", () => {
		const projectDir = makeTempDir("takumi-project-");
		const configDir = makeTempDir("takumi-user-");
		process.env.TAKUMI_CONFIG_DIR = configDir;

		const localConfig = join(projectDir, ".takumi", "config.json");
		const rootConfig = join(projectDir, "takumi.config.json");
		const globalConfig = join(configDir, "config.json");

		writeFileSync(rootConfig, "{}\n", "utf-8");
		writeFileSync(globalConfig, "{}\n", "utf-8");
		rmSync(join(projectDir, ".takumi"), { recursive: true, force: true });
		mkdirSync(join(projectDir, ".takumi"), { recursive: true });
		writeFileSync(localConfig, "{}\n", { encoding: "utf-8", flag: "w" });

		const inspection = inspectTakumiUserConfig(projectDir);
		expect(inspection.activePath).toBe(localConfig);
		expect(inspection.searchPaths[0]?.path).toBe(localConfig);
	});
});
