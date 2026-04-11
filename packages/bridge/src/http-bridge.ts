import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastify, { type FastifyInstance } from "fastify";
import type { ChitraguptaSessionInfo, SessionDetail } from "./chitragupta-types.js";
import {
	type ContinuityPeerActionResult,
	type ContinuityRedeemResult,
	type ContinuityStateSnapshot,
	isCompanionContinuityRoute,
	registerContinuityRoutes,
} from "./http-bridge-continuity-routes.js";
import { registerHttpBridgeOperatorRoutes, registerHttpBridgeSessionRoutes } from "./http-bridge-routes.js";

export interface TokmeterProjectSnapshot {
	/** Source identifier so clients can explain where project telemetry came from. */
	source: "tokmeter-core";
	/** Project substring used when querying tokmeter. */
	projectQuery: string;
	/** Epoch ms when this tokmeter snapshot was refreshed. */
	refreshedAt: number;
	/** Distinct tokmeter project buckets that matched the query. */
	matchedProjects: string[];
	/** Aggregated token count across all matched project records. */
	totalTokens: number;
	/** Aggregated spend across all matched project records. */
	totalCostUsd: number;
	/** Tokens recorded today for the matched project set. */
	todayTokens: number;
	/** Spend recorded today for the matched project set. */
	todayCostUsd: number;
	/** Number of active days represented by the matched project set. */
	activeDays: number;
	/** Number of priced or unpriced usage records seen by tokmeter. */
	totalRecords: number;
	/** Highest-cost models in the matched project set. */
	topModels: Array<{
		model: string;
		provider: string;
		totalTokens: number;
		costUsd: number;
		percentageOfTotal: number;
	}>;
	/** Highest-cost providers in the matched project set. */
	topProviders: Array<{
		provider: string;
		totalTokens: number;
		costUsd: number;
		percentageOfTotal: number;
	}>;
	/** Recent daily cost/token samples for lightweight spark charts. */
	recentDaily: Array<{
		date: string;
		totalTokens: number;
		costUsd: number;
	}>;
	/** Optional operator-facing note explaining empty or degraded tokmeter data. */
	note: string | null;
}

export interface AgentStateSnapshot {
	pid: number;
	activity: "working" | "waiting_input" | "idle" | "error";
	model: string | null;
	provider: string | null;
	sessionId: string | null;
	runtimeSource: string | null;
	lastAssistantText: string | null;
	toolsInFlight: string[];
	contextPercent: number | null;
	contextPressure?: string | null;
	bridgeConnected?: boolean;
	sync?: {
		canonicalSessionId: string | null;
		status: "idle" | "pending" | "syncing" | "ready" | "failed";
		pendingLocalTurns: number;
		lastSyncError: string | null;
		lastSyncedMessageId: string | null;
		lastSyncedMessageTimestamp: number | null;
		lastAttemptedMessageId: string | null;
		lastAttemptedMessageTimestamp: number | null;
		lastFailedMessageId: string | null;
		lastFailedMessageTimestamp: number | null;
		lastSyncedAt: number | null;
	} | null;
	routing?: {
		capability: string | null;
		authority: "engine" | "takumi-fallback";
		enforcement: "same-provider" | "capability-only";
		laneCount: number;
		degraded: boolean;
		fallbackChain: string[];
		reason: string | null;
		selectedId: string | null;
	} | null;
	approval?: {
		pendingCount: number;
		tool: string | null;
		argsSummary: string | null;
	} | null;
	usage?: {
		turnCount: number;
		totalTokens: number;
		totalCostUsd: number;
		ratePerMinute: number;
		projectedUsd: number;
		budgetFraction: number;
		alertLevel: "none" | "info" | "warning" | "critical";
	} | null;
	anomaly?: {
		severity: string;
		details: string;
		suggestion: string | null;
	} | null;
	extensionUi?: {
		prompt:
			| {
					kind: "confirm";
					title?: string;
					message: string;
			  }
			| {
					kind: "pick";
					title?: string;
					message: string;
					optionCount: number;
					options: Array<{ index: number; label: string; description?: string }>;
			  }
			| null;
		widgets: Array<{
			key: string;
			previewLines: string[];
			truncated: boolean;
		}>;
	} | null;
	tokmeter?: TokmeterProjectSnapshot | null;
	continuity?: ContinuityStateSnapshot | null;
	updatedAt: number;
}

export interface PendingApprovalSnapshot {
	id: string;
	tool: string;
	argsSummary: string;
	createdAt: number;
	sessionId?: string;
	lane?: "session" | "project" | "global";
	reason?: string;
	active: boolean;
}

export interface BridgeArtifactSummary {
	artifactId: string;
	kind: string;
	producer: string;
	summary: string;
	createdAt: string;
	promoted: boolean;
	taskId?: string;
	sessionId?: string;
}

export interface BridgeArtifactDetail extends BridgeArtifactSummary {
	body?: string;
	path?: string;
	confidence?: number;
	laneId?: string;
	metadata?: Record<string, unknown>;
}

export interface RepoDiffSnapshot {
	branch: string | null;
	isClean: boolean;
	stagedFiles: string[];
	modifiedFiles: string[];
	untrackedFiles: string[];
	stagedDiff: string;
	workingDiff: string;
}

export interface RuntimeSummary {
	runtimeId: string;
	pid: number;
	state: string;
	startedAt: number;
	cwd: string;
	logFile: string;
	command?: string;
	args?: string[];
	sessionId?: string;
	runtimeSource?: string;
}

export interface HttpBridgeConfig {
	port: number;
	host: string;
	bearerToken?: string;
	cidrAllowlist?: string[];
	onSend?: (text: string) => Promise<void>;
	getStatus?: () => Promise<unknown>;
	/** Return continuity summary for mobile/browser companion surfaces. */
	getContinuityState?: () => Promise<ContinuityStateSnapshot | null>;
	/** Redeem a short-lived continuity grant into a trusted attached peer. */
	redeemContinuityGrant?: (input: { grantId: string; nonce: string; kind?: string }) => Promise<ContinuityRedeemResult>;
	/** Refresh one attached companion peer without granting new authority. */
	heartbeatContinuityPeer?: (input: { peerId: string; companionToken: string }) => Promise<ContinuityPeerActionResult>;
	/** Explicitly detach one attached companion peer. */
	detachContinuityPeer?: (input: { peerId: string; companionToken: string }) => Promise<ContinuityPeerActionResult>;
	/** Return the current agent state snapshot for a given PID (or current process). */
	getAgentState?: (pid?: number) => Promise<AgentStateSnapshot | null>;
	/** Return a list of all known agent PIDs. */
	listAgents?: () => Promise<number[]>;
	/** Return recent Chitragupta sessions for desktop/operator surfaces. */
	getSessionList?: (limit?: number) => Promise<ChitraguptaSessionInfo[]>;
	/** Return a single session detail. */
	getSessionDetail?: (sessionId: string) => Promise<SessionDetail | null>;
	/** Attach (resume) a session by ID — local first, daemon fallback. */
	onAttachSession?: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
	/** Return fleet observability summary. */
	getFleetSummary?: () => Promise<unknown>;
	/** Return active alerts. */
	getAlerts?: () => Promise<unknown[]>;
	/** Acknowledge an alert by ID. */
	acknowledgeAlert?: (alertId: string) => Promise<boolean>;
	/** Return pending approvals and recent audit records relevant to the operator. */
	getPendingApprovals?: () => Promise<PendingApprovalSnapshot[]>;
	/** Submit an operator decision for a pending approval. */
	decideApproval?: (approvalId: string, decision: "approved" | "denied") => Promise<boolean>;
	/** Return local/hub artifacts for an operator surface. */
	getArtifacts?: (sessionId?: string, kind?: string, limit?: number) => Promise<BridgeArtifactSummary[]>;
	/** Return a single artifact with full detail. */
	getArtifact?: (artifactId: string) => Promise<BridgeArtifactDetail | null>;
	/** Update artifact promotion state. */
	setArtifactPromoted?: (artifactId: string, promoted: boolean) => Promise<boolean>;
	/** Return current repo diff state for review surfaces. */
	getRepoDiff?: () => Promise<RepoDiffSnapshot>;
	/** Interrupt the active agent run for a PID. */
	onInterrupt?: (pid: number) => Promise<boolean>;
	/** Force a fresh state notification for watchers. */
	onRefresh?: (pid: number) => Promise<boolean>;
	/** Start a sibling runtime from the current local installation. */
	onStartRuntime?: (options?: { sessionId?: string; provider?: string; model?: string }) => Promise<RuntimeSummary>;
	/** List locally known runtimes. */
	listRuntimes?: () => Promise<RuntimeSummary[]>;
	/** Stop a runtime by ID. */
	stopRuntime?: (runtimeId: string) => Promise<boolean>;
	/** Resolve an active extension-owned prompt from a remote operator surface. */
	respondExtensionPrompt?: (response: { action: "confirm" | "cancel" | "pick"; index?: number }) => Promise<{
		success: boolean;
		error?: string;
	}>;
}

const MAX_WATCH_WAITERS = 100;

export class HttpBridgeServer {
	private server: FastifyInstance | null = null;
	private config: HttpBridgeConfig;
	private stateFingerprint = 0;
	private watchWaiters: Array<{ resolve: (changed: boolean) => void; timer: ReturnType<typeof setTimeout> }> = [];

	constructor(config: HttpBridgeConfig) {
		this.config = config;
	}

	/** Call this when agent state changes to wake up long-polling /watch clients. */
	public notifyStateChange(): void {
		this.stateFingerprint++;
		for (const waiter of this.watchWaiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.resolve(true);
		}
	}

	public async start(): Promise<void> {
		if (this.server) return;

		this.server = fastify({ logger: false });
		await this.server.register(cors, { origin: "*" });
		await this.server.register(rateLimit, { max: 100, timeWindow: "1 minute" });

		this.server.addHook("preHandler", async (request, reply) => {
			if (!this.isAllowedIp(request.ip)) {
				return reply.code(403).send({ error: "Forbidden: IP not in allowlist" });
			}
			if (
				this.config.bearerToken &&
				!this.isLoopback(request.ip) &&
				!isCompanionContinuityRoute(request.method, request.raw.url)
			) {
				const authHeader = request.headers.authorization;
				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					return reply.code(401).send({ error: "Unauthorized: Missing or invalid token" });
				}
				if (!this.timingSafeTokenCompare(authHeader.substring(7), this.config.bearerToken)) {
					return reply.code(401).send({ error: "Unauthorized: Invalid token" });
				}
			}
		});

		this.server.get("/status", async (_request, reply) => {
			if (this.config.getStatus) {
				return reply.send(await this.config.getStatus());
			}
			return reply.send({ status: "ok" });
		});

		registerContinuityRoutes(this.server, this.config);

		this.server.get<{ Querystring: { timeout_ms?: string; fingerprint?: string } }>(
			"/watch",
			async (request, reply) => {
				const rawTimeout = parseInt(request.query.timeout_ms || "30000", 10);
				const timeoutMs = Math.min(Number.isNaN(rawTimeout) ? 30000 : rawTimeout, 60000);
				const rawFp = parseInt(request.query.fingerprint || "0", 10);
				const clientFingerprint = Number.isNaN(rawFp) ? 0 : rawFp;

				// Immediately return if state has changed since client's fingerprint
				if (clientFingerprint !== this.stateFingerprint) {
					return reply.send({ changes: true, fingerprint: this.stateFingerprint });
				}

				// Reject if too many concurrent long-poll waiters (DoS protection)
				if (this.watchWaiters.length >= MAX_WATCH_WAITERS) {
					return reply.code(503).send({ error: "Too many concurrent watchers" });
				}

				// Long-poll: wait for state change or timeout
				const changed = await new Promise<boolean>((resolve) => {
					const timer = setTimeout(() => {
						const idx = this.watchWaiters.findIndex((w) => w.resolve === resolve);
						if (idx >= 0) this.watchWaiters.splice(idx, 1);
						resolve(false);
					}, timeoutMs);
					this.watchWaiters.push({ resolve, timer });
				});

				return reply.send({ changes: changed, fingerprint: this.stateFingerprint });
			},
		);

		this.server.get("/agents", async (_request, reply) => {
			if (this.config.listAgents) {
				const pids = await this.config.listAgents();
				return reply.send({ agents: pids });
			}
			return reply.send({ agents: [process.pid] });
		});

		this.server.get<{ Params: { pid: string } }>("/latest/:pid", async (request, reply) => {
			const pid = parseInt(request.params.pid, 10);
			if (Number.isNaN(pid)) {
				return reply.code(400).send({ error: "Bad Request: Invalid PID" });
			}
			if (this.config.getAgentState) {
				const state = await this.config.getAgentState(pid);
				if (!state) return reply.code(404).send({ error: "Agent not found" });
				return reply.send(state);
			}
			return reply.code(501).send({ error: "Agent state not configured" });
		});

		this.server.post<{ Body: { text: string } }>("/send", async (request, reply) => {
			if (!request.body || typeof request.body.text !== "string") {
				return reply.code(400).send({ error: "Bad Request: Missing text property" });
			}
			if (this.config.onSend) {
				await this.config.onSend(request.body.text);
			}
			return reply.send({ success: true });
		});

		registerHttpBridgeSessionRoutes(this.server, this.config);
		registerHttpBridgeOperatorRoutes(this.server, this.config);

		await this.server.listen({ port: this.config.port, host: this.config.host });
	}

	public async stop(): Promise<void> {
		// Clean up any pending long-poll waiters
		for (const waiter of this.watchWaiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.resolve(false);
		}
		if (this.server) {
			await this.server.close();
			this.server = null;
		}
	}

	private timingSafeTokenCompare(a: string, b: string): boolean {
		const bufA = Buffer.from(a);
		const bufB = Buffer.from(b);
		if (bufA.length !== bufB.length) return false;
		return timingSafeEqual(bufA, bufB);
	}

	private isLoopback(ip: string): boolean {
		return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.0.0.1");
	}

	private isAllowedIp(ip: string): boolean {
		if (!this.config.cidrAllowlist || this.config.cidrAllowlist.length === 0) return true;
		if (this.isLoopback(ip)) return true;
		for (const cidr of this.config.cidrAllowlist) {
			const [base, prefixStr] = cidr.split("/");
			const rawPrefix = parseInt(prefixStr ?? "32", 10);
			const prefix = Number.isNaN(rawPrefix) ? 32 : Math.max(0, Math.min(32, rawPrefix));
			if (this.ipMatchesCidr(ip, base, prefix)) return true;
		}
		return false;
	}

	private ipMatchesCidr(ip: string, base: string, prefix: number): boolean {
		const ipNum = this.ipv4ToNum(ip);
		const baseNum = this.ipv4ToNum(base);
		if (ipNum === null || baseNum === null) return ip === base; // non-IPv4 fallback: exact match
		const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
		return (ipNum & mask) === (baseNum & mask);
	}

	private ipv4ToNum(ip: string): number | null {
		// Strip ::ffff: prefix for IPv4-mapped IPv6
		const raw = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
		const parts = raw.split(".");
		if (parts.length !== 4) return null;
		let num = 0;
		for (const p of parts) {
			const octet = parseInt(p, 10);
			if (Number.isNaN(octet) || octet < 0 || octet > 255) return null;
			num = (num << 8) | octet;
		}
		return num >>> 0;
	}
}
