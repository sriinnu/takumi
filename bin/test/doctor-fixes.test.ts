import { describe, expect, it, vi } from "vitest";
import type { DoctorReport } from "../cli/doctor.js";
import { applyDoctorFixes } from "../cli/doctor.js";

function makeReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
	return {
		version: "0.1.0",
		generatedAt: 123,
		workspace: "/repo",
		provider: "openai",
		model: "gpt-5",
		auth: { ready: true, source: "explicit api key", canSkipApiKey: false },
		daemon: {
			pid: 123,
			alive: true,
			listening: true,
			healthy: true,
			socketPath: "/tmp/chitragupta.sock",
			pidPath: "/tmp/chitragupta.pid",
			logDir: "/tmp/logs",
		},
		kosha: { totalProviders: 1, authenticatedProviders: 1, authenticatedIds: ["openai"] },
		telemetry: { activeInstances: 0, working: 0, waitingInput: 0, atLimit: 0, nearLimit: 0 },
		detachedJobs: { total: 0, running: 0 },
		sideAgents: {
			bootstrap: { enabled: true, degraded: false, reason: "enabled", summary: "preflight ready" },
			audit: {
				registry: {
					registryPath: "/repo/.takumi/side-agents/registry.json",
					totalEntries: 0,
					normalizedEntries: 0,
					malformedEntries: 0,
					records: [],
					agents: [],
				},
				activeAgents: 0,
				terminalAgents: 0,
				orphanedWorktrees: [],
				tmuxInspected: false,
				issues: [],
			},
		},
		overall: "ok",
		warnings: [],
		fixes: [],
		...overrides,
	};
}

describe("applyDoctorFixes", () => {
	it("starts the daemon and repairs safe registry-only drift", async () => {
		const startDaemon = vi.fn(async () => {});
		const repairSideAgentRegistry = vi.fn(async () => ({ changed: true, mode: "rewritten_normalized" }));
		const report = makeReport({
			daemon: {
				pid: null,
				alive: false,
				listening: false,
				healthy: false,
				socketPath: "/tmp/chitragupta.sock",
				pidPath: "/tmp/chitragupta.pid",
				logDir: "/tmp/logs",
			},
			sideAgents: {
				bootstrap: { enabled: true, degraded: false, reason: "enabled", summary: "preflight ready" },
				audit: {
					registry: {
						registryPath: "/repo/.takumi/side-agents/registry.json",
						totalEntries: 2,
						normalizedEntries: 1,
						malformedEntries: 1,
						records: [],
						agents: [],
					},
					activeAgents: 0,
					terminalAgents: 0,
					orphanedWorktrees: [],
					tmuxInspected: false,
					issues: [
						{ code: "registry_entry_normalized", severity: "warn", detail: "normalized" },
						{ code: "registry_entry_malformed", severity: "warn", detail: "malformed" },
					],
				},
			},
		});

		const applied = await applyDoctorFixes(report, { startDaemon, repairSideAgentRegistry });

		expect(startDaemon).toHaveBeenCalledOnce();
		expect(repairSideAgentRegistry).toHaveBeenCalledWith("/repo/.takumi/side-agents");
		expect(applied).toEqual(["Started Chitragupta daemon", "Repaired side-agent registry (rewritten_normalized)"]);
	});

	it("does not auto-repair when live side-agent drift exists", async () => {
		const startDaemon = vi.fn(async () => {});
		const repairSideAgentRegistry = vi.fn(async () => ({ changed: true, mode: "rewritten_normalized" }));
		const report = makeReport({
			sideAgents: {
				bootstrap: { enabled: true, degraded: false, reason: "enabled", summary: "preflight ready" },
				audit: {
					registry: {
						registryPath: "/repo/.takumi/side-agents/registry.json",
						totalEntries: 1,
						normalizedEntries: 0,
						malformedEntries: 0,
						records: [],
						agents: [],
					},
					activeAgents: 1,
					terminalAgents: 0,
					orphanedWorktrees: [],
					tmuxInspected: true,
					issues: [{ code: "live_branch_drift", severity: "fail", agentId: "side-1", detail: "drift" }],
				},
			},
		});

		const applied = await applyDoctorFixes(report, { startDaemon, repairSideAgentRegistry });

		expect(repairSideAgentRegistry).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
	});

	it("does not auto-repair unreadable registry failures", async () => {
		const startDaemon = vi.fn(async () => {});
		const repairSideAgentRegistry = vi.fn(async () => ({ changed: true, mode: "rewritten_reset" }));
		const report = makeReport({
			sideAgents: {
				bootstrap: { enabled: true, degraded: false, reason: "enabled", summary: "preflight ready" },
				audit: {
					registry: {
						registryPath: "/repo/.takumi/side-agents/registry.json",
						totalEntries: 0,
						normalizedEntries: 0,
						malformedEntries: 0,
						records: [],
						agents: [],
						readError: "permission denied",
					},
					activeAgents: 0,
					terminalAgents: 0,
					orphanedWorktrees: [],
					tmuxInspected: false,
					issues: [{ code: "registry_read_failed", severity: "warn", detail: "permission denied" }],
				},
			},
		});

		const applied = await applyDoctorFixes(report, { startDaemon, repairSideAgentRegistry });

		expect(repairSideAgentRegistry).not.toHaveBeenCalled();
		expect(applied).toEqual([]);
	});
});
