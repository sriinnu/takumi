import { currentPlatform, detectShell, detectTerminal, resolveCacheDir, resolveConfigDir } from "@takumi/core";
import { describe, expect, it } from "vitest";

describe("platform-detect", () => {
	it("currentPlatform returns a valid PlatformId", () => {
		const p = currentPlatform();
		expect(["macos", "linux", "windows", "unknown"]).toContain(p);
	});

	it("detectTerminal returns a string", () => {
		const t = detectTerminal();
		expect(typeof t).toBe("string");
		expect(t.length).toBeGreaterThan(0);
	});

	it("detectShell returns a string", () => {
		const s = detectShell();
		expect(typeof s).toBe("string");
		expect(s.length).toBeGreaterThan(0);
	});

	it("resolveConfigDir returns a non-empty path", () => {
		const dir = resolveConfigDir();
		expect(dir.length).toBeGreaterThan(0);
		expect(dir).toContain("takumi");
	});

	it("resolveCacheDir returns a non-empty path", () => {
		const dir = resolveCacheDir();
		expect(dir.length).toBeGreaterThan(0);
		expect(dir).toContain("takumi");
	});

	it("resolveConfigDir respects TAKUMI_CONFIG_DIR env", () => {
		const orig = process.env.TAKUMI_CONFIG_DIR;
		process.env.TAKUMI_CONFIG_DIR = "/custom/config/path";
		try {
			expect(resolveConfigDir()).toBe("/custom/config/path");
		} finally {
			if (orig === undefined) delete process.env.TAKUMI_CONFIG_DIR;
			else process.env.TAKUMI_CONFIG_DIR = orig;
		}
	});

	it("resolveCacheDir respects TAKUMI_CACHE_DIR env", () => {
		const orig = process.env.TAKUMI_CACHE_DIR;
		process.env.TAKUMI_CACHE_DIR = "/custom/cache/path";
		try {
			expect(resolveCacheDir()).toBe("/custom/cache/path");
		} finally {
			if (orig === undefined) delete process.env.TAKUMI_CACHE_DIR;
			else process.env.TAKUMI_CACHE_DIR = orig;
		}
	});
});
