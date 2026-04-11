import { randomBytes, randomUUID } from "node:crypto";

/**
 * Local structural overlay for continuity contracts.
 *
 * I mirror the current `@takumi/core` continuity shapes here so TUI can keep
 * moving even when package-level declaration surfaces lag behind source edits
 * during per-package `tsc --noEmit` runs.
 */
export type ContinuityPeerKind = "browser" | "phone" | "runtime";
export type ContinuityCompanionRole = "observer" | "commenter" | "approver";
export type ContinuityRuntimeRole = "shadow-runtime" | "active-executor";
export type ContinuityPeerRole = ContinuityCompanionRole | ContinuityRuntimeRole;
export type ContinuityWorkspaceFingerprintTier = "exact" | "safe-dirty" | "context-only" | "unsafe";

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

export interface ContinuityWorkspaceFingerprint {
	repoId: string;
	branch?: string | null;
	head?: string | null;
	dirtyHash?: string | null;
	capabilitySignature?: string | null;
	platformSignature?: string | null;
	tier: ContinuityWorkspaceFingerprintTier;
}

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

export type ContinuityAuditEventKind =
	| "grant-issued"
	| "grant-redeemed"
	| "grant-revoked"
	| "peer-stale"
	| "peer-detached";

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

export type ContinuityExecutorLeaseState =
	| "unclaimed"
	| "active"
	| "yield-pending"
	| "claim-pending"
	| "transferring"
	| "blocked";

export type ContinuityLeaseBlockerKind =
	| "tool-in-flight"
	| "approval-pending"
	| "pending-local-turns"
	| "replay-validation-failed"
	| "workspace-mismatch"
	| "control-plane-unavailable";

export interface ContinuityLeaseBlocker {
	kind: ContinuityLeaseBlockerKind;
	reason: string;
	detectedAt: number;
}

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

export function createContinuityAttachGrant(input: CreateContinuityAttachGrantInput): ContinuityAttachGrant {
	const now = input.now ?? Date.now();
	return {
		grantId: randomUUID(),
		canonicalSessionId: input.canonicalSessionId,
		issuerRuntimeId: input.issuerRuntimeId ?? null,
		kind: input.kind,
		initialRole: input.initialRole ?? "observer",
		nonce: randomBytes(16).toString("base64url"),
		expiresAt: now + Math.max(60_000, input.ttlMs ?? 10 * 60_000),
		transportRef: input.transportRef ?? null,
	};
}
