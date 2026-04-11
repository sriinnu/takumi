import { afterEach, describe, expect, it, vi } from "vitest";

const ideCoreMocks = vi.hoisted(() => ({
	detectAvailableIdeLaunchers: vi.fn(),
	openInIde: vi.fn(),
}));

vi.mock("@takumi/core", async () => {
	const actual = await vi.importActual<typeof import("@takumi/core")>("@takumi/core");
	return {
		...actual,
		detectAvailableIdeLaunchers: ideCoreMocks.detectAvailableIdeLaunchers,
		openInIde: ideCoreMocks.openInIde,
	};
});

import { cmdIde } from "../cli/ide.js";

describe("cmdIde", () => {
	afterEach(() => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockReset();
		ideCoreMocks.openInIde.mockReset();
		vi.restoreAllMocks();
		process.exitCode = 0;
	});

	it("prints JSON status when requested", async () => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockResolvedValue([
			{ id: "cursor", label: "Cursor", command: "cursor", aliases: [], source: "cli", probeArgs: ["--version"], available: true },
		]);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await cmdIde("status", [], true);

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"targetPath"'));
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"cursor"'));
	});

	it("opens the requested IDE launcher", async () => {
		ideCoreMocks.detectAvailableIdeLaunchers.mockResolvedValue([
			{ id: "cursor", label: "Cursor", command: "cursor", aliases: [], source: "cli", probeArgs: ["--version"], available: true },
		]);
		ideCoreMocks.openInIde.mockResolvedValue({
			opened: true,
			targetPath: "/repo/apps/desktop",
			launcher: { id: "cursor", label: "Cursor", command: "cursor", aliases: [], source: "cli", probeArgs: ["--version"], available: true },
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await cmdIde("open", ["cursor", "apps/desktop"]);

		expect(ideCoreMocks.openInIde).toHaveBeenCalledWith(
			expect.objectContaining({
				selector: "cursor",
				targetPath: "apps/desktop",
			}),
		);
		expect(logSpy).toHaveBeenCalledWith("Opened /repo/apps/desktop in Cursor.");
	});
});