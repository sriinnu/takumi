/**
 * Shared control-plane types for Chitragupta-owned integrations.
 *
 * These types are intentionally consumer-safe: they let Takumi and other apps
 * ask for capabilities and evaluate hard constraints without becoming the
 * routing authority themselves.
 */

export type CapabilityKind = "llm" | "cli" | "embedding" | "tool" | "adapter" | "local-model";

export type TrustLevel = "local" | "sandboxed" | "cloud" | "privileged";

export type CapabilityHealthState = "healthy" | "degraded" | "down" | "unknown";

export type CostClass = "free" | "low" | "medium" | "high";

export type CredentialProvider = "keychain" | "os-store" | "env-ref" | "token-broker" | "none";

export type InvocationTransport = "http" | "stdio" | "local-process" | "mcp" | "inproc";

export interface CredentialRef {
	id: string;
	provider: CredentialProvider;
	lookupKey: string;
	scopes: string[];
	lastValidatedAt?: number;
}

export interface InvocationContract {
	id: string;
	transport: InvocationTransport;
	entrypoint: string;
	requestShape: string;
	responseShape: string;
	timeoutMs: number;
	streaming: boolean;
	requiresApproval?: boolean;
}

export interface CapabilityDescriptor {
	id: string;
	kind: CapabilityKind;
	label: string;
	capabilities: string[];
	costClass: CostClass;
	trust: TrustLevel;
	health: CapabilityHealthState;
	authRef?: CredentialRef;
	invocation: InvocationContract;
	tags: string[];
	priority?: number;
	providerFamily?: string;
	version?: string;
	metadata?: Record<string, unknown>;
}

export interface ConsumerConstraint {
	preferLocal?: boolean;
	allowCloud?: boolean;
	maxCostClass?: CostClass;
	requireStreaming?: boolean;
	requireApproval?: boolean;
	trustFloor?: TrustLevel;
	excludedCapabilityIds?: string[];
	preferredCapabilityIds?: string[];
	hardProviderFamily?: string;
	hardCapabilityId?: string;
}

export interface RoutingRequest {
	consumer: string;
	sessionId: string;
	capability: string;
	constraints?: ConsumerConstraint;
	context?: Record<string, unknown>;
}

export interface RoutingDecision {
	request: RoutingRequest;
	selected: CapabilityDescriptor | null;
	reason: string;
	fallbackChain: string[];
	policyTrace: string[];
	degraded: boolean;
}

export type ExecutionLaneAuthority = "engine" | "takumi-fallback";

export type ExecutionLaneEnforcement = "same-provider" | "capability-only";

/**
 * Durable executor-side lane envelope derived from an engine routing decision.
 *
 * Takumi may still need a local fallback model, but that fallback is recorded as
 * part of the envelope rather than replacing the control-plane decision.
 */
export interface ExecutionLaneEnvelope {
	consumer: string;
	sessionId: string;
	role: string;
	capability: string;
	authority: ExecutionLaneAuthority;
	enforcement: ExecutionLaneEnforcement;
	selectedCapabilityId?: string;
	selectedProviderFamily?: string;
	selectedModel?: string;
	fallbackModel: string;
	appliedModel: string;
	degraded: boolean;
	reason: string;
	fallbackChain: string[];
	policyTrace: string[];
}

export interface CapabilityQuery {
	capability?: string;
	kinds?: CapabilityKind[];
	includeDegraded?: boolean;
	includeDown?: boolean;
	tags?: string[];
	limit?: number;
}

export interface CapabilityQueryResult {
	capabilities: CapabilityDescriptor[];
}

export interface CapabilityHealthSnapshot {
	capabilityId: string;
	state: CapabilityHealthState;
	errorRate: number;
	p50LatencyMs?: number;
	p95LatencyMs?: number;
	throttleRate?: number;
	authFailures?: number;
	lastSuccessAt?: number;
	lastFailureAt?: number;
	reason?: string;
}

export interface CredentialAccessEvent {
	sessionId: string;
	consumer: string;
	authRefId: string;
	purpose: string;
	outcome: "granted" | "denied" | "expired" | "invalid";
	timestamp: number;
}

export const LOCAL_FIRST_TIERS = {
	DETERMINISTIC: 0,
	LOCAL_SYSTEMS: 1,
	LOCAL_MODELS: 2,
	CLOUD: 3,
	DEGRADED: 4,
} as const;

const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

const COST_ORDER: Record<CostClass, number> = {
	free: 0,
	low: 1,
	medium: 2,
	high: 3,
};

const TRUST_ORDER: Record<TrustLevel, number> = {
	local: 0,
	sandboxed: 1,
	cloud: 2,
	privileged: 3,
};

export function isCapabilityName(value: string): boolean {
	return CAPABILITY_NAME_PATTERN.test(value);
}

export function getCapabilityTier(capability: CapabilityDescriptor): number {
	if (capability.health === "down") {
		return LOCAL_FIRST_TIERS.DEGRADED;
	}
	if (capability.kind === "local-model") {
		return LOCAL_FIRST_TIERS.LOCAL_MODELS;
	}
	if (capability.trust === "cloud") {
		return LOCAL_FIRST_TIERS.CLOUD;
	}
	if (capability.kind === "cli" || capability.kind === "tool" || capability.kind === "adapter") {
		return LOCAL_FIRST_TIERS.LOCAL_SYSTEMS;
	}
	return LOCAL_FIRST_TIERS.DETERMINISTIC;
}

export function capabilitySupports(
	capability: CapabilityDescriptor,
	request: Pick<RoutingRequest, "capability" | "constraints">,
): boolean {
	if (!capability.capabilities.includes(request.capability)) {
		return false;
	}

	const constraints = request.constraints;
	if (!constraints) {
		return capability.health !== "down";
	}

	if (capability.health === "down") {
		return false;
	}
	if (constraints.hardCapabilityId && capability.id !== constraints.hardCapabilityId) {
		return false;
	}
	if (constraints.hardProviderFamily && capability.providerFamily !== constraints.hardProviderFamily) {
		return false;
	}
	if (constraints.excludedCapabilityIds?.includes(capability.id)) {
		return false;
	}
	if (constraints.allowCloud === false && capability.trust === "cloud") {
		return false;
	}
	if (constraints.requireStreaming && !capability.invocation.streaming) {
		return false;
	}
	if (constraints.requireApproval && !capability.invocation.requiresApproval) {
		return false;
	}
	if (constraints.maxCostClass && COST_ORDER[capability.costClass] > COST_ORDER[constraints.maxCostClass]) {
		return false;
	}
	if (constraints.trustFloor && TRUST_ORDER[capability.trust] < TRUST_ORDER[constraints.trustFloor]) {
		return false;
	}

	return true;
}

export function compareCapabilities(
	left: CapabilityDescriptor,
	right: CapabilityDescriptor,
	constraints?: ConsumerConstraint,
): number {
	const leftPreferred = constraints?.preferredCapabilityIds?.includes(left.id) ? 1 : 0;
	const rightPreferred = constraints?.preferredCapabilityIds?.includes(right.id) ? 1 : 0;
	if (leftPreferred !== rightPreferred) {
		return rightPreferred - leftPreferred;
	}

	if (constraints?.preferLocal) {
		const tierDelta = getCapabilityTier(left) - getCapabilityTier(right);
		if (tierDelta !== 0) {
			return tierDelta;
		}
	}

	const healthDelta = healthWeight(right.health) - healthWeight(left.health);
	if (healthDelta !== 0) {
		return healthDelta;
	}

	const costDelta = COST_ORDER[left.costClass] - COST_ORDER[right.costClass];
	if (costDelta !== 0) {
		return costDelta;
	}

	const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
	if (priorityDelta !== 0) {
		return priorityDelta;
	}

	return left.id.localeCompare(right.id);
}

export function filterCapabilities(
	capabilities: CapabilityDescriptor[],
	query: CapabilityQuery = {},
): CapabilityDescriptor[] {
	return capabilities
		.filter((capability) => {
			if (query.capability && !capability.capabilities.includes(query.capability)) {
				return false;
			}
			if (query.kinds && !query.kinds.includes(capability.kind)) {
				return false;
			}
			if (!query.includeDegraded && capability.health === "degraded") {
				return false;
			}
			if (!query.includeDown && capability.health === "down") {
				return false;
			}
			if (query.tags && !query.tags.every((tag) => capability.tags.includes(tag))) {
				return false;
			}
			return true;
		})
		.sort((left, right) => compareCapabilities(left, right))
		.slice(0, query.limit ?? Number.MAX_SAFE_INTEGER);
}

export function chooseCapability(capabilities: CapabilityDescriptor[], request: RoutingRequest): RoutingDecision {
	const supported = capabilities
		.filter((capability) => capabilitySupports(capability, request))
		.sort((left, right) => compareCapabilities(left, right, request.constraints));

	const selected = supported[0] ?? null;
	return {
		request,
		selected,
		reason: selected
			? `Selected ${selected.id} for capability ${request.capability}`
			: `No capability satisfied ${request.capability}`,
		fallbackChain: supported.slice(1).map((capability) => capability.id),
		policyTrace: buildPolicyTrace(request, selected),
		degraded: selected?.health === "degraded",
	};
}

function healthWeight(state: CapabilityHealthState): number {
	switch (state) {
		case "healthy":
			return 3;
		case "degraded":
			return 2;
		case "unknown":
			return 1;
		case "down":
			return 0;
	}
}

function buildPolicyTrace(request: RoutingRequest, selected: CapabilityDescriptor | null): string[] {
	const trace = [`requested:${request.capability}`];
	if (request.constraints?.preferLocal) {
		trace.push("constraint:preferLocal");
	}
	if (request.constraints?.allowCloud === false) {
		trace.push("constraint:noCloud");
	}
	if (request.constraints?.hardCapabilityId) {
		trace.push(`constraint:hardCapability:${request.constraints.hardCapabilityId}`);
	}
	if (selected) {
		trace.push(`selected:${selected.id}`);
		trace.push(`selectedHealth:${selected.health}`);
	}
	return trace;
}
