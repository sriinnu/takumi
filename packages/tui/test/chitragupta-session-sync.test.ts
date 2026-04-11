import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, createHubArtifact, resetArtifactCounter } from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncPendingChitraguptaSessionTurns } from "../src/chitragupta/chitragupta-session-sync.js";
import { AppState } from "../src/state.js";

describe("Chitragupta session sync", () => {
	let homeDir: string;
	let previousHome: string | undefined;
	let artifactStore: ArtifactStore;

	beforeEach(async () => {
		resetArtifactCounter();
		homeDir = await mkdtemp(join(tmpdir(), "takumi-sync-home-"));
		previousHome = process.env.HOME;
		process.env.HOME = homeDir;
		artifactStore = new ArtifactStore();
	});

	afterEach(async () => {
		process.env.HOME = previousHome;
		await rm(homeDir, { recursive: true, force: true });
	});

	it("replays only conversational turns to the canonical session", async () => {
		const state = new AppState();
		state.sessionId.value = "local-session";
		state.canonicalSessionId.value = "canon-1";
		const emitExtensionEvent = vi.fn(async () => undefined);
		state.chitraguptaBridge.value = {
			isConnected: true,
			turnMaxNumber: vi.fn(async () => 7),
			turnAdd: vi.fn(async () => undefined),
			artifactImportBatch: vi.fn(async () => ({
				contractVersion: 1,
				consumer: "takumi",
				projectPath: process.cwd(),
				imported: [],
				skipped: [],
				failed: [],
			})),
			artifactListImported: vi.fn(async () => ({
				contractVersion: 1,
				projectPath: process.cwd(),
				items: [],
			})),
		} as never;
		state.messages.value = [
			{
				id: "info-1",
				role: "assistant",
				content: [{ type: "text", text: "Runtime ready" }],
				timestamp: 1000,
			},
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Fix the failing test" }],
				timestamp: 2000,
				sessionTurn: true,
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: [{ type: "text", text: "Investigating now." }],
				timestamp: 3000,
				sessionTurn: true,
			},
		];

		const result = await syncPendingChitraguptaSessionTurns(state, emitExtensionEvent);

		expect(result).toMatchObject({
			connected: true,
			canonicalSessionId: "canon-1",
			syncedMessages: 2,
			pendingMessages: 0,
			syncStatus: "ready",
			artifactPromotionStatus: "idle",
			pendingArtifacts: 0,
			importedArtifacts: 0,
		});
		expect(state.chitraguptaBridge.value?.turnAdd).toHaveBeenCalledTimes(2);
		expect(state.chitraguptaBridge.value?.turnAdd).toHaveBeenNthCalledWith(
			1,
			"canon-1",
			process.cwd(),
			expect.objectContaining({ number: 8, role: "user", content: "Fix the failing test" }),
		);
		expect(state.chitraguptaBridge.value?.turnAdd).toHaveBeenNthCalledWith(
			2,
			"canon-1",
			process.cwd(),
			expect.objectContaining({ number: 9, role: "assistant", content: "Investigating now." }),
		);
		expect(state.chitraguptaSync.value).toMatchObject({
			lastSyncedMessageId: "assistant-1",
			lastSyncedMessageTimestamp: 3000,
			status: "ready",
		});
		expect(emitExtensionEvent).toHaveBeenCalledTimes(2);
		expect(emitExtensionEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "before_replay_import",
				localSessionId: "local-session",
				canonicalSessionId: "canon-1",
				pendingMessageIds: ["user-1", "assistant-1"],
				pendingMessageCount: 2,
			}),
		);
		expect(emitExtensionEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				type: "after_replay_import",
				localSessionId: "local-session",
				canonicalSessionId: "canon-1",
				pendingMessageIds: ["user-1", "assistant-1"],
				importedMessageIds: ["user-1", "assistant-1"],
				remainingPendingMessageIds: [],
				syncedMessages: 2,
				pendingMessages: 0,
				syncStatus: "ready",
				lastSyncedMessageId: "assistant-1",
				lastSyncedMessageTimestamp: 3000,
			}),
		);
	});

	it("keeps pending turns local when Chitragupta is unavailable", async () => {
		const state = new AppState();
		state.sessionId.value = "local-session";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Do the thing" }],
				timestamp: 2000,
				sessionTurn: true,
			},
		];
		await artifactStore.save(
			createHubArtifact({
				kind: "summary",
				producer: "takumi.tui",
				summary: "Local artifact",
				localSessionId: "local-session",
				importStatus: "pending",
			}),
			"local-session",
		);

		const result = await syncPendingChitraguptaSessionTurns(state);

		expect(result).toMatchObject({
			connected: false,
			syncedMessages: 0,
			pendingMessages: 1,
			syncStatus: "pending",
			artifactPromotionStatus: "pending",
			pendingArtifacts: 1,
		});
		expect(state.chitraguptaSync.value.status).toBe("pending");
		expect(state.artifactPromotion.value).toMatchObject({
			status: "pending",
			pendingArtifactIds: expect.any(Array),
		});
	});

	it("records partial replay progress so retries do not duplicate already-synced turns", async () => {
		const state = new AppState();
		state.sessionId.value = "local-session";
		state.canonicalSessionId.value = "canon-2";
		const emitExtensionEvent = vi.fn(async () => undefined);
		const turnAdd = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("daemon write failed"))
			.mockResolvedValueOnce(undefined);
		state.chitraguptaBridge.value = {
			isConnected: true,
			turnMaxNumber: vi.fn(async () => 20),
			turnAdd,
			artifactImportBatch: vi.fn(async () => ({
				contractVersion: 1,
				consumer: "takumi",
				projectPath: process.cwd(),
				imported: [],
				skipped: [],
				failed: [],
			})),
			artifactListImported: vi.fn(async () => ({
				contractVersion: 1,
				projectPath: process.cwd(),
				items: [],
			})),
		} as never;
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "First pending turn" }],
				timestamp: 1000,
				sessionTurn: true,
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: [{ type: "text", text: "Second pending turn" }],
				timestamp: 2000,
				sessionTurn: true,
			},
		];

		const failedResult = await syncPendingChitraguptaSessionTurns(state, emitExtensionEvent);

		expect(failedResult).toMatchObject({
			connected: true,
			canonicalSessionId: "canon-2",
			syncedMessages: 1,
			pendingMessages: 1,
			syncStatus: "failed",
			lastSyncedMessageId: "user-1",
			lastSyncedMessageTimestamp: 1000,
			lastAttemptedMessageId: "assistant-1",
			lastAttemptedMessageTimestamp: 2000,
			lastFailedMessageId: "assistant-1",
			lastFailedMessageTimestamp: 2000,
			lastError: "daemon write failed",
		});
		expect(state.chitraguptaSync.value).toMatchObject({
			lastSyncedMessageId: "user-1",
			lastSyncedMessageTimestamp: 1000,
			lastFailedMessageId: "assistant-1",
			lastFailedMessageTimestamp: 2000,
			status: "failed",
		});
		expect(emitExtensionEvent).toHaveBeenCalledTimes(2);
		expect(emitExtensionEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "before_replay_import",
				localSessionId: "local-session",
				canonicalSessionId: "canon-2",
				pendingMessageIds: ["user-1", "assistant-1"],
				pendingMessageCount: 2,
			}),
		);
		expect(emitExtensionEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				type: "after_replay_import",
				localSessionId: "local-session",
				canonicalSessionId: "canon-2",
				pendingMessageIds: ["user-1", "assistant-1"],
				importedMessageIds: ["user-1"],
				remainingPendingMessageIds: ["assistant-1"],
				syncedMessages: 1,
				pendingMessages: 1,
				syncStatus: "failed",
				lastError: "daemon write failed",
				lastSyncedMessageId: "user-1",
				lastSyncedMessageTimestamp: 1000,
				lastFailedMessageId: "assistant-1",
				lastFailedMessageTimestamp: 2000,
			}),
		);

		emitExtensionEvent.mockClear();

		const retryResult = await syncPendingChitraguptaSessionTurns(state, emitExtensionEvent);

		expect(retryResult).toMatchObject({
			connected: true,
			canonicalSessionId: "canon-2",
			syncedMessages: 1,
			pendingMessages: 0,
			syncStatus: "ready",
			lastSyncedMessageId: "assistant-1",
			lastSyncedMessageTimestamp: 2000,
		});
		expect(turnAdd).toHaveBeenCalledTimes(3);
		expect(turnAdd).toHaveBeenNthCalledWith(
			3,
			"canon-2",
			process.cwd(),
			expect.objectContaining({ number: 21, role: "assistant", content: "Second pending turn" }),
		);
		expect(state.chitraguptaSync.value).toMatchObject({
			lastSyncedMessageId: "assistant-1",
			lastSyncedMessageTimestamp: 2000,
			status: "ready",
		});
		expect(state.chitraguptaSync.value.lastFailedMessageId).toBeUndefined();
		expect(emitExtensionEvent).toHaveBeenCalledTimes(2);
		expect(emitExtensionEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				type: "before_replay_import",
				localSessionId: "local-session",
				canonicalSessionId: "canon-2",
				pendingMessageIds: ["assistant-1"],
				pendingMessageCount: 1,
				lastSyncedMessageId: "user-1",
			}),
		);
		expect(emitExtensionEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				type: "after_replay_import",
				localSessionId: "local-session",
				canonicalSessionId: "canon-2",
				pendingMessageIds: ["assistant-1"],
				importedMessageIds: ["assistant-1"],
				remainingPendingMessageIds: [],
				syncedMessages: 1,
				pendingMessages: 0,
				syncStatus: "ready",
				lastSyncedMessageId: "assistant-1",
				lastSyncedMessageTimestamp: 2000,
			}),
		);
	});

	it("promotes pending local artifacts after session sync", async () => {
		const state = new AppState();
		state.sessionId.value = "local-session";
		state.canonicalSessionId.value = "canon-artifacts";
		const artifact = createHubArtifact({
			kind: "summary",
			producer: "takumi.tui",
			summary: "Imported artifact",
			localSessionId: "local-session",
			importStatus: "pending",
		});
		await artifactStore.save(artifact, "local-session");
		const bridge = {
			isConnected: true,
			turnMaxNumber: vi.fn(async () => 3),
			turnAdd: vi.fn(async () => undefined),
			artifactImportBatch: vi.fn(async () => ({
				contractVersion: 1,
				consumer: "takumi",
				projectPath: process.cwd(),
				imported: [
					{
						localArtifactId: artifact.artifactId,
						canonicalArtifactId: "cart-123",
						contentHash: artifact.contentHash,
						promoted: true as const,
					},
				],
				skipped: [],
				failed: [],
			})),
			artifactListImported: vi.fn(async () => ({
				contractVersion: 1,
				projectPath: process.cwd(),
				items: [
					{
						localArtifactId: artifact.artifactId,
						canonicalArtifactId: "cart-123",
						contentHash: artifact.contentHash,
						promoted: true as const,
						consumer: "takumi",
						projectPath: process.cwd(),
						canonicalSessionId: "canon-artifacts",
						localSessionId: "local-session",
						runId: null,
						kind: artifact.kind,
						producer: artifact.producer,
						summary: artifact.summary,
						body: null,
						path: null,
						confidence: null,
						createdAt: artifact.createdAt,
						taskId: null,
						laneId: null,
						metadata: {},
						importedAt: 1111,
					},
				],
			})),
		};
		state.chitraguptaBridge.value = bridge as never;

		const result = await syncPendingChitraguptaSessionTurns(state);

		expect(result).toMatchObject({
			connected: true,
			canonicalSessionId: "canon-artifacts",
			syncStatus: "ready",
			artifactPromotionStatus: "ready",
			pendingArtifacts: 0,
			importedArtifacts: 1,
		});
		expect(bridge.artifactImportBatch).toHaveBeenCalledWith(
			process.cwd(),
			"takumi",
			[
				expect.objectContaining({
					localArtifactId: artifact.artifactId,
					localSessionId: "local-session",
					canonicalSessionId: "canon-artifacts",
					contentHash: artifact.contentHash,
				}),
			],
			"canon-artifacts",
		);

		const loaded = await artifactStore.load(artifact.artifactId);
		expect(loaded).toMatchObject({
			promoted: true,
			importStatus: "imported",
			canonicalArtifactId: "cart-123",
			canonicalSessionId: "canon-artifacts",
			localSessionId: "local-session",
		});
		expect(state.artifactPromotion.value).toMatchObject({
			status: "ready",
			importedArtifactIds: [artifact.artifactId],
			pendingArtifactIds: [],
		});
	});

	it("keeps failed artifact imports pending and retries only the unresolved artifacts", async () => {
		const state = new AppState();
		state.sessionId.value = "local-session";
		state.canonicalSessionId.value = "canon-artifacts";
		const firstArtifact = createHubArtifact({
			kind: "summary",
			producer: "takumi.tui",
			summary: "Imported first",
			localSessionId: "local-session",
			importStatus: "pending",
		});
		const secondArtifact = createHubArtifact({
			kind: "summary",
			producer: "takumi.tui",
			summary: "Retry second",
			localSessionId: "local-session",
			importStatus: "pending",
		});
		await artifactStore.save(firstArtifact, "local-session");
		await artifactStore.save(secondArtifact, "local-session");
		const artifactImportBatch = vi
			.fn()
			.mockResolvedValueOnce({
				contractVersion: 1,
				consumer: "takumi",
				projectPath: process.cwd(),
				imported: [
					{
						localArtifactId: firstArtifact.artifactId,
						canonicalArtifactId: "cart-first",
						contentHash: firstArtifact.contentHash,
						promoted: true as const,
					},
				],
				skipped: [],
				failed: [{ localArtifactId: secondArtifact.artifactId, error: "daemon import failed" }],
			})
			.mockResolvedValueOnce({
				contractVersion: 1,
				consumer: "takumi",
				projectPath: process.cwd(),
				imported: [
					{
						localArtifactId: secondArtifact.artifactId,
						canonicalArtifactId: "cart-second",
						contentHash: secondArtifact.contentHash,
						promoted: true as const,
					},
				],
				skipped: [],
				failed: [],
			});
		const artifactListImported = vi
			.fn()
			.mockResolvedValueOnce({
				contractVersion: 1,
				projectPath: process.cwd(),
				items: [
					{
						localArtifactId: firstArtifact.artifactId,
						canonicalArtifactId: "cart-first",
						contentHash: firstArtifact.contentHash,
						promoted: true as const,
						consumer: "takumi",
						projectPath: process.cwd(),
						canonicalSessionId: "canon-artifacts",
						localSessionId: "local-session",
						runId: null,
						kind: firstArtifact.kind,
						producer: firstArtifact.producer,
						summary: firstArtifact.summary,
						body: null,
						path: null,
						confidence: null,
						createdAt: firstArtifact.createdAt,
						taskId: null,
						laneId: null,
						metadata: {},
						importedAt: 1111,
					},
				],
			})
			.mockResolvedValueOnce({
				contractVersion: 1,
				projectPath: process.cwd(),
				items: [
					{
						localArtifactId: firstArtifact.artifactId,
						canonicalArtifactId: "cart-first",
						contentHash: firstArtifact.contentHash,
						promoted: true as const,
						consumer: "takumi",
						projectPath: process.cwd(),
						canonicalSessionId: "canon-artifacts",
						localSessionId: "local-session",
						runId: null,
						kind: firstArtifact.kind,
						producer: firstArtifact.producer,
						summary: firstArtifact.summary,
						body: null,
						path: null,
						confidence: null,
						createdAt: firstArtifact.createdAt,
						taskId: null,
						laneId: null,
						metadata: {},
						importedAt: 1111,
					},
					{
						localArtifactId: secondArtifact.artifactId,
						canonicalArtifactId: "cart-second",
						contentHash: secondArtifact.contentHash,
						promoted: true as const,
						consumer: "takumi",
						projectPath: process.cwd(),
						canonicalSessionId: "canon-artifacts",
						localSessionId: "local-session",
						runId: null,
						kind: secondArtifact.kind,
						producer: secondArtifact.producer,
						summary: secondArtifact.summary,
						body: null,
						path: null,
						confidence: null,
						createdAt: secondArtifact.createdAt,
						taskId: null,
						laneId: null,
						metadata: {},
						importedAt: 2222,
					},
				],
			});
		state.chitraguptaBridge.value = {
			isConnected: true,
			turnMaxNumber: vi.fn(async () => 0),
			turnAdd: vi.fn(async () => undefined),
			artifactImportBatch,
			artifactListImported,
		} as never;

		const firstResult = await syncPendingChitraguptaSessionTurns(state);
		expect(firstResult).toMatchObject({
			artifactPromotionStatus: "failed",
			pendingArtifacts: 1,
			importedArtifacts: 1,
			artifactPromotionError: "daemon import failed",
		});
		expect(state.artifactPromotion.value).toMatchObject({
			status: "failed",
			importedArtifactIds: [firstArtifact.artifactId],
			pendingArtifactIds: [secondArtifact.artifactId],
		});

		const failedArtifact = await artifactStore.load(secondArtifact.artifactId);
		expect(failedArtifact).toMatchObject({
			importStatus: "failed",
			lastImportError: "daemon import failed",
		});

		const secondResult = await syncPendingChitraguptaSessionTurns(state);
		expect(secondResult).toMatchObject({
			artifactPromotionStatus: "ready",
			pendingArtifacts: 0,
			importedArtifacts: 2,
		});
		expect(artifactImportBatch).toHaveBeenNthCalledWith(
			2,
			process.cwd(),
			"takumi",
			[
				expect.objectContaining({
					localArtifactId: secondArtifact.artifactId,
				}),
			],
			"canon-artifacts",
		);

		const retriedArtifact = await artifactStore.load(secondArtifact.artifactId);
		expect(retriedArtifact).toMatchObject({
			promoted: true,
			importStatus: "imported",
			canonicalArtifactId: "cart-second",
		});
	});
});
