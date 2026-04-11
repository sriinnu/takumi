import { describe, expect, it } from "vitest";
import {
	buildSessionRailEntries,
	type BuildSessionRailEntriesInput,
} from "../src/components/build-window-session-rail-model";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<BuildSessionRailEntriesInput> = {}): BuildSessionRailEntriesInput {
	return {
		sessions: [],
		selectedSessionId: null,
		liveSessionId: null,
		liveActivity: undefined,
		liveRuntimeSource: undefined,
		provider: null,
		model: null,
		runtimes: [],
		...overrides,
	};
}

function makeSession(id: string, title = "Test", turns = 5) {
	return { id, title, timestamp: Date.now(), turns };
}

function makeRuntime(
	runtimeId: string,
	sessionId: string,
	state = "running",
	startedAt = Date.now(),
) {
	return {
		runtimeId,
		pid: 12345,
		state,
		startedAt,
		cwd: "/tmp",
		logFile: "/tmp/log",
		sessionId,
	};
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildSessionRailEntries", () => {
	it("returns empty array for no sessions", () => {
		const entries = buildSessionRailEntries(makeInput());
		expect(entries).toEqual([]);
	});

	it("returns a detached entry for a session with no runtime", () => {
		const entries = buildSessionRailEntries(
			makeInput({ sessions: [makeSession("s-1", "My Session", 10)] }),
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.id).toBe("s-1");
		expect(entries[0]!.live).toBe(false);
		expect(entries[0]!.statusLabel).toBe("detached");
		expect(entries[0]!.attachLabel).toBe("Attach");
		expect(entries[0]!.attachDisabled).toBe(false);
		expect(entries[0]!.providerModelLabel).toBe("daemon history");
		expect(entries[0]!.statusTone).toBe("neutral");
	});

	it("returns an attached live entry for the live session", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1")],
				liveSessionId: "s-1",
				liveActivity: "working",
				provider: "anthropic",
				model: "claude-opus-4",
			}),
		);
		expect(entries).toHaveLength(1);
		const entry = entries[0]!;
		expect(entry.live).toBe(true);
		expect(entry.attachLabel).toBe("Attached");
		expect(entry.attachDisabled).toBe(true);
		expect(entry.providerModelLabel).toBe("anthropic / claude-opus-4");
		expect(entry.statusTone).toBe("success");
	});

	it("marks the selected session", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1"), makeSession("s-2")],
				selectedSessionId: "s-2",
			}),
		);
		expect(entries[0]!.selected).toBe(false);
		expect(entries[1]!.selected).toBe(true);
	});

	it("shows runtime running state for a non-live session with active runtime", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1")],
				runtimes: [makeRuntime("rt-1", "s-1", "running")],
			}),
		);
		const entry = entries[0]!;
		expect(entry.live).toBe(false);
		expect(entry.statusLabel).toBe("runtime running");
		expect(entry.attachLabel).toBe("Attach");
		expect(entry.statusTone).toBe("success");
	});

	it("shows Resume for a stopped runtime", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1")],
				runtimes: [makeRuntime("rt-1", "s-1", "stopped")],
			}),
		);
		const entry = entries[0]!;
		expect(entry.attachLabel).toBe("Resume");
		expect(entry.statusTone).toBe("warning");
	});

	it("maps activity to correct status tones on live sessions", () => {
		const activities: Array<[string | undefined, string]> = [
			["working", "success"],
			["waiting_input", "warning"],
			["error", "error"],
			["idle", "neutral"],
			[undefined, "neutral"],
		];
		for (const [activity, expectedTone] of activities) {
			const entries = buildSessionRailEntries(
				makeInput({
					sessions: [makeSession("s-1")],
					liveSessionId: "s-1",
					liveActivity: activity,
				}),
			);
			expect(entries[0]!.statusTone).toBe(expectedTone);
		}
	});

	it("includes runtime hint when available", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1")],
				liveSessionId: "s-1",
				runtimes: [makeRuntime("rt-1", "s-1")],
			}),
		);
		expect(entries[0]!.runtimeHint).toBe("rt-1 · pid 12345");
	});

	it("shows liveRuntimeSource as source label", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1")],
				liveSessionId: "s-1",
				liveRuntimeSource: "test-src",
			}),
		);
		expect(entries[0]!.sourceLabel).toBe("Source: test-src");
	});

	it("uses fallback title for untitled sessions", () => {
		const entries = buildSessionRailEntries(
			makeInput({ sessions: [makeSession("s-1", "")] }),
		);
		expect(entries[0]!.title).toBe("Untitled");
	});

	it("prefers running runtime when multiple runtimes exist for a session", () => {
		const entries = buildSessionRailEntries(
			makeInput({
				sessions: [makeSession("s-1")],
				runtimes: [
					makeRuntime("rt-old", "s-1", "stopped", Date.now() - 1000),
					makeRuntime("rt-new", "s-1", "running", Date.now()),
				],
			}),
		);
		expect(entries[0]!.runtimeHint).toContain("rt-new");
		expect(entries[0]!.statusLabel).toBe("runtime running");
	});
});
