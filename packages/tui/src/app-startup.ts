import type { ChitraguptaHealth, DaemonBridgeBootstrapLane, RoutingDecision, VasanaTendency } from "@takumi/bridge";
import type { SessionControlPlaneDegradedContext, SessionControlPlaneLaneState } from "@takumi/core";
import { appendRoutingDecisions } from "./control-plane-state.js";
import {
	cloneDegradedExecutionContext,
	findRepresentativeDegradedLane,
	recordLaneDegradedExecution,
	recordRouteDegradedExecution,
} from "./degraded-execution-context.js";
import type { AppState } from "./state.js";

export interface StartupRouteSummary {
	capability: string;
	selectedCapabilityId?: string;
	preferredProvider?: string;
	preferredModel?: string;
	authority: "engine" | "takumi-fallback";
	degraded: boolean;
}

export interface StartupSummary {
	provider: string;
	model: string;
	source: string;
	providerCatalogAuthority?: "merge" | "strict";
	requestedModel?: {
		provider?: string;
		model: string;
		allow?: string[];
		prefer?: string[];
	};
	resolvedIntent?: string;
	resolvedVersion?: string;
	sideAgents?: string;
	localModels?: string[];
	availableProviderModels?: Record<string, string[]>;
	canonicalSessionId?: string;
	startupRoute?: StartupRouteSummary;
}

export interface StartupControlPlaneState {
	canonicalSessionId?: string;
	memoryContext?: string;
	tendencies?: VasanaTendency[];
	health?: ChitraguptaHealth | null;
	routingDecision?: RoutingDecision;
	startupLanes?: SessionControlPlaneLaneState[];
	degradedContext?: SessionControlPlaneDegradedContext;
}

/**
 * Seed the app's control-plane state from the bootstrap snapshot gathered
 * before the live Chitragupta bridge reconnects during `app.start()`.
 */
export function applyStartupControlPlaneState(state: AppState, input?: StartupControlPlaneState): void {
	if (!input) return;

	const seededAt = Date.now();
	if (input.canonicalSessionId) {
		state.canonicalSessionId.value = input.canonicalSessionId;
		state.chitraguptaSync.value = {
			...state.chitraguptaSync.value,
			status: "ready",
		};
	}
	if (input.memoryContext) {
		state.chitraguptaMemory.value = input.memoryContext;
	}
	if (input.tendencies && input.tendencies.length > 0) {
		state.vasanaTendencies.value = input.tendencies;
		state.vasanaLastRefresh.value = seededAt;
	}
	if (input.health) {
		state.chitraguptaHealth.value = input.health;
	}
	if (input.startupLanes && input.startupLanes.length > 0) {
		state.controlPlaneLanes.value = input.startupLanes;
	}
	if (input.degradedContext) {
		state.degradedExecutionContext.value = cloneDegradedExecutionContext(input.degradedContext);
	}
	if (input.routingDecision) {
		state.routingDecisions.value = appendRoutingDecisions([], [input.routingDecision]);
		if (input.routingDecision.degraded) {
			recordRouteDegradedExecution(state, input.routingDecision, seededAt);
		}
	}
	const degradedLane = findRepresentativeDegradedLane(input.startupLanes);
	if (degradedLane) {
		recordLaneDegradedExecution(state, degradedLane, seededAt);
	}
}

export function mapBootstrapLanesToSessionState(
	lanes: DaemonBridgeBootstrapLane[] | undefined,
	authoritySource: SessionControlPlaneLaneState["authoritySource"] = "bootstrap",
): SessionControlPlaneLaneState[] {
	if (!lanes || lanes.length === 0) return [];
	return lanes.map((lane) => ({
		key: lane.key,
		role: lane.role,
		laneId: lane.laneId,
		durableKey: lane.durableKey,
		snapshotAt: lane.snapshotAt,
		routeClass: lane.routingDecision?.routeClass ?? null,
		capability: lane.routingDecision?.capability ?? null,
		selectedCapabilityId: lane.routingDecision?.selectedCapabilityId ?? null,
		provider: lane.routingDecision?.provider ?? null,
		model: lane.routingDecision?.model ?? null,
		degraded: lane.routingDecision?.degraded ?? false,
		reason: lane.routingDecision?.reason ?? null,
		fallbackChain: lane.routingDecision?.fallbackChain ?? [],
		policyTrace: lane.routingDecision?.policyTrace ?? [],
		policy: { ...lane.policy },
		requestedPolicy: { ...lane.requestedPolicy },
		effectivePolicy: { ...lane.effectivePolicy },
		constraintsApplied: lane.constraintsApplied,
		policyHash: lane.policyHash,
		policyWarnings: [...lane.policyWarnings],
		authoritySource,
		verifiedAt: lane.snapshotAt,
	}));
}

export function formatStartupSummary(summary: StartupSummary): string {
	const localModels = summary.localModels ?? [];
	const localHint =
		localModels.length > 0 ? `Local models detected: ${localModels.join(", ")}` : "Local models detected: none";
	const routeLine = formatStartupRouteLine(summary.startupRoute);
	const requestedLine = formatRequestedModelLine(summary.requestedModel);
	const resolvedLine = formatResolvedModelLine(summary);
	const showResolvedSurface = Boolean(requestedLine || summary.resolvedIntent || summary.resolvedVersion);
	return [
		"Runtime ready",
		...(requestedLine ? [requestedLine] : []),
		...(showResolvedSurface ? [resolvedLine] : [`Provider: ${summary.provider}`, `Model: ${summary.model}`]),
		`Source: ${summary.source}`,
		...(summary.canonicalSessionId ? [`Canonical session: ${summary.canonicalSessionId}`] : []),
		...(routeLine ? [routeLine] : []),
		...(summary.sideAgents ? [summary.sideAgents] : []),
		localHint,
		"Hints: Enter submits • Ctrl+J adds newline • Alt+↑ recalls drafts • /provider <name> • /model <name> • /config • /init • /help",
	].join("\n");
}

function formatStartupRouteLine(route: StartupRouteSummary | undefined): string | null {
	if (!route) return null;

	const selected = route.selectedCapabilityId ?? "unresolved";
	const target = route.preferredProvider
		? `${route.preferredProvider}${route.preferredModel ? ` / ${route.preferredModel}` : ""}`
		: (route.preferredModel ?? "capability-only");
	const degraded = route.degraded ? ", degraded" : "";
	return `Startup route: ${route.capability} → ${selected} → ${target} (${route.authority}${degraded})`;
}

function formatRequestedModelLine(summary: StartupSummary["requestedModel"]): string | null {
	if (!summary) return null;
	const target = summary.provider ? `${summary.provider} / ${summary.model}` : summary.model;
	const policyParts: string[] = [];
	if (summary.allow && summary.allow.length > 0) {
		policyParts.push(`allow: ${summary.allow.join(", ")}`);
	}
	if (summary.prefer && summary.prefer.length > 0) {
		policyParts.push(`prefer: ${summary.prefer.join(", ")}`);
	}
	const suffix = policyParts.length > 0 ? ` (${policyParts.join("; ")})` : "";
	return `Requested: ${target}${suffix}`;
}

function formatResolvedModelLine(summary: StartupSummary): string {
	const details: string[] = [];
	if (summary.resolvedIntent) {
		details.push(`intent: ${summary.resolvedIntent}`);
	}
	if (summary.resolvedVersion) {
		details.push(`version: ${summary.resolvedVersion}`);
	}
	const suffix = details.length > 0 ? ` (${details.join("; ")})` : "";
	return `Resolved: ${summary.provider} / ${summary.model}${suffix}`;
}
