import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface RootPackageJson {
	scripts?: Record<string, string>;
}

interface DevTsconfig {
	compilerOptions?: {
		paths?: Record<string, string[]>;
	};
}

/**
 * I keep the local source-run entrypoints honest so `pnpm takumi` and the
 * other tsx-driven scripts do not silently drift back to stale workspace
 * package builds.
 */
describe("dev entrypoint contract", () => {
	function readJson<T>(relativePath: string): T {
		const absolutePath = resolve(process.cwd(), relativePath);
		return JSON.parse(readFileSync(absolutePath, "utf-8")) as T;
	}

	it("routes source-run scripts through the dev tsconfig aliases", () => {
		const packageJson = readJson<RootPackageJson>("package.json");
		const scripts = packageJson.scripts ?? {};

		expect(scripts.takumi).toBe("tsx --tsconfig tsconfig.dev.json bin/takumi.ts");
		expect(scripts["autosearch:overnight"]).toBe("tsx --tsconfig tsconfig.dev.json scripts/overnight-autosearch.ts");
		expect(scripts.eval).toBe("tsx --tsconfig tsconfig.dev.json scripts/eval.ts");
	});

	it("maps every workspace package to source for dev execution", () => {
		const tsconfig = readJson<DevTsconfig>("tsconfig.dev.json");
		const paths = tsconfig.compilerOptions?.paths ?? {};

		expect(paths).toEqual({
			"@takumi/core": ["packages/core/src/index.ts"],
			"@takumi/render": ["packages/render/src/index.ts"],
			"@takumi/bridge": ["packages/bridge/src/index.ts"],
			"@takumi/agent": ["packages/agent/src/index.ts"],
			"@takumi/tui": ["packages/tui/src/index.ts"],
		});
	});
});
