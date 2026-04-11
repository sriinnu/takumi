import { type ChitraguptaBridge, reconstructFromDaemon } from "@takumi/bridge";
import {
	loadSession,
	type SessionControlPlaneDegradedContext,
	type SessionControlPlaneSyncState,
	type SessionData,
} from "@takumi/core";
import { findPrimaryControlPlaneLane, validateReplayBeforeCanonicalImport } from "./app-session-replay-validation.js";
import { refreshControlPlaneLanesFromDaemon } from "./chitragupta/control-plane-lanes.js";
import { buildSyncFailureSource, upsertDegradedExecutionSource } from "./degraded-execution-context.js";

export interface AttachSessionToRuntimeOptions {
	sessionId: string;
	model: string | null;
	chitragupta: ChitraguptaBridge | null | undefined;
	activateSession: (session: SessionData, notice: string) => Promise<void>;
}

export interface AttachSessionToRuntimeResult {
	success: boolean;
	error?: string;
}

/**
 * I keep session attachment logic in one small place so the TUI and desktop
 * bridge can share it without bloating `app.ts` past the repo guardrail.
 */
export async function attachSessionToRuntime(
	options: AttachSessionToRuntimeOptions,
): Promise<AttachSessionToRuntimeResult> {
	const loaded = await loadSession(options.sessionId);
	if (loaded) {
		const prepared = await prepareLoadedSessionForActivation(loaded, options);
		await options.activateSession(prepared.session, prepared.notice);
		return { success: true };
	}

	if (options.chitragupta?.isConnected) {
		try {
			const recovered = await reconstructFromDaemon(options.chitragupta, options.sessionId);
			if (recovered && recovered.messages.length > 0) {
				const refreshedLanes = await refreshControlPlaneLanesFromDaemon(
					options.chitragupta,
					recovered.sessionId,
					process.cwd(),
				);
				const primaryLane = findPrimaryControlPlaneLane(refreshedLanes.lanes);
				const session: SessionData = {
					id: recovered.sessionId,
					title:
						recovered.messages[0]?.content[0]?.type === "text"
							? recovered.messages[0].content[0].text.slice(0, 80).replace(/\n/g, " ")
							: "Recovered session",
					messages: recovered.messages,
					model: primaryLane?.model ?? options.model ?? "unknown",
					createdAt: recovered.createdAt,
					updatedAt: recovered.updatedAt,
					tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
					controlPlane: {
						canonicalSessionId: recovered.sessionId,
						...(refreshedLanes.lanes.length > 0 ? { lanes: refreshedLanes.lanes } : {}),
						sync: { status: "ready" },
					},
				};
				await options.activateSession(
					session,
					`Attached daemon session ${recovered.sessionId} (${recovered.turnCount} turns).`,
				);
				return { success: true };
			}
		} catch {
			// Daemon reconstruction failed — fall through to the shared error shape.
		}
	}

	return { success: false, error: `Could not resume session: ${options.sessionId}` };
}

async function prepareLoadedSessionForActivation(
	session: SessionData,
	options: AttachSessionToRuntimeOptions,
): Promise<{ session: SessionData; notice: string }> {
	const notice = `Resumed session ${session.id} (${session.messages.length} messages).`;
	const canonicalSessionId = session.controlPlane?.canonicalSessionId;
	if (!canonicalSessionId || !options.chitragupta?.isConnected) {
		return { session, notice };
	}

	try {
		const refreshed = await refreshControlPlaneLanesFromDaemon(options.chitragupta, canonicalSessionId, process.cwd());
		const storedLanes = session.controlPlane?.lanes ?? [];
		const pendingLocalTurns = countPendingSessionTurns(session);
		const validation = validateReplayBeforeCanonicalImport({
			canonicalSessionId,
			pendingLocalTurns,
			sessionModel: session.model,
			currentProvider: findPrimaryControlPlaneLane(storedLanes)?.provider ?? null,
			storedLanes,
			refreshedLanes: refreshed.lanes,
		});
		const primaryLane = findPrimaryControlPlaneLane(refreshed.lanes);
		const nextSync = mergeValidationIntoSyncState(session.controlPlane?.sync, validation.summary, validation.blocking);
		const nextDegradedContext = mergeValidationIntoDegradedContext(
			session.controlPlane?.degradedContext,
			nextSync,
			pendingLocalTurns,
			validation.blocking,
		);
		const notes = [validation.summary, ...validation.warnings].filter(Boolean);
		return {
			session: {
				...session,
				model: primaryLane?.model ?? session.model,
				controlPlane: {
					...session.controlPlane,
					canonicalSessionId,
					...(refreshed.lanes.length > 0 ? { lanes: refreshed.lanes } : {}),
					...(nextSync ? { sync: nextSync } : {}),
					...(nextDegradedContext ? { degradedContext: nextDegradedContext } : {}),
				},
			},
			notice: notes.length > 0 ? `${notice}\n${notes.join("\n")}` : notice,
		};
	} catch {
		return { session, notice };
	}
}

function countPendingSessionTurns(session: SessionData): number {
	const sessionTurns = session.messages.filter((message) => message.sessionTurn === true);
	const lastSyncedMessageId = session.controlPlane?.sync?.lastSyncedMessageId;
	if (!lastSyncedMessageId) {
		return sessionTurns.length;
	}
	const lastSyncedIndex = sessionTurns.findIndex((message) => message.id === lastSyncedMessageId);
	return lastSyncedIndex >= 0 ? sessionTurns.slice(lastSyncedIndex + 1).length : sessionTurns.length;
}

function mergeValidationIntoSyncState(
	sync: SessionControlPlaneSyncState | undefined,
	validationSummary: string | null,
	blocking: boolean,
): SessionControlPlaneSyncState | undefined {
	if (!blocking) {
		return sync;
	}
	return {
		...sync,
		status: "failed",
		lastError: validationSummary ?? sync?.lastError,
	};
}

function mergeValidationIntoDegradedContext(
	degradedContext: SessionControlPlaneDegradedContext | undefined,
	sync: SessionControlPlaneSyncState | undefined,
	pendingLocalTurns: number,
	blocking: boolean,
) {
	if (!blocking || !sync) {
		return degradedContext;
	}
	return upsertDegradedExecutionSource(degradedContext, buildSyncFailureSource(sync, pendingLocalTurns));
}
