import { describe, expect, it } from "vitest";
import {
	ContinuityCompanionRegistry,
	redeemContinuityGrant,
	storeContinuityGrant,
	sweepStaleContinuityPeers,
} from "../src/continuity/continuity-runtime.js";
import { createContinuityAttachGrant } from "../src/continuity/continuity-types.js";
import { AppState } from "../src/state.js";

describe("continuity runtime helpers", () => {
	it("redeems a grant exactly once and creates a trusted peer session", () => {
		const state = new AppState();
		const registry = new ContinuityCompanionRegistry();
		const grant = createContinuityAttachGrant({
			canonicalSessionId: "canon-runtime",
			kind: "phone",
			initialRole: "observer",
			transportRef: "http://127.0.0.1:3100/continuity/redeem",
			now: 1_000,
			ttlMs: 60_000,
		});
		storeContinuityGrant(state, grant, 1_000);

		const first = redeemContinuityGrant(
			state,
			registry,
			{ grantId: grant.grantId, nonce: grant.nonce, kind: "phone" },
			1_500,
		);
		expect(first.ok).toBe(true);
		if (!first.ok) {
			return;
		}
		expect(first.peer?.peerId).toBeTruthy();
		expect(first.companionSession?.token).toBeTruthy();
		expect(state.continuityGrants.value).toHaveLength(0);
		expect(state.continuityPeers.value).toHaveLength(1);
		expect(state.continuityEvents.value[0]?.kind).toBe("grant-redeemed");

		const second = redeemContinuityGrant(
			state,
			registry,
			{ grantId: grant.grantId, nonce: grant.nonce, kind: "phone" },
			1_600,
		);
		expect(second.ok).toBe(false);
		expect(second.statusCode).toBe(404);
	});

	it("rejects grant redemption when the nonce does not match", () => {
		const state = new AppState();
		const registry = new ContinuityCompanionRegistry();
		const grant = createContinuityAttachGrant({
			canonicalSessionId: "canon-runtime",
			kind: "phone",
			initialRole: "observer",
			now: 1_000,
			ttlMs: 60_000,
		});
		storeContinuityGrant(state, grant, 1_000);

		const result = redeemContinuityGrant(
			state,
			registry,
			{ grantId: grant.grantId, nonce: "wrong-nonce", kind: "phone" },
			1_500,
		);
		expect(result.ok).toBe(false);
		expect(result.statusCode).toBe(403);
		expect(state.continuityGrants.value).toHaveLength(1);
		expect(state.continuityPeers.value).toHaveLength(0);
	});

	it("sweeps stale peers and records a bounded audit event", () => {
		const state = new AppState();
		const registry = new ContinuityCompanionRegistry();
		state.continuityPeers.value = [
			{
				peerId: "peer-stale",
				kind: "phone",
				role: "observer",
				attachedAt: 1_000,
				lastSeenAt: 1_000,
			},
		];

		const changed = sweepStaleContinuityPeers(state, registry, 1_000 + 5 * 60_000 + 1);
		expect(changed).toBe(true);
		expect(state.continuityPeers.value).toHaveLength(0);
		expect(state.continuityEvents.value[0]).toMatchObject({
			kind: "peer-stale",
			peerId: "peer-stale",
		});
	});
});
