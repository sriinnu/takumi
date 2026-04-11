import type { FastifyInstance } from "fastify";
import type { HttpBridgeConfig } from "./http-bridge.js";

/** Register session-centric bridge endpoints used by operators and remote shells. */
export function registerHttpBridgeSessionRoutes(server: FastifyInstance, config: HttpBridgeConfig): void {
	server.get<{ Querystring: { limit?: string } }>("/sessions", async (request, reply) => {
		if (!config.getSessionList) {
			return reply.code(501).send({ error: "Session list not configured" });
		}
		const rawLimit = parseInt(request.query.limit || "20", 10);
		const limit = Number.isNaN(rawLimit) ? 20 : Math.max(1, Math.min(100, rawLimit));
		const sessions = await config.getSessionList(limit);
		return reply.send({ sessions });
	});

	server.get<{ Params: { sessionId: string } }>("/sessions/:sessionId", async (request, reply) => {
		if (!config.getSessionDetail) {
			return reply.code(501).send({ error: "Session detail not configured" });
		}
		const detail = await config.getSessionDetail(request.params.sessionId);
		if (!detail) {
			return reply.code(404).send({ error: "Session not found" });
		}
		return reply.send(detail);
	});

	server.post<{ Params: { sessionId: string } }>("/sessions/:sessionId/attach", async (request, reply) => {
		if (!config.onAttachSession) {
			return reply.code(501).send({ error: "Session attach not configured" });
		}
		const result = await config.onAttachSession(request.params.sessionId);
		if (!result.success) {
			return reply.code(404).send({ error: result.error ?? "Session not found" });
		}
		return reply.send({ success: true });
	});

	server.post<{ Body: { action?: string; index?: number } }>("/extension-ui/respond", async (request, reply) => {
		if (!config.respondExtensionPrompt) {
			return reply.code(501).send({ error: "Extension UI response not configured" });
		}
		const action = request.body?.action;
		if (action !== "confirm" && action !== "cancel" && action !== "pick") {
			return reply.code(400).send({ error: "Bad Request: Invalid extension prompt action" });
		}
		if (action === "pick" && !Number.isInteger(request.body?.index)) {
			return reply.code(400).send({ error: "Bad Request: Pick responses require an integer index" });
		}
		const result = await config.respondExtensionPrompt(
			action === "pick" ? { action, index: request.body.index } : { action },
		);
		if (!result.success) {
			return reply.code(409).send({ error: result.error ?? "Extension prompt response rejected" });
		}
		return reply.send({ success: true });
	});
}

/** Register operator/fleet/artifact/runtime bridge endpoints. */
export function registerHttpBridgeOperatorRoutes(server: FastifyInstance, config: HttpBridgeConfig): void {
	server.get("/fleet", async (_request, reply) => {
		if (!config.getFleetSummary) {
			return reply.code(501).send({ error: "Fleet summary not configured" });
		}
		return reply.send(await config.getFleetSummary());
	});

	server.get("/alerts", async (_request, reply) => {
		if (!config.getAlerts) {
			return reply.code(501).send({ error: "Alerts not configured" });
		}
		return reply.send({ alerts: await config.getAlerts() });
	});

	server.post<{ Params: { alertId: string } }>("/alerts/:alertId/ack", async (request, reply) => {
		if (!config.acknowledgeAlert) {
			return reply.code(501).send({ error: "Alert acknowledgement not configured" });
		}
		const ok = await config.acknowledgeAlert(request.params.alertId);
		if (!ok) return reply.code(404).send({ error: "Alert not found" });
		return reply.send({ success: true });
	});

	server.get("/approvals", async (_request, reply) => {
		if (!config.getPendingApprovals) {
			return reply.code(501).send({ error: "Approval queue not configured" });
		}
		return reply.send({ approvals: await config.getPendingApprovals() });
	});

	server.post<{ Params: { approvalId: string; decision: string } }>(
		"/approvals/:approvalId/:decision",
		async (request, reply) => {
			if (!config.decideApproval) {
				return reply.code(501).send({ error: "Approval decisions not configured" });
			}
			if (request.params.decision !== "approve" && request.params.decision !== "deny") {
				return reply.code(400).send({ error: "Bad Request: decision must be approve or deny" });
			}
			const ok = await config.decideApproval(
				request.params.approvalId,
				request.params.decision === "approve" ? "approved" : "denied",
			);
			if (!ok) return reply.code(404).send({ error: "Approval not found" });
			return reply.send({ success: true });
		},
	);

	server.get<{ Querystring: { sessionId?: string; kind?: string; limit?: string } }>(
		"/artifacts",
		async (request, reply) => {
			if (!config.getArtifacts) {
				return reply.code(501).send({ error: "Artifact listing not configured" });
			}
			const rawLimit = parseInt(request.query.limit || "20", 10);
			const limit = Number.isNaN(rawLimit) ? 20 : Math.max(1, Math.min(100, rawLimit));
			return reply.send({
				artifacts: await config.getArtifacts(request.query.sessionId, request.query.kind, limit),
			});
		},
	);

	server.get<{ Params: { artifactId: string } }>("/artifacts/:artifactId", async (request, reply) => {
		if (!config.getArtifact) {
			return reply.code(501).send({ error: "Artifact detail not configured" });
		}
		const artifact = await config.getArtifact(request.params.artifactId);
		if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
		return reply.send(artifact);
	});

	server.post<{ Params: { artifactId: string }; Body: { promoted?: boolean } }>(
		"/artifacts/:artifactId/promote",
		async (request, reply) => {
			if (!config.setArtifactPromoted) {
				return reply.code(501).send({ error: "Artifact promotion not configured" });
			}
			const promoted = request.body?.promoted ?? true;
			const ok = await config.setArtifactPromoted(request.params.artifactId, promoted);
			if (!ok) return reply.code(404).send({ error: "Artifact not found" });
			return reply.send({ success: true, promoted });
		},
	);

	server.get("/repo/diff", async (_request, reply) => {
		if (!config.getRepoDiff) {
			return reply.code(501).send({ error: "Repo diff not configured" });
		}
		return reply.send(await config.getRepoDiff());
	});

	server.post<{ Params: { pid: string } }>("/agent/:pid/interrupt", async (request, reply) => {
		if (!config.onInterrupt) {
			return reply.code(501).send({ error: "Interrupt not configured" });
		}
		const pid = parseInt(request.params.pid, 10);
		if (Number.isNaN(pid)) return reply.code(400).send({ error: "Bad Request: Invalid PID" });
		const ok = await config.onInterrupt(pid);
		if (!ok) return reply.code(404).send({ error: "Agent not found" });
		return reply.send({ success: true });
	});

	server.post<{ Params: { pid: string } }>("/agent/:pid/refresh", async (request, reply) => {
		if (!config.onRefresh) {
			return reply.code(501).send({ error: "Refresh not configured" });
		}
		const pid = parseInt(request.params.pid, 10);
		if (Number.isNaN(pid)) return reply.code(400).send({ error: "Bad Request: Invalid PID" });
		const ok = await config.onRefresh(pid);
		if (!ok) return reply.code(404).send({ error: "Agent not found" });
		return reply.send({ success: true });
	});

	server.get("/runtime/list", async (_request, reply) => {
		if (!config.listRuntimes) {
			return reply.code(501).send({ error: "Runtime listing not configured" });
		}
		return reply.send({ runtimes: await config.listRuntimes() });
	});

	server.post<{ Body: { sessionId?: string; provider?: string; model?: string } }>(
		"/runtime/start",
		async (request, reply) => {
			if (!config.onStartRuntime) {
				return reply.code(501).send({ error: "Runtime start not configured" });
			}
			const runtime = await config.onStartRuntime(request.body ?? {});
			return reply.code(201).send(runtime);
		},
	);

	server.post<{ Params: { runtimeId: string } }>("/runtime/:runtimeId/stop", async (request, reply) => {
		if (!config.stopRuntime) {
			return reply.code(501).send({ error: "Runtime stop not configured" });
		}
		const ok = await config.stopRuntime(request.params.runtimeId);
		if (!ok) return reply.code(404).send({ error: "Runtime not found" });
		return reply.send({ success: true });
	});
}
