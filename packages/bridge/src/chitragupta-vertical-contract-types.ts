/**
 * I am generated from `chitragupta/packages/core/src/contract-sdk-schema.ts`.
 * I mirror Chitragupta's machine-readable vertical registry contract for Takumi and sibling vertical runtimes.
 * Run `pnpm tsx scripts/generate-contract-sdk.ts --mirror-takumi` from the Chitragupta repo instead of editing me by hand.
 */

/** I enumerate the daemon-owned durable continuity row statuses. */
export const VERTICAL_RUNTIME_CONTINUITY_STATUSES = ["active", "detached"] as const;
export type VerticalRuntimeContinuityStatus = (typeof VERTICAL_RUNTIME_CONTINUITY_STATUSES)[number];

/** I enumerate the daemon-owned continuity states surfaced to operators and verticals. */
export const VERTICAL_RUNTIME_CONTINUITY_STATES = ["tracked", "reattachable"] as const;
export type VerticalRuntimeContinuityState = (typeof VERTICAL_RUNTIME_CONTINUITY_STATES)[number];

/** I enumerate the next correct action for one vertical continuity record. */
export const VERTICAL_RUNTIME_CONTINUITY_REQUIRED_ACTIONS = [
	"none",
	"reattach-via-bridge.bootstrap",
	"handover-required",
] as const;
export type VerticalRuntimeContinuityRequiredAction = (typeof VERTICAL_RUNTIME_CONTINUITY_REQUIRED_ACTIONS)[number];

/** I enumerate the daemon-owned source behind one continuity record. */
export const VERTICAL_RUNTIME_CONTINUITY_SOURCES = ["durable-record"] as const;
export type VerticalRuntimeContinuitySource = (typeof VERTICAL_RUNTIME_CONTINUITY_SOURCES)[number];

/** I enumerate the daemon-issued next steps for a reconnecting vertical runtime. */
export const VERTICAL_RUNTIME_RECOVERY_ACTIONS = [
	"continue-live",
	"resubscribe-live",
	"reattach-via-bridge.bootstrap",
	"bootstrap-new-runtime",
	"handover-required",
] as const;
export type VerticalRuntimeRecoveryAction = (typeof VERTICAL_RUNTIME_RECOVERY_ACTIONS)[number];

/** I capture one durable daemon-owned continuity row for a vertical attachment. */
export interface VerticalRuntimeContinuityRecord {
	/** I version the continuity record block. */
	contractVersion: 1;
	/** I record the durable daemon identity key when one is visible. */
	identityKey: string | null;
	/** I record the canonical vertical id. */
	verticalId: string;
	/** I record the bound consumer when one exists. */
	consumer: string | null;
	/** I record the bound surface. */
	surface: string;
	/** I record the bound channel when one exists. */
	channel: string | null;
	/** I record the bound project path when one is visible. */
	project: string | null;
	/** I record the canonical session id when one is visible. */
	sessionId: string | null;
	/** I record the daemon-owned session reuse policy when one exists. */
	sessionReusePolicy: string | null;
	/** I record the bound client key when one is visible. */
	clientKey: string | null;
	/** I record the bound session lineage key when one is visible. */
	sessionLineageKey: string | null;
	/** I record the currently attached daemon client id when one is visible. */
	attachedClientId: string | null;
	/** I record the auth family attached to the continuity row when one exists. */
	authFamily: string | null;
	/** I record the durable row status. */
	status: VerticalRuntimeContinuityStatus;
	/** I record the daemon-owned continuity state for the row. */
	state: VerticalRuntimeContinuityState;
	/** I record the next correct action for the row. */
	requiredAction: VerticalRuntimeContinuityRequiredAction;
	/** I record the daemon-owned source behind the row. */
	source: VerticalRuntimeContinuitySource;
	/** I record when the daemon last saw the row alive. */
	lastSeenAt: number | null;
	/** I record when the daemon last detached the row. */
	lastDetachedAt: number | null;
	/** I record when the daemon last updated the row. */
	updatedAt: number;
}

/** I enumerate the preferred runtime transports one vertical profile may advertise. */
export const VERTICAL_PROFILE_PREFERRED_TRANSPORTS = ["daemon-rpc", "http-attachment", "mcp"] as const;
export type VerticalProfilePreferredTransport = (typeof VERTICAL_PROFILE_PREFERRED_TRANSPORTS)[number];

/** I enumerate the daemon-owned auth modes one vertical profile may advertise. */
export const VERTICAL_PROFILE_AUTH_MODES = [
	"daemon-bridge-token",
	"serve-pairing-jwt",
	"daemon-bridge-token-or-serve-pairing-jwt",
] as const;
export type VerticalProfileAuthMode = (typeof VERTICAL_PROFILE_AUTH_MODES)[number];

/** I describe one machine-readable vertical capability bundle. */
export interface VerticalRegistryBundle {
	/** I record the stable bundle id. */
	id: string;
	/** I record the display label for the bundle. */
	label: string;
	/** I record the bundle description. */
	description: string;
	/** I record the RPC methods in the bundle. */
	methods: string[];
	/** I record the route classes attached to the bundle when one exists. */
	routeClasses?: string[];
	/** I record HTTP attachment surfaces exposed by the bundle when one exists. */
	httpAttachments?: string[];
}

/** I describe the daemon bearer-token presentation contract for vertical runtimes. */
export interface VerticalRegistryDaemonBearerContract {
	/** I record how the daemon bearer token is presented. */
	presentation: string;
	/** I record where the daemon bearer token is stored. */
	tokenSource: string;
	/** I record whether the token is hashed at rest. */
	hashedAtRest: boolean;
	/** I record whether the raw token still exists on disk for operator use. */
	rawTokenOnDisk: boolean;
}

/** I describe the QR/JWT pairing contract exposed by serve attachment surfaces. */
export interface VerticalRegistryServePairingContract {
	/** I record that this pairing contract only applies to serve surfaces. */
	serveOnly: boolean;
	/** I record the supported pairing methods. */
	methods: string[];
	/** I record the serve-issued session token kind. */
	sessionToken: string;
	/** I record whether serve pairing is disallowed for daemon runtime startup. */
	notForDaemonRuntimeStartup: boolean;
}

/** I describe the hashed-at-rest verifier and binding token contract for vertical runtimes. */
export interface VerticalRegistryTokenContract {
	/** I record the verifier tenant prefix. */
	verifierTenantPrefix: string;
	/** I record the binding tenant prefix. */
	bindingTenantPrefix: string;
	/** I record the verifier issuance method. */
	issueMethod: string;
	/** I record the binding exchange method. */
	exchangeMethod: string;
	/** I record the verifier rotation method. */
	rotateMethod: string;
	/** I record the token listing method. */
	listMethod: string;
	/** I record the token introspection method. */
	introspectMethod: string;
	/** I record the token revocation method. */
	revokeMethod: string;
	/** I record whether the tokens are hashed at rest. */
	hashedAtRest: boolean;
	/** I record whether verifier rotation is supported. */
	supportsRotation: boolean;
	/** I record whether token revocation is supported. */
	supportsRevocation: boolean;
	/** I record whether token introspection is supported. */
	supportsIntrospection: boolean;
	/** I record the default binding-token ttl in milliseconds. */
	defaultBindingTtlMs: number;
}

/** I capture the machine-readable cross-vertical auth contract block. */
export interface VerticalRegistryAuthContract {
	/** I version the auth contract block. */
	contractVersion: 1;
	/** I carry the daemon bearer-token contract. */
	daemonBearer: VerticalRegistryDaemonBearerContract;
	/** I carry the serve pairing contract. */
	servePairing: VerticalRegistryServePairingContract;
	/** I carry the verifier and binding token contract. */
	verticalTokens: VerticalRegistryTokenContract;
}

/** I describe one daemon-owned vertical profile guidance block. */
export interface VerticalRegistryProfile {
	/** I record the stable vertical id. */
	id: string;
	/** I record the display label for the vertical. */
	label: string;
	/** I record the vertical description. */
	description: string;
	/** I record the preferred runtime transport. */
	preferredTransport: VerticalProfilePreferredTransport;
	/** I record the preferred daemon-owned auth mode. */
	authMode: VerticalProfileAuthMode;
	/** I record the bundle ids exposed to the vertical. */
	bundleIds: string[];
}

/** I describe the bootstrap and identify calls one vertical uses to bind to the daemon. */
export interface VerticalRegistryBindContract {
	/** I record the bootstrap method used for binding. */
	bootstrapMethod: string;
	/** I record the canonical runtime attachment method. */
	attachMethod: string;
	/** I record the identity method used after binding. */
	identifyMethod: string;
	/** I record the daemon-owned metadata keys used for reuse and reattach. */
	sessionReuseMetadata: string[];
}

/** I describe the replay token and turn-cursor contract for missed-event recovery. */
export interface VerticalRegistryReplayContract {
	/** I record the replay strategy identifier. */
	strategy: string;
	/** I record the replay token field. */
	tokenField: string;
	/** I record the endpoint that publishes replay tokens. */
	tokenSourceEndpoint: string;
	/** I record the watch endpoint used for streaming recovery. */
	watchEndpoint: string;
	/** I record the timeline endpoint used for gap inspection. */
	timelineEndpoint: string;
	/** I record the session continuity method used during recovery. */
	continuityMethod: string;
	/** I record the turn backfill method. */
	turnCursorMethod: string;
	/** I record the cursor field inside the backfill response. */
	turnCursorField: string;
}

/** I describe how a consumer stops an active subscription. */
export interface VerticalRegistryUnsubscribeContract {
	/** I record how daemon RPC subscriptions are unsubscribed. */
	daemonRpc: string;
	/** I record how HTTP watch subscriptions are unsubscribed. */
	httpWatch: string;
}

/** I describe the pull-style endpoints used when live subscriptions are unavailable. */
export interface VerticalRegistryPullFallbackContract {
	/** I record the HTTP watch endpoint. */
	httpWatch: string;
	/** I record the HTTP timeline endpoint. */
	httpTimeline: string;
	/** I record the HTTP instances endpoint. */
	httpInstances: string;
}

/** I describe the ordered missed-event recovery steps for one vertical attachment. */
export interface VerticalRegistryMissedEventRecoveryContract {
	/** I record the ordered recovery steps. */
	steps: string[];
}

/** I describe how one vertical reattaches to daemon-owned state. */
export interface VerticalRegistryReattachContract {
	/** I record whether reattach resumes through bridge.bootstrap. */
	resumeViaBootstrap: boolean;
	/** I record the identity fields that must always be supplied before reattach lookup is authoritative. */
	requiredIdentityFields: string[];
	/** I record the identity fields where at least one must be supplied for reattach lookup. */
	alternativeIdentityFieldsAnyOf: string[];
	/** I record the daemon RPC method used to inspect durable continuity before reattach. */
	lookupMethod: string;
	/** I record whether the lookup response already carries the current daemon-issued recovery plan. */
	lookupIncludesRecoveryPlan: boolean;
}

/** I capture the daemon-issued reconnect and replay plan for one vertical runtime identity. */
export interface VerticalRuntimeRecoveryPlan {
	/** I version the recovery-plan block. */
	contractVersion: 1;
	/** I record the next correct action the reconnecting runtime should take. */
	action: VerticalRuntimeRecoveryAction;
	/** I record whether another daemon client is still attached to the same durable continuity row. */
	activeElsewhere: boolean;
	/** I record whether the caller must execute bridge.bootstrap before it can continue. */
	shouldBootstrap: boolean;
	/** I record whether the caller should reopen live subscriptions after recovery. */
	shouldResubscribe: boolean;
	/** I record whether the caller should backfill missed turns or timeline events. */
	shouldReplay: boolean;
	/** I record the ordered recovery steps the caller should follow. */
	steps: string[];
}

/** I capture the daemon-issued continuity lookup result plus the current recovery plan. */
export interface VerticalRuntimeContinuityLookupResult {
	/** I record whether a durable continuity row exists for the requested identity. */
	found: boolean;
	/** I carry the durable continuity row when one exists. */
	record: VerticalRuntimeContinuityRecord | null;
	/** I carry the daemon-issued recovery plan for the current lookup state. */
	plan: VerticalRuntimeRecoveryPlan;
}

/** I describe the daemon-owned notification and recovery contract for vertical consumers. */
export interface VerticalRegistrySubscribeContract {
	/** I record the canonical subscription transport. */
	transport: string;
	/** I record whether the notifier is currently available. */
	notifierAvailable: boolean;
	/** I record the supported notification methods. */
	notificationMethods: string[];
	/** I carry the replay contract block. */
	replay: VerticalRegistryReplayContract;
	/** I carry the unsubscribe contract block. */
	unsubscribe: VerticalRegistryUnsubscribeContract;
	/** I carry the pull fallback contract block. */
	pullFallback: VerticalRegistryPullFallbackContract;
	/** I carry the missed-event recovery contract block. */
	missedEventRecovery: VerticalRegistryMissedEventRecoveryContract;
	/** I carry the reattach contract block. */
	reattach: VerticalRegistryReattachContract;
}

/** I capture the bind and subscribe contract block emitted by vertical.registry. */
export interface VerticalRegistryBindSubscribeContract {
	/** I version the bind/subscribe contract block. */
	contractVersion: 1;
	/** I carry the bind contract block. */
	bind: VerticalRegistryBindContract;
	/** I carry the subscribe contract block. */
	subscribe: VerticalRegistrySubscribeContract;
}

/** I capture the machine-readable daemon-owned vertical registry contract. */
export interface VerticalRegistryContract {
	/** I version the vertical registry contract. */
	contractVersion: 1;
	/** I carry the stable capability bundles. */
	bundles: VerticalRegistryBundle[];
	/** I carry the cross-vertical auth contract. */
	auth: VerticalRegistryAuthContract;
	/** I carry the vertical profile guidance. */
	profiles: VerticalRegistryProfile[];
	/** I carry the bind and subscribe contract. */
	bindSubscribe: VerticalRegistryBindSubscribeContract;
}
