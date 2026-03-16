import { ApprovalQueue, type ApprovalRecord, createApprovalRecord, resetApprovalCounter } from "@takumi/core";
import { beforeEach, describe, expect, it } from "vitest";

describe("approval-types", () => {
	beforeEach(() => resetApprovalCounter());

	it("createApprovalRecord produces valid record", () => {
		const rec = createApprovalRecord({ tool: "shell", argsSummary: "rm -rf /tmp/test", sessionId: "session-1" });
		expect(rec.id).toMatch(/^apr-/);
		expect(rec.status).toBe("pending");
		expect(rec.tool).toBe("shell");
		expect(rec.argsSummary).toBe("rm -rf /tmp/test");
		expect(rec.sessionId).toBe("session-1");
		expect(rec.actor).toBe("user");
		expect(rec.decidedAt).toBeUndefined();
	});

	it("increments IDs across calls", () => {
		const a = createApprovalRecord({ tool: "file_write", argsSummary: "/a.ts", sessionId: "s1" });
		const b = createApprovalRecord({ tool: "file_write", argsSummary: "/b.ts", sessionId: "s1" });
		expect(a.id).not.toBe(b.id);
	});
});

describe("ApprovalQueue (in-memory)", () => {
	let queue: ApprovalQueue;

	beforeEach(() => {
		resetApprovalCounter();
		// Use a temp dir that won't exist — queue works in-memory without disk
		queue = new ApprovalQueue("/tmp/takumi-test-approval-nonexistent");
	});

	it("request() creates a pending record", async () => {
		const rec = await queue.request("shell", "echo hello", "sess-1");
		expect(rec.status).toBe("pending");
		expect(queue.pending()).toHaveLength(1);
	});

	it("decide() transitions record from pending to approved", async () => {
		const rec = await queue.request("file_write", "/etc/hosts", "sess-1");
		const updated = await queue.decide(rec.id, "approved", "operator", "Looks safe");
		expect(updated).not.toBeNull();
		expect(updated!.status).toBe("approved");
		expect(updated!.actor).toBe("operator");
		expect(updated!.reason).toBe("Looks safe");
		expect(updated!.decidedAt).toBeDefined();
		expect(queue.pending()).toHaveLength(0);
	});

	it("decide() transitions to denied", async () => {
		const rec = await queue.request("shell", "rm -rf /", "sess-1");
		const updated = await queue.decide(rec.id, "denied", "operator", "Too dangerous");
		expect(updated!.status).toBe("denied");
	});

	it("decide() returns null for unknown id", async () => {
		const result = await queue.decide("apr-nonexistent", "approved", "user");
		expect(result).toBeNull();
	});

	it("snapshot() returns correct counts", async () => {
		await queue.request("shell", "cmd1", "sess-1");
		await queue.request("shell", "cmd2", "sess-1");
		const pendingRecs = queue.pending();
		await queue.decide(pendingRecs[0].id, "approved", "user");

		const snap = queue.snapshot();
		expect(snap.total).toBe(2);
		expect(snap.pending).toHaveLength(1);
		expect(snap.recent).toHaveLength(2);
	});

	it("find() returns record by id", async () => {
		const rec = await queue.request("file_write", "/a.ts", "sess-1");
		expect(queue.find(rec.id)).toEqual(rec);
		expect(queue.find("nonexistent")).toBeUndefined();
	});

	it("exportLog() produces JSONL output", async () => {
		await queue.request("shell", "cmd1", "sess-1");
		await queue.request("shell", "cmd2", "sess-1");

		const jsonl = await queue.exportLog({ format: "jsonl" });
		const lines = jsonl.trim().split("\n");
		expect(lines).toHaveLength(2);
		const parsed = JSON.parse(lines[0]) as ApprovalRecord;
		expect(parsed.tool).toBe("shell");
	});

	it("exportLog() produces CSV output", async () => {
		await queue.request("shell", 'echo "hello, world"', "sess-1");

		const csv = await queue.exportLog({ format: "csv" });
		const lines = csv.trim().split("\n");
		expect(lines).toHaveLength(2); // header + 1 row
		expect(lines[0]).toContain("id,tool");
	});

	it("exportLog() respects limit option", async () => {
		await queue.request("shell", "cmd1", "sess-1");
		await queue.request("shell", "cmd2", "sess-2");
		await queue.request("shell", "cmd3", "sess-3");

		const jsonl = await queue.exportLog({ format: "jsonl", limit: 1 });
		const lines = jsonl.trim().split("\n");
		expect(lines).toHaveLength(1);
	});
});
