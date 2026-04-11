/**
 * I hold the vertical/runtime bootstrap contract slices that were split out of
 * the mirrored bootstrap SDK types so the main mirror can stay within Takumi's
 * LOC guard while preserving the public API.
 */

/** I enumerate how bootstrap resolved the bound vertical identity. */
export const BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES = [
	"catalog",
	"auth-token-family",
	"explicit-vertical-id",
	"derived-consumer-prefix",
	"unbound",
] as const;
export type BridgeBootstrapVerticalResolutionSource = (typeof BRIDGE_BOOTSTRAP_VERTICAL_RESOLUTION_SOURCES)[number];

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

/** I capture the resolved vertical attachment identity returned by daemon bootstrap. */
export interface DaemonBridgeBootstrapVertical {
	contractVersion: 1;
	id: string | null;
	label: string | null;
	description: string | null;
	preferredTransport: VerticalProfilePreferredTransport | null;
	authMode: VerticalProfileAuthMode | null;
	allowedTransports: VerticalProfilePreferredTransport[];
	bundleIds: string[];
	consumer: string | null;
	surface: string | null;
	canonical: boolean;
	degraded: boolean;
	resolutionSource: BridgeBootstrapVerticalResolutionSource;
}

/** I capture one durable daemon-owned continuity row for a vertical attachment. */
export interface VerticalRuntimeContinuityRecord {
	contractVersion: 1;
	identityKey: string | null;
	verticalId: string;
	consumer: string | null;
	surface: string;
	channel: string | null;
	project: string | null;
	sessionId: string | null;
	sessionReusePolicy: string | null;
	clientKey: string | null;
	sessionLineageKey: string | null;
	attachedClientId: string | null;
	authFamily: string | null;
	status: VerticalRuntimeContinuityStatus;
	state: VerticalRuntimeContinuityState;
	requiredAction: VerticalRuntimeContinuityRequiredAction;
	source: VerticalRuntimeContinuitySource;
	lastSeenAt: number | null;
	lastDetachedAt: number | null;
	updatedAt: number;
}

/** I capture the daemon-issued reconnect and replay plan for one vertical runtime identity. */
export interface VerticalRuntimeRecoveryPlan {
	contractVersion: 1;
	action: VerticalRuntimeRecoveryAction;
	activeElsewhere: boolean;
	shouldBootstrap: boolean;
	shouldResubscribe: boolean;
	shouldReplay: boolean;
	steps: string[];
}

/** I capture the daemon-owned continuity snapshot returned to a bootstrapping vertical. */
export interface DaemonBridgeBootstrapContinuity {
	contractVersion: 1;
	tracked: boolean;
	reattached: boolean;
	activeElsewhere: boolean;
	record: VerticalRuntimeContinuityRecord | null;
	plan: VerticalRuntimeRecoveryPlan;
}
