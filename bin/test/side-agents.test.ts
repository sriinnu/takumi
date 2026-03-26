import { beforeEach, describe, expect, it, vi } from "vitest";

const inspectPersistedSideAgentRegistry = vi.fn();
const repairPersistedSideAgentRegistry = vi.fn();

vi.mock("@takumi/agent", () => ({
	inspectPersistedSideAgentRegistry,
	repairPersistedSideAgentRegistry,
}));

describe("side-agents CLI", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("formats inspect output with an explicit repair hint when the registry needs rewrite", async () => {
		const { buildSideAgentRegistryInspectReport, formatSideAgentRegistryInspectReport } = await import("../cli/side-agents.js");

		const report = buildSideAgentRegistryInspectReport(
			"/repo",
			{
				registryPath: "/repo/.takumi/side-agents/registry.json",
				totalEntries: 3,
				normalizedEntries: 1,
				malformedEntries: 1,
				records: [],
				agents: [{ id: "side-1" }],
			} as never,
			true,
		);

		expect(report.status).toBe("needs_repair");
		expect(report.repairSuggested).toBe(true);
		expect(formatSideAgentRegistryInspectReport(report)).toContain("takumi side-agents repair");
	});

	it("prints inspect JSON for an absent registry", async () => {
		inspectPersistedSideAgentRegistry.mockResolvedValueOnce({
			registryPath: "/repo/.takumi/side-agents/registry.json",
			totalEntries: 0,
			normalizedEntries: 0,
			malformedEntries: 0,
			records: [],
			agents: [],
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { cmdSideAgents } = await import("../cli/side-agents.js");

		await cmdSideAgents({} as never, "inspect", true, "/repo");

		expect(inspectPersistedSideAgentRegistry).toHaveBeenCalledWith("/repo/.takumi/side-agents");
		const payload = JSON.parse(log.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			action: "inspect",
			status: "absent",
			repairSuggested: false,
		});
		log.mockRestore();
	});

	it("prints repair JSON after rewriting the registry", async () => {
		repairPersistedSideAgentRegistry.mockResolvedValueOnce({
			registryPath: "/repo/.takumi/side-agents/registry.json",
			backupPath: "/repo/.takumi/side-agents/registry.backup-1.json",
			mode: "rewritten_normalized",
			changed: true,
			totalEntries: 3,
			writtenEntries: 1,
			removedEntries: 2,
			normalizedEntries: 1,
			malformedEntries: 1,
			summary: "rewritten",
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { cmdSideAgents } = await import("../cli/side-agents.js");

		await cmdSideAgents({} as never, "repair", true, "/repo");

		expect(repairPersistedSideAgentRegistry).toHaveBeenCalledWith("/repo/.takumi/side-agents");
		const payload = JSON.parse(log.mock.calls[0]?.[0] as string);
		expect(payload).toMatchObject({
			action: "repair",
			result: {
				mode: "rewritten_normalized",
				changed: true,
			},
		});
		log.mockRestore();
	});
});
