import { describe, expect, it } from "vitest";
import { decodePlatformWatchAction, formatPlatformWatchScreen, type PlatformWatchState } from "../cli/platform-watch.js";
import { buildPlatformReport } from "../cli/platform.js";

function makeState(overrides: Partial<PlatformWatchState> = {}): PlatformWatchState {
	return {
		showDoctor: true,
		showSessions: true,
		showJobs: true,
		showHelp: false,
		focus: "doctor",
		paused: false,
		lastMessage: "Watch ready.",
		lastRefreshAt: 123,
		refreshing: false,
		fixesApplied: 0,
		error: null,
		...overrides,
	};
}

function makeReport() {
	return buildPlatformReport({
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
				kosha: { totalProviders: 3, authenticatedProviders: 1, authenticatedIds: ["anthropic"] },
				telemetry: { activeInstances: 2, working: 1, waitingInput: 1, atLimit: 0, nearLimit: 0 },
				detachedJobs: { total: 1, running: 1 },
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
						issues: [],
					},
				},
				overall: "warn",
				warnings: ["Heads up"],
				fixes: ["Do a fix"],
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
		generatedAt: 456,
	});
}

describe("platform watch", () => {
	it("decodes single-keystroke actions", () => {
		expect(decodePlatformWatchAction("q")).toBe("quit");
		expect(decodePlatformWatchAction("r")).toBe("refresh");
		expect(decodePlatformWatchAction("f")).toBe("fix");
		expect(decodePlatformWatchAction("R")).toBe("hard-refresh");
		expect(decodePlatformWatchAction("d")).toBe("toggle-doctor");
		expect(decodePlatformWatchAction("s")).toBe("toggle-sessions");
		expect(decodePlatformWatchAction("j")).toBe("toggle-jobs");
		expect(decodePlatformWatchAction("1")).toBe("focus-doctor");
		expect(decodePlatformWatchAction("2")).toBe("focus-sessions");
		expect(decodePlatformWatchAction("3")).toBe("focus-jobs");
		expect(decodePlatformWatchAction("\t")).toBe("cycle-focus");
		expect(decodePlatformWatchAction(" ")).toBe("toggle-focused");
		expect(decodePlatformWatchAction("p")).toBe("pause");
		expect(decodePlatformWatchAction("g")).toBe("focus-first");
		expect(decodePlatformWatchAction("G")).toBe("focus-last");
		expect(decodePlatformWatchAction("?")).toBe("toggle-help");
	});

	it("renders watch output with sections and keystroke hints", () => {
		const text = formatPlatformWatchScreen(makeReport(), makeState({ showHelp: true }), 120);
		expect(text).toContain("Takumi Platform Watch");
		expect(text).toContain("q quit");
		expect(text).toContain("focus doctor");
		expect(text).toContain("side-agents");
		expect(text).toContain("Doctor");
		expect(text).toContain("Recent Sessions");
		expect(text).toContain("Detached Jobs");
	});

	it("honors section toggles", () => {
		const text = formatPlatformWatchScreen(
			makeReport(),
			makeState({ showDoctor: false, showSessions: false, showJobs: false }),
			120,
		);
		expect(text).not.toContain("Doctor");
		expect(text).not.toContain("Recent Sessions");
		expect(text).not.toContain("Detached Jobs");
	});

	it("renders focus marker and paused state", () => {
		const text = formatPlatformWatchScreen(makeReport(), makeState({ focus: "jobs", paused: true }), 120);
		expect(text).toContain("paused");
		expect(text).toContain("▶ Detached Jobs");
	});
});
