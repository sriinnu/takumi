import type { AppState } from "../state.js";
import type { ContinuityExecutorLease, SessionContinuityState } from "./continuity-types.js";

type ContinuityStateStore = Pick<
	AppState,
	"continuityEvents" | "continuityGrants" | "continuityLease" | "continuityPeers"
>;

interface ClonedContinuityState {
	grants: NonNullable<SessionContinuityState["grants"]>;
	attachedPeers: NonNullable<SessionContinuityState["attachedPeers"]>;
	lease: ContinuityExecutorLease | null;
	events: NonNullable<SessionContinuityState["events"]>;
}

export function cloneStoredContinuityState(storedContinuity?: SessionContinuityState): ClonedContinuityState {
	return {
		grants: storedContinuity?.grants?.map((grant) => ({ ...grant })) ?? [],
		attachedPeers:
			storedContinuity?.attachedPeers?.map((peer) => ({
				...peer,
				...(peer.fingerprint ? { fingerprint: { ...peer.fingerprint } } : {}),
			})) ?? [],
		lease: storedContinuity?.lease
			? {
					...storedContinuity.lease,
					...(storedContinuity.lease.blockers
						? { blockers: storedContinuity.lease.blockers.map((blocker) => ({ ...blocker })) }
						: {}),
				}
			: null,
		events: storedContinuity?.events?.map((event) => ({ ...event })) ?? [],
	};
}

export function buildPersistedContinuityState(state: ContinuityStateStore): SessionContinuityState | undefined {
	const continuityGrants = state.continuityGrants.value;
	const continuityPeers = state.continuityPeers.value;
	const continuityLease = state.continuityLease.value;
	const continuityEvents = state.continuityEvents.value;
	const hasContinuity = Boolean(
		continuityGrants.length || continuityPeers.length || continuityLease || continuityEvents.length,
	);
	if (!hasContinuity) {
		return undefined;
	}

	return {
		lastUpdatedAt: Date.now(),
		...(continuityGrants.length > 0 ? { grants: continuityGrants.map((grant) => ({ ...grant })) } : {}),
		...(continuityPeers.length > 0
			? {
					attachedPeers: continuityPeers.map((peer) => ({
						...peer,
						...(peer.fingerprint ? { fingerprint: { ...peer.fingerprint } } : {}),
					})),
				}
			: {}),
		...(continuityLease
			? {
					lease: {
						...continuityLease,
						...(continuityLease.blockers
							? { blockers: continuityLease.blockers.map((blocker) => ({ ...blocker })) }
							: {}),
					},
				}
			: {}),
		...(continuityEvents.length > 0 ? { events: continuityEvents.map((event) => ({ ...event })) } : {}),
	};
}
