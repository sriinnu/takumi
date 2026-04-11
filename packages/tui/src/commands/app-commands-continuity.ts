import { saveSession } from "@takumi/core";
import {
	buildContinuityBootstrapPayload,
	ContinuityCompanionRegistry,
	describeContinuityAuditEvent,
	pruneExpiredContinuityGrants,
	recordContinuityEvent,
	storeContinuityGrant,
	sweepStaleContinuityPeers,
} from "../continuity/continuity-runtime.js";
import { createContinuityAttachGrant } from "../continuity/continuity-types.js";
import type { AppCommandContext } from "./app-command-context.js";

const DEFAULT_GRANT_TTL_MS = 10 * 60_000;
const helperRegistry = new ContinuityCompanionRegistry();

function continuityBaseUrl(): string {
	const explicit = process.env.TAKUMI_BRIDGE_PUBLIC_URL?.trim();
	if (explicit) {
		return explicit.replace(/\/$/, "");
	}
	const port = process.env.TAKUMI_BRIDGE_PORT?.trim() || "3100";
	return `http://127.0.0.1:${port}`;
}

function formatExpiry(epochMs: number): string {
	return new Date(epochMs).toLocaleString();
}

async function persistCurrentSession(ctx: AppCommandContext): Promise<void> {
	const session = ctx.buildSessionData();
	if (!session.id) return;
	await saveSession(session);
}

/**
 * I keep V1 grant administration intentionally small: operators can revoke a
 * single short-lived grant without mutating attached peers or lease state.
 */
async function revokeContinuityGrant(ctx: AppCommandContext, grantId: string): Promise<boolean> {
	pruneExpiredContinuityGrants(ctx.state);
	const before = ctx.state.continuityGrants.value.length;
	const revokedGrant = ctx.state.continuityGrants.value.find((grant) => grant.grantId === grantId);
	ctx.state.continuityGrants.value = ctx.state.continuityGrants.value.filter((grant) => grant.grantId !== grantId);
	if (ctx.state.continuityGrants.value.length === before) {
		return false;
	}
	if (revokedGrant) {
		recordContinuityEvent(ctx.state, {
			kind: "grant-revoked",
			grantId: revokedGrant.grantId,
			peerKind: revokedGrant.kind,
			role: revokedGrant.initialRole,
			note: "Operator revoked the attach grant.",
		});
	}
	await persistCurrentSession(ctx);
	return true;
}

/**
 * Expired grants are pruned first so the command only reports grants that were
 * still actionable when the operator cleared them.
 */
async function clearContinuityGrants(ctx: AppCommandContext): Promise<number> {
	pruneExpiredContinuityGrants(ctx.state);
	const cleared = ctx.state.continuityGrants.value.length;
	if (cleared === 0) {
		return 0;
	}
	for (const grant of ctx.state.continuityGrants.value) {
		recordContinuityEvent(ctx.state, {
			kind: "grant-revoked",
			grantId: grant.grantId,
			peerKind: grant.kind,
			role: grant.initialRole,
			note: "Operator cleared the remaining attach grants.",
		});
	}
	ctx.state.continuityGrants.value = [];
	await persistCurrentSession(ctx);
	return cleared;
}

function buildContinuityReport(ctx: AppCommandContext): string {
	pruneExpiredContinuityGrants(ctx.state);
	const grants = ctx.state.continuityGrants.value;
	const peers = ctx.state.continuityPeers.value;
	const events = ctx.state.continuityEvents.value;
	const lease = ctx.state.continuityLease.value;
	const lines = [
		"Continuity state:",
		`  Canonical session: ${ctx.state.canonicalSessionId.value || "(unbound)"}`,
		`  Grants           : ${grants.length}`,
		`  Attached peers   : ${peers.length}`,
		`  Lease            : ${lease ? `${lease.state} (epoch ${lease.epoch})` : "(none)"}`,
	];
	if (grants.length > 0) {
		lines.push("", "Active grants:");
		for (const grant of grants) {
			lines.push(
				`- ${grant.grantId} · ${grant.kind} · ${grant.initialRole} · expires ${formatExpiry(grant.expiresAt)}`,
			);
		}
	}
	if (peers.length > 0) {
		lines.push("", "Attached peers:");
		for (const peer of peers) {
			lines.push(
				`- ${peer.peerId} · ${peer.kind} · ${peer.role}${peer.shadowReady ? " · shadow-ready" : ""} · last seen ${formatExpiry(peer.lastSeenAt)}`,
			);
		}
	}
	if (events.length > 0) {
		lines.push("", "Recent events:");
		for (const event of events.slice(0, 5)) {
			lines.push(`- ${formatExpiry(event.occurredAt)} · ${describeContinuityAuditEvent(event)}`);
		}
	}
	return lines.join("\n");
}

function parseDurationMinutes(raw: string | undefined): number | null {
	if (!raw) return null;
	const minutes = Number.parseInt(raw, 10);
	if (Number.isNaN(minutes) || minutes <= 0) return null;
	return minutes;
}

export function registerContinuityCommands(ctx: AppCommandContext): void {
	ctx.commands.register("/pair", "Create a continuity attach grant (/pair mobile [minutes])", async (args) => {
		const [mode, ttlArg] = args.trim().split(/\s+/, 2);
		if (mode !== "mobile") {
			ctx.addInfoMessage("Usage: /pair mobile [minutes]");
			return;
		}

		const sessionId = ctx.state.canonicalSessionId.value || ctx.state.sessionId.value;
		if (!sessionId) {
			ctx.addInfoMessage("No active session to pair. Start or resume a session first.");
			return;
		}

		const ttlMinutes = parseDurationMinutes(ttlArg);
		if (ttlArg && ttlMinutes === null) {
			ctx.addInfoMessage("Usage: /pair mobile [minutes]");
			return;
		}

		const now = Date.now();
		pruneExpiredContinuityGrants(ctx.state, now);
		const grant = createContinuityAttachGrant({
			canonicalSessionId: sessionId,
			kind: "phone",
			initialRole: "observer",
			issuerRuntimeId: process.pid.toString(),
			ttlMs: ttlMinutes ? ttlMinutes * 60_000 : DEFAULT_GRANT_TTL_MS,
			transportRef: `${continuityBaseUrl()}/continuity/redeem`,
			now,
		});

		storeContinuityGrant(ctx.state, grant, now);
		recordContinuityEvent(ctx.state, {
			kind: "grant-issued",
			grantId: grant.grantId,
			peerKind: grant.kind,
			role: grant.initialRole,
			note: "Observer-only companion bootstrap issued.",
			occurredAt: now,
		});
		await persistCurrentSession(ctx);
		const bootstrap = buildContinuityBootstrapPayload(grant);

		ctx.addInfoMessage(
			[
				"Companion continuity grant created.",
				`Grant ID: ${grant.grantId}`,
				`Role: ${grant.initialRole}`,
				`Expires: ${formatExpiry(grant.expiresAt)}`,
				`Redeem: ${grant.transportRef}`,
				"Bootstrap payload:",
				JSON.stringify(bootstrap),
				"Note: this slice persists and exposes continuity state for companion-aware surfaces; privileged runtime transfer is still gated for later work.",
			].join("\n"),
		);
	});

	ctx.commands.register("/drift", "Alias for /pair mobile", async (args) => {
		await ctx.commands.execute(`/pair mobile${args.trim() ? ` ${args.trim()}` : ""}`);
	});

	ctx.commands.register("/continuity", "Inspect or manage continuity grants, peers, and lease state", async (args) => {
		const [subcommand, value] = args.trim().split(/\s+/, 2);
		const stateChanged =
			pruneExpiredContinuityGrants(ctx.state) || sweepStaleContinuityPeers(ctx.state, helperRegistry);
		if (stateChanged) {
			await persistCurrentSession(ctx);
		}
		if (!subcommand) {
			ctx.addInfoMessage(buildContinuityReport(ctx));
			return;
		}

		if (subcommand === "revoke") {
			if (!value) {
				ctx.addInfoMessage("Usage: /continuity revoke <grant-id>");
				return;
			}
			const revoked = await revokeContinuityGrant(ctx, value);
			ctx.addInfoMessage(revoked ? `Revoked continuity grant ${value}.` : `Continuity grant not found: ${value}`);
			return;
		}

		if (subcommand === "clear-grants") {
			const cleared = await clearContinuityGrants(ctx);
			ctx.addInfoMessage(
				cleared > 0
					? `Cleared ${cleared} continuity grant${cleared === 1 ? "" : "s"}.`
					: "No continuity grants to clear.",
			);
			return;
		}

		ctx.addInfoMessage("Usage: /continuity [revoke <grant-id> | clear-grants]");
	});
}
