import { describe, expect, it } from "vitest";
import { toDetachedJobView } from "../cli/detached-jobs.js";
import { toSessionListEntry, toSessionStatusView } from "../cli/session-commands.js";

describe("operational CLI output helpers", () => {
	it("builds session list entries for json output", () => {
		const entry = toSessionListEntry({
			id: "session-1",
			title: "Ship it",
			model: "claude-sonnet-4-20250514",
			messageCount: 4,
			updatedAt: 1_700_000_000_000,
		});

		expect(entry.id).toBe("session-1");
		expect(entry.updatedAge).toContain("ago");
	});

	it("builds session status views for json output", () => {
		const status = toSessionStatusView({
			id: "session-2",
			title: "Review",
			model: "gpt-5",
			createdAt: 10,
			updatedAt: 20,
			messages: [{}, {}],
			tokenUsage: { inputTokens: 100, outputTokens: 50, totalCost: 0.25 },
		});

		expect(status.messageCount).toBe(2);
		expect(status.totalCost).toBe(0.25);
	});

	it("builds detached job views for json output", () => {
		const view = toDetachedJobView({
			id: "job-1",
			pid: -1,
			logFile: "/tmp/job.log",
			cwd: "/repo",
			startedAt: 123,
			status: "exited",
			command: "node",
			args: ["bin/takumi.ts"],
		});

		expect(view.id).toBe("job-1");
		expect(view.state).toBe("exited");
		expect(view.logFile).toBe("/tmp/job.log");
	});
});