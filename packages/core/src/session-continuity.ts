import { randomBytes, randomUUID } from "node:crypto";

/**
 * Shared continuity contracts for cross-device session attach and executor transfer.
 *
 * I keep these types separate from `sessions.ts` so future continuity work can
 * evolve without inflating the already-busy session persistence module.
 */

/** Attach surface kind allowed to join a continuity session. */
export type ContinuityPeerKind = "browser" | "phone" | "runtime";

/** Companion roles allowed during V1 mobile/browser attach. */
export type ContinuityCompanionRole = "observer" | "commenter" | "approver";

/** Runtime-only continuity roles used when a second Takumi process attaches. */
export type ContinuityRuntimeRole = "shadow-runtime" | "active-executor";

/** Full continuity role vocabulary across companion and runtime peers. */
export type ContinuityPeerRole = ContinuityCompanionRole | ContinuityRuntimeRole;

/** Workspace trust tier used to decide whether a runtime may claim the lease. */
export type ContinuityWorkspaceFingerprintTier = "exact" | "safe-dirty" | "context-only" | "unsafe";

/**
 * Short-lived attach grant used for QR or URL-based continuity bootstrap.
 *
 * I expect the canonical control plane to issue these grants. The QR or URL
 * payload should carry only short-lived challenge material, never durable
 * daemon or provider credentials.
 */
export interface ContinuityAttachGrant {
	grantId: string;
	canonicalSessionId: string;
	issuerRuntimeId?: string | null;
	kind: ContinuityPeerKind;
	initialRole: ContinuityCompanionRole;
	nonce: string;
	expiresAt: number;
	transportRef?: string | null;
}

/**
 * Repo/runtime fingerprint used to decide whether a runtime claim is safe.
 *
 * `tier` is intentionally conservative. Future claim logic can permit only
 * `exact` matches while still persisting softer observer-only states.
 */
export interface ContinuityWorkspaceFingerprint {
	repoId: string;
	branch?: string | null;
	head?: string | null;
	dirtyHash?: string | null;
	capabilitySignature?: string | null;
	platformSignature?: string | null;
	tier: ContinuityWorkspaceFingerprintTier;
}

/**
 * Presence record for each attached companion or runtime.
 *
 * Runtime peers may carry `runtimeId`, `shadowReady`, and a fingerprint,
 * while companion peers generally use the observer/commenter/approver roles.
 */
export interface ContinuityAttachedPeer {
	peerId: string;
	kind: ContinuityPeerKind;
	role: ContinuityPeerRole;
	runtimeId?: string | null;
	attachedAt: number;
	lastSeenAt: number;
	replayCursor?: string | null;
	shadowReady?: boolean;
	fingerprint?: ContinuityWorkspaceFingerprint;
}

/** Meaningful continuity lifecycle events retained for operator inspection. */
export type ContinuityAuditEventKind =
	| "grant-issued"
	| "grant-redeemed"
	| "grant-revoked"
	| "peer-stale"
	| "peer-detached";

/**
 * Compact operator-facing audit record for continuity lifecycle transitions.
 *
 * I only persist semantic changes here, not noisy heartbeats, so the session
 * file stays readable and companion presence doesn't churn the autosaver.
 */
export interface ContinuityAuditEvent {
	eventId: string;
	kind: ContinuityAuditEventKind;
	occurredAt: number;
	grantId?: string | null;
	peerId?: string | null;
	peerKind?: ContinuityPeerKind | null;
	role?: ContinuityPeerRole | null;
	note?: string | null;
}

/** Lease states for the single-writer executor model. */
export type ContinuityExecutorLeaseState =
	| "unclaimed"
	| "active"
	| "yield-pending"
	| "claim-pending"
	| "transferring"
	| "blocked";

/** Canonical reason a claim or transfer is blocked. */
export type ContinuityLeaseBlockerKind =
	| "tool-in-flight"
	| "approval-pending"
	| "pending-local-turns"
	| "replay-validation-failed"
	| "workspace-mismatch"
	| "control-plane-unavailable";

/**
 * Concrete blocker detail attached to a lease snapshot.
 *
 * I keep the shape stringly-typed and serializable so it can move cleanly
 * through persisted session state, daemon snapshots, and UI inspection views.
 */
export interface ContinuityLeaseBlocker {
	kind: ContinuityLeaseBlockerKind;
	reason: string;
	detectedAt: number;
}

/**
 * Single-writer lease snapshot for cross-device continuity.
 *
 * `epoch` is the important fence: any runtime acting on an older epoch should
 * be treated as stale and blocked from write-capable actions.
 */
export interface ContinuityExecutorLease {
	canonicalSessionId: string;
	epoch: number;
	state: ContinuityExecutorLeaseState;
	holderRuntimeId?: string | null;
	claimantRuntimeId?: string | null;
	lastHeartbeatAt?: number;
	leaseExpiresAt?: number;
	blockers?: ContinuityLeaseBlocker[];
	reason?: string | null;
	witnessPeerId?: string | null;
}

/**
 * Compact continuity summary mirrored into session control-plane state.
 *
 * The mirrored snapshot is useful for UI and recovery, but it is not meant to
 * replace the canonical daemon-side authority for future continuity work.
 */
export interface SessionContinuityState {
	lastUpdatedAt: number;
	grants?: ContinuityAttachGrant[];
	attachedPeers?: ContinuityAttachedPeer[];
	lease?: ContinuityExecutorLease;
	events?: ContinuityAuditEvent[];
}

export interface CreateContinuityAttachGrantInput {
	canonicalSessionId: string;
	kind: ContinuityPeerKind;
	initialRole?: ContinuityCompanionRole;
	issuerRuntimeId?: string | null;
	ttlMs?: number;
	transportRef?: string | null;
	now?: number;
}

/** Generate a compact nonce safe to embed in short-lived continuity grants. */
export function generateContinuityNonce(bytes = 16): string {
	return randomBytes(bytes).toString("base64url");
}

/**
 * Create a short-lived continuity attach grant.
 *
 * I default grants to observer-only behavior and a conservative 10-minute TTL
 * so new companion surfaces begin in the safest possible mode.
 */
export function createContinuityAttachGrant(input: CreateContinuityAttachGrantInput): ContinuityAttachGrant {
	const now = input.now ?? Date.now();
	return {
		grantId: randomUUID(),
		canonicalSessionId: input.canonicalSessionId,
		issuerRuntimeId: input.issuerRuntimeId ?? null,
		kind: input.kind,
		initialRole: input.initialRole ?? "observer",
		nonce: generateContinuityNonce(),
		expiresAt: now + Math.max(60_000, input.ttlMs ?? 10 * 60_000),
		transportRef: input.transportRef ?? null,
	};
}
