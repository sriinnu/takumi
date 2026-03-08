import { akashaDepositDefinition, akashaTracesDefinition, createAkashaHandlers, SteeringPriority } from "@takumi/agent";
import { ChitraguptaBridge, ChitraguptaObserver } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AgentRunner } from "./agent-runner.js";
import { buildTelemetryCognition, upsertPatternMatch } from "./app-chitragupta-cognition.js";
import { normalizePredictions } from "./chitragupta-notification-helpers.js";
import {
	enqueueDirective,
	loadMcpConfig,
	resetRecentDirectiveHistory,
	wasRecentlyHandled,
} from "./chitragupta-runtime-helpers.js";
import {
	mergeControlPlaneCapabilities,
	summarizeTakumiCapabilityHealth,
	upsertCapabilityHealthSnapshot,
} from "./control-plane-state.js";
import type { AppState } from "./state.js";

const log = createLogger("app");
let startedAt = 0;

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
			state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
				state.capabilityHealthSnapshots.value,
				summarizeTakumiCapabilityHealth({
					connected: state.chitraguptaConnected.value,
					anomalySeverity: severity,
					routingDecisions: state.routingDecisions.value,
				}),
			);

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
			upsertPatternMatch(state, {
				type,
				confidence: Number.isFinite(confidence) ? confidence : 0,
				lastSeen: Date.now(),
			});

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
				type: prediction.type,
				action: prediction.action ?? (prediction.files?.length ? prediction.files.join(", ") : prediction.type),
				confidence: prediction.confidence,
				risk: prediction.risk,
				reasoning: prediction.reasoning,
				suggestion: prediction.suggestion,
				files: prediction.files,
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
		onHealReported: (params) => {
			const anomalyType = String(params.anomalyType ?? "heal");
			const outcome = String(params.outcome ?? "partial");
			log.info(`Chitragupta heal reported: ${anomalyType} -> ${outcome}`);
			if (outcome === "success") {
				state.chitraguptaAnomaly.value = null;
				state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
					state.capabilityHealthSnapshots.value,
					summarizeTakumiCapabilityHealth({
						connected: state.chitraguptaConnected.value,
						routingDecisions: state.routingDecisions.value,
					}),
				);
			}
		},
		onSabhaConsult: (params) => {
			const sabhaId = String(params.sabhaId ?? "");
			const question = typeof params.question === "string" ? params.question : "Provide council input to Chitragupta.";
			const convener = typeof params.convener === "string" ? params.convener : "chitragupta";
			log.info(`Chitragupta sabha consult ${sabhaId || "(new)"}: ${question}`);
			if (agentRunner?.isRunning && !wasRecentlyHandled(`sabha:${sabhaId}:${question}`)) {
				enqueueDirective(state, `Chitragupta Sabha consult from ${convener}: ${question}`, SteeringPriority.HIGH, {
					source: "chitragupta",
					method: "sabha.consult",
					sabhaId,
				});
			}
		},
		onSabhaUpdated: (params) => {
			const sabhaId = String(params.sabhaId ?? "");
			const event = String(params.event ?? "updated");
			const topic = typeof params.sabha?.topic === "string" ? params.sabha.topic : sabhaId || "sabha";
			log.info(`Chitragupta sabha updated ${sabhaId || "(unknown)"}: ${event}`);
			if (!agentRunner?.isRunning) return;
			const key = `sabha-updated:${sabhaId}:${event}`;
			if (wasRecentlyHandled(key)) return;
			const directive =
				event === "concluded"
					? `Chitragupta Sabha concluded for ${topic}. Use the updated council state before the next step.`
					: event === "escalated"
						? `Chitragupta Sabha escalated for ${topic}. Stop assuming autonomy on this branch and wait for explicit direction.`
						: `Chitragupta Sabha updated for ${topic}. Incorporate the latest council state.`;
			enqueueDirective(state, directive, event === "escalated" ? SteeringPriority.INTERRUPT : SteeringPriority.NORMAL, {
				source: "chitragupta",
				method: "sabha.updated",
				sabhaId,
				event,
			});
		},
		onSabhaRecorded: (params) => {
			log.info(`Chitragupta sabha recorded ${String(params.sabhaId ?? "")}: ${String(params.decisionId ?? "")}`);
		},
		onSabhaEscalated: (params) => {
			const sabhaId = String(params.sabhaId ?? "");
			const reason = typeof params.reason === "string" ? params.reason : "Escalated by Chitragupta.";
			log.warn(`Chitragupta sabha escalated ${sabhaId || "(unknown)"}: ${reason}`);
			if (agentRunner?.isRunning && !wasRecentlyHandled(`sabha-escalated:${sabhaId}:${reason}`)) {
				enqueueDirective(state, `Chitragupta escalated Sabha ${sabhaId || ""}. ${reason}`, SteeringPriority.INTERRUPT, {
					source: "chitragupta",
					method: "sabha.escalated",
					sabhaId,
				});
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
			if (key === "theme") state.theme.value = value;
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

export function connectChitragupta(
	state: AppState,
	agentRunner: AgentRunner | null,
	onInterval: (timer: ReturnType<typeof setInterval>) => void,
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

			const observer = new ChitraguptaObserver(bridge);
			state.chitraguptaObserver.value = observer;
			subscribeToNotifications(state, observer, agentRunner);
			try {
				const capabilities = await observer.capabilities({ includeDegraded: true, includeDown: true, limit: 25 });
				state.controlPlaneCapabilities.value = mergeControlPlaneCapabilities(capabilities.capabilities);
			} catch (err) {
				log.debug(`Chitragupta capabilities preload failed: ${(err as Error).message}`);
			}
			state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
				state.capabilityHealthSnapshots.value,
				summarizeTakumiCapabilityHealth({ connected: true, routingDecisions: state.routingDecisions.value }),
			);

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
						cognition: buildTelemetryCognition(state) as never,
						lastEvent: "heartbeat",
					});
				} catch (err) {
					log.debug(`Telemetry heartbeat failed: ${(err as Error).message}`);
				}
			}, 1_500);
			onInterval(heartbeatTimer);

			const vasanaTimer = setInterval(async () => {
				const b = state.chitraguptaBridge.value;
				if (!b?.isConnected) return;
				try {
					const [t, h, capabilities] = await Promise.all([
						b.vasanaTendencies(10),
						b.healthStatus(),
						observer.capabilities({ includeDegraded: true, includeDown: true, limit: 25 }),
					]);
					state.vasanaTendencies.value = t;
					if (h) state.chitraguptaHealth.value = h;
					state.controlPlaneCapabilities.value = mergeControlPlaneCapabilities(capabilities.capabilities);
					state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
						state.capabilityHealthSnapshots.value,
						summarizeTakumiCapabilityHealth({
							connected: true,
							anomalySeverity: state.chitraguptaAnomaly.value?.severity,
							routingDecisions: state.routingDecisions.value,
						}),
					);
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

	state.chitraguptaObserver.value?.teardown();
	state.chitraguptaObserver.value = null;
	resetRecentDirectiveHistory();

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
	state.capabilityHealthSnapshots.value = upsertCapabilityHealthSnapshot(
		state.capabilityHealthSnapshots.value,
		summarizeTakumiCapabilityHealth({ connected: false, routingDecisions: state.routingDecisions.value }),
	);
	state.chitraguptaBridge.value = null;
}
