import { randomBytes, randomUUID } from "node:crypto";
import {
	type ContinuityStore,
	failOutcome,
	failPeerAction,
	replaceGrants,
	replacePeers,
	timingSafeStringMatch,
	toPeerSnapshot,
} from "./continuity-runtime-support.js";
import type {
	ContinuityAttachedPeer,
	ContinuityAttachGrant,
	ContinuityAuditEvent,
	ContinuityCompanionRole,
	ContinuityPeerKind,
} from "./continuity-types.js";

const MAX_PERSISTED_GRANTS = 5;
const MAX_ACTIVE_PEERS = 8;
const MAX_PERSISTED_EVENTS = 20;
const DEFAULT_PEER_IDLE_MS = 5 * 60_000;
const DEFAULT_COMPANION_SESSION_TTL_MS = 15 * 60_000;
const HEARTBEAT_COMMIT_MS = 30_000;

export interface ContinuityBridgeSnapshot {
	grantCount: number;
	attachedPeerCount: number;
	grants: Array<{
		grantId: string;
		kind: string;
		initialRole: string;
		expiresAt: number;
		transportRef?: string | null;
	}>;
	lease: {
		state: string;
		epoch: number;
		holderRuntimeId?: string | null;
		reason?: string | null;
	} | null;
	peers?: Array<{
		peerId: string;
		kind: string;
		role: string;
		attachedAt: number;
		lastSeenAt: number;
	}>;
	events?: Array<{
		eventId: string;
		kind: string;
		occurredAt: number;
		grantId?: string | null;
		peerId?: string | null;
		peerKind?: string | null;
		role?: string | null;
		note?: string | null;
	}>;
}

type ContinuityPeerSnapshot = NonNullable<ContinuityBridgeSnapshot["peers"]>[number];

export interface ContinuityBootstrapPayload {
	version: 1;
	grantId: string;
	canonicalSessionId: string;
	kind: ContinuityPeerKind;
	nonce: string;
	expiresAt: number;
	redeemUrl: string | null;
}

interface CompanionSessionRecord {
	peerId: string;
	role: ContinuityCompanionRole;
	token: string;
	expiresAt: number;
	lastSeenAt: number;
}

export interface ContinuityRedeemOutcome {
	ok: boolean;
	statusCode?: number;
	error?: string;
	stateChanged: boolean;
	peer?: ContinuityPeerSnapshot;
	continuity?: ContinuityBridgeSnapshot | null;
	companionSession?: {
		token: string;
		expiresAt: number;
	};
}

export interface ContinuityPeerActionOutcome {
	ok: boolean;
	statusCode?: number;
	error?: string;
	stateChanged: boolean;
	peer?: ContinuityPeerSnapshot;
	continuity?: ContinuityBridgeSnapshot | null;
}

/**
 * In-memory companion auth registry.
 *
 * I keep this ephemeral on purpose so redeem tokens die with the runtime and
 * never become durable authority hidden inside session JSON.
 */
export class ContinuityCompanionRegistry {
	private sessionsByToken = new Map<string, CompanionSessionRecord>();
	private tokenByPeerId = new Map<string, string>();

	issue(peerId: string, role: ContinuityCompanionRole, now = Date.now()): CompanionSessionRecord {
		this.revokePeer(peerId);
		const record: CompanionSessionRecord = {
			peerId,
			role,
			token: randomBytes(24).toString("base64url"),
			expiresAt: now + DEFAULT_COMPANION_SESSION_TTL_MS,
			lastSeenAt: now,
		};
		this.sessionsByToken.set(record.token, record);
		this.tokenByPeerId.set(peerId, record.token);
		return record;
	}

	touch(token: string, peerId: string, now = Date.now()): CompanionSessionRecord | null {
		const record = this.validate(token, peerId, now);
		if (!record) {
			return null;
		}
		record.lastSeenAt = now;
		record.expiresAt = now + DEFAULT_COMPANION_SESSION_TTL_MS;
		return record;
	}

	validate(token: string, peerId: string, now = Date.now()): CompanionSessionRecord | null {
		const record = this.sessionsByToken.get(token);
		if (!record || record.peerId !== peerId) {
			return null;
		}
		if (record.expiresAt <= now) {
			this.revokeToken(token);
			return null;
		}
		return record;
	}

	revokePeer(peerId: string): void {
		const token = this.tokenByPeerId.get(peerId);
		if (!token) {
			return;
		}
		this.revokeToken(token);
	}

	private revokeToken(token: string): void {
		const record = this.sessionsByToken.get(token);
		if (!record) {
			return;
		}
		this.sessionsByToken.delete(token);
		this.tokenByPeerId.delete(record.peerId);
	}
}

export function buildContinuityBootstrapPayload(grant: ContinuityAttachGrant): ContinuityBootstrapPayload {
	return {
		version: 1,
		grantId: grant.grantId,
		canonicalSessionId: grant.canonicalSessionId,
		kind: grant.kind,
		nonce: grant.nonce,
		expiresAt: grant.expiresAt,
		redeemUrl: grant.transportRef ?? null,
	};
}

export function storeContinuityGrant(state: ContinuityStore, grant: ContinuityAttachGrant, now = Date.now()): boolean {
	pruneExpiredContinuityGrants(state, now);
	const next = [grant, ...state.continuityGrants.value]
		.sort((left, right) => right.expiresAt - left.expiresAt)
		.slice(0, MAX_PERSISTED_GRANTS);
	return replaceGrants(state, next);
}

export function pruneExpiredContinuityGrants(state: ContinuityStore, now = Date.now()): boolean {
	const next = state.continuityGrants.value
		.filter((grant) => grant.expiresAt > now)
		.sort((left, right) => right.expiresAt - left.expiresAt)
		.slice(0, MAX_PERSISTED_GRANTS);
	return replaceGrants(state, next);
}

export function recordContinuityEvent(
	state: ContinuityStore,
	event: Omit<ContinuityAuditEvent, "eventId" | "occurredAt"> & { occurredAt?: number },
): ContinuityAuditEvent {
	const entry: ContinuityAuditEvent = {
		eventId: randomUUID(),
		occurredAt: event.occurredAt ?? Date.now(),
		grantId: null,
		peerId: null,
		peerKind: null,
		role: null,
		note: null,
		...event,
	};
	state.continuityEvents.value = [entry, ...state.continuityEvents.value].slice(0, MAX_PERSISTED_EVENTS);
	return entry;
}

export function sweepStaleContinuityPeers(
	state: ContinuityStore,
	registry: ContinuityCompanionRegistry,
	now = Date.now(),
): boolean {
	const stalePeers = state.continuityPeers.value.filter((peer) => now - peer.lastSeenAt >= DEFAULT_PEER_IDLE_MS);
	if (stalePeers.length === 0) {
		return false;
	}
	const staleIds = new Set(stalePeers.map((peer) => peer.peerId));
	const next = state.continuityPeers.value.filter((peer) => !staleIds.has(peer.peerId));
	const changed = replacePeers(state, next);
	for (const peer of stalePeers) {
		registry.revokePeer(peer.peerId);
		recordContinuityEvent(state, {
			kind: "peer-stale",
			peerId: peer.peerId,
			peerKind: peer.kind,
			role: peer.role,
			note: "Peer heartbeat expired.",
			occurredAt: now,
		});
	}
	return changed;
}

export function buildContinuitySummary(state: ContinuityStore): ContinuityBridgeSnapshot | null {
	const grants = state.continuityGrants.value;
	const peers = state.continuityPeers.value;
	const lease = state.continuityLease.value;
	if (grants.length === 0 && peers.length === 0 && !lease) {
		return null;
	}
	return {
		grantCount: grants.length,
		attachedPeerCount: peers.length,
		grants: grants.map((grant) => ({
			grantId: grant.grantId,
			kind: grant.kind,
			initialRole: grant.initialRole,
			expiresAt: grant.expiresAt,
			transportRef: grant.transportRef ?? null,
		})),
		lease: lease
			? {
					state: lease.state,
					epoch: lease.epoch,
					holderRuntimeId: lease.holderRuntimeId ?? null,
					reason: lease.reason ?? null,
				}
			: null,
	};
}

export function buildContinuityDetail(state: ContinuityStore): ContinuityBridgeSnapshot | null {
	const summary = buildContinuitySummary(state);
	const events = state.continuityEvents.value;
	if (!summary && events.length === 0) {
		return null;
	}
	return {
		grantCount: summary?.grantCount ?? 0,
		attachedPeerCount: summary?.attachedPeerCount ?? state.continuityPeers.value.length,
		grants: summary?.grants ?? [],
		lease: summary?.lease ?? null,
		...(state.continuityPeers.value.length > 0
			? {
					peers: state.continuityPeers.value.map((peer) => ({
						peerId: peer.peerId,
						kind: peer.kind,
						role: peer.role,
						attachedAt: peer.attachedAt,
						lastSeenAt: peer.lastSeenAt,
					})),
				}
			: {}),
		...(events.length > 0
			? {
					events: events.map((event) => ({
						eventId: event.eventId,
						kind: event.kind,
						occurredAt: event.occurredAt,
						grantId: event.grantId ?? null,
						peerId: event.peerId ?? null,
						peerKind: event.peerKind ?? null,
						role: event.role ?? null,
						note: event.note ?? null,
					})),
				}
			: {}),
	};
}

export function describeContinuityAuditEvent(event: ContinuityAuditEvent): string {
	switch (event.kind) {
		case "grant-issued":
			return `${event.grantId ?? "grant"} issued for ${event.peerKind ?? "peer"}${event.role ? ` as ${event.role}` : ""}`;
		case "grant-redeemed":
			return `${event.peerId ?? "peer"} redeemed ${event.grantId ?? "grant"}${event.role ? ` as ${event.role}` : ""}`;
		case "grant-revoked":
			return `${event.grantId ?? "grant"} revoked`;
		case "peer-stale":
			return `${event.peerId ?? "peer"} marked stale`;
		case "peer-detached":
			return `${event.peerId ?? "peer"} detached`;
	}
	return event.kind;
}

export function redeemContinuityGrant(
	state: ContinuityStore,
	registry: ContinuityCompanionRegistry,
	input: { grantId: string; nonce: string; kind?: ContinuityPeerKind },
	now = Date.now(),
): ContinuityRedeemOutcome {
	const staleChanged = sweepStaleContinuityPeers(state, registry, now);
	pruneExpiredContinuityGrants(state, now);
	const grant = state.continuityGrants.value.find((entry) => entry.grantId === input.grantId);
	if (!grant) {
		return failOutcome(404, "Continuity grant not found", staleChanged);
	}
	if (input.kind && input.kind !== grant.kind) {
		return failOutcome(403, "Continuity grant kind mismatch", staleChanged);
	}
	if (!timingSafeStringMatch(input.nonce, grant.nonce)) {
		return failOutcome(403, "Continuity grant challenge rejected", staleChanged);
	}
	if (state.continuityPeers.value.length >= MAX_ACTIVE_PEERS) {
		return failOutcome(409, "Too many active continuity peers", staleChanged);
	}

	const peer: ContinuityAttachedPeer = {
		peerId: randomUUID(),
		kind: grant.kind,
		role: grant.initialRole,
		attachedAt: now,
		lastSeenAt: now,
	};
	const session = registry.issue(peer.peerId, grant.initialRole, now);
	const nextGrants = state.continuityGrants.value.filter((entry) => entry.grantId !== grant.grantId);
	const nextPeers = [peer, ...state.continuityPeers.value]
		.sort((left, right) => right.lastSeenAt - left.lastSeenAt)
		.slice(0, MAX_ACTIVE_PEERS);
	const grantChanged = replaceGrants(state, nextGrants);
	const peerChanged = replacePeers(state, nextPeers);
	recordContinuityEvent(state, {
		kind: "grant-redeemed",
		grantId: grant.grantId,
		peerId: peer.peerId,
		peerKind: peer.kind,
		role: peer.role,
		note: "Observer-only companion attached.",
		occurredAt: now,
	});
	return {
		ok: true,
		stateChanged: staleChanged || grantChanged || peerChanged,
		peer: toPeerSnapshot(peer),
		continuity: buildContinuityDetail(state),
		companionSession: { token: session.token, expiresAt: session.expiresAt },
	};
}

export function heartbeatContinuityPeer(
	state: ContinuityStore,
	registry: ContinuityCompanionRegistry,
	input: { peerId: string; companionToken: string },
	now = Date.now(),
): ContinuityPeerActionOutcome {
	const session = registry.touch(input.companionToken, input.peerId, now);
	if (!session) {
		return failPeerAction(401, "Companion session rejected", false);
	}
	const peer = state.continuityPeers.value.find((entry) => entry.peerId === input.peerId);
	if (!peer) {
		registry.revokePeer(input.peerId);
		return failPeerAction(404, "Continuity peer not found", false);
	}
	if (now - peer.lastSeenAt < HEARTBEAT_COMMIT_MS) {
		return { ok: true, stateChanged: false, peer: { ...toPeerSnapshot(peer), lastSeenAt: now } };
	}
	const nextPeers = state.continuityPeers.value
		.map((entry) => (entry.peerId === peer.peerId ? { ...entry, lastSeenAt: now } : entry))
		.sort((left, right) => right.lastSeenAt - left.lastSeenAt);
	const stateChanged = replacePeers(state, nextPeers);
	const updatedPeer = nextPeers.find((entry) => entry.peerId === peer.peerId) ?? { ...peer, lastSeenAt: now };
	return { ok: true, stateChanged, peer: toPeerSnapshot(updatedPeer) };
}

export function detachContinuityPeer(
	state: ContinuityStore,
	registry: ContinuityCompanionRegistry,
	input: { peerId: string; companionToken: string },
	now = Date.now(),
): ContinuityPeerActionOutcome {
	const session = registry.validate(input.companionToken, input.peerId, now);
	if (!session) {
		return failPeerAction(401, "Companion session rejected", false);
	}
	const peer = state.continuityPeers.value.find((entry) => entry.peerId === input.peerId);
	if (!peer) {
		registry.revokePeer(input.peerId);
		return failPeerAction(404, "Continuity peer not found", false);
	}
	const nextPeers = state.continuityPeers.value.filter((entry) => entry.peerId !== peer.peerId);
	const stateChanged = replacePeers(state, nextPeers);
	registry.revokePeer(peer.peerId);
	recordContinuityEvent(state, {
		kind: "peer-detached",
		peerId: peer.peerId,
		peerKind: peer.kind,
		role: peer.role,
		note: "Companion detached cleanly.",
		occurredAt: now,
	});
	return {
		ok: true,
		stateChanged,
		peer: toPeerSnapshot(peer),
		continuity: buildContinuityDetail(state),
	};
}
