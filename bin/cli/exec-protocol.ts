import type {
	ExecAgentEventEnvelope,
	ExecBootstrapTransport,
	ExecBootstrapSnapshot,
	ExecBootstrapStatusEvent,
	ExecExitCode,
	ExecFailurePhase,
	ExecProtocolEvent,
	ExecRunCompletedEvent,
	ExecRunFailedEvent,
	ExecRunStartedEvent,
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
	ExecBootstrapTransport,
	ExecBootstrapSnapshot,
	ExecBootstrapStatusEvent,
	ExecExitCode,
	ExecFailurePhase,
	ExecProtocolEvent,
	ExecRunCompletedEvent,
	ExecRunFailedEvent,
	ExecRunStartedEvent,
	SerializedError,
};

export function emitExecEvent(event: ExecProtocolEvent): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}