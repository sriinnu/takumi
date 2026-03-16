import { normalisePath, resolveExeName, winToWslPath, wslToWinPath } from "@takumi/core";
import { describe, expect, it } from "vitest";

describe("win-paths", () => {
	describe("winToWslPath", () => {
		it("converts a standard Windows path", () => {
			expect(winToWslPath("C:\\Users\\dev\\project")).toBe("/mnt/c/Users/dev/project");
		});

		it("handles lowercase drive letter", () => {
			expect(winToWslPath("d:\\data\\file.txt")).toBe("/mnt/d/data/file.txt");
		});

		it("returns non-Windows paths unchanged", () => {
			expect(winToWslPath("/home/user/file")).toBe("/home/user/file");
		});

		it("handles forward-slash Windows path", () => {
			expect(winToWslPath("C:/Users/dev/project")).toBe("/mnt/c/Users/dev/project");
		});
	});

	describe("wslToWinPath", () => {
		it("converts a standard WSL mount path", () => {
			expect(wslToWinPath("/mnt/c/Users/dev/project")).toBe("C:\\Users\\dev\\project");
		});

		it("returns non-WSL paths unchanged", () => {
			expect(wslToWinPath("/home/user/file")).toBe("/home/user/file");
		});

		it("uppercases the drive letter", () => {
			expect(wslToWinPath("/mnt/d/data/file.txt")).toBe("D:\\data\\file.txt");
		});
	});

	describe("normalisePath", () => {
		it("returns Windows paths unchanged on non-WSL non-Windows platforms", () => {
			// On macOS (not WSL, not Windows), normalisePath passes through
			if (process.platform !== "win32") {
				expect(normalisePath("C:\\Users\\dev\\file.ts")).toBe("C:\\Users\\dev\\file.ts");
			}
		});

		it("passes through POSIX paths on non-Windows", () => {
			const posix = "/home/user/file.ts";
			// On macOS/Linux, normalisePath should return a POSIX path
			const result = normalisePath(posix);
			expect(result.startsWith("/")).toBe(true);
		});
	});

	describe("resolveExeName", () => {
		it("returns name unchanged on non-Windows", () => {
			// On macOS CI this should return the name as-is
			const name = resolveExeName("pnpm");
			if (process.platform !== "win32") {
				expect(name).toBe("pnpm");
			} else {
				expect(name).toBe("pnpm.cmd");
			}
		});
	});
});
