import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdConfig } from "../cli/config.js";

const originalConfigDir = process.env.TAKUMI_CONFIG_DIR;

describe("cmdConfig", () => {
	afterEach(() => {
		if (originalConfigDir === undefined) delete process.env.TAKUMI_CONFIG_DIR;
		else process.env.TAKUMI_CONFIG_DIR = originalConfigDir;
		vi.restoreAllMocks();
	});

	it("prints the default global config path in path mode", async () => {
		const configDir = mkdtempSync(join(tmpdir(), "takumi-config-cli-"));
		process.env.TAKUMI_CONFIG_DIR = configDir;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		try {
			await cmdConfig("path");
			expect(logSpy).toHaveBeenCalledWith(join(configDir, "config.json"));
		} finally {
			rmSync(configDir, { recursive: true, force: true });
		}
	});
});