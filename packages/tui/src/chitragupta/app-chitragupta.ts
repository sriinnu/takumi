import {
	akashaDepositDefinition,
	akashaTracesDefinition,
	createAkashaHandlers,
	type ExtensionEvent,
} from "@takumi/agent";
import { ChitraguptaBridge, ChitraguptaObserver } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AgentRunner } from "../agent/agent-runner.js";
import {
	formatReplayValidationConflict,
	validateReplayBeforeCanonicalImport,
} from "../app-session-replay-validation.js";
import {
	mergeControlPlaneCapabilities,
	summarizeTakumiCapabilityHealth,
	upsertCapabilityHealthSnapshot,
} from "../control-plane-state.js";
import {
	findRepresentativeDegradedLane,
	recordLaneDegradedExecution,
	recordSyncFailureExecution,
} from "../degraded-execution-context.js";
import type { AppState } from "../state.js";
import { buildTelemetryCognition } from "./app-chitragupta-cognition.js";
import { setupChitraguptaNotifications } from "./app-chitragupta-notifications.js";
import { ensureCanonicalSessionBinding } from "./chitragupta-executor-runtime.js";
import { loadMcpConfig, resetRecentDirectiveHistory } from "./chitragupta-runtime-helpers.js";
import {
	type ChitraguptaSessionSyncResult,
	countPendingChitraguptaSessionTurns,
	markChitraguptaSyncPending,
	syncPendingChitraguptaSessionTurns,
} from "./chitragupta-session-sync.js";
import { refreshControlPlaneLanesFromDaemon } from "./control-plane-lanes.js";

const log = createLogger("app");
let startedAt = 0;

export interface ChitraguptaConnectResult extends ChitraguptaSessionSyncResult {}

export async function connectChitragupta(
	state: AppState,
	agentRunner: AgentRunner | null,
	onInterval: (timer: ReturnType<typeof setInterval>) => void,
	socketPath?: string,
): Promise<ChitraguptaConnectResult> {
	const canonicalSessionId = state.canonicalSessionId.value || null;
	const pendingLocalTurns = countPendingChitraguptaSessionTurns(state);
	if (canonicalSessionId) {
		await safelyEmitExtensionEvent(agentRunner?.emitExtensionEvent, {
			type: "before_session_rebind",
			localSessionId: state.sessionId.value || undefined,
			canonicalSessionId,
			pendingLocalTurns,
			currentProvider: state.provider.value || undefined,
			currentModel: state.model.value || undefined,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: state.chitraguptaSync.value.lastError,
		});
	}

	const mcpConfig = loadMcpConfig();
	const bridge = new ChitraguptaBridge({
		command: mcpConfig?.command,
		args: mcpConfig?.args,
		projectPath: process.cwd(),
		startupTimeoutMs: 8_000,
		socketPath, // undefined → auto-resolve; "" → disable socket mode
	});
	state.chitraguptaBridge.value = bridge;

	bridge.mcpClient.on("disconnected", () => {
		state.chitraguptaConnected.value = false;
		markChitraguptaSyncPending(state, state.chitraguptaSync.value.lastError);
		log.info("Chitragupta bridge disconnected");
	});
	bridge.mcpClient.on("error", (err) => {
		const message = (err as Error).message;
		log.debug(`Chitragupta bridge error: ${message}`);
		state.chitraguptaConnected.value = false;
		markChitraguptaSyncPending(state, message);
	});
	try {
		await bridge.connect();
		state.chitraguptaConnected.value = true;
		startedAt = Date.now();
		log.info("Chitragupta bridge connected");
		const observer = new ChitraguptaObserver(bridge);
		state.chitraguptaObserver.value = observer;
		setupChitraguptaNotifications(state, observer, agentRunner);
		await ensureCanonicalSessionBinding(state);
		const storedLanes = state.controlPlaneLanes.value.map((lane) => ({ ...lane }));
		const refreshedLanes = await refreshControlPlaneLanesFromDaemon(
			bridge,
			state.canonicalSessionId.value || undefined,
			process.cwd(),
		);
		if (refreshedLanes.lanes.length > 0) {
			state.controlPlaneLanes.value = refreshedLanes.lanes;
			const degradedLane = findRepresentativeDegradedLane(refreshedLanes.lanes);
			if (degradedLane) recordLaneDegradedExecution(state, degradedLane);
		}
		for (const warning of refreshedLanes.warnings) log.debug(warning);
		const replayValidation = validateReplayBeforeCanonicalImport({
			canonicalSessionId: state.canonicalSessionId.value || null,
			pendingLocalTurns,
			sessionModel: state.model.value || null,
			currentProvider: state.provider.value || null,
			storedLanes,
			refreshedLanes: refreshedLanes.lanes,
		});
		if (replayValidation.blocking) {
			state.chitraguptaSync.value = {
				...state.chitraguptaSync.value,
				status: "failed",
				lastError: replayValidation.summary ?? "Replay validation failed.",
			};
			recordSyncFailureExecution(state);
			return withReplayValidation(
				buildSyncLikeResult(state, {
					connected: true,
					canonicalSessionId: state.canonicalSessionId.value || null,
					syncedMessages: 0,
					pendingMessages: pendingLocalTurns,
					syncStatus: state.chitraguptaSync.value.status,
					lastError: state.chitraguptaSync.value.lastError,
					lastSyncedMessageId: state.chitraguptaSync.value.lastSyncedMessageId,
					lastSyncedMessageTimestamp: state.chitraguptaSync.value.lastSyncedMessageTimestamp,
					lastAttemptedMessageId: state.chitraguptaSync.value.lastAttemptedMessageId,
					lastAttemptedMessageTimestamp: state.chitraguptaSync.value.lastAttemptedMessageTimestamp,
					lastFailedMessageId: state.chitraguptaSync.value.lastFailedMessageId,
					lastFailedMessageTimestamp: state.chitraguptaSync.value.lastFailedMessageTimestamp,
				}),
				replayValidation,
			);
		}
		try {
			const capabilities = await observer.capabilities({ includeDegraded: true, includeDown: true, limit: 25 });
			state.controlPlaneCapabilities.value = mergeControlPlaneCapabilities(capabilities.capabilities);
		} catch (err) {
			log.debug(`Chitragupta capabilities preload failed: ${(err as Error).message}`);
		}
		state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
			state.capabilityHealthSnapshots.value,
			summarizeTakumiCapabilityHealth({ connected: true, routingDecisions: state.routingDecisions.value }),
		);
		if (agentRunner) {
			const tools = agentRunner.getTools();
			const handlers = createAkashaHandlers(
				bridge,
				() => {
					state.akashaDeposits.value++;
					state.akashaLastActivity.value = Date.now();
				},
				() => {
					state.akashaLastActivity.value = Date.now();
				},
			);
			tools.register(akashaDepositDefinition, handlers.deposit);
			tools.register(akashaTracesDefinition, handlers.traces);
			log.info("Registered Akasha tools");
		}

		try {
			const cwd = process.cwd();
			const projectName = cwd.split("/").pop() ?? cwd;
			const results = await bridge.unifiedRecall(projectName, 5, projectName);
			if (results.length > 0) {
				state.chitraguptaMemory.value = results
					.map(
						(r, i) =>
							`${i + 1}. [score ${r.score.toFixed(2)} | ${r.type}${r.source ? ` | ${r.source}` : ""}]\n${r.content}`,
					)
					.join("\n\n");
				log.info(`Loaded ${results.length} memory entries from Chitragupta (unified recall)`);
			}
		} catch (err) {
			log.debug(`Chitragupta memory preload failed: ${(err as Error).message}`);
		}

		try {
			const tendencies = await bridge.vasanaTendencies(10);
			state.vasanaTendencies.value = tendencies;
			state.vasanaLastRefresh.value = Date.now();
			if (tendencies.length > 0) log.info(`Loaded ${tendencies.length} vasana tendencies from Chitragupta`);
		} catch (err) {
			log.debug(`Chitragupta vasana preload failed: ${(err as Error).message}`);
		}

		try {
			const health = await bridge.healthStatus();
			if (health) {
				state.chitraguptaHealth.value = health;
				log.info(`Chitragupta health: ${health.dominant} (sattva=${health.state.sattva.toFixed(2)})`);
			}
		} catch (err) {
			log.debug(`Chitragupta health check failed: ${(err as Error).message}`);
		}

		const syncResult = withReplayValidation(
			await syncPendingChitraguptaSessionTurns(state, agentRunner?.emitExtensionEvent),
			replayValidation,
		);

		const heartbeatTimer = setInterval(async () => {
			const b = state.chitraguptaBridge.value;
			if (!b?.isConnected) return;
			try {
				await b.telemetryHeartbeat({
					process: {
						pid: process.pid,
						ppid: process.ppid ?? 0,
						uptime: process.uptime(),
						heartbeatAt: Date.now(),
						startedAt,
					} as never,
					state: {
						activity: state.isStreaming.value ? "working" : "waiting_input",
						idle: !state.isStreaming.value,
					} as never,
					context: {
						tokens: state.contextTokens.value,
						contextWindow: state.contextWindow.value,
						remainingTokens: state.contextWindow.value - state.contextTokens.value,
						percent: state.contextPercent.value,
						pressure: state.contextPressure.value as never,
						closeToLimit: state.contextPercent.value >= 85,
						nearLimit: state.contextPercent.value >= 95,
					} as never,
					cognition: buildTelemetryCognition(state) as never,
					lastEvent: "heartbeat",
				});
			} catch (err) {
				log.debug(`Telemetry heartbeat failed: ${(err as Error).message}`);
			}
		}, 1_500);
		onInterval(heartbeatTimer);

		const vasanaTimer = setInterval(async () => {
			const b = state.chitraguptaBridge.value;
			if (!b?.isConnected) return;
			try {
				const [t, h, capabilities] = await Promise.all([
					b.vasanaTendencies(10),
					b.healthStatus(),
					observer.capabilities({ includeDegraded: true, includeDown: true, limit: 25 }),
				]);
				state.vasanaTendencies.value = t;
				if (h) state.chitraguptaHealth.value = h;
				state.controlPlaneCapabilities.value = mergeControlPlaneCapabilities(capabilities.capabilities);
				state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
					state.capabilityHealthSnapshots.value,
					summarizeTakumiCapabilityHealth({
						connected: true,
						anomalySeverity: state.chitraguptaAnomaly.value?.severity,
						routingDecisions: state.routingDecisions.value,
					}),
				);
				state.vasanaLastRefresh.value = Date.now();
			} catch {
				/* best effort */
			}
		}, 60_000);
		onInterval(vasanaTimer);

		return syncResult;
	} catch (err) {
		const message = (err as Error).message;
		log.debug(`Chitragupta bridge connection failed: ${message}`);
		state.chitraguptaConnected.value = false;
		state.chitraguptaBridge.value = null;
		const pendingMessages = markChitraguptaSyncPending(state, message);
		return {
			connected: false,
			canonicalSessionId: state.canonicalSessionId.value || null,
			syncedMessages: 0,
			pendingMessages,
			syncStatus: state.chitraguptaSync.value.status,
			lastError: message,
			artifactPromotionStatus: state.artifactPromotion.value.status,
			pendingArtifacts: state.artifactPromotion.value.pendingArtifactIds?.length ?? 0,
			importedArtifacts: state.artifactPromotion.value.importedArtifactIds?.length ?? 0,
			lastPromotionAt: state.artifactPromotion.value.lastPromotionAt,
			artifactPromotionError: state.artifactPromotion.value.lastError,
		};
	}
}

/**
 * Session/replay hook emission is fail-open for now.
 * Hook ordering and failure policy graduate separately once the seams prove out.
 */
async function safelyEmitExtensionEvent(
	emitExtensionEvent: ((event: ExtensionEvent) => Promise<void> | void) | undefined,
	event: ExtensionEvent,
): Promise<void> {
	if (!emitExtensionEvent) return;
	try {
		await emitExtensionEvent(event);
	} catch {
		// Ignore hook failures until Track 2 defines explicit policy semantics.
	}
}

function buildSyncLikeResult(
	state: AppState,
	base: Omit<
		ChitraguptaSessionSyncResult,
		"artifactPromotionStatus" | "pendingArtifacts" | "importedArtifacts" | "lastPromotionAt" | "artifactPromotionError"
	>,
): ChitraguptaSessionSyncResult {
	return {
		...base,
		artifactPromotionStatus: state.artifactPromotion.value.status,
		pendingArtifacts: state.artifactPromotion.value.pendingArtifactIds?.length ?? 0,
		importedArtifacts: state.artifactPromotion.value.importedArtifactIds?.length ?? 0,
		lastPromotionAt: state.artifactPromotion.value.lastPromotionAt,
		artifactPromotionError: state.artifactPromotion.value.lastError,
	};
}

function withReplayValidation(
	result: ChitraguptaSessionSyncResult,
	validation: ReturnType<typeof validateReplayBeforeCanonicalImport>,
): ChitraguptaSessionSyncResult {
	return {
		...result,
		...(validation.warnings.length > 0 ? { validationWarnings: [...validation.warnings] } : {}),
		...(validation.conflicts.length > 0
			? { validationConflicts: validation.conflicts.map((conflict) => formatReplayValidationConflict(conflict)) }
			: {}),
	};
}

export async function disconnectChitragupta(state: AppState): Promise<void> {
	const bridge = state.chitraguptaBridge.value;
	if (!bridge || !bridge.isConnected) return;

	state.chitraguptaObserver.value?.teardown();
	state.chitraguptaObserver.value = null;
	resetRecentDirectiveHistory();

	try {
		await bridge.telemetryCleanup(process.pid);
		log.debug("Telemetry heartbeat file cleaned up");
	} catch (err) {
		log.debug(`Telemetry cleanup failed: ${(err as Error).message}`);
	}

	try {
		await Promise.race([
			bridge.handover(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("handover timeout")), 3_000)),
		]);
		log.debug("Chitragupta handover completed");
	} catch (err) {
		log.debug(`Chitragupta handover failed: ${(err as Error).message}`);
	}

	try {
		await bridge.disconnect();
	} catch (err) {
		log.debug(`Chitragupta disconnect failed: ${(err as Error).message}`);
	}
	state.chitraguptaConnected.value = false;
	markChitraguptaSyncPending(state, state.chitraguptaSync.value.lastError);
	state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
		state.capabilityHealthSnapshots.value,
		summarizeTakumiCapabilityHealth({ connected: false, routingDecisions: state.routingDecisions.value }),
	);
	state.chitraguptaBridge.value = null;
}
