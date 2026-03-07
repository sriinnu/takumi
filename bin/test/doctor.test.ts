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
			generatedAt: 456,
		});

		expect(report.overall).toBe("fail");
		expect(report.warnings.some((warning) => warning.includes("auth path"))).toBe(true);
		expect(report.warnings.some((warning) => warning.includes("context limit"))).toBe(true);
		expect(report.fixes.some((fix) => fix.includes("daemon"))).toBe(true);
		expect(formatDoctorReport(report)).toContain("FAIL");
		expect(formatDoctorReport(report)).toContain("Fixes:");
	});
});