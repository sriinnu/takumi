import { describe, expect, it, vi } from "vitest";
import { requestToolPermission } from "../src/agent/agent-runner-permissions.js";
import { applyPersistedSessionState } from "../src/app-session-lifecycle.js";
import { AppState } from "../src/state.js";

/**
 * Stub the `ApprovalQueue` so the disk-write side never touches the filesystem.
 * `request()` returns a unique id per call; `decide()` records what the
 * permission flow asked it to persist so tests can verify the queue-full
 * denial path closed the disk row correctly.
 */
function stubApprovalQueue(state: AppState) {
	let counter = 0;
	const decide = vi.fn(async () => true);
	const request = vi.fn(async () => ({
		id: `ap-${++counter}`,
		tool: "x",
		args: "",
		status: "pending" as const,
		requestedAt: Date.now(),
	}));
	(state.approvalQueue as unknown as { request: typeof request; decide: typeof decide }).request = request;
	(state.approvalQueue as unknown as { request: typeof request; decide: typeof decide }).decide = decide;
	return { decide, request };
}

describe("requestToolPermission queue cap", () => {
	/**
	 * Drive `count` requests synchronously and yield to the event loop so all
	 * inner IIFEs settle their `await approvalQueue.request()` step. Returns
	 * the captured promises — only the rejected ones can be safely `await`ed
	 * (queued + visible promises never resolve without an operator decision).
	 */
	async function fireAndSettle(state: AppState, count: number) {
		const promises = Array.from({ length: count }, (_, i) => requestToolPermission(state, `tool-${i}`, { idx: i }));
		// Two macrotasks is enough for the IIFE microtasks + the queue-full
		// branch to run end-to-end across all inputs.
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		return promises;
	}

	it("admits 1 visible + 100 queued, rejects the 102nd with reason 'queue full'", async () => {
		const state = new AppState();
		state.sessionId.value = "test-session";
		const { decide } = stubApprovalQueue(state);

		const promises = await fireAndSettle(state, 102);

		// First fills the visible slot; the next 100 fill the queue exactly to cap.
		expect(state.pendingPermission.value?.tool).toBe("tool-0");
		expect(state.pendingPermissionQueue.value.length).toBe(100);

		// The 102nd is rejected — only this promise resolves; the others sit
		// waiting on operator decisions that never come in this test.
		const rejected = await promises[101];
		expect(rejected.allowed).toBe(false);
		expect(rejected.reason).toContain("queue full");

		// Disk row for the rejected request is closed denied with our reason.
		const denialCalls = decide.mock.calls.filter((call) => call[3] === "permission queue full");
		expect(denialCalls.length).toBe(1);
	});

	it("pushes a transcript notice when a request is denied for queue-full", async () => {
		const state = new AppState();
		state.sessionId.value = "test-session";
		stubApprovalQueue(state);

		const baselineMessages = state.messages.value.length;
		await fireAndSettle(state, 102);

		const newMessages = state.messages.value.slice(baselineMessages);
		const queueFullNotices = newMessages.filter((m) => {
			const block = m.content[0];
			return block.type === "text" && block.text.includes("queue full");
		});
		expect(queueFullNotices.length).toBeGreaterThan(0);
	});
});

describe("session boundary clears pending + queue", () => {
	it("applyPersistedSessionState drops the queued requests so they don't surface in the new session", () => {
		const state = new AppState();
		state.pendingPermission.value = {
			approvalId: "old-1",
			tool: "bash",
			args: { command: "ls" },
			resolve: () => undefined,
		};
		state.pendingPermissionQueue.value = [
			{ approvalId: "old-2", tool: "read", args: { file_path: "a" }, resolve: () => undefined },
			{ approvalId: "old-3", tool: "write", args: { file_path: "b" }, resolve: () => undefined },
		];

		applyPersistedSessionState(state, {
			id: "new-session",
			title: "fresh",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
			model: "claude-sonnet-4",
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		});

		expect(state.pendingPermission.value).toBeNull();
		expect(state.pendingPermissionQueue.value).toEqual([]);
	});

	it("AppState.reset() also drops the queue", () => {
		const state = new AppState();
		state.pendingPermissionQueue.value = [{ approvalId: "stuck", tool: "bash", args: {}, resolve: () => undefined }];
		state.reset();
		expect(state.pendingPermissionQueue.value).toEqual([]);
		expect(state.pendingPermission.value).toBeNull();
	});
});
