import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionData } from "@takumi/core";
import {
	createAutoSaver,
	deleteSession,
	generateSessionId,
	listSessions,
	loadSession,
	saveSession,
} from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Create a minimal valid SessionData for testing. */
function makeSession(overrides: Partial<SessionData> = {}): SessionData {
	return {
		id: overrides.id ?? "session-2025-01-15-abcd",
		title: overrides.title ?? "Test session",
		createdAt: overrides.createdAt ?? 1000,
		updatedAt: overrides.updatedAt ?? 2000,
		messages: overrides.messages ?? [
			{
				id: "msg-1",
				role: "user",
				content: [{ type: "text", text: "Hello" }],
				timestamp: 1000,
			},
			{
				id: "msg-2",
				role: "assistant",
				content: [{ type: "text", text: "Hi there!" }],
				timestamp: 1500,
			},
		],
		model: overrides.model ?? "claude-sonnet-4-20250514",
		tokenUsage: overrides.tokenUsage ?? {
			inputTokens: 100,
			outputTokens: 200,
			totalCost: 0.01,
		},
	};
}

describe("generateSessionId", () => {
	it("returns a string matching the session-YYYY-MM-DD-XXXX format", () => {
		const id = generateSessionId();
		expect(id).toMatch(/^session-\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/);
	});

	it("generates unique IDs on successive calls", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 20; i++) {
			ids.add(generateSessionId());
		}
		// With 4 hex chars, collisions in 20 draws are extremely unlikely
		expect(ids.size).toBeGreaterThanOrEqual(15);
	});

	it("includes today's date", () => {
		const id = generateSessionId();
		const today = new Date().toISOString().slice(0, 10);
		expect(id).toContain(today);
	});
});

describe("saveSession / loadSession", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "takumi-sessions-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("round-trips a session through save and load", async () => {
		const session = makeSession();
		await saveSession(session, tmpDir);

		const loaded = await loadSession(session.id, tmpDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.id).toBe(session.id);
		expect(loaded!.title).toBe(session.title);
		expect(loaded!.messages).toHaveLength(2);
		expect(loaded!.messages[0].content[0]).toEqual({ type: "text", text: "Hello" });
		expect(loaded!.model).toBe(session.model);
		expect(loaded!.tokenUsage).toEqual(session.tokenUsage);
		expect(loaded!.createdAt).toBe(session.createdAt);
		expect(loaded!.updatedAt).toBe(session.updatedAt);
	});

	it("overwrites an existing session on re-save", async () => {
		const session = makeSession();
		await saveSession(session, tmpDir);

		session.title = "Updated title";
		session.updatedAt = 9999;
		await saveSession(session, tmpDir);

		const loaded = await loadSession(session.id, tmpDir);
		expect(loaded!.title).toBe("Updated title");
		expect(loaded!.updatedAt).toBe(9999);
	});

	it("returns null for a non-existent session", async () => {
		const loaded = await loadSession("does-not-exist", tmpDir);
		expect(loaded).toBeNull();
	});

	it("returns null for a corrupt JSON file", async () => {
		const filePath = join(tmpDir, "session-corrupt.json");
		await writeFile(filePath, "not valid json {{{", "utf-8");

		const loaded = await loadSession("session-corrupt", tmpDir);
		expect(loaded).toBeNull();
	});

	it("returns null for a JSON file missing required fields", async () => {
		const filePath = join(tmpDir, "session-bad.json");
		await writeFile(filePath, JSON.stringify({ title: "no id or messages" }), "utf-8");

		const loaded = await loadSession("session-bad", tmpDir);
		expect(loaded).toBeNull();
	});

	it("sanitizes session IDs to prevent directory traversal", async () => {
		const session = makeSession({ id: "../../../etc/passwd" });
		await saveSession(session, tmpDir);

		// The file should be written inside tmpDir, not outside
		const files = await readdir(tmpDir);
		expect(files.length).toBe(1);
		expect(files[0]).toMatch(/\.json$/);

		// The saved file should still be loadable with the sanitized ID
		const sanitizedId = "../../../etc/passwd".replace(/[^a-zA-Z0-9_-]/g, "");
		const loaded = await loadSession(sanitizedId, tmpDir);
		expect(loaded).not.toBeNull();
	});
});

describe("listSessions", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "takumi-sessions-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("returns an empty array when no sessions exist", async () => {
		const sessions = await listSessions(undefined, tmpDir);
		expect(sessions).toEqual([]);
	});

	it("returns sessions sorted by updatedAt descending", async () => {
		await saveSession(makeSession({ id: "session-a", updatedAt: 1000 }), tmpDir);
		await saveSession(makeSession({ id: "session-b", updatedAt: 3000 }), tmpDir);
		await saveSession(makeSession({ id: "session-c", updatedAt: 2000 }), tmpDir);

		const sessions = await listSessions(undefined, tmpDir);
		expect(sessions).toHaveLength(3);
		expect(sessions[0].id).toBe("session-b");
		expect(sessions[1].id).toBe("session-c");
		expect(sessions[2].id).toBe("session-a");
	});

	it("respects the limit parameter", async () => {
		await saveSession(makeSession({ id: "session-1", updatedAt: 1000 }), tmpDir);
		await saveSession(makeSession({ id: "session-2", updatedAt: 2000 }), tmpDir);
		await saveSession(makeSession({ id: "session-3", updatedAt: 3000 }), tmpDir);

		const sessions = await listSessions(2, tmpDir);
		expect(sessions).toHaveLength(2);
		expect(sessions[0].id).toBe("session-3");
		expect(sessions[1].id).toBe("session-2");
	});

	it("returns correct summary fields", async () => {
		const session = makeSession({
			id: "session-test",
			title: "My test",
			createdAt: 5000,
			updatedAt: 6000,
			model: "claude-opus-4",
		});
		await saveSession(session, tmpDir);

		const sessions = await listSessions(undefined, tmpDir);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toEqual({
			id: "session-test",
			title: "My test",
			createdAt: 5000,
			updatedAt: 6000,
			messageCount: 2,
			model: "claude-opus-4",
		});
	});

	it("skips corrupt files gracefully", async () => {
		await saveSession(makeSession({ id: "session-good", updatedAt: 1000 }), tmpDir);
		await writeFile(join(tmpDir, "session-bad.json"), "corrupt", "utf-8");

		const sessions = await listSessions(undefined, tmpDir);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe("session-good");
	});
});

describe("deleteSession", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "takumi-sessions-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("removes a session file from disk", async () => {
		await saveSession(makeSession({ id: "session-to-delete" }), tmpDir);

		// Verify it exists
		const before = await loadSession("session-to-delete", tmpDir);
		expect(before).not.toBeNull();

		await deleteSession("session-to-delete", tmpDir);

		// Verify it's gone
		const after = await loadSession("session-to-delete", tmpDir);
		expect(after).toBeNull();
	});

	it("does not throw when deleting a non-existent session", async () => {
		await expect(deleteSession("nonexistent", tmpDir)).resolves.toBeUndefined();
	});
});

describe("createAutoSaver", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "takumi-sessions-"));
		vi.useFakeTimers();
	});

	afterEach(async () => {
		vi.useRealTimers();
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("saves immediately when save() is called", async () => {
		const session = makeSession({ id: "session-auto" });
		const saver = createAutoSaver(session.id, () => session, 30_000, tmpDir);

		await saver.save();
		saver.stop();

		const loaded = await loadSession("session-auto", tmpDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.id).toBe("session-auto");
	});

	it("saves periodically on the configured interval", async () => {
		const session = makeSession({ id: "session-periodic" });
		const saver = createAutoSaver(
			session.id,
			() => session,
			1000, // 1 second interval
			tmpDir,
		);

		// Should not have saved yet
		let loaded = await loadSession("session-periodic", tmpDir);
		expect(loaded).toBeNull();

		// Advance past the interval using the async variant so the
		// async save callback (file I/O) can settle between ticks
		await vi.advanceTimersByTimeAsync(1100);
		// Allow any remaining I/O promises (mkdir, writeFile) to settle
		await vi.advanceTimersByTimeAsync(50);
		// Flush remaining microtasks from async file operations
		await new Promise((r) => process.nextTick(r));
		await new Promise((r) => process.nextTick(r));

		loaded = await loadSession("session-periodic", tmpDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.id).toBe("session-periodic");

		saver.stop();
	});

	it("stop() prevents further saves", async () => {
		let saveCount = 0;
		const session = makeSession({ id: "session-stop" });
		const saver = createAutoSaver(
			session.id,
			() => {
				saveCount++;
				return session;
			},
			500,
			tmpDir,
		);

		saver.stop();

		vi.advanceTimersByTime(2000);
		await vi.advanceTimersByTimeAsync(100);
		expect(saveCount).toBe(0);
	});

	it("updates the updatedAt timestamp on each save", async () => {
		const session = makeSession({ id: "session-ts", updatedAt: 1000 });
		const saver = createAutoSaver(session.id, () => ({ ...session }), 30_000, tmpDir);

		const beforeSave = Date.now();
		await saver.save();
		saver.stop();

		const loaded = await loadSession("session-ts", tmpDir);
		expect(loaded).not.toBeNull();
		// updatedAt should have been updated to roughly Date.now()
		expect(loaded!.updatedAt).toBeGreaterThanOrEqual(beforeSave);
	});
});
