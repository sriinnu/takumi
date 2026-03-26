import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectPersistedSideAgentRegistry, normalizeLoadedAgent } from "../src/cluster/side-agent-registry-io.js";

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

async function createRegistry(entries: unknown[]): Promise<string> {
	const baseDir = await mkdtemp(join(tmpdir(), "takumi-side-agent-registry-io-"));
	tempDirs.push(baseDir);
	await mkdir(baseDir, { recursive: true });
	await writeFile(join(baseDir, "registry.json"), JSON.stringify(entries, null, 2));
	return baseDir;
}

describe("side-agent-registry-io", () => {
	afterEach(async () => {
		for (const dir of tempDirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("keeps raw persisted state separate from the normalized runtime state", () => {
		const normalized = normalizeLoadedAgent(
			makeRawAgent({
				tmuxWindow: null,
				tmuxWindowId: null,
				tmuxPaneId: null,
			}),
		);

		expect(normalized.agent?.state).toBe("failed");
		expect(normalized.record.rawState).toBe("running");
		expect(normalized.record.normalizedState).toBe("failed");
		expect(normalized.record.incompleteLive).toBe(true);
		expect(normalized.record.reasons).toContain("incomplete_live_metadata");
	});

	it("retains per-row diagnostics while only keeping unique agents in the runtime snapshot", async () => {
		const registryBaseDir = await createRegistry([
			makeRawAgent({ id: "side-1", description: "" }),
			makeRawAgent({ id: "side-1", tmuxWindowId: "@9" }),
			{ nope: true },
		]);

		const snapshot = await inspectPersistedSideAgentRegistry(registryBaseDir);

		expect(snapshot.records).toHaveLength(3);
		expect(snapshot.agents).toHaveLength(1);
		expect(snapshot.normalizedEntries).toBe(1);
		expect(snapshot.malformedEntries).toBe(2);
		expect(snapshot.records.find((record) => record.rawId === "side-1" && !record.retained)?.reasons).toContain(
			"duplicate_id",
		);
		expect(snapshot.records.find((record) => record.rawId === null)?.reasons).toContain("missing_id");
	});
});
