import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairPersistedSideAgentRegistry } from "../src/cluster/side-agent-registry-repair.js";

const tempDirs: string[] = [];

function makeRawAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "side-1",
		description: "raw side agent",
		state: "running",
		model: "gpt-5",
		slotId: "wt-0001",
		worktreePath: "/repo/.takumi/worktrees/wt-0001",
		tmuxWindow: "agent-side-1",
		tmuxSessionName: "takumi-side-agents",
		tmuxWindowId: "@1",
		tmuxPaneId: "%1",
		branch: "takumi/side-agent/side-1-wt-0001",
		pid: null,
		startedAt: 100,
		updatedAt: 100,
		...overrides,
	};
}

async function createRegistry(raw: string): Promise<string> {
	const baseDir = await mkdtemp(join(tmpdir(), "takumi-side-agent-repair-"));
	tempDirs.push(baseDir);
	await mkdir(baseDir, { recursive: true });
	await writeFile(join(baseDir, "registry.json"), raw, "utf-8");
	return baseDir;
}

describe("repairPersistedSideAgentRegistry", () => {
	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rewrites retained normalized agents and drops malformed rows", async () => {
		const baseDir = await createRegistry(
			JSON.stringify(
				[makeRawAgent({ description: "" }), makeRawAgent({ id: "side-1", tmuxWindowId: "@9" }), { nope: true }],
				null,
				2,
			),
		);

		const result = await repairPersistedSideAgentRegistry(baseDir);
		const repaired = JSON.parse(await readFile(join(baseDir, "registry.json"), "utf-8"));

		expect(result).toMatchObject({
			mode: "rewritten_normalized",
			changed: true,
			totalEntries: 3,
			writtenEntries: 1,
			removedEntries: 2,
			normalizedEntries: 1,
			malformedEntries: 2,
		});
		expect(result.backupPath).toBeTruthy();
		await expect(access(result.backupPath!)).resolves.toBeUndefined();
		expect(repaired).toHaveLength(1);
		expect(repaired[0]).toMatchObject({
			id: "side-1",
			description: "Recovered side agent side-1",
		});
	});

	it("backs up and resets unreadable registries", async () => {
		const baseDir = await createRegistry("{not-json");

		const result = await repairPersistedSideAgentRegistry(baseDir);
		const repaired = await readFile(join(baseDir, "registry.json"), "utf-8");

		expect(result).toMatchObject({
			mode: "rewritten_reset",
			changed: true,
			writtenEntries: 0,
		});
		expect(result.backupPath).toBeTruthy();
		await expect(access(result.backupPath!)).resolves.toBeUndefined();
		expect(repaired).toBe("[]");
	});

	it("no-ops when the registry is already clean", async () => {
		const baseDir = await createRegistry(JSON.stringify([makeRawAgent()], null, 2));

		const result = await repairPersistedSideAgentRegistry(baseDir);
		const repaired = JSON.parse(await readFile(join(baseDir, "registry.json"), "utf-8"));

		expect(result).toMatchObject({
			mode: "noop_clean",
			changed: false,
			totalEntries: 1,
			writtenEntries: 1,
		});
		expect(result.backupPath).toBeNull();
		expect(repaired).toHaveLength(1);
	});

	it("no-ops when the registry file is absent", async () => {
		const baseDir = await mkdtemp(join(tmpdir(), "takumi-side-agent-repair-missing-"));
		tempDirs.push(baseDir);

		const result = await repairPersistedSideAgentRegistry(baseDir);

		expect(result).toMatchObject({
			mode: "noop_missing",
			changed: false,
			totalEntries: 0,
			writtenEntries: 0,
		});
		expect(result.backupPath).toBeNull();
	});
});
