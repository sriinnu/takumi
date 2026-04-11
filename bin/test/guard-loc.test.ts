import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(new URL("../../scripts/guard-loc.mjs", import.meta.url));
const tempRoots: string[] = [];

/**
 * Creates a temporary workspace root for the guard.
 */
async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), "takumi-guard-loc-"));
	tempRoots.push(root);
	await mkdir(join(root, "scripts"), { recursive: true });
	return root;
}

/**
 * Writes a source file with an exact logical line count.
 */
async function writeSourceFile(root: string, relPath: string, lineCount: number) {
	const fullPath = join(root, relPath);
	await mkdir(dirname(fullPath), { recursive: true });
	const lines = Array.from({ length: lineCount }, (_, index) => `export const value${index} = ${index};`);
	await writeFile(fullPath, lines.join("\n"));
}

/**
 * Writes LOC debt metadata for the fixture workspace.
 */
async function writeBaseline(root: string, baseline: unknown) {
	await writeFile(join(root, "scripts", "guard-loc-baseline.json"), `${JSON.stringify(baseline, null, "\t")}\n`);
}

/**
 * Runs the guard in a temporary workspace.
 */
async function runGuard(root: string, today: string) {
	try {
		const result = await execFileAsync("node", [SCRIPT_PATH], {
			cwd: root,
			env: {
				...process.env,
				TAKUMI_LOC_GUARD_TODAY: today,
			},
		});
		return {
			code: 0,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (error) {
		const result = error as {
			code?: number;
			stdout?: string;
			stderr?: string;
		};
		return {
			code: typeof result.code === "number" ? result.code : 1,
			stdout: typeof result.stdout === "string" ? result.stdout : "",
			stderr: typeof result.stderr === "string" ? result.stderr : "",
		};
	}
}

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("guard-loc", () => {
	it("prints the next ratchet target for grandfathered debt", async () => {
		const root = await createWorkspace();
		await writeSourceFile(root, "packages/demo/src/legacy.ts", 500);
		await writeBaseline(root, {
			version: 1,
			recordedAt: "2026-04-04",
			defaults: {
				ratchetLines: 25,
				ratchetEveryDays: 30,
			},
			entries: {
				"packages/demo/src/legacy.ts": {
					baselineLines: 500,
				},
			},
		});

		const result = await runGuard(root, "2026-04-10");

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("next target 475 by 2026-05-04");
	});

	it("fails once a debt file misses its scheduled ratchet", async () => {
		const root = await createWorkspace();
		await writeSourceFile(root, "packages/demo/src/legacy.ts", 500);
		await writeBaseline(root, {
			version: 1,
			recordedAt: "2026-04-04",
			defaults: {
				ratchetLines: 25,
				ratchetEveryDays: 30,
			},
			entries: {
				"packages/demo/src/legacy.ts": {
					baselineLines: 500,
				},
			},
		});

		const result = await runGuard(root, "2026-05-05");

		expect(result.code).toBe(1);
		expect(result.stderr).toContain("allowed 475");
	});

	it("passes when a debt file is reduced to the current allowance", async () => {
		const root = await createWorkspace();
		await writeSourceFile(root, "packages/demo/src/legacy.ts", 475);
		await writeBaseline(root, {
			version: 1,
			recordedAt: "2026-04-04",
			defaults: {
				ratchetLines: 25,
				ratchetEveryDays: 30,
			},
			entries: {
				"packages/demo/src/legacy.ts": {
					baselineLines: 500,
				},
			},
		});

		const result = await runGuard(root, "2026-05-05");

		expect(result.code).toBe(0);
		expect(result.stdout).toContain("allowed 475");
	});

	it("blocks new oversized files that do not have debt metadata", async () => {
		const root = await createWorkspace();
		await writeSourceFile(root, "packages/demo/src/new-offender.ts", 451);

		const result = await runGuard(root, "2026-04-10");

		expect(result.code).toBe(1);
		expect(result.stderr).toContain("new offender, max 450");
	});
});
