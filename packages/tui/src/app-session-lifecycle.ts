/**
 * Session lifecycle — owns session state, persistence, attach/resume, and
 * control-plane round-tripping. Consolidates what used to live across
 * app-session-{lifecycle,attach,control-plane}.ts.
 */
import type { ExtensionRunner } from "@takumi/agent";
import { type ChitraguptaBridge, reconstructFromDaemon } from "@takumi/bridge";
import {
	type AutoSaver,
	createAutoSaver,
	loadSession,
	type SessionControlPlaneDegradedContext,
	type SessionControlPlaneSyncState,
	type SessionData,
} from "@takumi/core";
import { batch, type RenderScheduler } from "@takumi/render";
import type { AgentRunner } from "./agent/agent-runner.js";
import type { CodingAgent } from "./agent/coding-agent.js";
import { buildSessionTitle, normalizeSessionTitle } from "./app-extension-runtime.js";
import { findPrimaryControlPlaneLane, validateReplayBeforeCanonicalImport } from "./app-session-replay-validation.js";
import type { AutocycleAgent } from "./autocycle/autocycle-agent.js";
import { refreshControlPlaneLanesFromDaemon } from "./chitragupta/control-plane-lanes.js";
import { buildPersistedContinuityState, cloneStoredContinuityState } from "./continuity/continuity-persistence.js";
import type { SessionContinuityState } from "./continuity/continuity-types.js";
import {
	buildSyncFailureSource,
	cloneDegradedExecutionContext,
	upsertDegradedExecutionSource,
} from "./degraded-execution-context.js";
import type { ExtensionUiStore } from "./extension-ui-store.js";
import { countSessionTurns } from "./session-turns.js";
import type { AppState } from "./state.js";

// ── Persisted control-plane state ──────────────────────────────────────────

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
		// Drop the queue too — its `resolve` callbacks belong to the previous
		// session's agent loop, which is being torn down. Surfacing them in
		// the new session would either hang on dead promises or surface a
		// permission card for a tool the operator has zero context for.
		state.pendingPermissionQueue.value = [];
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

// ── Session attach (local + daemon recovery) ───────────────────────────────

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
 * Resolve a sessionId against local storage, falling back to a daemon
 * reconstruction. Shared between the TUI resume path and the desktop bridge
 * so both surfaces produce identical control-plane state.
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

// ── SessionManager — owns mutable session state and lifecycle ops ──────────

export interface SessionManagerDeps {
	state: AppState;
	getAgentRunner(): AgentRunner | null;
	extensionRunner: ExtensionRunner | null;
	extensionUiStore: ExtensionUiStore;
	getScheduler(): RenderScheduler | null;
	addInfoMessage(text: string): void;
}

export class SessionManager {
	autoSaver: AutoSaver | null = null;
	activeCoder: CodingAgent | null = null;
	activeAutocycle: AutocycleAgent | null = null;
	sessionTitleOverride: string | null = null;
	resumeSessionId: string | undefined;

	private readonly deps: SessionManagerDeps;

	constructor(deps: SessionManagerDeps) {
		this.deps = deps;
	}

	applySessionState(session: SessionData): void {
		this.sessionTitleOverride = normalizeSessionTitle(session.title);
		this.deps.extensionUiStore.resetSessionUi();
		applyPersistedSessionState(this.deps.state, session);
		this.deps.getAgentRunner()?.hydrateHistory(session.messages);
	}

	async cleanupActiveWork(reason: string): Promise<void> {
		const agentRunner = this.deps.getAgentRunner();
		if (agentRunner?.isRunning) {
			agentRunner.cancel();
		}

		const activeAutocycle = this.activeAutocycle;
		this.activeAutocycle = null;
		if (activeAutocycle?.isActive) {
			activeAutocycle.cancel();
		}

		const activeCoder = this.activeCoder;
		this.activeCoder = null;
		if (!activeCoder) return;
		if (activeCoder.isActive) await activeCoder.cancel(reason);
		await activeCoder.shutdown();
	}

	async rotateAutoSaver(): Promise<void> {
		if (!this.autoSaver) return;
		try {
			await this.autoSaver.save();
		} catch {
			/* best effort */
		}
		this.autoSaver.stop();
		this.autoSaver = null;
	}

	async activateSession(session: SessionData, notice?: string, reason: "new" | "resume" = "resume"): Promise<void> {
		const { state, extensionRunner, addInfoMessage } = this.deps;
		const previousSessionId = state.sessionId.value || undefined;
		if (extensionRunner) {
			const cancelled = await extensionRunner.emitCancellable({
				type: "session_before_switch",
				reason,
				targetSessionId: session.id,
			});
			if (cancelled?.cancel) {
				addInfoMessage("Session switch blocked by extension.");
				return;
			}
		}

		await this.cleanupActiveWork(`Switching to session ${session.id}.`);
		await this.rotateAutoSaver();
		this.applySessionState(session);
		this.resumeSessionId = session.id;
		this.startAutoSaver();
		if (extensionRunner) {
			await extensionRunner.emit({ type: "session_switch", reason, previousSessionId });
		}
		if (notice) addInfoMessage(notice);
		this.deps.getScheduler()?.scheduleRender();
	}

	async resumeSession(sessionId: string): Promise<void> {
		const result = await attachSessionToRuntime({
			sessionId,
			model: this.deps.state.model.value,
			chitragupta: this.deps.state.chitraguptaBridge.value,
			activateSession: (session, notice) => this.activateSession(session, notice, "resume"),
		});
		if (!result.success) {
			this.deps.addInfoMessage(result.error ?? `Could not resume session: ${sessionId}`);
		}
	}

	buildSessionData(): SessionData {
		const { state } = this.deps;
		const messages = state.messages.value;
		const controlPlane = buildSessionControlPlaneState(state);
		return {
			id: state.sessionId.value,
			title: buildSessionTitle(messages, this.sessionTitleOverride),
			createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
			updatedAt: Date.now(),
			messages,
			model: state.model.value,
			tokenUsage: {
				inputTokens: state.totalInputTokens.value,
				outputTokens: state.totalOutputTokens.value,
				totalCost: state.totalCost.value,
			},
			controlPlane,
		};
	}

	startAutoSaver(): void {
		if (!this.autoSaver) {
			this.autoSaver = createAutoSaver(this.deps.state.sessionId.value, () => this.buildSessionData());
		}
	}
}
