import type { SessionData } from "@takumi/core";
import { batch } from "@takumi/render";
import { findPrimaryControlPlaneLane } from "./app-session-replay-validation.js";
import { buildPersistedContinuityState, cloneStoredContinuityState } from "./continuity/continuity-persistence.js";
import type { SessionContinuityState } from "./continuity/continuity-types.js";
import { cloneDegradedExecutionContext } from "./degraded-execution-context.js";
import { countSessionTurns } from "./session-turns.js";
import type { AppState } from "./state.js";

/**
 * Restore persisted control-plane/session state into the live app store.
 */
export function applyPersistedSessionState(state: AppState, session: SessionData): void {
	const controlPlane =
		(session.controlPlane as
			| (NonNullable<SessionData["controlPlane"]> & { continuity?: SessionContinuityState })
			| undefined) ?? undefined;
	const storedSync = controlPlane?.sync;
	const storedLanes = controlPlane?.lanes ?? [];
	const clonedContinuity = cloneStoredContinuityState(controlPlane?.continuity);
	const primaryLane = findPrimaryControlPlaneLane(storedLanes);
	const storedDegradedContext = cloneDegradedExecutionContext(controlPlane?.degradedContext);
	const storedArtifactPromotion = controlPlane?.artifactPromotion;

	batch(() => {
		state.clearDialogs();
		state.pendingPermission.value = null;
		state.clearFileTracking();
		state.canonicalSessionId.value = controlPlane?.canonicalSessionId ?? "";
		state.controlPlaneLanes.value = storedLanes;
		state.chitraguptaSync.value = storedSync
			? { status: "idle", ...storedSync }
			: { status: controlPlane?.canonicalSessionId ? "ready" : "idle" };
		state.continuityGrants.value = clonedContinuity.grants;
		state.continuityPeers.value = clonedContinuity.attachedPeers;
		state.continuityEvents.value = clonedContinuity.events;
		state.continuityLease.value = clonedContinuity.lease;
		state.degradedExecutionContext.value = storedDegradedContext;
		state.artifactPromotion.value = storedArtifactPromotion
			? { status: "idle", ...storedArtifactPromotion }
			: { status: "idle" };
		state.sessionId.value = session.id;
		state.provider.value = primaryLane?.provider ?? state.provider.value;
		state.model.value = primaryLane?.model ?? session.model;
		state.messages.value = session.messages;
		state.totalInputTokens.value = session.tokenUsage.inputTokens;
		state.totalOutputTokens.value = session.tokenUsage.outputTokens;
		state.totalCost.value = session.tokenUsage.totalCost;
		state.turnCount.value = countSessionTurns(session.messages);
	});
}

/**
 * Build the persisted control-plane envelope stored alongside a session.
 */
export function buildSessionControlPlaneState(state: AppState): SessionData["controlPlane"] {
	const canonicalSessionId = state.canonicalSessionId.value || undefined;
	const lanes = state.controlPlaneLanes.value;
	const sync = state.chitraguptaSync.value;
	const persistedContinuity = buildPersistedContinuityState(state);
	const degradedContext = cloneDegradedExecutionContext(state.degradedExecutionContext.value);
	const artifactPromotion = state.artifactPromotion.value;
	const hasSync = Boolean(
		sync.lastSyncedMessageId ||
			sync.lastSyncedMessageTimestamp ||
			sync.lastSyncedAt ||
			sync.lastError ||
			(sync.status && sync.status !== "idle"),
	);
	const hasContinuity = Boolean(persistedContinuity);
	const hasDegradedContext = Boolean(degradedContext?.sources.length);
	const hasArtifactPromotion = Boolean(
		artifactPromotion.lastPromotionAt ||
			artifactPromotion.lastError ||
			artifactPromotion.importedArtifactIds?.length ||
			artifactPromotion.pendingArtifactIds?.length ||
			(artifactPromotion.status && artifactPromotion.status !== "idle"),
	);

	if (
		!canonicalSessionId &&
		!hasSync &&
		lanes.length === 0 &&
		!hasContinuity &&
		!hasDegradedContext &&
		!hasArtifactPromotion
	) {
		return undefined;
	}

	return {
		...(canonicalSessionId ? { canonicalSessionId } : {}),
		...(lanes.length > 0 ? { lanes: lanes.map((lane) => ({ ...lane })) } : {}),
		...(hasSync ? { sync: { ...sync } } : {}),
		...(persistedContinuity ? { continuity: persistedContinuity satisfies SessionContinuityState } : {}),
		...(hasDegradedContext && degradedContext ? { degradedContext } : {}),
		...(hasArtifactPromotion ? { artifactPromotion: { ...artifactPromotion } } : {}),
	} as SessionData["controlPlane"];
}
