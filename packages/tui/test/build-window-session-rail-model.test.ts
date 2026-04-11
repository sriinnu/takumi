import { describe, expect, it } from "vitest";
import { buildSessionRailEntries } from "../../../apps/desktop/src/components/build-window-session-rail-model.js";

describe("buildSessionRailEntries", () => {
	it("surfaces live, runtime-backed, and detached session truth in one rail", () => {
		const sessions = [
			{ id: "live", title: "Live session", timestamp: 1_700_000_000_000, turns: 12 },
			{ id: "running", title: "Running runtime", timestamp: 1_700_000_100_000, turns: 4 },
			{ id: "stopped", title: "Stopped runtime", timestamp: 1_700_000_200_000, turns: 3 },
			{ id: "detached", title: "Detached", timestamp: 1_700_000_300_000, turns: 1 },
		];
		const runtimes = [
			{
				runtimeId: "rt-running",
				pid: 4242,
				state: "running",
				cwd: "/repo",
				logFile: "/tmp/running.log",
				command: "pnpm",
				args: ["takumi"],
				startedAt: 20,
				sessionId: "running",
				runtimeSource: "desktop",
			},
			{
				runtimeId: "rt-stopped",
				pid: 5252,
				state: "stopped",
				cwd: "/repo",
				logFile: "/tmp/stopped.log",
				command: "pnpm",
				args: ["takumi"],
				startedAt: 10,
				sessionId: "stopped",
				runtimeSource: "tmux",
			},
		];

		const entries = buildSessionRailEntries({
			sessions,
			selectedSessionId: "running",
			liveSessionId: "live",
			liveActivity: "working",
			liveRuntimeSource: "terminal",
			provider: "openai",
			model: "gpt-5.4",
			runtimes,
		});

		expect(entries).toHaveLength(4);
		expect(entries[0]).toMatchObject({
			id: "live",
			live: true,
			attachLabel: "Attached",
			attachDisabled: true,
			providerModelLabel: "openai / gpt-5.4",
			statusLabel: "attached · working",
			sourceLabel: "Source: terminal",
			statusTone: "success",
		});
		expect(entries[1]).toMatchObject({
			id: "running",
			selected: true,
			attachLabel: "Attach",
			providerModelLabel: "local runtime available",
			statusLabel: "runtime running",
			sourceLabel: "Source: desktop",
			runtimeHint: "rt-running · pid 4242",
			statusTone: "success",
		});
		expect(entries[2]).toMatchObject({
			id: "stopped",
			attachLabel: "Resume",
			providerModelLabel: "local runtime stopped",
			statusLabel: "runtime stopped",
			sourceLabel: "Source: tmux",
			runtimeHint: "rt-stopped · pid 5252",
			statusTone: "warning",
		});
		expect(entries[3]).toMatchObject({
			id: "detached",
			attachLabel: "Attach",
			providerModelLabel: "daemon history",
			statusLabel: "detached",
			sourceLabel: "Source: daemon history",
			statusTone: "neutral",
		});
	});

	it("prefers the newest running runtime when multiple runtimes point at the same session", () => {
		const entries = buildSessionRailEntries({
			sessions: [{ id: "shared", title: "Shared", timestamp: 1_700_000_400_000, turns: 7 }],
			selectedSessionId: null,
			liveSessionId: null,
			liveActivity: undefined,
			liveRuntimeSource: null,
			provider: null,
			model: null,
			runtimes: [
				{
					runtimeId: "older-stopped",
					pid: 1111,
					state: "stopped",
					cwd: "/repo",
					logFile: "/tmp/old.log",
					command: "pnpm",
					args: ["takumi"],
					startedAt: 1,
					sessionId: "shared",
					runtimeSource: "terminal",
				},
				{
					runtimeId: "newer-running",
					pid: 2222,
					state: "running",
					cwd: "/repo",
					logFile: "/tmp/new.log",
					command: "pnpm",
					args: ["takumi"],
					startedAt: 2,
					sessionId: "shared",
					runtimeSource: "desktop",
				},
			],
		});

		expect(entries[0]).toMatchObject({
			statusLabel: "runtime running",
			sourceLabel: "Source: desktop",
			runtimeHint: "newer-running · pid 2222",
		});
	});
});
