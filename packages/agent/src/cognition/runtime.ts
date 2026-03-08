import { SteeringPriority } from "../steering-queue.js";
import type {
	BuildCognitiveStateInput,
	CognitiveAwareness,
	CognitiveContextPressure,
	CognitiveDirective,
	CognitiveIntegrityStatus,
	CognitivePatternMatch,
	CognitivePrediction,
	CognitiveStance,
	CognitiveState,
	CognitiveWorkspaceMode,
	IntuitionSignal,
} from "./types.js";

const PRESSURE_ORDER: Record<CognitiveContextPressure, number> = {
	normal: 0,
	approaching_limit: 1,
	near_limit: 2,
	at_limit: 3,
};

const STANCE_ORDER: Record<CognitiveStance, number> = {
	stable: 0,
	watchful: 1,
	strained: 2,
	critical: 3,
};

export function buildCognitiveState(input: BuildCognitiveStateInput): CognitiveState {
	const now = input.now ?? Date.now();
	const pressure = normalizePressure(input.contextPressure);
	const routingDecisions = input.routingDecisions ?? [];
	const degradedRoutes = routingDecisions.filter((decision) => decision.degraded).length;
	const unresolvedRoutes = routingDecisions.filter((decision) => !decision.selected).length;
	const signals = deriveIntuitionSignals({ ...input, contextPressure: pressure, routingDecisions });
	const dominantSignal = signals[0] ?? null;
	const constraints = buildConstraints({
		connected: input.connected,
		pressure,
		degradedRoutes,
		unresolvedRoutes,
		steeringPending: input.steeringPending ?? 0,
		evolveQueueLength: input.evolveQueueLength ?? 0,
	});
	const observations = buildObservations({
		signals,
		degradedRoutes,
		unresolvedRoutes,
		observationFlushCount: input.observationFlushCount ?? 0,
		patternMatches: input.patternMatches ?? [],
		predictions: input.predictions ?? [],
	});
	const stance = deriveStance({
		connected: input.connected,
		integrityStatus: input.integrityStatus,
		pressure,
		degradedRoutes,
		unresolvedRoutes,
		anomaly: input.anomaly,
		dominantSignal,
	});
	const workspaceMode = deriveWorkspaceMode({
		stance,
		pressure,
		anomaly: input.anomaly,
		dominantSignal,
		agentPhase: input.agentPhase,
		clusterPhase: input.clusterPhase,
	});
	const focus =
		dominantSignal?.summary ?? deriveFallbackFocus(input.agentPhase, input.clusterPhase, input.integritySummary);
	const recommendedDirectives = buildDirectives({
		workspaceMode,
		pressure,
		dominantSignal,
		anomaly: input.anomaly,
		integrityStatus: input.integrityStatus,
		steeringPending: input.steeringPending ?? 0,
	});
	const awareness: CognitiveAwareness = {
		stance,
		focus,
		integrity: input.integrityStatus,
		contextPressure: pressure,
		connected: input.connected,
		agentPhase: normalizePhase(input.agentPhase),
		clusterPhase: normalizePhase(input.clusterPhase),
		constraints,
		observations,
	};

	return {
		awareness,
		intuition: {
			dominantSignal,
			signals,
		},
		workspace: {
			mode: workspaceMode,
			backlog: input.steeringPending ?? 0,
			recommendedDirectives,
		},
		summary: summarizeCognition(awareness, workspaceMode, dominantSignal),
		updatedAt: now,
	};
}

function deriveIntuitionSignals(
	input: BuildCognitiveStateInput & { contextPressure: CognitiveContextPressure },
): IntuitionSignal[] {
	const signals: IntuitionSignal[] = [];
	const anomaly = input.anomaly;
	if (anomaly) {
		const critical = anomaly.severity === "critical";
		signals.push({
			id: signalId("anomaly", anomaly.details),
			kind: "anomaly",
			summary: anomaly.suggestion ? `${anomaly.details} — ${anomaly.suggestion}` : anomaly.details,
			salience: critical ? 0.99 : 0.88,
			confidence: critical ? 0.96 : 0.82,
			priority: critical ? SteeringPriority.INTERRUPT : SteeringPriority.HIGH,
			recommendedAction: anomaly.suggestion ?? "stabilize the run before proceeding",
		});
	}

	if (input.integrityStatus !== "healthy") {
		const critical = input.integrityStatus === "critical";
		signals.push({
			id: signalId("integrity", input.integritySummary ?? input.integrityStatus),
			kind: "integrity",
			summary: input.integritySummary ?? `integrity status is ${input.integrityStatus}`,
			salience: critical ? 0.95 : 0.76,
			confidence: critical ? 0.9 : 0.74,
			priority: critical ? SteeringPriority.INTERRUPT : SteeringPriority.HIGH,
			recommendedAction: critical
				? "pause forward progress and repair control-plane integrity"
				: "prefer safer execution paths until integrity recovers",
		});
	}

	if (input.contextPressure !== "normal") {
		const priority = input.contextPressure === "at_limit" ? SteeringPriority.INTERRUPT : SteeringPriority.HIGH;
		signals.push({
			id: signalId("context", `${input.contextPressure}:${input.contextPercent ?? 0}`),
			kind: "context",
			summary: `context pressure is ${input.contextPressure.replaceAll("_", " ")} (${Math.round(input.contextPercent ?? 0)}%)`,
			salience: contextSalience(input.contextPressure),
			confidence: 0.9,
			priority,
			recommendedAction:
				input.contextPressure === "at_limit"
					? "compact or checkpoint context immediately"
					: "reduce context growth and prefer concise next actions",
		});
	}

	for (const prediction of (input.predictions ?? []).slice(0, 3)) {
		if (prediction.confidence < 0.65 && (prediction.risk ?? 0) < 0.75) continue;
		const isFailure = prediction.type === "failure_warning";
		const subject = prediction.action || prediction.files?.join(", ") || prediction.type || "next step";
		const confidence = Math.max(prediction.confidence, prediction.risk ?? 0);
		const suggestion = prediction.suggestion ?? prediction.reasoning;
		signals.push({
			id: signalId("prediction", `${prediction.type ?? "prediction"}:${subject}`),
			kind: "prediction",
			summary: isFailure ? `predicted failure risk around ${subject}` : `predicted next move: ${subject}`,
			salience: Math.min(0.95, confidence + (isFailure ? 0.08 : 0.02)),
			confidence,
			priority: isFailure && confidence >= 0.85 ? SteeringPriority.INTERRUPT : SteeringPriority.NORMAL,
			recommendedAction: suggestion ?? (isFailure ? "choose a safer next step" : `consider ${subject} next`),
			metadata: {
				type: prediction.type ?? "prediction",
				risk: prediction.risk,
			},
		});
	}

	const patterns = input.patternMatches?.length
		? input.patternMatches
		: input.lastPattern
			? [{ type: input.lastPattern.type, confidence: input.lastPattern.confidence }]
			: [];
	for (const pattern of patterns.slice(0, 3)) {
		if (pattern.confidence < 0.7) continue;
		const occurrenceText = pattern.occurrences ? ` across ${pattern.occurrences} occurrences` : "";
		signals.push({
			id: signalId("pattern", `${pattern.type}:${pattern.id ?? pattern.confidence}`),
			kind: "pattern",
			summary: `pattern ${pattern.type} detected${occurrenceText}`,
			salience: Math.min(0.9, pattern.confidence + 0.05),
			confidence: pattern.confidence,
			priority: pattern.confidence >= 0.9 ? SteeringPriority.HIGH : SteeringPriority.NORMAL,
			recommendedAction: `use the ${pattern.type} pattern as guidance before the next step`,
			metadata: {
				occurrences: pattern.occurrences,
				lastSeen: pattern.lastSeen,
			},
		});
	}

	const routingDecisions = input.routingDecisions ?? [];
	const degradedRoutes = routingDecisions.filter((decision) => decision.degraded).length;
	const unresolvedRoutes = routingDecisions.filter((decision) => !decision.selected).length;
	if (degradedRoutes > 0 || unresolvedRoutes > 0) {
		const degradedText = degradedRoutes > 0 ? `${degradedRoutes} degraded route${degradedRoutes === 1 ? "" : "s"}` : "";
		const unresolvedText =
			unresolvedRoutes > 0 ? `${unresolvedRoutes} unresolved route${unresolvedRoutes === 1 ? "" : "s"}` : "";
		const summary = [degradedText, unresolvedText].filter(Boolean).join(", ");
		signals.push({
			id: signalId("routing", summary),
			kind: "routing",
			summary: `routing friction detected: ${summary}`,
			salience: unresolvedRoutes > 0 ? 0.93 : 0.74,
			confidence: unresolvedRoutes > 0 ? 0.9 : 0.72,
			priority: unresolvedRoutes > 0 ? SteeringPriority.INTERRUPT : SteeringPriority.HIGH,
			recommendedAction:
				unresolvedRoutes > 0
					? "re-resolve capabilities before continuing"
					: "prefer healthier route classes or same-provider fallbacks",
		});
	}

	if ((input.steeringPending ?? 0) > 0) {
		signals.push({
			id: signalId("steering", String(input.steeringPending)),
			kind: "steering",
			summary: `${input.steeringPending} directive${input.steeringPending === 1 ? "" : "s"} waiting in workspace queue`,
			salience: Math.min(0.7, 0.45 + (input.steeringPending ?? 0) * 0.08),
			confidence: 0.72,
			priority: SteeringPriority.NORMAL,
			recommendedAction: "respect queued directives before widening the search",
		});
	}

	return signals.sort((left, right) => {
		if (right.salience !== left.salience) return right.salience - left.salience;
		if (right.confidence !== left.confidence) return right.confidence - left.confidence;
		return left.id.localeCompare(right.id);
	});
}

function buildConstraints(input: {
	connected: boolean;
	pressure: CognitiveContextPressure;
	degradedRoutes: number;
	unresolvedRoutes: number;
	steeringPending: number;
	evolveQueueLength: number;
}): string[] {
	const constraints: string[] = [];
	if (!input.connected) constraints.push("control plane offline");
	if (input.pressure !== "normal") constraints.push(`context ${input.pressure.replaceAll("_", " ")}`);
	if (input.unresolvedRoutes > 0) constraints.push("unresolved routing authority");
	else if (input.degradedRoutes > 0) constraints.push("degraded route envelope");
	if (input.steeringPending > 0) constraints.push("workspace directives pending");
	if (input.evolveQueueLength > 0) constraints.push("evolution requests queued");
	return constraints;
}

function buildObservations(input: {
	signals: IntuitionSignal[];
	degradedRoutes: number;
	unresolvedRoutes: number;
	observationFlushCount: number;
	patternMatches: CognitivePatternMatch[];
	predictions: CognitivePrediction[];
}): string[] {
	const observations: string[] = [];
	if (input.signals.length > 0)
		observations.push(`${input.signals.length} active intuition signal${input.signals.length === 1 ? "" : "s"}`);
	if (input.predictions.length > 0)
		observations.push(`${input.predictions.length} predictive hint${input.predictions.length === 1 ? "" : "s"} loaded`);
	if (input.patternMatches.length > 0)
		observations.push(
			`${input.patternMatches.length} pattern memory hit${input.patternMatches.length === 1 ? "" : "s"}`,
		);
	if (input.degradedRoutes > 0)
		observations.push(`${input.degradedRoutes} degraded route${input.degradedRoutes === 1 ? "" : "s"} observed`);
	if (input.unresolvedRoutes > 0)
		observations.push(`${input.unresolvedRoutes} unresolved route${input.unresolvedRoutes === 1 ? "" : "s"} observed`);
	if (input.observationFlushCount > 0)
		observations.push(
			`${input.observationFlushCount} observation batch${input.observationFlushCount === 1 ? "" : "es"} flushed`,
		);
	return observations;
}

function deriveStance(input: {
	connected: boolean;
	integrityStatus: CognitiveIntegrityStatus;
	pressure: CognitiveContextPressure;
	degradedRoutes: number;
	unresolvedRoutes: number;
	anomaly?: BuildCognitiveStateInput["anomaly"];
	dominantSignal: IntuitionSignal | null;
}): CognitiveStance {
	let stance: CognitiveStance = "stable";
	if (!input.connected || input.integrityStatus === "critical" || input.pressure === "at_limit") {
		stance = escalateStance(stance, "critical");
	}
	if (input.anomaly?.severity === "critical" || input.unresolvedRoutes > 0) {
		stance = escalateStance(stance, "critical");
	}
	if (input.integrityStatus === "warning" || input.pressure === "near_limit" || input.degradedRoutes > 0) {
		stance = escalateStance(stance, "strained");
	}
	if (input.pressure === "approaching_limit") {
		stance = escalateStance(stance, "watchful");
	}
	if (input.dominantSignal && input.dominantSignal.salience >= 0.7) {
		stance = escalateStance(stance, input.dominantSignal.kind === "prediction" ? "watchful" : stance);
	}
	return stance;
}

function deriveWorkspaceMode(input: {
	stance: CognitiveStance;
	pressure: CognitiveContextPressure;
	anomaly?: BuildCognitiveStateInput["anomaly"];
	dominantSignal: IntuitionSignal | null;
	agentPhase?: string;
	clusterPhase?: string;
}): CognitiveWorkspaceMode {
	if (input.anomaly?.severity === "critical" || input.stance === "critical") return "recover";
	if (PRESSURE_ORDER[input.pressure] >= PRESSURE_ORDER.near_limit) return "consolidate";
	if (input.dominantSignal?.kind === "routing") return "stabilize";
	if (input.dominantSignal?.kind === "prediction" && input.dominantSignal.priority <= SteeringPriority.HIGH)
		return "stabilize";
	if (isActivePhase(input.agentPhase) || isActivePhase(input.clusterPhase)) return "execute";
	return "monitor";
}

function buildDirectives(input: {
	workspaceMode: CognitiveWorkspaceMode;
	pressure: CognitiveContextPressure;
	dominantSignal: IntuitionSignal | null;
	anomaly?: BuildCognitiveStateInput["anomaly"];
	integrityStatus: CognitiveIntegrityStatus;
	steeringPending: number;
}): CognitiveDirective[] {
	const directives: CognitiveDirective[] = [];
	if (input.workspaceMode === "recover") {
		directives.push({
			id: directiveId("recover", input.dominantSignal?.id ?? "integrity"),
			text: input.anomaly?.suggestion ?? "stabilize the run and repair integrity before proceeding",
			priority: SteeringPriority.INTERRUPT,
			rationale: input.anomaly?.details ?? `integrity status is ${input.integrityStatus}`,
			sourceSignalId: input.dominantSignal?.id,
		});
	}
	if (input.workspaceMode === "consolidate") {
		directives.push({
			id: directiveId("consolidate", input.dominantSignal?.id ?? input.pressure),
			text:
				input.pressure === "at_limit"
					? "compact context immediately or checkpoint before more tool work"
					: "keep the next step compact and prefer consolidation-friendly edits",
			priority: input.pressure === "at_limit" ? SteeringPriority.INTERRUPT : SteeringPriority.HIGH,
			rationale: `context pressure is ${input.pressure}`,
			sourceSignalId: input.dominantSignal?.id,
		});
	}
	if (input.workspaceMode === "stabilize" && input.dominantSignal) {
		directives.push({
			id: directiveId("stabilize", input.dominantSignal.id),
			text: input.dominantSignal.recommendedAction ?? "choose a safer next step before committing to execution",
			priority: input.dominantSignal.priority,
			rationale: input.dominantSignal.summary,
			sourceSignalId: input.dominantSignal.id,
		});
	}
	if (input.workspaceMode === "execute" && input.dominantSignal?.kind === "prediction" && input.steeringPending === 0) {
		directives.push({
			id: directiveId("execute", input.dominantSignal.id),
			text: input.dominantSignal.recommendedAction ?? "follow the strongest predicted next action",
			priority: SteeringPriority.NORMAL,
			rationale: input.dominantSignal.summary,
			sourceSignalId: input.dominantSignal.id,
		});
	}
	return directives.slice(0, 2);
}

function summarizeCognition(
	awareness: CognitiveAwareness,
	workspaceMode: CognitiveWorkspaceMode,
	dominantSignal: IntuitionSignal | null,
): string {
	const signalSummary = dominantSignal ? dominantSignal.summary : "no dominant intuition signal";
	return `${capitalize(awareness.stance)} awareness, workspace ${workspaceMode}, focus on ${signalSummary}.`;
}

function normalizePressure(value: string | undefined): CognitiveContextPressure {
	if (value === "approaching_limit" || value === "near_limit" || value === "at_limit") return value;
	return "normal";
}

function contextSalience(pressure: CognitiveContextPressure): number {
	switch (pressure) {
		case "approaching_limit":
			return 0.68;
		case "near_limit":
			return 0.87;
		case "at_limit":
			return 0.98;
		default:
			return 0.5;
	}
}

function deriveFallbackFocus(agentPhase?: string, clusterPhase?: string, integritySummary?: string): string {
	if (isActivePhase(agentPhase)) return normalizePhase(agentPhase);
	if (isActivePhase(clusterPhase)) return normalizePhase(clusterPhase);
	return integritySummary ?? "maintain bounded execution discipline";
}

function normalizePhase(value?: string): string {
	return value && value.trim().length > 0 ? value.trim() : "idle";
}

function isActivePhase(value?: string): boolean {
	const phase = normalizePhase(value).toLowerCase();
	return phase !== "idle" && phase !== "ready";
}

function signalId(prefix: string, value: string): string {
	return `${prefix}:${slug(value)}`;
}

function directiveId(prefix: string, value: string): string {
	return `${prefix}:${slug(value)}`;
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

function capitalize(value: string): string {
	return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function escalateStance(current: CognitiveStance, next: CognitiveStance): CognitiveStance {
	return STANCE_ORDER[next] > STANCE_ORDER[current] ? next : current;
}
