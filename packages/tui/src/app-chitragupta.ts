import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { akashaDepositDefinition, akashaTracesDefinition, createAkashaHandlers } from "@takumi/agent";
import { ChitraguptaBridge } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AgentRunner } from "./agent-runner.js";
import type { AppState } from "./state.js";

const log = createLogger("app");

/** Timestamp (epoch ms) captured when the Chitragupta bridge first connects. */
let startedAt = 0;

/** Unsubscribe functions for daemon socket notification handlers. */
const notificationUnsubs: Array<() => void> = [];

/**
 * Subscribe to Chitragupta daemon push notifications.
 * These arrive as JSON-RPC messages without an `id` field.
 */
function subscribeToNotifications(state: AppState, bridge: ChitraguptaBridge): void {
	const socket = bridge.daemonSocket;
	if (!socket) return; // MCP subprocess mode — no push notifications

	notificationUnsubs.push(
		socket.onNotification("anomaly_alert", (params) => {
			const severity = params.severity as string;
			const details = params.details as string;
			const suggestion = params.suggestion as string | undefined;
			log.warn(`Chitragupta anomaly [${severity}]: ${details}`);
			state.chitraguptaAnomaly.value = { severity, details, suggestion: suggestion ?? null, at: Date.now() };
		}),
	);

	notificationUnsubs.push(
		socket.onNotification("pattern_detected", (params) => {
			const type = params.type as string;
			const confidence = params.confidence as number;
			log.info(`Chitragupta pattern [${type}]: confidence=${confidence.toFixed(2)}`);
			state.chitraguptaLastPattern.value = { type, confidence, at: Date.now() };
		}),
	);

	notificationUnsubs.push(
		socket.onNotification("prediction", (params) => {
			const predictions = params.predictions as Array<{ action: string; confidence: number }>;
			if (predictions?.length > 0) {
				log.debug(`Chitragupta prediction: ${predictions[0].action} (${predictions[0].confidence.toFixed(2)})`);
			}
			state.chitraguptaPredictions.value = predictions ?? [];
		}),
	);

	notificationUnsubs.push(
		socket.onNotification("evolve_request", (params) => {
			const type = params.type as string;
			log.info(`Chitragupta evolve request: ${type}`);
			state.chitraguptaEvolveQueue.value = [...state.chitraguptaEvolveQueue.value, params];
		}),
	);

	notificationUnsubs.push(
		socket.onNotification("preference_update", (params) => {
			const key = params.key as string;
			const value = params.value as string;
			log.info(`Chitragupta preference update: ${key}=${value}`);
		}),
	);

	log.info("Subscribed to Chitragupta daemon notifications");
}

function loadMcpConfig(): { command: string; args: string[] } | null {
	try {
		const mcpPath = join(process.cwd(), ".vscode", "mcp.json");
		if (!existsSync(mcpPath)) {
			log.debug("No .vscode/mcp.json found");
			return null;
		}
		const raw = readFileSync(mcpPath, "utf-8");
		const parsed = JSON.parse(raw);
		const chitraguptaConfig = parsed?.mcpServers?.chitragupta;
		if (!chitraguptaConfig?.command) return null;
		log.info("Loaded MCP config from .vscode/mcp.json");
		return { command: chitraguptaConfig.command, args: chitraguptaConfig.args || [] };
	} catch (err) {
		log.debug(`Failed to load MCP config: ${(err as Error).message}`);
		return null;
	}
}

export function connectChitragupta(
	state: AppState,
	agentRunner: AgentRunner | null,
	onInterval: (timer: ReturnType<typeof setInterval>) => void,
	/** Override the daemon socket path (from config.chitraguptaDaemon.socketPath). */
	socketPath?: string,
): void {
	const mcpConfig = loadMcpConfig();
	const bridge = new ChitraguptaBridge({
		command: mcpConfig?.command,
		args: mcpConfig?.args,
		projectPath: process.cwd(),
		startupTimeoutMs: 8_000,
		socketPath, // undefined → auto-resolve; "" → disable socket mode
	});
	state.chitraguptaBridge.value = bridge;

	bridge
		.connect()
		.then(async () => {
			state.chitraguptaConnected.value = true;
			startedAt = Date.now();
			log.info("Chitragupta bridge connected");

			// Subscribe to server-push notifications (anomaly, pattern, prediction, etc.)
			subscribeToNotifications(state, bridge);

			if (agentRunner) {
				const tools = agentRunner.getTools();
				const handlers = createAkashaHandlers(
					bridge,
					() => {
						state.akashaDeposits.value++;
						state.akashaLastActivity.value = Date.now();
					},
					() => {
						state.akashaLastActivity.value = Date.now();
					},
				);
				tools.register(akashaDepositDefinition, handlers.deposit);
				tools.register(akashaTracesDefinition, handlers.traces);
				log.info("Registered Akasha tools");
			}

			try {
				const cwd = process.cwd();
				const projectName = cwd.split("/").pop() ?? cwd;
				const results = await bridge.unifiedRecall(projectName, 5, projectName);
				if (results.length > 0) {
					state.chitraguptaMemory.value = results
						.map(
							(r, i) =>
								`${i + 1}. [score ${r.score.toFixed(2)} | ${r.type}${r.source ? ` | ${r.source}` : ""}]\n${r.content}`,
						)
						.join("\n\n");
					log.info(`Loaded ${results.length} memory entries from Chitragupta (unified recall)`);
				}
			} catch (err) {
				log.debug(`Chitragupta memory preload failed: ${(err as Error).message}`);
			}

			try {
				const tendencies = await bridge.vasanaTendencies(10);
				state.vasanaTendencies.value = tendencies;
				state.vasanaLastRefresh.value = Date.now();
				if (tendencies.length > 0) log.info(`Loaded ${tendencies.length} vasana tendencies from Chitragupta`);
			} catch (err) {
				log.debug(`Chitragupta vasana preload failed: ${(err as Error).message}`);
			}

			try {
				const health = await bridge.healthStatus();
				if (!health) return;
				state.chitraguptaHealth.value = health;
				log.info(`Chitragupta health: ${health.dominant} (sattva=${health.state.sattva.toFixed(2)})`);
			} catch (err) {
				log.debug(`Chitragupta health check failed: ${(err as Error).message}`);
			}

			// Telemetry heartbeat — emits process + context status every 1.5s
			const heartbeatTimer = setInterval(async () => {
				const b = state.chitraguptaBridge.value;
				if (!b?.isConnected) return;
				try {
					await b.telemetryHeartbeat({
						process: {
							pid: process.pid,
							ppid: process.ppid ?? 0,
							uptime: process.uptime(),
							heartbeatAt: Date.now(),
							startedAt,
						} as never,
						state: {
							activity: state.isStreaming.value ? "working" : "waiting_input",
							idle: !state.isStreaming.value,
						} as never,
						context: {
							tokens: state.contextTokens.value,
							contextWindow: state.contextWindow.value,
							remainingTokens: state.contextWindow.value - state.contextTokens.value,
							percent: state.contextPercent.value,
							pressure: state.contextPressure.value as never,
							closeToLimit: state.contextPercent.value >= 85,
							nearLimit: state.contextPercent.value >= 95,
						} as never,
						lastEvent: "heartbeat",
					});
				} catch (err) {
					log.debug(`Telemetry heartbeat failed: ${(err as Error).message}`);
				}
			}, 1_500);
			onInterval(heartbeatTimer);

			// Vasana/health refresh — polls every 60s
			const vasanaTimer = setInterval(async () => {
				const b = state.chitraguptaBridge.value;
				if (!b?.isConnected) return;
				try {
					const [t, h] = await Promise.all([b.vasanaTendencies(10), b.healthStatus()]);
					state.vasanaTendencies.value = t;
					if (h) state.chitraguptaHealth.value = h;
					state.vasanaLastRefresh.value = Date.now();
				} catch {
					/* best effort */
				}
			}, 60_000);
			onInterval(vasanaTimer);
		})
		.catch((err) => {
			log.debug(`Chitragupta bridge connection failed: ${(err as Error).message}`);
			state.chitraguptaConnected.value = false;
			state.chitraguptaBridge.value = null;
		});

	bridge.mcpClient.on("disconnected", () => {
		state.chitraguptaConnected.value = false;
		log.info("Chitragupta bridge disconnected");
	});
	bridge.mcpClient.on("error", (err) => {
		log.debug(`Chitragupta bridge error: ${(err as Error).message}`);
		state.chitraguptaConnected.value = false;
	});
}

export async function disconnectChitragupta(state: AppState): Promise<void> {
	const bridge = state.chitraguptaBridge.value;
	if (!bridge || !bridge.isConnected) return;

	// Unsubscribe from daemon notifications
	for (const unsub of notificationUnsubs) unsub();
	notificationUnsubs.length = 0;

	// Cleanup telemetry heartbeat file before handover
	try {
		await bridge.telemetryCleanup(process.pid);
		log.debug("Telemetry heartbeat file cleaned up");
	} catch (err) {
		log.debug(`Telemetry cleanup failed: ${(err as Error).message}`);
	}

	try {
		await Promise.race([
			bridge.handover(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("handover timeout")), 3_000)),
		]);
		log.debug("Chitragupta handover completed");
	} catch (err) {
		log.debug(`Chitragupta handover failed: ${(err as Error).message}`);
	}

	try {
		await bridge.disconnect();
	} catch (err) {
		log.debug(`Chitragupta disconnect failed: ${(err as Error).message}`);
	}
	state.chitraguptaConnected.value = false;
	state.chitraguptaBridge.value = null;
}
