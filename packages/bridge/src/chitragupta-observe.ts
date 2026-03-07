/**
 * Phase 49-51 operations for ChitraguptaBridge.
 * Observation dispatch, notification handling, and prediction queries.
 */

import { createLogger } from "@takumi/core";
import type { CapabilityQuery, CapabilityQueryResult, RoutingDecision, RoutingRequest } from "./control-plane.js";
import type { DaemonSocketClient, NotificationHandler } from "./daemon-socket.js";
import type {
	AnomalyAlertNotification,
	EvolveRequestNotification,
	HealReportedNotification,
	HealReportParams,
	HealReportResult,
	HealthStatusResult,
	ObservationEvent,
	ObserveBatchResult,
	PatternDetectedNotification,
	PatternQueryParams,
	PatternQueryResult,
	PredictionNotification,
	PredictNextParams,
	PredictNextResult,
	PreferenceUpdateNotification,
	SabhaAskParams,
	SabhaAskResult,
	SabhaConsultNotification,
	SabhaDeliberateParams,
	SabhaDeliberateResult,
	SabhaEscalatedNotification,
	SabhaEscalateParams,
	SabhaEscalateResult,
	SabhaGatherParams,
	SabhaGatherResult,
	SabhaRecordedNotification,
	SabhaRecordParams,
	SabhaRecordResult,
	SabhaUpdatedNotification,
} from "./observation-types.js";

const log = createLogger("chitragupta-observe");

// ── Observation Dispatch (Phase 49) ──────────────────────────────────────────

/**
 * Batch-submit observation events to Chitragupta.
 * Falls back gracefully if the daemon doesn't support observe.batch yet.
 */
export async function observeBatch(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	events: ObservationEvent[],
): Promise<ObserveBatchResult> {
	if (events.length === 0) return { accepted: 0 };

	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<ObserveBatchResult>("observe.batch", { events });
		} catch (err) {
			// Daemon may not support observe.batch yet — log and continue
			log.debug(`observe.batch not available: ${(err as Error).message}`);
			return { accepted: 0 };
		}
	}

	// MCP fallback: no observe.batch support in MCP mode
	log.debug("observe.batch requires daemon socket mode");
	return { accepted: 0 };
}

// ── Prediction Queries (Phase 51) ────────────────────────────────────────────

/**
 * Request predictions from Chitragupta based on current context.
 */
export async function predictNext(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: PredictNextParams,
): Promise<PredictNextResult> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<PredictNextResult>("predict.next", { ...params });
		} catch (err) {
			log.debug(`predict.next not available: ${(err as Error).message}`);
			return { predictions: [] };
		}
	}
	return { predictions: [] };
}

/**
 * Query detected patterns from Chitragupta's pattern engine.
 */
export async function patternQuery(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: PatternQueryParams = {},
): Promise<PatternQueryResult> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<PatternQueryResult>("pattern.query", { ...params });
		} catch (err) {
			log.debug(`pattern.query not available: ${(err as Error).message}`);
			return { patterns: [] };
		}
	}
	return { patterns: [] };
}

/**
 * Get health status overview (error rates, anomalies, cost trajectory).
 */
export async function healthStatusExtended(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
): Promise<HealthStatusResult | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<HealthStatusResult>("health.status", {});
		} catch (err) {
			log.debug(`health.status not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

/**
 * Report a heal action outcome to Chitragupta for effectiveness tracking.
 */
export async function healReport(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: HealReportParams,
): Promise<HealReportResult> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<HealReportResult>("heal.report", { ...params });
		} catch (err) {
			log.debug(`heal.report not available: ${(err as Error).message}`);
			return { recorded: false };
		}
	}
	return { recorded: false };
}

// ── Control-plane Queries ───────────────────────────────────────────────────

/**
 * Query engine-owned capabilities from Chitragupta.
 */
export async function capabilitiesQuery(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	query: CapabilityQuery = {},
): Promise<CapabilityQueryResult> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<CapabilityQueryResult>("capabilities", { ...query });
		} catch (err) {
			log.debug(`capabilities not available: ${(err as Error).message}`);
			return { capabilities: [] };
		}
	}
	return { capabilities: [] };
}

/**
 * Ask the engine to resolve a semantic capability request into a concrete lane.
 */
export async function routeResolve(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	request: RoutingRequest,
): Promise<RoutingDecision | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<RoutingDecision>("route.resolve", { ...request });
		} catch (err) {
			log.debug(`route.resolve not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

export async function sabhaAsk(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: SabhaAskParams,
): Promise<SabhaAskResult | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<SabhaAskResult>("sabha.ask", { ...params });
		} catch (err) {
			log.debug(`sabha.ask not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

export async function sabhaGather(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: SabhaGatherParams,
): Promise<SabhaGatherResult | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<SabhaGatherResult>("sabha.gather", { ...params });
		} catch (err) {
			log.debug(`sabha.gather not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

export async function sabhaDeliberate(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: SabhaDeliberateParams,
): Promise<SabhaDeliberateResult | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<SabhaDeliberateResult>("sabha.deliberate", { ...params });
		} catch (err) {
			log.debug(`sabha.deliberate not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

export async function sabhaRecord(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: SabhaRecordParams,
): Promise<SabhaRecordResult | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<SabhaRecordResult>("sabha.record", { ...params });
		} catch (err) {
			log.debug(`sabha.record not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

export async function sabhaEscalate(
	socket: DaemonSocketClient | null,
	socketMode: boolean,
	params: SabhaEscalateParams,
): Promise<SabhaEscalateResult | null> {
	if (socketMode && socket?.isConnected) {
		try {
			return await socket.call<SabhaEscalateResult>("sabha.escalate", { ...params });
		} catch (err) {
			log.debug(`sabha.escalate not available: ${(err as Error).message}`);
			return null;
		}
	}
	return null;
}

// ── Notification Subscriptions (Phase 50) ─────────────────────────────────────

/** Callback types for notification handlers */
export interface NotificationCallbacks {
	onPatternDetected?: (params: PatternDetectedNotification) => void;
	onPrediction?: (params: PredictionNotification) => void;
	onAnomalyAlert?: (params: AnomalyAlertNotification) => void;
	onHealReported?: (params: HealReportedNotification) => void;
	onSabhaConsult?: (params: SabhaConsultNotification) => void;
	onSabhaUpdated?: (params: SabhaUpdatedNotification) => void;
	onSabhaRecorded?: (params: SabhaRecordedNotification) => void;
	onSabhaEscalated?: (params: SabhaEscalatedNotification) => void;
	onEvolveRequest?: (params: EvolveRequestNotification) => void;
	onPreferenceUpdate?: (params: PreferenceUpdateNotification) => void;
}

/**
 * Subscribe to all Chitragupta push notifications on the daemon socket.
 * Returns an unsubscribe function that removes all handlers.
 */
export function subscribeNotifications(
	socket: DaemonSocketClient | null,
	callbacks: NotificationCallbacks,
): () => void {
	if (!socket) return () => {};

	const unsubs: Array<() => void> = [];

	if (callbacks.onPatternDetected) {
		const handler: NotificationHandler = (params) => {
			callbacks.onPatternDetected!(params as unknown as PatternDetectedNotification);
		};
		unsubs.push(socket.onNotification("pattern_detected", handler));
	}

	if (callbacks.onPrediction) {
		const handler: NotificationHandler = (params) => {
			callbacks.onPrediction!(params as unknown as PredictionNotification);
		};
		unsubs.push(socket.onNotification("prediction", handler));
	}

	if (callbacks.onAnomalyAlert) {
		const handler: NotificationHandler = (params) => {
			callbacks.onAnomalyAlert!(params as unknown as AnomalyAlertNotification);
		};
		unsubs.push(socket.onNotification("anomaly_alert", handler));
	}

	if (callbacks.onHealReported) {
		const handler: NotificationHandler = (params) => {
			callbacks.onHealReported!(params as unknown as HealReportedNotification);
		};
		unsubs.push(socket.onNotification("heal_reported", handler));
	}

	if (callbacks.onSabhaConsult) {
		const handler: NotificationHandler = (params) => {
			callbacks.onSabhaConsult!(params as unknown as SabhaConsultNotification);
		};
		unsubs.push(socket.onNotification("sabha.consult", handler));
	}

	if (callbacks.onSabhaUpdated) {
		const handler: NotificationHandler = (params) => {
			callbacks.onSabhaUpdated!(params as unknown as SabhaUpdatedNotification);
		};
		unsubs.push(socket.onNotification("sabha.updated", handler));
	}

	if (callbacks.onSabhaRecorded) {
		const handler: NotificationHandler = (params) => {
			callbacks.onSabhaRecorded!(params as unknown as SabhaRecordedNotification);
		};
		unsubs.push(socket.onNotification("sabha.recorded", handler));
	}

	if (callbacks.onSabhaEscalated) {
		const handler: NotificationHandler = (params) => {
			callbacks.onSabhaEscalated!(params as unknown as SabhaEscalatedNotification);
		};
		unsubs.push(socket.onNotification("sabha.escalated", handler));
	}

	if (callbacks.onEvolveRequest) {
		const handler: NotificationHandler = (params) => {
			callbacks.onEvolveRequest!(params as unknown as EvolveRequestNotification);
		};
		unsubs.push(socket.onNotification("evolve_request", handler));
	}

	if (callbacks.onPreferenceUpdate) {
		const handler: NotificationHandler = (params) => {
			callbacks.onPreferenceUpdate!(params as unknown as PreferenceUpdateNotification);
		};
		unsubs.push(socket.onNotification("preference_update", handler));
	}

	return () => {
		for (const unsub of unsubs) unsub();
	};
}
