/**
 * Phase 49-51 operations for ChitraguptaBridge.
 * Observation dispatch, notification handling, and prediction queries.
 */

import { createLogger } from "@takumi/core";
import type { DaemonSocketClient, NotificationHandler } from "./daemon-socket.js";
import type {
	AnomalyAlertNotification,
	EvolveRequestNotification,
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

// ── Notification Subscriptions (Phase 50) ─────────────────────────────────────

/** Callback types for notification handlers */
export interface NotificationCallbacks {
	onPatternDetected?: (params: PatternDetectedNotification) => void;
	onPrediction?: (params: PredictionNotification) => void;
	onAnomalyAlert?: (params: AnomalyAlertNotification) => void;
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
