import { describe, expect, it } from "vitest";
import { buildDoctorReport, formatDoctorReport } from "../cli/doctor.js";

describe("doctor report", () => {
	it("marks the CLI healthy when auth and control-plane signals are present", () => {
		const report = buildDoctorReport({
			version: "0.1.0",
			workspace: "/repo",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			auth: { ready: true, source: "GitHub CLI", canSkipApiKey: false },
			daemon: {
				pid: 123,
				alive: true,
				listening: true,
				healthy: true,
				socketPath: "/tmp/chitragupta.sock",
				pidPath: "/tmp/chitragupta.pid",
				logDir: "/tmp/logs",
			},
			kosha: { totalProviders: 4, authenticatedProviders: 2, authenticatedIds: ["anthropic", "github"] },
			telemetry: { activeInstances: 2, working: 1, waitingInput: 1, atLimit: 0, nearLimit: 0 },
			detachedJobs: { total: 1, running: 1 },
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
			generatedAt: 123,
		});

		expect(report.overall).toBe("ok");
		expect(report.warnings).toEqual([]);
		expect(report.fixes.length).toBe(0);
		expect(formatDoctorReport(report)).toContain("CLI looks crisp");
	});

	it("surfaces warnings and fail state when auth is missing", () => {
		const report = buildDoctorReport({
			version: "0.1.0",
			workspace: "/repo",
			provider: "openai",
			model: "gpt-5",
			auth: { ready: false, source: "not found", canSkipApiKey: false },
			daemon: {
				pid: null,
				alive: false,
				listening: false,
				healthy: false,
				socketPath: "/tmp/chitragupta.sock",
				pidPath: "/tmp/chitragupta.pid",
				logDir: "/tmp/logs",
			},
			kosha: { totalProviders: 0, authenticatedProviders: 0, authenticatedIds: [] },
			telemetry: { activeInstances: 1, working: 1, waitingInput: 0, atLimit: 1, nearLimit: 0 },
			detachedJobs: { total: 3, running: 2 },
			sideAgents: {
				bootstrap: { enabled: false, degraded: true, reason: "tmux_unavailable", summary: "tmux is unavailable" },
				audit: null,
			},
			generatedAt: 456,
		});

		expect(report.overall).toBe("fail");
		expect(report.warnings.some((warning) => warning.includes("auth path"))).toBe(true);
		expect(report.warnings.some((warning) => warning.includes("context limit"))).toBe(true);
		expect(report.warnings.some((warning) => warning.includes("Side-agent runtime"))).toBe(true);
		expect(report.fixes.some((fix) => fix.includes("daemon"))).toBe(true);
		expect(report.fixes.some((fix) => fix.includes("tmux"))).toBe(true);
		expect(formatDoctorReport(report)).toContain("FAIL");
		expect(formatDoctorReport(report)).toContain("Fixes:");
	});

	it("fails when side-agent audit finds live runtime drift", () => {
		const report = buildDoctorReport({
			version: "0.1.0",
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
					issues: [{ code: "live_branch_drift", severity: "fail", agentId: "side-1", detail: "branch drift" }],
				},
			},
		});

		expect(report.overall).toBe("fail");
		expect(report.warnings.some((warning) => warning.includes("Side-agent audit found"))).toBe(true);
		expect(report.fixes.some((fix) => fix.includes("live side agents"))).toBe(true);
	});

	it("recommends the explicit side-agent repair command for registry drift", () => {
		const report = buildDoctorReport({
			version: "0.1.0",
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
					issues: [{ code: "registry_entry_malformed", severity: "warn", detail: "bad row" }],
				},
			},
		});

		expect(report.fixes.some((fix) => fix.includes("takumi side-agents repair"))).toBe(true);
	});

	it("keeps side agents silent when they are intentionally disabled", () => {
		const report = buildDoctorReport({
			version: "0.1.0",
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
				bootstrap: { enabled: false, degraded: false, reason: "tmux_disabled", summary: "disabled by config" },
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
		});

		expect(report.overall).toBe("ok");
		expect(report.warnings.some((warning) => warning.includes("Side-agent runtime"))).toBe(false);
		expect(formatDoctorReport(report)).toContain("Side agents:       disabled (disabled by config)");
		expect(formatDoctorReport(report)).toContain("Side-agent audit:  0 persisted, 0 active, 0 terminal, 0 issue(s), 0 orphaned, tmux skipped");
	});
});
