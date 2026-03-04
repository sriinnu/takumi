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
