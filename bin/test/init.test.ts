import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdInit } from "../cli/init.js";

const originalCwd = process.cwd();

describe("cmdInit", () => {
	afterEach(() => {
		process.chdir(originalCwd);
		vi.restoreAllMocks();
	});

	it("prints the default TAKUMI.md path in path mode", async () => {
		const projectDir = mkdtempSync(join(tmpdir(), "takumi-init-cli-"));
		writeFileSync(join(projectDir, "package.json"), '{"name":"demo-app"}\n', "utf-8");
		process.chdir(projectDir);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		try {
			await cmdInit("path");
			expect(logSpy).toHaveBeenCalledWith(join(process.cwd(), "TAKUMI.md"));
		} finally {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});
});