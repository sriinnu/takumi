import type { FastifyInstance } from "fastify";

export interface ContinuityStateSnapshot {
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

export type ContinuityRedeemResult =
	| {
			success: true;
			peer: NonNullable<ContinuityStateSnapshot["peers"]>[number];
			continuity: ContinuityStateSnapshot | null;
			companionSession: {
				token: string;
				expiresAt: number;
			};
	  }
	| {
			success: false;
			statusCode: number;
			error: string;
	  };

export type ContinuityPeerActionResult =
	| {
			success: true;
			peer?: NonNullable<ContinuityStateSnapshot["peers"]>[number];
			continuity?: ContinuityStateSnapshot | null;
	  }
	| {
			success: false;
			statusCode: number;
			error: string;
	  };

export interface ContinuityRouteConfig {
	getContinuityState?: () => Promise<ContinuityStateSnapshot | null>;
	redeemContinuityGrant?: (input: { grantId: string; nonce: string; kind?: string }) => Promise<ContinuityRedeemResult>;
	heartbeatContinuityPeer?: (input: { peerId: string; companionToken: string }) => Promise<ContinuityPeerActionResult>;
	detachContinuityPeer?: (input: { peerId: string; companionToken: string }) => Promise<ContinuityPeerActionResult>;
}

export function isCompanionContinuityRoute(method: string, rawUrl: string | undefined): boolean {
	if (method !== "POST" || !rawUrl) {
		return false;
	}
	const path = rawUrl.split("?", 1)[0] ?? rawUrl;
	return path === "/continuity/redeem" || /^\/continuity\/peers\/[^/]+\/(heartbeat|detach)$/.test(path);
}

export function registerContinuityRoutes(server: FastifyInstance, config: ContinuityRouteConfig): void {
	server.get("/continuity", async (_request, reply) => {
		if (!config.getContinuityState) {
			return reply.code(501).send({ error: "Continuity state not configured" });
		}
		return reply.send({ continuity: await config.getContinuityState() });
	});

	server.post<{ Body: { grantId?: string; nonce?: string; kind?: string } }>(
		"/continuity/redeem",
		async (request, reply) => {
			if (!config.redeemContinuityGrant) {
				return reply.code(501).send({ error: "Continuity redemption not configured" });
			}
			if (typeof request.body?.grantId !== "string" || typeof request.body?.nonce !== "string") {
				return reply.code(400).send({ error: "Bad Request: grantId and nonce are required" });
			}
			const result = await config.redeemContinuityGrant({
				grantId: request.body.grantId,
				nonce: request.body.nonce,
				kind: typeof request.body.kind === "string" ? request.body.kind : undefined,
			});
			if (!result.success) {
				return reply.code(result.statusCode).send({ error: result.error });
			}
			return reply.send(result);
		},
	);

	server.post<{ Params: { peerId: string }; Body: { companionToken?: string } }>(
		"/continuity/peers/:peerId/heartbeat",
		async (request, reply) => {
			if (!config.heartbeatContinuityPeer) {
				return reply.code(501).send({ error: "Continuity heartbeat not configured" });
			}
			if (typeof request.body?.companionToken !== "string") {
				return reply.code(400).send({ error: "Bad Request: companionToken is required" });
			}
			const result = await config.heartbeatContinuityPeer({
				peerId: request.params.peerId,
				companionToken: request.body.companionToken,
			});
			if (!result.success) {
				return reply.code(result.statusCode).send({ error: result.error });
			}
			return reply.send(result);
		},
	);

	server.post<{ Params: { peerId: string }; Body: { companionToken?: string } }>(
		"/continuity/peers/:peerId/detach",
		async (request, reply) => {
			if (!config.detachContinuityPeer) {
				return reply.code(501).send({ error: "Continuity detach not configured" });
			}
			if (typeof request.body?.companionToken !== "string") {
				return reply.code(400).send({ error: "Bad Request: companionToken is required" });
			}
			const result = await config.detachContinuityPeer({
				peerId: request.params.peerId,
				companionToken: request.body.companionToken,
			});
			if (!result.success) {
				return reply.code(result.statusCode).send({ error: result.error });
			}
			return reply.send(result);
		},
	);
}
