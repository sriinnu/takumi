import { timingSafeEqual } from "node:crypto";
import type { AppState } from "../state.js";
import type {
	ContinuityBridgeSnapshot,
	ContinuityPeerActionOutcome,
	ContinuityRedeemOutcome,
} from "./continuity-runtime.js";
import type { ContinuityAttachedPeer, ContinuityAttachGrant } from "./continuity-types.js";

export type ContinuityStore = Pick<
	AppState,
	"continuityEvents" | "continuityGrants" | "continuityLease" | "continuityPeers"
>;

/** Build a consistent failed redeem result. */
export function failOutcome(statusCode: number, error: string, stateChanged: boolean): ContinuityRedeemOutcome {
	return { ok: false, statusCode, error, stateChanged };
}

/** Build a consistent failed peer-action result. */
export function failPeerAction(statusCode: number, error: string, stateChanged: boolean): ContinuityPeerActionOutcome {
	return { ok: false, statusCode, error, stateChanged };
}

/** Convert a live peer record into the public bridge snapshot shape. */
export function toPeerSnapshot(peer: ContinuityAttachedPeer): NonNullable<ContinuityBridgeSnapshot["peers"]>[number] {
	return {
		peerId: peer.peerId,
		kind: peer.kind,
		role: peer.role,
		attachedAt: peer.attachedAt,
		lastSeenAt: peer.lastSeenAt,
	};
}

/** Replace grants only when the persisted ordering or identities actually changed. */
export function replaceGrants(state: ContinuityStore, next: ContinuityAttachGrant[]): boolean {
	if (sameArray(state.continuityGrants.value, next, (grant) => `${grant.grantId}:${grant.expiresAt}`)) {
		return false;
	}
	state.continuityGrants.value = next;
	return true;
}

/** Replace peers only when the persisted ordering or liveness actually changed. */
export function replacePeers(state: ContinuityStore, next: ContinuityAttachedPeer[]): boolean {
	if (sameArray(state.continuityPeers.value, next, (peer) => `${peer.peerId}:${peer.lastSeenAt}:${peer.role}`)) {
		return false;
	}
	state.continuityPeers.value = next;
	return true;
}

/** Compare two arrays by a stable caller-provided identity key. */
export function sameArray<T>(current: T[], next: T[], key: (value: T) => string): boolean {
	if (current.length !== next.length) {
		return false;
	}
	for (let index = 0; index < current.length; index++) {
		if (key(current[index]) !== key(next[index])) {
			return false;
		}
	}
	return true;
}

/** Compare grant nonces without leaking timing differences. */
export function timingSafeStringMatch(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}
	return timingSafeEqual(leftBuffer, rightBuffer);
}
