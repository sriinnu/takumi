import { SteeringPriority } from "@takumi/agent";
import type { ChitraguptaObserver } from "@takumi/bridge";
import { createLogger } from "@takumi/core";
import type { AgentRunner } from "../agent/agent-runner.js";
import { summarizeTakumiCapabilityHealth, upsertCapabilityHealthSnapshot } from "../control-plane-state.js";
import type { AppState } from "../state.js";
import { upsertPatternMatch } from "./app-chitragupta-cognition.js";
import { getBoundSessionId } from "./chitragupta-executor-runtime.js";
import { normalizePredictions } from "./chitragupta-notification-helpers.js";
import { enqueueDirective, wasRecentlyHandled } from "./chitragupta-runtime-helpers.js";

const log = createLogger("app");

/**
 * I keep the notification wiring separate from the reconnect path so the core
 * rebind flow can stay readable and within the repo's LOC guardrail.
 */
export function setupChitraguptaNotifications(
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
				const sessionId = getBoundSessionId(state);
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
			if (sabhaId) state.lastSabhaId.value = sabhaId;
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
			if (sabhaId) state.lastSabhaId.value = sabhaId;
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
			if (params.sabhaId) state.lastSabhaId.value = String(params.sabhaId);
			log.info(`Chitragupta sabha recorded ${String(params.sabhaId ?? "")}: ${String(params.decisionId ?? "")}`);
		},
		onSabhaEscalated: (params) => {
			const sabhaId = String(params.sabhaId ?? "");
			if (sabhaId) state.lastSabhaId.value = sabhaId;
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
