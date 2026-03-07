import {
	buildTakumiCapabilityHealth,
	type CapabilityDescriptor,
	type CapabilityHealthSnapshot,
	type RoutingDecision,
	TAKUMI_CAPABILITY,
} from "@takumi/bridge";

const MAX_ROUTING_DECISIONS = 12;

export function mergeControlPlaneCapabilities(capabilities: CapabilityDescriptor[]): CapabilityDescriptor[] {
	const map = new Map<string, CapabilityDescriptor>();
	for (const capability of capabilities) {
		map.set(capability.id, capability);
	}
	map.set(TAKUMI_CAPABILITY.id, {
		...TAKUMI_CAPABILITY,
		...(map.get(TAKUMI_CAPABILITY.id) ?? {}),
	});

	const takumi = map.get(TAKUMI_CAPABILITY.id)!;
	const rest = Array.from(map.values())
		.filter((capability) => capability.id !== TAKUMI_CAPABILITY.id)
		.sort((left, right) => left.id.localeCompare(right.id));
	return [takumi, ...rest];
}

export function appendRoutingDecisions(
	existing: RoutingDecision[],
	decisions: RoutingDecision[],
	limit = MAX_ROUTING_DECISIONS,
): RoutingDecision[] {
	if (decisions.length === 0) {
		return existing;
	}

	const merged = [...existing, ...decisions];
	return merged.slice(Math.max(merged.length - limit, 0));
}

export interface TakumiHealthSummaryInput {
	connected: boolean;
	anomalySeverity?: string | null;
	routingDecisions?: RoutingDecision[];
	now?: number;
}

export function summarizeTakumiCapabilityHealth(input: TakumiHealthSummaryInput): CapabilityHealthSnapshot {
	const now = input.now ?? Date.now();
	if (!input.connected) {
		return buildTakumiCapabilityHealth({
			state: "down",
			reason: "Chitragupta bridge disconnected",
			lastFailureAt: now,
		});
	}

	const latestDecision = [...(input.routingDecisions ?? [])]
		.reverse()
		.find((decision) => decision.selected?.id === TAKUMI_CAPABILITY.id);
	if (input.anomalySeverity === "critical") {
		return buildTakumiCapabilityHealth({
			state: "degraded",
			reason: "Critical anomaly reported by Chitragupta",
			lastFailureAt: now,
		});
	}
	if (latestDecision?.degraded) {
		return buildTakumiCapabilityHealth({
			state: "degraded",
			reason: `Engine selected a degraded lane for ${latestDecision.request.capability}`,
			lastFailureAt: now,
		});
	}

	return buildTakumiCapabilityHealth({
		state: "healthy",
		reason: latestDecision
			? `Latest route ${latestDecision.request.capability} resolved cleanly`
			: "Takumi executor healthy",
		lastSuccessAt: now,
	});
}

export function upsertCapabilityHealthSnapshot(
	existing: CapabilityHealthSnapshot[],
	snapshot: CapabilityHealthSnapshot,
): CapabilityHealthSnapshot[] {
	const rest = existing.filter((entry) => entry.capabilityId !== snapshot.capabilityId);
	return [snapshot, ...rest];
}

export function formatRoutingDecision(decision: RoutingDecision): string {
	const selected = decision.selected?.id ?? "none";
	const fallback = decision.fallbackChain.length > 0 ? decision.fallbackChain.join(", ") : "none";
	const trace = decision.policyTrace.length > 0 ? decision.policyTrace.join(" → ") : "none";
	return [
		`Capability: ${decision.request.capability}`,
		`Selected: ${selected}`,
		`Reason: ${decision.reason}`,
		`Fallback: ${fallback}`,
		`Trace: ${trace}`,
		`Degraded: ${decision.degraded ? "yes" : "no"}`,
	].join("\n");
}

export function formatCapabilityHealthSnapshot(snapshot: CapabilityHealthSnapshot): string {
	return [
		`${snapshot.capabilityId} — ${snapshot.state}`,
		`  errorRate=${(snapshot.errorRate * 100).toFixed(0)}%`,
		snapshot.reason ? `  reason=${snapshot.reason}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
