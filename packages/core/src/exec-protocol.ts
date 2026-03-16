import type { HubArtifact } from "./artifact-types.js";
import type { AgentEvent, Usage } from "./types.js";

export const EXEC_PROTOCOL = "takumi.exec.v1";
export const EXEC_PROTOCOL_VERSION = 1;

export const EXEC_EXIT_CODES = {
	OK: 0,
	FATAL: 1,
	AGENT_ERROR: 2,
	POLICY: 77,
	USAGE: 64,
	CONFIG: 78,
} as const;

export type ExecExitCode = (typeof EXEC_EXIT_CODES)[keyof typeof EXEC_EXIT_CODES];
export type ExecFailurePhase = "usage" | "config" | "bootstrap" | "policy" | "agent_loop" | "internal";
export type ExecBootstrapTransport = "daemon-socket" | "mcp-stdio" | "unavailable";
export type ExecFailureCategory = "usage" | "config" | "bootstrap" | "agent" | "policy" | "internal";

export interface ExecSessionBinding {
	projectPath: string;
	canonicalSessionId?: string;
	parentSessionId?: string;
	title?: string;
}

export interface ExecRoutingBinding {
	capability: string;
	authority: "engine" | "takumi-fallback";
	enforcement: "same-provider" | "capability-only";
	provider?: string;
	model?: string;
	laneId?: string;
	degraded?: boolean;
}

/** @deprecated Use HubArtifact for new code. Kept for wire-compat with older consumers. */
export interface ExecArtifact {
	type: "assistant_response" | "summary" | "validation" | "postmortem" | "exec-result";
	summary: string;
	path?: string;
	metadata?: Record<string, unknown>;
}

export interface ExecValidationSummary {
	status: "not-run" | "passed" | "failed" | "unknown";
	checks: string[];
}

export interface ExecPostRunPolicy {
	status: "pending" | "passed" | "failed";
	checks: string[];
}

export interface SerializedError {
	name: string;
	message: string;
	stack?: string;
}

export interface ExecBootstrapSnapshot {
	connected: boolean;
	degraded: boolean;
	transport: ExecBootstrapTransport;
	memoryEntries: number;
	vasanaCount: number;
	hasHealth: boolean;
	summary: string;
	error?: SerializedError;
}

interface ExecEnvelopeBase<K extends string> {
	protocol: typeof EXEC_PROTOCOL;
	schemaVersion: typeof EXEC_PROTOCOL_VERSION;
	kind: K;
	runId: string;
	timestamp: string;
}

export interface ExecLaneSnapshot {
	capability: string;
	authority: "engine" | "takumi-fallback";
	enforcement: "same-provider" | "capability-only";
	selectedModel?: string;
	fallbackModel?: string;
	laneId?: string;
	degraded: boolean;
	reason?: string;
}

export interface ExecRunStartedEvent extends ExecEnvelopeBase<"run_started"> {
	cwd: string;
	prompt: string;
	headless: boolean;
	streamFormat: "text" | "ndjson";
	provider?: string;
	model?: string;
	session?: ExecSessionBinding;
	routing?: ExecRoutingBinding;
	lane?: ExecLaneSnapshot;
}

export interface ExecBootstrapStatusEvent extends ExecEnvelopeBase<"bootstrap_status"> {
	bootstrap: ExecBootstrapSnapshot;
}

export interface ExecAgentEventEnvelope extends ExecEnvelopeBase<"agent_event"> {
	event: Record<string, unknown>;
	laneId?: string;
}

export interface ExecRunCompletedEvent extends ExecEnvelopeBase<"run_completed"> {
	success: true;
	exitCode: typeof EXEC_EXIT_CODES.OK;
	durationMs: number;
	stopReason?: string;
	stats: {
		textChars: number;
		toolCalls: number;
		toolErrors: number;
	};
	usage?: Usage;
	bootstrapConnected: boolean;
	session?: ExecSessionBinding;
	routing?: ExecRoutingBinding;
	lane?: ExecLaneSnapshot;
	/** @deprecated Prefer hubArtifacts for typed artifact data. */
	artifacts: ExecArtifact[];
	hubArtifacts: HubArtifact[];
	filesChanged: string[];
	validation: ExecValidationSummary;
	postRunPolicy: ExecPostRunPolicy;
}

export interface ExecRunFailedEvent extends ExecEnvelopeBase<"run_failed"> {
	success: false;
	exitCode: ExecExitCode;
	phase: ExecFailurePhase;
	category: ExecFailureCategory;
	error: SerializedError;
	session?: ExecSessionBinding;
	routing?: ExecRoutingBinding;
}

export type ExecProtocolEvent =
	| ExecRunStartedEvent
	| ExecBootstrapStatusEvent
	| ExecAgentEventEnvelope
	| ExecRunCompletedEvent
	| ExecRunFailedEvent;

function envelopeBase<K extends ExecProtocolEvent["kind"]>(kind: K, runId: string): ExecEnvelopeBase<K> {
	return {
		protocol: EXEC_PROTOCOL,
		schemaVersion: EXEC_PROTOCOL_VERSION,
		kind,
		runId,
		timestamp: new Date().toISOString(),
	};
}

export function serializeError(error: unknown): SerializedError {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}

	return {
		name: "Error",
		message: typeof error === "string" ? error : JSON.stringify(error),
	};
}

export function sanitizeAgentEvent(event: AgentEvent): Record<string, unknown> {
	if (event.type === "error") {
		return { ...event, error: serializeError(event.error) };
	}

	return { ...event };
}

export function createExecRunId(now = Date.now()): string {
	return `exec-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRunStartedEvent(input: {
	runId: string;
	cwd: string;
	prompt: string;
	headless: boolean;
	streamFormat: "text" | "ndjson";
	provider?: string;
	model?: string;
	session?: ExecSessionBinding;
	routing?: ExecRoutingBinding;
	lane?: ExecLaneSnapshot;
}): ExecRunStartedEvent {
	return {
		...envelopeBase("run_started", input.runId),
		cwd: input.cwd,
		prompt: input.prompt,
		headless: input.headless,
		streamFormat: input.streamFormat,
		provider: input.provider,
		model: input.model,
		session: input.session,
		routing: input.routing,
		lane: input.lane,
	};
}

export function createBootstrapStatusEvent(input: {
	runId: string;
	bootstrap: Omit<ExecBootstrapSnapshot, "error"> & { error?: unknown };
}): ExecBootstrapStatusEvent {
	return {
		...envelopeBase("bootstrap_status", input.runId),
		bootstrap: {
			...input.bootstrap,
			error: input.bootstrap.error ? serializeError(input.bootstrap.error) : undefined,
		},
	};
}

export function createAgentEventEnvelope(runId: string, event: AgentEvent, laneId?: string): ExecAgentEventEnvelope {
	return {
		...envelopeBase("agent_event", runId),
		event: sanitizeAgentEvent(event),
		laneId,
	};
}

export function createRunCompletedEvent(input: {
	runId: string;
	durationMs: number;
	stopReason?: string;
	usage?: Usage;
	stats: { textChars: number; toolCalls: number; toolErrors: number };
	bootstrapConnected: boolean;
	session?: ExecSessionBinding;
	routing?: ExecRoutingBinding;
	lane?: ExecLaneSnapshot;
	artifacts?: ExecArtifact[];
	hubArtifacts?: HubArtifact[];
	filesChanged?: string[];
	validation?: ExecValidationSummary;
	postRunPolicy?: ExecPostRunPolicy;
}): ExecRunCompletedEvent {
	return {
		...envelopeBase("run_completed", input.runId),
		success: true,
		exitCode: EXEC_EXIT_CODES.OK,
		durationMs: input.durationMs,
		stopReason: input.stopReason,
		usage: input.usage,
		stats: input.stats,
		bootstrapConnected: input.bootstrapConnected,
		session: input.session,
		routing: input.routing,
		lane: input.lane,
		artifacts: input.artifacts ?? [],
		hubArtifacts: input.hubArtifacts ?? [],
		filesChanged: input.filesChanged ?? [],
		validation: input.validation ?? { status: "not-run", checks: [] },
		postRunPolicy: input.postRunPolicy ?? {
			status: "pending",
			checks: ["provider-model-consistency", "session-binding", "artifact-reporting"],
		},
	};
}

export function createRunFailedEvent(input: {
	runId: string;
	exitCode: ExecExitCode;
	phase: ExecFailurePhase;
	error: unknown;
	session?: ExecSessionBinding;
	routing?: ExecRoutingBinding;
}): ExecRunFailedEvent {
	return {
		...envelopeBase("run_failed", input.runId),
		success: false,
		exitCode: input.exitCode,
		phase: input.phase,
		category: phaseToFailureCategory(input.phase),
		error: serializeError(input.error),
		session: input.session,
		routing: input.routing,
	};
}

function phaseToFailureCategory(phase: ExecFailurePhase): ExecFailureCategory {
	switch (phase) {
		case "usage":
			return "usage";
		case "config":
			return "config";
		case "bootstrap":
			return "bootstrap";
		case "policy":
			return "policy";
		case "agent_loop":
			return "agent";
		case "internal":
			return "internal";
	}
}
