import type { ExtensionEvent } from "@takumi/agent";
import { messageToTurn } from "@takumi/bridge";
import {
	createLogger,
	DEFAULT_HOOK_POLICY,
	executeWithHookPolicy,
	type HookPolicyConfig,
	resolveHookPolicy,
	type SessionControlPlaneSyncState,
} from "@takumi/core";
import { recordSyncFailureExecution } from "../degraded-execution-context.js";
import type { AppState } from "../state.js";
import {
	promotePendingSessionArtifacts,
	readArtifactPromotionSummary,
	refreshArtifactPromotionState,
} from "./chitragupta-artifact-promotion.js";
import { ensureCanonicalSessionBinding } from "./chitragupta-executor-runtime.js";

const log = createLogger("chitragupta-session-sync");
const inFlightSyncs = new WeakMap<AppState, Promise<ChitraguptaSessionSyncResult>>();

type ExtensionEventEmitter = (event: ExtensionEvent) => Promise<void> | void;

export interface ChitraguptaSessionSyncResult {
	connected: boolean;
	canonicalSessionId: string | null;
	syncedMessages: number;
	pendingMessages: number;
	syncStatus: SessionControlPlaneSyncState["status"];
	validationWarnings?: string[];
	validationConflicts?: string[];
	lastError?: string;
	lastSyncedMessageId?: string;
	lastSyncedMessageTimestamp?: number;
	lastAttemptedMessageId?: string;
	lastAttemptedMessageTimestamp?: number;
	lastFailedMessageId?: string;
	lastFailedMessageTimestamp?: number;
	artifactPromotionStatus: AppState["artifactPromotion"]["value"]["status"];
	pendingArtifacts: number;
	importedArtifacts: number;
	lastPromotionAt?: number;
	artifactPromotionError?: string;
}

/** Count conversational turns that still need to be mirrored to Chitragupta. */
export function countPendingChitraguptaSessionTurns(state: AppState): number {
	return getPendingSessionTurnMessages(state).length;
}

/** Mark the current session as having unsynced local turns. */
export function markChitraguptaSyncPending(state: AppState, lastError?: string): number {
	const pendingMessages = countPendingChitraguptaSessionTurns(state);
	setChitraguptaSyncState(state, {
		status: pendingMessages > 0 ? "pending" : "idle",
		lastError,
		...(pendingMessages > 0
			? {}
			: {
					lastAttemptedMessageId: undefined,
					lastAttemptedMessageTimestamp: undefined,
					lastFailedMessageId: undefined,
					lastFailedMessageTimestamp: undefined,
				}),
	});
	return pendingMessages;
}

/** Reconcile local turns first, then promote pending local artifacts. */
export async function syncPendingChitraguptaSessionTurns(
	state: AppState,
	emitExtensionEvent?: ExtensionEventEmitter,
): Promise<ChitraguptaSessionSyncResult> {
	const existing = inFlightSyncs.get(state);
	if (existing) {
		return existing;
	}

	const syncPromise = performPendingSessionTurnSync(state, emitExtensionEvent).finally(() => {
		if (inFlightSyncs.get(state) === syncPromise) {
			inFlightSyncs.delete(state);
		}
	});
	inFlightSyncs.set(state, syncPromise);
	return syncPromise;
}

function getPendingSessionTurnMessages(state: AppState) {
	const sessionTurns = state.messages.value.filter((message) => message.sessionTurn === true);
	const lastSyncedMessageId = state.chitraguptaSync.value.lastSyncedMessageId;
	if (!lastSyncedMessageId) {
		return sessionTurns;
	}

	const lastSyncedIndex = sessionTurns.findIndex((message) => message.id === lastSyncedMessageId);
	if (lastSyncedIndex < 0) {
		return sessionTurns;
	}

	return sessionTurns.slice(lastSyncedIndex + 1);
}

async function performPendingSessionTurnSync(
	state: AppState,
	emitExtensionEvent?: ExtensionEventEmitter,
): Promise<ChitraguptaSessionSyncResult> {
	const bridge = state.chitraguptaBridge.value;
	const pendingMessages = getPendingSessionTurnMessages(state);
	if (!bridge?.isConnected) {
		const pendingCount = markChitraguptaSyncPending(state);
		await refreshArtifactPromotionState(state);
		return buildSyncResult(state, {
			connected: false,
			canonicalSessionId: state.canonicalSessionId.value || null,
			syncedMessages: 0,
			pendingMessages: pendingCount,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: state.chitraguptaSync.value.lastError,
			lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
			lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
			lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId,
			lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp,
			lastFailedMessageId: state.chitraguptaSync.value.lastFailedMessageId,
			lastFailedMessageTimestamp: state.chitraguptaSync.value.lastFailedMessageTimestamp,
		});
	}

	const canonicalSessionId = await ensureCanonicalSessionBinding(state);
	if (!canonicalSessionId) {
		const pendingCount = markChitraguptaSyncPending(state, "Canonical session binding unavailable.");
		await refreshArtifactPromotionState(state);
		return buildSyncResult(state, {
			connected: true,
			canonicalSessionId: null,
			syncedMessages: 0,
			pendingMessages: pendingCount,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: state.chitraguptaSync.value.lastError,
			lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
			lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
			lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId,
			lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp,
			lastFailedMessageId: state.chitraguptaSync.value.lastFailedMessageId,
			lastFailedMessageTimestamp: state.chitraguptaSync.value.lastFailedMessageTimestamp,
		});
	}

	if (pendingMessages.length === 0) {
		setChitraguptaSyncState(state, {
			status: "ready",
			lastError: undefined,
			lastAttemptedMessageId: undefined,
			lastAttemptedMessageTimestamp: undefined,
			lastFailedMessageId: undefined,
			lastFailedMessageTimestamp: undefined,
		});
		await promotePendingSessionArtifacts(state, canonicalSessionId);
		return buildSyncResult(state, {
			connected: true,
			canonicalSessionId,
			syncedMessages: 0,
			pendingMessages: 0,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: state.chitraguptaSync.value.lastError,
			lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
			lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
			lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId,
			lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp,
			lastFailedMessageId: state.chitraguptaSync.value.lastFailedMessageId,
			lastFailedMessageTimestamp: state.chitraguptaSync.value.lastFailedMessageTimestamp,
		});
	}

	const pendingMessageIds = pendingMessages.map((message) => message.id);
	await safelyEmitExtensionEvent(emitExtensionEvent, {
		type: "before_replay_import",
		localSessionId: state.sessionId.value || undefined,
		canonicalSessionId,
		pendingMessageIds,
		pendingMessageCount: pendingMessages.length,
		lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
	});

	setChitraguptaSyncState(state, {
		status: "syncing",
		lastError: undefined,
		lastFailedMessageId: undefined,
		lastFailedMessageTimestamp: undefined,
	});

	let syncedMessages = 0;
	let lastSyncedMessage: (typeof pendingMessages)[number] | undefined;
	let failedMessage: (typeof pendingMessages)[number] | undefined;
	const importedMessageIds: string[] = [];

	try {
		const project = process.cwd();
		let nextTurnNumber = (await bridge.turnMaxNumber(canonicalSessionId)) + 1;

		for (const message of pendingMessages) {
			failedMessage = message;
			setChitraguptaSyncState(state, {
				lastAttemptedMessageId: message.id,
				lastAttemptedMessageTimestamp: message.timestamp,
			});
			const turn = messageToTurn(message, canonicalSessionId, project);
			turn.number = nextTurnNumber++;
			await bridge.turnAdd(canonicalSessionId, project, turn);
			syncedMessages += 1;
			lastSyncedMessage = message;
			importedMessageIds.push(message.id);
			failedMessage = undefined;
			setChitraguptaSyncState(state, {
				lastSyncedMessageId: message.id,
				lastSyncedMessageTimestamp: message.timestamp,
				lastSyncedAt: Date.now(),
			});
		}

		setChitraguptaSyncState(state, {
			lastSyncedMessageId: lastSyncedMessage?.id,
			lastSyncedMessageTimestamp: lastSyncedMessage?.timestamp,
			status: "ready",
			lastError: undefined,
			lastAttemptedMessageId: undefined,
			lastAttemptedMessageTimestamp: undefined,
			lastFailedMessageId: undefined,
			lastFailedMessageTimestamp: undefined,
		});
		await safelyEmitExtensionEvent(emitExtensionEvent, {
			type: "after_replay_import",
			localSessionId: state.sessionId.value || undefined,
			canonicalSessionId,
			pendingMessageIds,
			pendingMessageCount: pendingMessages.length,
			importedMessageIds,
			remainingPendingMessageIds: [],
			syncedMessages,
			pendingMessages: 0,
			syncStatus: state.chitraguptaSync.value.status,
			lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
			lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
		});
		await promotePendingSessionArtifacts(state, canonicalSessionId);
		log.info(`Synced ${syncedMessages} local session turn(s) to ${canonicalSessionId}`);
		return buildSyncResult(state, {
			connected: true,
			canonicalSessionId,
			syncedMessages,
			pendingMessages: 0,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: state.chitraguptaSync.value.lastError,
			lastSyncedMessageId: lastSyncedMessage?.id,
			lastSyncedMessageTimestamp: lastSyncedMessage?.timestamp,
			lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId,
			lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp,
			lastFailedMessageId: state.chitraguptaSync.value.lastFailedMessageId,
			lastFailedMessageTimestamp: state.chitraguptaSync.value.lastFailedMessageTimestamp,
		});
	} catch (error) {
		const message = (error as Error).message;
		const pendingCount = pendingMessages.length - syncedMessages;
		setChitraguptaSyncState(state, {
			status: "failed",
			lastError: message,
			lastFailedMessageId: failedMessage?.id,
			lastFailedMessageTimestamp: failedMessage?.timestamp,
		});
		await safelyEmitExtensionEvent(emitExtensionEvent, {
			type: "after_replay_import",
			localSessionId: state.sessionId.value || undefined,
			canonicalSessionId,
			pendingMessageIds,
			pendingMessageCount: pendingMessages.length,
			importedMessageIds,
			remainingPendingMessageIds: pendingMessages.slice(syncedMessages).map((pendingMessage) => pendingMessage.id),
			syncedMessages,
			pendingMessages: pendingCount,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: message,
			lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
			lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
			lastFailedMessageId: failedMessage?.id,
			lastFailedMessageTimestamp: failedMessage?.timestamp,
		});
		recordSyncFailureExecution(state);
		await refreshArtifactPromotionState(state, canonicalSessionId);
		log.debug(`Failed to sync local session turns after ${syncedMessages} message(s): ${message}`);
		return buildSyncResult(state, {
			connected: true,
			canonicalSessionId,
			syncedMessages,
			pendingMessages: pendingCount,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: message,
			lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
			lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
			lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId,
			lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp,
			lastFailedMessageId: failedMessage?.id,
			lastFailedMessageTimestamp: failedMessage?.timestamp,
		});
	}
}

function buildSyncResult(
	state: AppState,
	base: Omit<
		ChitraguptaSessionSyncResult,
		"artifactPromotionStatus" | "pendingArtifacts" | "importedArtifacts" | "lastPromotionAt" | "artifactPromotionError"
	>,
): ChitraguptaSessionSyncResult {
	const artifactPromotion = readArtifactPromotionSummary(state);
	return {
		...base,
		artifactPromotionStatus: artifactPromotion.status,
		pendingArtifacts: artifactPromotion.pendingArtifactIds.length,
		importedArtifacts: artifactPromotion.importedArtifactIds.length,
		lastPromotionAt: artifactPromotion.lastPromotionAt,
		artifactPromotionError: artifactPromotion.lastError,
	};
}

function setChitraguptaSyncState(state: AppState, patch: Partial<SessionControlPlaneSyncState>): void {
	const nextState: SessionControlPlaneSyncState = {
		status: "idle",
		...state.chitraguptaSync.value,
		...patch,
	};
	for (const [key, value] of Object.entries(patch) as Array<
		[keyof SessionControlPlaneSyncState, SessionControlPlaneSyncState[keyof SessionControlPlaneSyncState]]
	>) {
		if (value === undefined) {
			delete nextState[key];
		}
	}
	state.chitraguptaSync.value = nextState;
}

/**
 * Execute a session/replay hook under configurable failure policy governance.
 * Replaces the old bare try/catch that silently swallowed all hook errors.
 */
async function safelyEmitExtensionEvent(
	emitExtensionEvent: ExtensionEventEmitter | undefined,
	event: ExtensionEvent,
	policyConfig: HookPolicyConfig = DEFAULT_HOOK_POLICY,
): Promise<void> {
	if (!emitExtensionEvent) return;
	const policy = resolveHookPolicy(policyConfig, event.type);
	await executeWithHookPolicy(event.type, policy, () => emitExtensionEvent(event));
}
