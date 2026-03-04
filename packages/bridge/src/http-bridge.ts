import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastify, { type FastifyInstance } from "fastify";

export interface HttpBridgeConfig {
	port: number;
	host: string;
	bearerToken?: string;
	cidrAllowlist?: string[];
	onSend?: (text: string) => Promise<void>;
	getStatus?: () => Promise<unknown>;
}

export class HttpBridgeServer {
	private server: FastifyInstance | null = null;
	private config: HttpBridgeConfig;

	constructor(config: HttpBridgeConfig) {
		this.config = config;
	}

	public async start(): Promise<void> {
		if (this.server) {
			return;
		}

		this.server = fastify({ logger: false });

		await this.server.register(cors, {
			origin: "*",
		});

		await this.server.register(rateLimit, {
			max: 100,
			timeWindow: "1 minute",
		});

		this.server.addHook("preHandler", async (request, reply) => {
			if (!this.isAllowedIp(request.ip)) {
				return reply.code(403).send({ error: "Forbidden: IP not in allowlist" });
			}

			if (this.config.bearerToken && !this.isLoopback(request.ip)) {
				const authHeader = request.headers.authorization;
				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					return reply.code(401).send({ error: "Unauthorized: Missing or invalid token" });
				}
				const token = authHeader.substring(7);
				if (token !== this.config.bearerToken) {
					return reply.code(401).send({ error: "Unauthorized: Invalid token" });
				}
			}
		});

		this.server.get("/status", async (_request, reply) => {
			if (this.config.getStatus) {
				const status = await this.config.getStatus();
				return reply.send(status);
			}
			return reply.send({ status: "ok" });
		});

		this.server.get<{ Querystring: { timeout_ms?: string; fingerprint?: string } }>(
			"/watch",
			async (request, reply) => {
				const timeoutMs = parseInt(request.query.timeout_ms || "30000", 10);
				// Basic placeholder for long polling
				await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 5000)));
				return reply.send({ changes: false });
			},
		);

		this.server.get<{ Params: { pid: string } }>("/latest/:pid", async (request, reply) => {
			return reply.send({ content: `placeholder for ${request.params.pid}` });
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

		await this.server.listen({
			port: this.config.port,
			host: this.config.host,
		});
	}

	public async stop(): Promise<void> {
		if (this.server) {
			await this.server.close();
			this.server = null;
		}
	}

	private isLoopback(ip: string): boolean {
		return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.0.0.1");
	}

	private isAllowedIp(ip: string): boolean {
		if (!this.config.cidrAllowlist || this.config.cidrAllowlist.length === 0) {
			return true;
		}

		if (this.isLoopback(ip)) {
			return true;
		}

		for (const cidr of this.config.cidrAllowlist) {
			if (cidr === "127.0.0.1/8" && ip.startsWith("127.")) {
				return true;
			}
			if (ip === cidr.split("/")[0]) {
				return true;
			}
		}

		return false;
	}
}
