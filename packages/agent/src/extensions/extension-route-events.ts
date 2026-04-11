/**
 * Route lifecycle events — Track 2 hook substrate.
 *
 * These events expose route request / resolution boundaries to extensions
 * without granting mutation rights yet. They are intentionally observe-only
 * for now; ordered blocking and failure policy arrive as a later hook-layer
 * slice once the event seams are proven.
 */

import type { ExecutionLaneAuthority, ExecutionLaneEnvelope, RoutingDecision, RoutingRequest } from "@takumi/bridge";

/** Runtime flow emitting a route lifecycle event. */
export type RouteLifecycleFlow = "interactive-submit" | "multi-agent";

interface RouteResolutionEventBase {
	type: "after_route_resolution" | "route_degraded";
	/** Runtime flow that requested the route. */
	flow: RouteLifecycleFlow;
	/** Original engine request Takumi attempted to resolve. */
	request: RoutingRequest;
	/** Raw engine decision, when one existed. */
	decision: RoutingDecision | null;
	/** Authority of the executable route Takumi ended up with. */
	authority: ExecutionLaneAuthority;
	/** Whether the engine-selected route was executable and applied as-is. */
	applied: boolean;
	/** Whether Takumi is continuing in a degraded route state. */
	degraded: boolean;
	/** Concrete provider family Takumi will use, when known. */
	provider?: string;
	/** Concrete model Takumi will use, when known. */
	model?: string;
	/** Operator-facing explanation of the resolution outcome. */
	reason: string;
	/** Resolution failure detail when no executable route could be produced. */
	resolutionError?: string;
	/** Per-role lane envelopes for multi-agent route groups. */
	laneEnvelopes?: ExecutionLaneEnvelope[];
}

/** Fired immediately before Takumi asks the engine to resolve a route. */
export interface BeforeRouteRequestEvent {
	type: "before_route_request";
	flow: RouteLifecycleFlow;
	request: RoutingRequest;
	/** Current provider family/model Takumi would otherwise use locally. */
	currentProvider?: string;
	currentModel?: string;
}

/** Fired after Takumi resolves a route request into an executable outcome. */
export interface AfterRouteResolutionEvent extends RouteResolutionEventBase {
	type: "after_route_resolution";
}

/** Fired when Takumi continues with a degraded route rather than engine truth. */
export interface RouteDegradedEvent extends RouteResolutionEventBase {
	type: "route_degraded";
}

export type RouteLifecycleEvent = BeforeRouteRequestEvent | AfterRouteResolutionEvent | RouteDegradedEvent;
