/**
 * I am generated from `chitragupta/packages/core/src/contract-sdk-schema.ts`.
 * I mirror Chitragupta's daemon bootstrap contract for Takumi's local bridge package.
 * Run `pnpm tsx scripts/generate-contract-sdk.ts --mirror-takumi` from the Chitragupta repo instead of editing me by hand.
 */

/** I enumerate the daemon-owned bootstrap modes clients may request. */
export const BRIDGE_BOOTSTRAP_MODES = ["interactive", "exec", "doctor", "remote_attach"] as const;
export type BridgeBootstrapMode = (typeof BRIDGE_BOOTSTRAP_MODES)[number];

/** I enumerate the supported startup budget classes. */
export const BRIDGE_BOOTSTRAP_POLICY_BUDGETS = ["free", "low", "medium", "high"] as const;
export type BootstrapPolicyBudgetClass = (typeof BRIDGE_BOOTSTRAP_POLICY_BUDGETS)[number];

/** I enumerate the daemon-owned tool-access policy values. */
export const BRIDGE_BOOTSTRAP_POLICY_TOOL_ACCESS = ["inherit", "allow", "deny"] as const;
export type BootstrapLaneToolAccess = (typeof BRIDGE_BOOTSTRAP_POLICY_TOOL_ACCESS)[number];

/** I enumerate the daemon-owned privacy-boundary policy values. */
export const BRIDGE_BOOTSTRAP_POLICY_PRIVACY = ["inherit", "local-preferred", "cloud-ok", "strict-local"] as const;
export type BootstrapLanePrivacyBoundary = (typeof BRIDGE_BOOTSTRAP_POLICY_PRIVACY)[number];

/** I enumerate the daemon-owned fallback strategies for startup lanes. */
export const BRIDGE_BOOTSTRAP_POLICY_FALLBACK = ["same-provider", "capability-only", "none"] as const;
export type BootstrapLaneFallbackStrategy = (typeof BRIDGE_BOOTSTRAP_POLICY_FALLBACK)[number];

/** I keep applied bootstrap constraints machine-readable without over-fitting their shape. */
export type DaemonBridgeBootstrapLaneConstraints = Record<string, unknown>;

/** I describe the shared Chitragupta daemon bridge protocol envelope. */
export interface DaemonBridgeProtocolDescriptor {
	/** I keep the stable bridge protocol name. */
	name: "chitragupta-daemon-bridge";
	/** I record the current bridge protocol version. */
	version: number;
	/** I record the oldest compatible bridge version. */
	minCompatibleVersion: number;
	/** I record the newest compatible bridge version. */
	maxCompatibleVersion: number;
}

/** I carry one machine-readable startup-lane policy snapshot. */
export interface DaemonBridgeBootstrapLanePolicy {
	/** I version the lane-policy schema. */
	contractVersion: 1;
	/** I label the startup lane role. */
	role: string;
	/** I record whether the lane prefers local execution. */
	preferLocal: boolean | null;
	/** I record whether the lane may cross the cloud boundary. */
	allowCloud: boolean | null;
	/** I record the lane's maximum budget class. */
	maxCostClass: BootstrapPolicyBudgetClass | null;
	/** I record whether the lane requires streaming. */
	requireStreaming: boolean | null;
	/** I record the hard provider family when one is pinned. */
	hardProviderFamily: string | null;
	/** I record the preferred provider families in priority order. */
	preferredProviderFamilies: string[];
	/** I record the lane's tool-access policy. */
	toolAccess: BootstrapLaneToolAccess;
	/** I record the lane's privacy boundary. */
	privacyBoundary: BootstrapLanePrivacyBoundary;
	/** I record the lane's fallback strategy. */
	fallbackStrategy: BootstrapLaneFallbackStrategy;
	/** I record free-form lane tags. */
	tags: string[];
}

/** I capture the authenticated daemon principal snapshot returned at bootstrap time. */
export interface DaemonBridgeBootstrapAuth {
	/** I record whether the bootstrap caller is authenticated. */
	authenticated: boolean;
	/** I record the authenticated key id when one is bound. */
	keyId: string | null;
	/** I record the authenticated tenant id when one is bound. */
	tenantId: string | null;
	/** I record the granted auth scopes. */
	scopes: string[];
}

/** I capture the daemon-owned runtime binding returned by bootstrap. */
export interface DaemonBridgeBootstrapBinding {
	/** I record the bound bootstrap mode. */
	mode: BridgeBootstrapMode;
	/** I record the bound project path when one exists. */
	project: string | null;
	/** I record the bound consumer id when one exists. */
	consumer: string | null;
	/** I record the bound daemon client id when one exists. */
	clientId: string | null;
}

/** I capture the canonical session summary returned by bootstrap. */
export interface DaemonBridgeBootstrapSession {
	/** I record the canonical session id when one exists. */
	id: string | null;
	/** I record whether bootstrap created the session. */
	created: boolean | null;
	/** I record the canonical session lineage key. */
	lineageKey: string | null;
	/** I record the daemon-owned session reuse policy. */
	sessionReusePolicy: string | null;
}

/** I capture the daemon-owned routing decision attached to bootstrap and lane snapshots. */
export interface DaemonBridgeBootstrapRoutingDecision {
	/** I record the authority that made the routing decision. */
	authority: "chitragupta";
	/** I record the route-decision source. */
	source: string | null;
	/** I record the resolved route class. */
	routeClass: string | null;
	/** I record the resolved capability. */
	capability: string | null;
	/** I record the selected capability id. */
	selectedCapabilityId: string | null;
	/** I record the resolved provider id. */
	provider: string | null;
	/** I record the resolved model id. */
	model: string | null;
	/** I record the requested budget class. */
	requestedBudget: string | null;
	/** I record the effective budget class. */
	effectiveBudget: string | null;
	/** I record whether the routing decision is degraded. */
	degraded: boolean;
	/** I record the machine-readable route reason code. */
	reasonCode: string;
	/** I record the human-readable route reason. */
	reason: string | null;
	/** I record the applied policy trace. */
	policyTrace: string[];
	/** I record the evaluated fallback chain. */
	fallbackChain: string[];
	/** I record whether the result is discoverable-only. */
	discoverableOnly: boolean;
	/** I record the authoritative request id. */
	requestId: string | null;
	/** I record the authoritative trace id. */
	traceId: string | null;
	/** I record when the route snapshot was captured. */
	snapshotAt: number;
	/** I record the route snapshot expiry when one exists. */
	expiresAt: unknown | null;
	/** I record the cache scope for the route snapshot. */
	cacheScope: "request";
}

/** I capture one durable startup lane returned by bootstrap or lane refresh. */
export interface DaemonBridgeBootstrapLane {
	/** I record the daemon-owned lane key. */
	key: string;
	/** I record the daemon-owned lane role. */
	role: string;
	/** I record the daemon-owned lane id. */
	laneId: string;
	/** I record the durable lane key. */
	durableKey: string;
	/** I record when the lane snapshot was captured. */
	snapshotAt: number;
	/** I keep the effective lane policy for compatibility callers. */
	policy: DaemonBridgeBootstrapLanePolicy;
	/** I record the caller-requested lane policy. */
	requestedPolicy: DaemonBridgeBootstrapLanePolicy;
	/** I record the daemon-effective lane policy. */
	effectivePolicy: DaemonBridgeBootstrapLanePolicy;
	/** I record the machine-readable constraints the daemon applied. */
	constraintsApplied: DaemonBridgeBootstrapLaneConstraints | null;
	/** I record the stable lane-policy hash when one exists. */
	policyHash: string | null;
	/** I record daemon-issued lane-policy warnings. */
	policyWarnings: string[];
	/** I carry the daemon-owned route envelope. */
	route: Record<string, unknown> | null;
	/** I carry the daemon-owned lane routing decision when one exists. */
	routingDecision: DaemonBridgeBootstrapRoutingDecision | null;
}

export type {
	BridgeBootstrapVerticalResolutionSource,
	DaemonBridgeBootstrapContinuity,
	DaemonBridgeBootstrapVertical,
	VerticalProfileAuthMode,
	VerticalProfilePreferredTransport,
	VerticalRuntimeContinuityRecord,
	VerticalRuntimeContinuityRequiredAction,
	VerticalRuntimeContinuitySource,
	VerticalRuntimeContinuityState,
	VerticalRuntimeContinuityStatus,
	VerticalRuntimeRecoveryAction,
	VerticalRuntimeRecoveryPlan,
} from "./chitragupta-bootstrap-vertical-runtime-types.js";
export {
	BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES,
	VERTICAL_PROFILE_AUTH_MODES,
	VERTICAL_PROFILE_PREFERRED_TRANSPORTS,
	VERTICAL_RUNTIME_CONTINUITY_REQUIRED_ACTIONS,
	VERTICAL_RUNTIME_CONTINUITY_SOURCES,
	VERTICAL_RUNTIME_CONTINUITY_STATES,
	VERTICAL_RUNTIME_CONTINUITY_STATUSES,
	VERTICAL_RUNTIME_RECOVERY_ACTIONS,
} from "./chitragupta-bootstrap-vertical-runtime-types.js";

import type {
	DaemonBridgeBootstrapContinuity,
	DaemonBridgeBootstrapVertical,
} from "./chitragupta-bootstrap-vertical-runtime-types.js";

/** I capture the route request a vertical sends into daemon bootstrap. */
export interface BridgeBootstrapRouteRequest {
	/** I request a specific capability when one is known. */
	capability?: string;
	/** I request a specific route class when one is known. */
	routeClass?: string;
	/** I bind the request to a specific consumer id. */
	consumer?: string;
	/** I pass route constraints without over-fitting their shape. */
	constraints?: Record<string, unknown>;
	/** I pass route context without over-fitting its shape. */
	context?: Record<string, unknown>;
	/** I allow callers to supply a partial lane policy request. */
	policy?: Record<string, unknown>;
}

/** I capture one named startup lane request a vertical sends into daemon bootstrap. */
export interface BridgeBootstrapLaneRequest {
	/** I record the requested lane key. */
	key: string;
	/** I record the requested lane role when one is provided. */
	role?: string;
	/** I request a specific capability when one is known. */
	capability?: string;
	/** I request a specific route class when one is known. */
	routeClass?: string;
	/** I bind the lane request to a specific consumer id. */
	consumer?: string;
	/** I pass route constraints without over-fitting their shape. */
	constraints?: Record<string, unknown>;
	/** I pass route context without over-fitting its shape. */
	context?: Record<string, unknown>;
	/** I allow callers to supply a partial lane policy request. */
	policy?: Record<string, unknown>;
}

/** I capture the canonical session request a client sends into daemon bootstrap. */
export interface BridgeBootstrapSessionRequest {
	/** I record the requested project path. */
	project: string;
	/** I record the requested session title. */
	title: string;
	/** I record the requested agent id. */
	agent: string;
	/** I record the requested model id when one is supplied. */
	model?: string;
	/** I record the requested provider id when one is supplied. */
	provider?: string;
	/** I record the requested branch when one is supplied. */
	branch?: string;
	/** I record the requested consumer id when one is supplied. */
	consumer?: string;
}

/** I capture raw execution identity hints forwarded to daemon bootstrap. */
export interface BridgeBootstrapExecutionInput {
	/** I carry raw task identity hints. */
	task?: Record<string, unknown>;
	/** I carry raw lane identity hints. */
	lane?: Record<string, unknown>;
}

/** I capture the canonical bootstrap request Takumi sends to Chitragupta. */
export interface BridgeBootstrapRequest {
	/** I record the requested bootstrap mode. */
	mode: BridgeBootstrapMode;
	/** I record the requested project path. */
	project: string;
	/** I record the requested consumer id. */
	consumer: string;
	/** I request capability metadata when the caller needs it. */
	includeCapabilities?: boolean;
	/** I carry a canonical session request when one is supplied. */
	session?: BridgeBootstrapSessionRequest;
	/** I carry one primary startup route request when one is supplied. */
	route?: BridgeBootstrapRouteRequest;
	/** I carry requested startup lanes when they are supplied. */
	lanes?: BridgeBootstrapLaneRequest[];
}

/** I capture the broader bootstrap params surface Chitragupta attachments send to the daemon. */
export interface BridgeBootstrapParams {
	/** I record the requested bootstrap mode. */
	mode: BridgeBootstrapMode;
	/** I record the requested project path when one is supplied. */
	project?: string;
	/** I record the requested consumer id when one is supplied. */
	consumer?: string;
	/** I request capability metadata when the caller needs it. */
	includeCapabilities?: boolean;
	/** I carry raw session metadata when one is supplied. */
	session?: Record<string, unknown>;
	/** I carry raw route metadata when one is supplied. */
	route?: Record<string, unknown>;
	/** I carry raw lane metadata when it is supplied. */
	lanes?: Record<string, unknown>[];
	/** I carry raw execution identity hints when they are supplied. */
	execution?: BridgeBootstrapExecutionInput;
	/** I carry an explicit daemon task id when one is supplied. */
	taskId?: string;
	/** I carry an explicit daemon lane id when one is supplied. */
	laneId?: string;
	/** I carry an explicit trace id when one is supplied. */
	traceId?: string;
}

/** I capture the canonical daemon bootstrap response consumed by TypeScript clients. */
export interface DaemonBridgeBootstrapResult {
	/** I record the bootstrap contract version. */
	contractVersion: number;
	/** I carry the shared bridge protocol descriptor. */
	protocol: DaemonBridgeProtocolDescriptor;
	/** I record whether the daemon transport is connected. */
	connected: boolean;
	/** I record whether the bootstrap result is degraded. */
	degraded: boolean;
	/** I record the authoritative bootstrap transport. */
	transport: string;
	/** I record the authority that produced the result. */
	authority: string;
	/** I record the authoritative request id. */
	requestId: string | null;
	/** I record the authoritative trace id. */
	traceId: string | null;
	/** I record the authoritative daemon task id. */
	taskId: string | null;
	/** I record the authoritative daemon lane id. */
	laneId: string | null;
	/** I record daemon-issued bootstrap warnings. */
	warnings: string[];
	/** I carry the daemon-owned auth snapshot. */
	auth: DaemonBridgeBootstrapAuth;
	/** I carry the daemon-owned binding snapshot. */
	binding: DaemonBridgeBootstrapBinding;
	/** I carry the daemon-owned session snapshot when one exists. */
	session: DaemonBridgeBootstrapSession | null;
	/** I carry the daemon-owned vertical attachment identity block. */
	vertical: DaemonBridgeBootstrapVertical;
	/** I carry the daemon-owned continuity snapshot when one exists. */
	continuity: DaemonBridgeBootstrapContinuity | null;
	/** I carry the daemon-owned route envelope. */
	route: Record<string, unknown> | null;
	/** I carry the daemon-owned routing decision when one exists. */
	routingDecision: DaemonBridgeBootstrapRoutingDecision | null;
	/** I carry the daemon-owned startup lanes. */
	lanes: DaemonBridgeBootstrapLane[];
	/** I carry capability metadata when the caller requested it. */
	capabilities?: unknown;
}

/** I capture the request for one authoritative daemon lane snapshot. */
export interface DaemonBridgeLaneSnapshotRequest {
	/** I record the canonical session id. */
	sessionId: string;
	/** I record the project path when one is supplied. */
	project?: string;
}

/** I capture the request for one refreshed authoritative daemon lane snapshot. */
export interface DaemonBridgeLaneRefreshRequest {
	/** I record the canonical session id. */
	sessionId: string;
	/** I record the project path when one is supplied. */
	project?: string;
	/** I record the consumer id when one is supplied. */
	consumer?: string;
	/** I record the caller-supplied refresh reason when one is supplied. */
	refreshReason?: string;
}

/** I capture the authoritative durable daemon lane snapshot. */
export interface DaemonBridgeLaneSnapshotResult {
	/** I record the lane snapshot contract version. */
	contractVersion: number;
	/** I record the canonical session id when one exists. */
	sessionId: string | null;
	/** I record the canonical project path when one exists. */
	project: string | null;
	/** I record the daemon-owned primary lane key when one exists. */
	primaryLaneKey: string | null;
	/** I record the number of durable lanes in the snapshot. */
	laneCount: number;
	/** I carry the durable lanes in snapshot order. */
	lanes: DaemonBridgeBootstrapLane[];
}

/** I capture one decrypted provider-credential resolution result. */
export interface ProviderCredentialResolution {
	/** I record whether the credential lookup found a value. */
	found: boolean;
	/** I record the requested provider id. */
	providerId: string;
	/** I record the daemon-bound provider id when one exists. */
	boundProviderId: string | null;
	/** I record the resolved model id when one exists. */
	modelId: string | null;
	/** I record the resolved route class when one exists. */
	routeClass: string | null;
	/** I record the selected capability id when one exists. */
	selectedCapabilityId: string | null;
	/** I record the bound consumer id when one exists. */
	consumer: string | null;
	/** I record the decrypted credential value when one exists. */
	value: string | null;
	/** I record whether the credential value should be re-keyed. */
	needsRekey: boolean;
}
