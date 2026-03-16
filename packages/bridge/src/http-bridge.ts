import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastify, { type FastifyInstance } from "fastify";
import type { ChitraguptaSessionInfo, SessionDetail } from "./chitragupta-types.js";

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
	anomaly?: {
		severity: string;
		details: string;
		suggestion: string | null;
	} | null;
	updatedAt: number;
}

export interface HttpBridgeConfig {
	port: number;
	host: string;
	bearerToken?: string;
	cidrAllowlist?: string[];
	onSend?: (text: string) => Promise<void>;
	getStatus?: () => Promise<unknown>;
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
			if (this.config.bearerToken && !this.isLoopback(request.ip)) {
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

		this.server.get<{ Querystring: { limit?: string } }>("/sessions", async (request, reply) => {
			if (!this.config.getSessionList) {
				return reply.code(501).send({ error: "Session list not configured" });
			}
			const rawLimit = parseInt(request.query.limit || "20", 10);
			const limit = Number.isNaN(rawLimit) ? 20 : Math.max(1, Math.min(100, rawLimit));
			const sessions = await this.config.getSessionList(limit);
			return reply.send({ sessions });
		});

		this.server.get<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {
			if (!this.config.getSessionDetail) {
				return reply.code(501).send({ error: "Session detail not configured" });
			}
			const detail = await this.config.getSessionDetail(request.params.sessionId);
			if (!detail) {
				return reply.code(404).send({ error: "Session not found" });
			}
			return reply.send(detail);
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

		this.server.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/attach", async (request, reply) => {
			if (!this.config.onAttachSession) {
				return reply.code(501).send({ error: "Session attach not configured" });
			}
			const result = await this.config.onAttachSession(request.params.sessionId);
			if (!result.success) {
				return reply.code(404).send({ error: result.error ?? "Session not found" });
			}
			return reply.send({ success: true });
		});

		// ── Fleet observability endpoints ────────────────────────────────
		this.server.get("/fleet", async (_request, reply) => {
			if (!this.config.getFleetSummary) {
				return reply.code(501).send({ error: "Fleet summary not configured" });
			}
			return reply.send(await this.config.getFleetSummary());
		});

		this.server.get("/alerts", async (_request, reply) => {
			if (!this.config.getAlerts) {
				return reply.code(501).send({ error: "Alerts not configured" });
			}
			return reply.send({ alerts: await this.config.getAlerts() });
		});

		this.server.post<{ Params: { alertId: string } }>("/alerts/:alertId/ack", async (request, reply) => {
			if (!this.config.acknowledgeAlert) {
				return reply.code(501).send({ error: "Alert acknowledgement not configured" });
			}
			const ok = await this.config.acknowledgeAlert(request.params.alertId);
			if (!ok) return reply.code(404).send({ error: "Alert not found" });
			return reply.send({ success: true });
		});

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
