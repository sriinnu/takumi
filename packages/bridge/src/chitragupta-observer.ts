/**
 * ChitraguptaObserver — Phase 49-51 companion for ChitraguptaBridge.
 *
 * Adds bidirectional intelligence: observation dispatch, push-notification
 * subscriptions, and prediction/pattern/health queries.
 *
 * Kept as a separate class because ChitraguptaBridge is at the LOC limit.
 * Reads connection state through the bridge's public getters.
 */

import type { ChitraguptaBridge } from "./chitragupta.js";
import type { NotificationCallbacks } from "./chitragupta-observe.js";
import * as observe from "./chitragupta-observe.js";
import type { CapabilityQuery, CapabilityQueryResult, RoutingDecision, RoutingRequest } from "./control-plane.js";
import type {
	HealReportParams,
	HealReportResult,
	HealthStatusResult,
	ObservationEvent,
	ObserveBatchResult,
	PatternQueryParams,
	PatternQueryResult,
	PredictNextParams,
	PredictNextResult,
	SabhaAskParams,
	SabhaAskResult,
	SabhaDeliberateParams,
	SabhaDeliberateResult,
	SabhaEscalateParams,
	SabhaEscalateResult,
	SabhaGatherParams,
	SabhaGatherResult,
	SabhaRecordParams,
	SabhaRecordResult,
} from "./observation-types.js";

export class ChitraguptaObserver {
	private readonly bridge: ChitraguptaBridge;
	private unsubscribe: (() => void) | null = null;

	constructor(bridge: ChitraguptaBridge) {
		this.bridge = bridge;
	}

	// ── Observation Dispatch (Phase 49) ──────────────────────────────────

	/** Batch-submit observation events to Chitragupta. */
	async observeBatch(events: ObservationEvent[]): Promise<ObserveBatchResult> {
		return observe.observeBatch(this.bridge.daemonSocket, this.bridge.isSocketMode, events);
	}

	// ── Prediction & Pattern Queries (Phase 51) ──────────────────────────

	/** Request next-action predictions from Chitragupta. */
	async predictNext(params: PredictNextParams): Promise<PredictNextResult> {
		return observe.predictNext(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Query detected patterns from Chitragupta's pattern engine. */
	async patternQuery(params: PatternQueryParams = {}): Promise<PatternQueryResult> {
		return observe.patternQuery(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Get extended health status (error rates, anomalies, cost). */
	async healthStatusExtended(): Promise<HealthStatusResult | null> {
		return observe.healthStatusExtended(this.bridge.daemonSocket, this.bridge.isSocketMode);
	}

	/** Report a heal action outcome for effectiveness tracking. */
	async healReport(params: HealReportParams): Promise<HealReportResult> {
		return observe.healReport(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Query engine-owned integration capabilities. */
	async capabilities(query: CapabilityQuery = {}): Promise<CapabilityQueryResult> {
		return observe.capabilitiesQuery(this.bridge.daemonSocket, this.bridge.isSocketMode, query);
	}

	/** Resolve a semantic routing request through the engine control plane. */
	async routeResolve(request: RoutingRequest): Promise<RoutingDecision | null> {
		return observe.routeResolve(this.bridge.daemonSocket, this.bridge.isSocketMode, request);
	}

	/** Ask the engine to convene a Sabha consultation. */
	async sabhaAsk(params: SabhaAskParams): Promise<SabhaAskResult | null> {
		return observe.sabhaAsk(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Gather the current state of a Sabha. */
	async sabhaGather(params: SabhaGatherParams): Promise<SabhaGatherResult | null> {
		return observe.sabhaGather(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Run or conclude a Sabha deliberation round. */
	async sabhaDeliberate(params: SabhaDeliberateParams): Promise<SabhaDeliberateResult | null> {
		return observe.sabhaDeliberate(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Record a Sabha outcome into the engine. */
	async sabhaRecord(params: SabhaRecordParams): Promise<SabhaRecordResult | null> {
		return observe.sabhaRecord(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	/** Escalate a Sabha to external authority or human review. */
	async sabhaEscalate(params: SabhaEscalateParams): Promise<SabhaEscalateResult | null> {
		return observe.sabhaEscalate(this.bridge.daemonSocket, this.bridge.isSocketMode, params);
	}

	// ── Notification Subscriptions (Phase 50) ────────────────────────────

	/**
	 * Subscribe to all Chitragupta push notifications.
	 * Idempotent: calling again replaces the previous subscription.
	 */
	subscribe(callbacks: NotificationCallbacks): void {
		this.teardown();
		this.unsubscribe = observe.subscribeNotifications(this.bridge.daemonSocket, callbacks);
	}

	/** Remove all notification subscriptions. */
	teardown(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}
