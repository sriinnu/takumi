import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SteeringPriorityLevel } from "@takumi/agent";
import { akashaDepositDefinition, akashaTracesDefinition, createAkashaHandlers, SteeringPriority } from "@takumi/agent";
import { ChitraguptaBridge, ChitraguptaObserver } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AgentRunner } from "./agent-runner.js";
import type { AppState } from "./state.js";

const log = createLogger("app");

/** Timestamp (epoch ms) captured when the Chitragupta bridge first connects. */
let startedAt = 0;

const RECENT_NOTIFICATION_WINDOW_MS = 8_000;
const recentDirectives = new Map<string, number>();

function wasRecentlyHandled(key: string, windowMs = RECENT_NOTIFICATION_WINDOW_MS): boolean {
	const now = Date.now();
	const lastAt = recentDirectives.get(key) ?? 0;
	if (lastAt && now - lastAt < windowMs) return true;
	recentDirectives.set(key, now);
	return false;
}

function enqueueDirective(
	state: AppState,
	text: string,
	priority: SteeringPriorityLevel,
	metadata?: Record<string, unknown>,
): void {
	const id = state.steeringQueue.enqueue(text, { priority, metadata });
	if (id) {
		state.steeringPending.value = state.steeringQueue.size;
	}
}

function parseStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

function normalizePredictions(params: Record<string, unknown>): Array<{
	type: string;
	action?: string;
	files?: string[];
	confidence: number;
	reasoning?: string;
	risk?: number;
	pastFailures?: number;
	suggestion?: string;
}> {
	const raw = Array.isArray(params.predictions) ? params.predictions : [];
	const predictions: Array<{
		type: string;
		action?: string;
		files?: string[];
		confidence: number;
		reasoning?: string;
		risk?: number;
		pastFailures?: number;
		suggestion?: string;
	}> = [];

	for (const entry of raw) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const prediction = entry as Record<string, unknown>;
		const confidence = Number(prediction.confidence ?? 0);
		predictions.push({
			type: String(prediction.type ?? params.type ?? "prediction"),
			action: typeof prediction.action === "string" ? prediction.action : undefined,
			files: parseStringArray(prediction.files),
			confidence: Number.isFinite(confidence) ? confidence : 0,
			reasoning: typeof prediction.reasoning === "string" ? prediction.reasoning : undefined,
			risk: Number.isFinite(Number(prediction.risk)) ? Number(prediction.risk) : undefined,
			pastFailures: Number.isFinite(Number(prediction.pastFailures)) ? Number(prediction.pastFailures) : undefined,
			suggestion: typeof prediction.suggestion === "string" ? prediction.suggestion : undefined,
		});
	}

	return predictions;
}

/**
 * Subscribe to Chitragupta daemon push notifications.
 * These arrive as JSON-RPC messages without an `id` field.
 */
function subscribeToNotifications(
	state: AppState,
	observer: ChitraguptaObserver,
	agentRunner: AgentRunner | null,
): void {
	observer.subscribe({
		onAnomalyAlert: (params) => {
			const type = String(params.type ?? "anomaly");
			const severity = String(params.severity ?? "warning");
			const suggestion = typeof params.suggestion === "string" ? params.suggestion : undefined;
			const details = typeof params.details === "string" ? params.details : JSON.stringify(params.details ?? {});

			log.warn(`Chitragupta anomaly [${severity}] ${type}: ${details}`);
			state.chitraguptaAnomaly.value = { severity, details, suggestion: suggestion ?? null, at: Date.now() };

			if (agentRunner?.isRunning && (type === "loop_detected" || suggestion === "abort")) {
				agentRunner.cancel();
				const sessionId = state.sessionId.value || "takumi-live";
				void observer
					.healReport({
						anomalyType: type,
						actionTaken: "cancel_run",
						outcome: "success",
						sessionId,
					})
					.catch(() => {
						/* best effort */
					});
				return;
			}

			const directiveKey = `anomaly:${type}:${severity}:${suggestion ?? ""}`;
			if (agentRunner?.isRunning && !wasRecentlyHandled(directiveKey)) {
				const directive = suggestion
					? `Chitragupta anomaly alert: ${type} (${severity}). ${suggestion}. Avoid repeating the failing path.`
					: `Chitragupta anomaly alert: ${type} (${severity}). Adjust the current approach to stabilize the run.`;
				enqueueDirective(
					state,
					directive,
					severity === "critical" ? SteeringPriority.INTERRUPT : SteeringPriority.HIGH,
					{ source: "chitragupta", method: "anomaly_alert", type },
				);
			}
		},
		onPatternDetected: (params) => {
			const type = String(params.type ?? "pattern");
			const confidence = Number(params.confidence ?? 0);
			state.chitraguptaLastPattern.value = {
				type,
				confidence: Number.isFinite(confidence) ? confidence : 0,
				at: Date.now(),
			};

			const suggestion = typeof params.suggestion === "string" ? params.suggestion : undefined;
			if (
				agentRunner?.isRunning &&
				suggestion &&
				confidence >= 0.85 &&
				!wasRecentlyHandled(`pattern:${type}:${suggestion}`)
			) {
				enqueueDirective(state, `Chitragupta pattern detected: ${suggestion}`, SteeringPriority.NORMAL, {
					source: "chitragupta",
					method: "pattern_detected",
					type,
				});
			}
		},
		onPrediction: (params) => {
			const predictions = normalizePredictions(params as unknown as Record<string, unknown>);
			state.chitraguptaPredictions.value = predictions.map((prediction) => ({
				action: prediction.action ?? (prediction.files?.length ? prediction.files.join(", ") : prediction.type),
				confidence: prediction.confidence,
			}));

			const top = predictions[0];
			if (!agentRunner?.isRunning || !top) return;

			if (top.type === "failure_warning" && (top.risk ?? top.confidence) >= 0.8) {
				const key = `prediction:failure:${top.action ?? top.type}`;
				if (!wasRecentlyHandled(key)) {
					enqueueDirective(
						state,
						top.suggestion
							? `Chitragupta warns the current path may fail. ${top.suggestion}`
							: `Chitragupta warns the current path may fail. Choose a safer next step.`,
						SteeringPriority.INTERRUPT,
						{ source: "chitragupta", method: "prediction", type: top.type },
					);
				}
				return;
			}

			if (top.confidence >= 0.85) {
				const summary = top.action
					? `next action "${top.action}"`
					: top.files?.length
						? `likely files ${top.files.join(", ")}`
						: top.type;
				const key = `prediction:${summary}`;
				if (!wasRecentlyHandled(key)) {
					enqueueDirective(
						state,
						`Chitragupta predicts ${summary}. ${top.reasoning ?? "Use this as guidance for the next turn."}`,
						SteeringPriority.HIGH,
						{ source: "chitragupta", method: "prediction", type: top.type },
					);
				}
			}
		},
		onEvolveRequest: (params) => {
			const type = String(params.type ?? "evolve_request");
			log.info(`Chitragupta evolve request: ${type}`);
			state.chitraguptaEvolveQueue.value = [
				...state.chitraguptaEvolveQueue.value,
				params as unknown as Record<string, unknown>,
			];
			if (agentRunner?.isRunning && !wasRecentlyHandled(`evolve:${type}`)) {
				enqueueDirective(state, `Chitragupta evolve request: adapt behavior for ${type}.`, SteeringPriority.HIGH, {
					source: "chitragupta",
					method: "evolve_request",
					type,
				});
			}
		},
		onPreferenceUpdate: (params) => {
			const key = String(params.key ?? "").trim();
			const value = String(params.value ?? "").trim();
			if (!key || !value) return;
			log.info(`Chitragupta preference update: ${key}=${value}`);
			if (key === "theme") {
				state.theme.value = value;
			}
			if (agentRunner?.isRunning && !wasRecentlyHandled(`preference:${key}:${value}`, 30_000)) {
				enqueueDirective(state, `Honor learned preference from Chitragupta: ${key}=${value}.`, SteeringPriority.LOW, {
					source: "chitragupta",
					method: "preference_update",
					key,
				});
			}
		},
	});

	log.info("Subscribed to Chitragupta daemon notifications via observer");
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

			// Phase 49 — Create observer for observation dispatch & prediction queries
			const observer = new ChitraguptaObserver(bridge);
			state.chitraguptaObserver.value = observer;
			subscribeToNotifications(state, observer, agentRunner);

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

	// Phase 49 — Teardown observer notification subscriptions
	state.chitraguptaObserver.value?.teardown();
	state.chitraguptaObserver.value = null;

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
