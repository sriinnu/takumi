import type {
	ExecAgentEventEnvelope,
	ExecArtifact,
	ExecBootstrapTransport,
	ExecBootstrapSnapshot,
	ExecBootstrapStatusEvent,
	ExecExitCode,
	ExecFailurePhase,
	ExecProtocolEvent,
	ExecRoutingBinding,
	ExecRunCompletedEvent,
	ExecRunFailedEvent,
	ExecRunStartedEvent,
	ExecSessionBinding,
	SerializedError,
} from "@takumi/core";
import {
	createAgentEventEnvelope,
	createBootstrapStatusEvent,
	createExecRunId,
	createRunCompletedEvent,
	createRunFailedEvent,
	createRunStartedEvent,
	EXEC_EXIT_CODES,
	EXEC_PROTOCOL,
	EXEC_PROTOCOL_VERSION,
	sanitizeAgentEvent,
	serializeError,
} from "@takumi/core";

export {
	createAgentEventEnvelope,
	createBootstrapStatusEvent,
	createExecRunId,
	createRunCompletedEvent,
	createRunFailedEvent,
	createRunStartedEvent,
	EXEC_EXIT_CODES,
	EXEC_PROTOCOL,
	EXEC_PROTOCOL_VERSION,
	sanitizeAgentEvent,
	serializeError,
};
export type {
	ExecAgentEventEnvelope,
	ExecArtifact,
	ExecBootstrapTransport,
	ExecBootstrapSnapshot,
	ExecBootstrapStatusEvent,
	ExecExitCode,
	ExecFailurePhase,
	ExecProtocolEvent,
	ExecRoutingBinding,
	ExecRunCompletedEvent,
	ExecRunFailedEvent,
	ExecRunStartedEvent,
	ExecSessionBinding,
	SerializedError,
};

export function emitExecEvent(event: ExecProtocolEvent): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}