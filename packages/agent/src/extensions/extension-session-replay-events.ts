/**
 * Session replay / rebind lifecycle events — Track 2 hook substrate.
 *
 * These events expose canonical replay-import and rebind boundaries to
 * extensions without granting mutation rights yet. They are intentionally
 * observe-only for now; hook ordering and failure policy graduate later.
 */

import type { SessionControlPlaneSyncState } from "@takumi/core";

interface ReplayImportEventBase {
	type: "before_replay_import" | "after_replay_import";
	/** Current Takumi-local session id, when the runtime has one. */
	localSessionId?: string;
	/** Canonical Chitragupta session Takumi is syncing into. */
	canonicalSessionId: string;
	/** Pending local session-turn message ids Takumi is attempting to import. */
	pendingMessageIds: string[];
	/** Count of pending local session-turn messages in this import batch. */
	pendingMessageCount: number;
	/** Last message id Takumi had already mirrored before this import attempt. */
	lastSyncedMessageId?: string;
}

/** Fired immediately before Takumi imports pending local turns into a canonical session. */
export interface BeforeReplayImportEvent extends ReplayImportEventBase {
	type: "before_replay_import";
}

/** Fired after Takumi finishes a replay-import attempt, including partial failures. */
export interface AfterReplayImportEvent extends ReplayImportEventBase {
	type: "after_replay_import";
	/** Message ids that were successfully imported during this attempt. */
	importedMessageIds: string[];
	/** Remaining local session-turn message ids still waiting for canonical import. */
	remainingPendingMessageIds: string[];
	/** Number of messages imported during this attempt. */
	syncedMessages: number;
	/** Number of local session-turn messages still pending after the attempt. */
	pendingMessages: number;
	/** Final sync state after the attempt completed. */
	syncStatus: SessionControlPlaneSyncState["status"];
	/** Import failure detail when the attempt did not complete cleanly. */
	lastError?: string;
	/** Last successfully mirrored message id after the attempt. */
	lastSyncedMessageId?: string;
	lastSyncedMessageTimestamp?: number;
	/** First message id that failed during this import attempt, when one exists. */
	lastFailedMessageId?: string;
	lastFailedMessageTimestamp?: number;
}

/** Fired before Takumi attempts to rebind a live runtime to an existing canonical session. */
export interface BeforeSessionRebindEvent {
	type: "before_session_rebind";
	localSessionId?: string;
	canonicalSessionId: string;
	/** Number of local session turns still waiting to be mirrored. */
	pendingLocalTurns: number;
	/** Current runtime provider/model Takumi would resume with. */
	currentProvider?: string;
	currentModel?: string;
	/** Sync state recorded before the rebind attempt begins. */
	syncStatus: SessionControlPlaneSyncState["status"];
	lastError?: string;
}

export type SessionReplayEvent = BeforeReplayImportEvent | AfterReplayImportEvent | BeforeSessionRebindEvent;
