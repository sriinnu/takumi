import { describe, expect, it } from "vitest";
import { buildPlatformReport, formatPlatformReport } from "../cli/platform.js";

describe("platform report", () => {
	it("builds an aggregate platform report", () => {
		const report = buildPlatformReport({
			doctor: {
				version: "0.1.0",
				generatedAt: 100,
				workspace: "/repo",
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				auth: { ready: true, source: "cli", canSkipApiKey: false },
				daemon: {
					pid: 123,
					alive: true,
					listening: true,
					healthy: true,
					socketPath: "/tmp/chitragupta.sock",
					pidPath: "/tmp/chitragupta.pid",
					logDir: "/tmp/logs",
				},
				kosha: { totalProviders: 3, authenticatedProviders: 2, authenticatedIds: ["anthropic", "github"] },
				telemetry: { activeInstances: 1, working: 1, waitingInput: 0, atLimit: 0, nearLimit: 0 },
				detachedJobs: { total: 2, running: 1 },
				overall: "warn",
				warnings: ["Kosha is grumpy"],
				fixes: ["Log in again"],
			},
			sessions: [
				{
					id: "session-1",
					title: "Ship it",
					model: "claude-sonnet-4-20250514",
					messageCount: 4,
					updatedAt: 200,
					updatedAge: "1m ago",
				},
			],
			detachedJobs: [
				{
					id: "job-1",
					pid: 999,
					state: "running",
					startedAt: 300,
					cwd: "/repo",
					logFile: "/tmp/job.log",
				},
			],
			generatedAt: 400,
		});

		expect(report.overall).toBe("warn");
		expect(report.summary.runningDetachedJobs).toBe(1);
		expect(report.summary.recentSessions).toBe(1);
		expect(report.daemon.healthy).toBe(true);
	});

	it("formats a readable platform summary", () => {
		const text = formatPlatformReport(
			buildPlatformReport({
				doctor: {
					version: "0.1.0",
					generatedAt: 100,
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
					telemetry: { activeInstances: 0, working: 0, waitingInput: 0, atLimit: 0, nearLimit: 0 },
					detachedJobs: { total: 0, running: 0 },
					overall: "fail",
					warnings: ["No auth"],
					fixes: ["Set an API key"],
				},
				sessions: [],
				detachedJobs: [],
			}),
		);

		expect(text).toContain("Takumi Platform — FAIL");
		expect(text).toContain("Doctor:");
		expect(text).toContain("Recent sessions:");
		expect(text).toContain("Detached jobs:");
		});
});