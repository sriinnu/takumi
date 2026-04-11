import {
	findIdeLauncher,
	type IdeLauncherAvailability,
	openInIde,
	resolveConfiguredIdeSelector,
	resolveIdeTargetPath,
	selectIdeLauncher,
} from "@takumi/core";
import { describe, expect, it, vi } from "vitest";

function createLauncher(overrides: Partial<IdeLauncherAvailability> = {}): IdeLauncherAvailability {
	return {
		id: "cursor",
		label: "Cursor",
		command: "cursor",
		aliases: [],
		source: "cli",
		probeArgs: ["--version"],
		available: true,
		...overrides,
	};
}

describe("ide-launch", () => {
	it("resolves configured IDE selectors from env", () => {
		expect(resolveConfiguredIdeSelector({ TAKUMI_IDE: "code-insiders" })).toBe("code-insiders");
		expect(
			resolveConfiguredIdeSelector({
				VISUAL: '"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" -w',
			}),
		).toBe("code");
		expect(resolveConfiguredIdeSelector({ EDITOR: "cursor --wait" })).toBe("cursor");
	});

	it("matches common launcher aliases", () => {
		expect(findIdeLauncher("code")?.id).toBe("vscode");
		expect(findIdeLauncher("insiders")?.id).toBe("vscode-insiders");
		expect(findIdeLauncher("subl")?.id).toBe("sublime");
	});

	it("expands home-relative IDE target paths", () => {
		expect(resolveIdeTargetPath("~/takumi-playground", "/tmp/workspace")).toContain("takumi-playground");
		expect(resolveIdeTargetPath(undefined, "/tmp/workspace")).toBe("/tmp/workspace");
	});

	it("prefers configured launchers when they are available", () => {
		const selected = selectIdeLauncher(
			[
				createLauncher({ id: "vscode", label: "VS Code", command: "code" }),
				createLauncher({ id: "cursor", label: "Cursor", command: "cursor" }),
			],
			undefined,
			{ TAKUMI_IDE: "code" },
		);

		expect(selected?.id).toBe("vscode");
	});

	it("returns a helpful error for unknown launchers", async () => {
		const spawnDetached = vi.fn(async () => undefined);
		const result = await openInIde({
			selector: "not-a-real-ide",
			cwd: "/repo",
			availability: [
				createLauncher(),
				createLauncher({ id: "system", label: "System default", command: "open", source: "system", probeArgs: [] }),
			],
			spawnDetached,
		});

		expect(result.opened).toBe(false);
		expect(result.error).toContain("Unknown IDE launcher");
		expect(spawnDetached).not.toHaveBeenCalled();
	});

	it("launches the selected IDE with a resolved target path", async () => {
		const spawnDetached = vi.fn(async () => undefined);
		const result = await openInIde({
			selector: "cursor",
			targetPath: "apps/desktop",
			cwd: "/repo",
			availability: [createLauncher()],
			spawnDetached,
		});

		expect(result.opened).toBe(true);
		expect(result.targetPath).toBe("/repo/apps/desktop");
		expect(spawnDetached).toHaveBeenCalledWith("cursor", ["/repo/apps/desktop"]);
	});
});
