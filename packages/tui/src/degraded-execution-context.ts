import type { RoutingDecision } from "@takumi/bridge";
import type {
	SessionControlPlaneDegradedContext,
	SessionControlPlaneDegradedSourceState,
	SessionControlPlaneLaneState,
	SessionControlPlaneSyncState,
} from "@takumi/core";
import type { AppState } from "./state.js";

type SyncStatus = Exclude<SessionControlPlaneSyncState["status"], undefined>;

export interface DegradedExecutionSummary {
	active: boolean;
	summary: string;
	since: number;
	lastUpdatedAt: number;
	sourceKinds: SessionControlPlaneDegradedSourceState["kind"][];
	route: {
		degraded: boolean;
		capability: string | null;
		reason: string | null;
		authority: "engine" | "takumi-fallback" | null;
		fallbackChain: string[];
	} | null;
	sync: {
		failed: boolean;
		status: SyncStatus | null;
		reason: string | null;
		lastFailedMessageId: string | null;
		pendingLocalTurns: number | null;
	} | null;
}

/**
 * I deep-clone persisted degraded state so restore, save, and summary builders
 * never share mutable arrays by accident.
 */
export function cloneDegradedExecutionContext(
	context: SessionControlPlaneDegradedContext | null | undefined,
): SessionControlPlaneDegradedContext | null {
	if (!context) return null;
	return {
		firstDetectedAt: context.firstDetectedAt,
		lastUpdatedAt: context.lastUpdatedAt,
		sources: context.sources.map((source) => ({
			...source,
			fallbackChain: source.fallbackChain ? [...source.fallbackChain] : undefined,
		})),
	};
}

export function buildRouteDegradedSource(
	decision: RoutingDecision,
	now = Date.now(),
): SessionControlPlaneDegradedSourceState {
	return {
		kind: "route_degraded",
		reason: decision.reason ?? `Degraded route selected for ${decision.request?.capability ?? "unknown capability"}`,
		firstDetectedAt: now,
		lastDetectedAt: now,
		capability: decision.request?.capability ?? null,
		authority: decision.selected ? "engine" : "takumi-fallback",
		fallbackChain: [...(decision.fallbackChain ?? [])],
	};
}

export function buildLaneDegradedSource(
	lane: SessionControlPlaneLaneState,
	now = Date.now(),
): SessionControlPlaneDegradedSourceState {
	return {
		kind: "route_degraded",
		reason: lane.reason ?? `Degraded lane ${lane.role}`,
		firstDetectedAt: now,
		lastDetectedAt: now,
		capability: lane.capability ?? null,
		authority: "engine",
		fallbackChain: [...(lane.fallbackChain ?? [])],
	};
}

export function buildSyncFailureSource(
	sync: SessionControlPlaneSyncState,
	pendingLocalTurns: number,
	now = Date.now(),
): SessionControlPlaneDegradedSourceState {
	return {
		kind: "sync_failure",
		reason: sync.lastError ?? "Chitragupta replay failed",
		firstDetectedAt: now,
		lastDetectedAt: now,
		status: sync.status ?? "failed",
		lastFailedMessageId: sync.lastFailedMessageId ?? null,
		pendingLocalTurns,
	};
}

export function upsertDegradedExecutionSource(
	existing: SessionControlPlaneDegradedContext | null | undefined,
	incoming: SessionControlPlaneDegradedSourceState,
): SessionControlPlaneDegradedContext {
	const next = cloneDegradedExecutionContext(existing) ?? {
		firstDetectedAt: incoming.firstDetectedAt,
		lastUpdatedAt: incoming.lastDetectedAt,
		sources: [],
	};
	const index = next.sources.findIndex((source) => source.kind === incoming.kind);
	if (index >= 0) {
		const current = next.sources[index]!;
		next.sources[index] = {
			...current,
			...incoming,
			firstDetectedAt: Math.min(current.firstDetectedAt, incoming.firstDetectedAt),
			lastDetectedAt: Math.max(current.lastDetectedAt, incoming.lastDetectedAt),
			fallbackChain: mergeDistinct(current.fallbackChain, incoming.fallbackChain),
		};
	} else {
		next.sources.push({
			...incoming,
			fallbackChain: incoming.fallbackChain ? [...incoming.fallbackChain] : undefined,
		});
	}
	next.sources.sort((left, right) => left.firstDetectedAt - right.firstDetectedAt);
	next.firstDetectedAt = Math.min(next.firstDetectedAt, incoming.firstDetectedAt);
	next.lastUpdatedAt = Math.max(next.lastUpdatedAt, incoming.lastDetectedAt);
	return next;
}

export function findRepresentativeDegradedLane(
	lanes: SessionControlPlaneLaneState[] | undefined,
): SessionControlPlaneLaneState | null {
	if (!lanes || lanes.length === 0) return null;
	return (
		lanes.find((lane) => lane.degraded && (lane.role === "primary" || lane.key === "primary")) ??
		lanes.find((lane) => lane.degraded) ??
		null
	);
}

export function recordRouteDegradedExecution(
	state: AppState,
	decision: RoutingDecision,
	now = Date.now(),
): SessionControlPlaneDegradedContext {
	const next = upsertDegradedExecutionSource(
		state.degradedExecutionContext.value,
		buildRouteDegradedSource(decision, now),
	);
	state.degradedExecutionContext.value = next;
	return next;
}

export function recordLaneDegradedExecution(
	state: AppState,
	lane: SessionControlPlaneLaneState,
	now = Date.now(),
): SessionControlPlaneDegradedContext {
	const next = upsertDegradedExecutionSource(state.degradedExecutionContext.value, buildLaneDegradedSource(lane, now));
	state.degradedExecutionContext.value = next;
	return next;
}

export function recordSyncFailureExecution(state: AppState, now = Date.now()): SessionControlPlaneDegradedContext {
	const next = upsertDegradedExecutionSource(
		state.degradedExecutionContext.value,
		buildSyncFailureSource(state.chitraguptaSync.value, countPendingLocalTurns(state), now),
	);
	state.degradedExecutionContext.value = next;
	return next;
}

export function summarizeDegradedExecutionContext(state: AppState, now = Date.now()): DegradedExecutionSummary | null {
	const context = resolveDegradedExecutionContext(state, now);
	if (!context || context.sources.length === 0) return null;
	return buildDegradedExecutionSummary(context);
}

export function buildDegradedExecutionSummary(context: SessionControlPlaneDegradedContext): DegradedExecutionSummary {
	const routeSource = context.sources.find((source) => source.kind === "route_degraded") ?? null;
	const syncSource = context.sources.find((source) => source.kind === "sync_failure") ?? null;
	return {
		active: true,
		summary: formatDegradedExecutionSummary(routeSource, syncSource),
		since: context.firstDetectedAt,
		lastUpdatedAt: context.lastUpdatedAt,
		sourceKinds: context.sources.map((source) => source.kind),
		route: routeSource
			? {
					degraded: true,
					capability: routeSource.capability ?? null,
					reason: routeSource.reason,
					authority: routeSource.authority ?? null,
					fallbackChain: [...(routeSource.fallbackChain ?? [])],
				}
			: null,
		sync: syncSource
			? {
					failed: true,
					status: syncSource.status ?? "failed",
					reason: syncSource.reason,
					lastFailedMessageId: syncSource.lastFailedMessageId ?? null,
					pendingLocalTurns: syncSource.pendingLocalTurns ?? null,
				}
			: null,
	};
}

function resolveDegradedExecutionContext(state: AppState, now: number): SessionControlPlaneDegradedContext | null {
	let next = cloneDegradedExecutionContext(state.degradedExecutionContext.value);
	const routeSource = resolveLiveRouteDegradedSource(state, now);
	if (routeSource) {
		next = upsertDegradedExecutionSource(next, routeSource);
	}
	const syncSource = resolveLiveSyncFailureSource(state, now);
	if (syncSource) {
		next = upsertDegradedExecutionSource(next, syncSource);
	}
	return next;
}

function resolveLiveRouteDegradedSource(state: AppState, now: number): SessionControlPlaneDegradedSourceState | null {
	const decision = state.routingDecisions.value.at(-1);
	if (decision?.degraded === true) {
		return buildRouteDegradedSource(decision, now);
	}
	const lane = findRepresentativeDegradedLane(state.controlPlaneLanes.value);
	return lane ? buildLaneDegradedSource(lane, now) : null;
}

function resolveLiveSyncFailureSource(state: AppState, now: number): SessionControlPlaneDegradedSourceState | null {
	if (state.chitraguptaSync.value.status !== "failed") return null;
	return buildSyncFailureSource(state.chitraguptaSync.value, countPendingLocalTurns(state), now);
}

function countPendingLocalTurns(state: AppState): number {
	const sessionTurns = state.messages.value.filter((message) => message.sessionTurn === true);
	const lastSyncedMessageId = state.chitraguptaSync.value.lastSyncedMessageId;
	const lastSyncedIndex = lastSyncedMessageId
		? sessionTurns.findIndex((message) => message.id === lastSyncedMessageId)
		: -1;
	return lastSyncedIndex >= 0 ? sessionTurns.slice(lastSyncedIndex + 1).length : sessionTurns.length;
}

function formatDegradedExecutionSummary(
	routeSource: SessionControlPlaneDegradedSourceState | null,
	syncSource: SessionControlPlaneDegradedSourceState | null,
): string {
	if (routeSource && syncSource) {
		return "degraded execution: route degraded and replay failed";
	}
	if (routeSource) {
		return `degraded execution: ${routeSource.reason}`;
	}
	if (syncSource) {
		return `degraded execution: ${syncSource.reason}`;
	}
	return "degraded execution";
}

function mergeDistinct(existing: string[] | undefined, incoming: string[] | undefined): string[] | undefined {
	if (!existing && !incoming) return undefined;
	return Array.from(new Set([...(existing ?? []), ...(incoming ?? [])]));
}
