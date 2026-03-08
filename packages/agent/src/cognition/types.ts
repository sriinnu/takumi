import type { SteeringPriorityLevel } from "../steering-queue.js";

export type CognitiveSignalKind =
	| "anomaly"
	| "integrity"
	| "context"
	| "prediction"
	| "pattern"
	| "routing"
	| "steering";
export type CognitiveStance = "stable" | "watchful" | "strained" | "critical";
export type CognitiveWorkspaceMode = "monitor" | "execute" | "stabilize" | "consolidate" | "recover";
export type CognitiveIntegrityStatus = "healthy" | "warning" | "critical";
export type CognitiveContextPressure = "normal" | "approaching_limit" | "near_limit" | "at_limit";

export interface CognitivePrediction {
	type?: string;
	action: string;
	confidence: number;
	risk?: number;
	reasoning?: string;
	suggestion?: string;
	files?: string[];
}

export interface CognitivePatternMatch {
	id?: number;
	type: string;
	confidence: number;
	occurrences?: number;
	lastSeen?: number;
}

export interface CognitiveRoutingDecision {
	selected: boolean;
	degraded: boolean;
	reason?: string;
	capabilityId?: string;
}

export interface CognitiveSteeringBacklogItem {
	text: string;
	priority: SteeringPriorityLevel;
}

export interface IntuitionSignal {
	id: string;
	kind: CognitiveSignalKind;
	summary: string;
	salience: number;
	confidence: number;
	priority: SteeringPriorityLevel;
	recommendedAction?: string;
	metadata?: Record<string, unknown>;
}

export interface CognitiveDirective {
	id: string;
	text: string;
	priority: SteeringPriorityLevel;
	rationale: string;
	sourceSignalId?: string;
}

export interface CognitiveAwareness {
	stance: CognitiveStance;
	focus: string;
	integrity: CognitiveIntegrityStatus;
	contextPressure: CognitiveContextPressure;
	connected: boolean;
	agentPhase: string;
	clusterPhase: string;
	constraints: string[];
	observations: string[];
}

export interface CognitiveIntuition {
	dominantSignal: IntuitionSignal | null;
	signals: IntuitionSignal[];
}

export interface CognitiveWorkspace {
	mode: CognitiveWorkspaceMode;
	backlog: number;
	recommendedDirectives: CognitiveDirective[];
}

export interface CognitiveState {
	awareness: CognitiveAwareness;
	intuition: CognitiveIntuition;
	workspace: CognitiveWorkspace;
	summary: string;
	updatedAt: number;
}

export interface BuildCognitiveStateInput {
	connected: boolean;
	integrityStatus: CognitiveIntegrityStatus;
	integritySummary?: string;
	anomaly?: {
		severity: string;
		details: string;
		suggestion: string | null;
		at?: number;
	} | null;
	predictions?: CognitivePrediction[];
	patternMatches?: CognitivePatternMatch[];
	lastPattern?: { type: string; confidence: number; at?: number } | null;
	routingDecisions?: CognitiveRoutingDecision[];
	contextPressure?: string;
	contextPercent?: number;
	agentPhase?: string;
	clusterPhase?: string;
	steeringPending?: number;
	steeringQueue?: CognitiveSteeringBacklogItem[];
	observationFlushCount?: number;
	evolveQueueLength?: number;
	now?: number;
}
