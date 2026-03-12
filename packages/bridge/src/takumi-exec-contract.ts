import { EXEC_EXIT_CODES, EXEC_PROTOCOL, EXEC_PROTOCOL_VERSION, type ExecProtocolEvent } from "@takumi/core";

export const TAKUMI_EXEC_BINARY_ENV = "TAKUMI_EXEC_BIN";
export const TAKUMI_EXEC_BINARY_CANDIDATES = ["takumi"] as const;
export const TAKUMI_EXEC_STREAM_FORMAT = "ndjson" as const;
export const TAKUMI_EXEC_DEFAULT_TIMEOUT_MS = 120_000;

export interface TakumiExecRequest {
	prompt: string;
	cwd: string;
	issue?: string;
	provider?: string;
	model?: string;
	fallbackProvider?: string;
	chitraguptaSocketPath?: string;
	additionalEnv?: Record<string, string | undefined>;
}

export interface TakumiExecSpawnPlan {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	stdoutProtocol: typeof EXEC_PROTOCOL;
	stderrMode: "diagnostic-text";
	exitCodes: typeof EXEC_EXIT_CODES;
	timeoutMs: number;
}

export interface TakumiExecParentContract {
	transport: "local-process";
	protocol: typeof EXEC_PROTOCOL;
	schemaVersion: typeof EXEC_PROTOCOL_VERSION;
	binaryEnv: typeof TAKUMI_EXEC_BINARY_ENV;
	binaryCandidates: readonly string[];
	defaultArgs: readonly ["exec", "--headless", "--stream=ndjson"];
	stdout: "ndjson-envelopes-only";
	stderr: "diagnostic-text";
	timeoutMs: number;
	exitCodes: typeof EXEC_EXIT_CODES;
}

export const TAKUMI_EXEC_PARENT_CONTRACT: TakumiExecParentContract = {
	transport: "local-process",
	protocol: EXEC_PROTOCOL,
	schemaVersion: EXEC_PROTOCOL_VERSION,
	binaryEnv: TAKUMI_EXEC_BINARY_ENV,
	binaryCandidates: TAKUMI_EXEC_BINARY_CANDIDATES,
	defaultArgs: ["exec", "--headless", "--stream=ndjson"],
	stdout: "ndjson-envelopes-only",
	stderr: "diagnostic-text",
	timeoutMs: TAKUMI_EXEC_DEFAULT_TIMEOUT_MS,
	exitCodes: EXEC_EXIT_CODES,
};

export function resolveTakumiExecCommand(env: NodeJS.ProcessEnv = process.env): string {
	return env[TAKUMI_EXEC_BINARY_ENV] || TAKUMI_EXEC_BINARY_CANDIDATES[0];
}

export function buildTakumiExecArgs(request: TakumiExecRequest): string[] {
	const args = [...TAKUMI_EXEC_PARENT_CONTRACT.defaultArgs, request.prompt];

	if (request.issue) args.push("--issue", request.issue);
	if (request.provider) args.push("--provider", request.provider);
	if (request.model) args.push("--model", request.model);
	if (request.fallbackProvider) args.push("--fallback", request.fallbackProvider);

	return args;
}

export function buildTakumiExecSpawnPlan(
	request: TakumiExecRequest,
	env: NodeJS.ProcessEnv = process.env,
): TakumiExecSpawnPlan {
	return {
		command: resolveTakumiExecCommand(env),
		args: buildTakumiExecArgs(request),
		cwd: request.cwd,
		env: {
			...env,
			CHITRAGUPTA_SOCKET: request.chitraguptaSocketPath ?? env.CHITRAGUPTA_SOCKET,
			CHITRAGUPTA_PROJECT: request.cwd,
			...request.additionalEnv,
		},
		stdoutProtocol: EXEC_PROTOCOL,
		stderrMode: "diagnostic-text",
		exitCodes: EXEC_EXIT_CODES,
		timeoutMs: TAKUMI_EXEC_PARENT_CONTRACT.timeoutMs,
	};
}

export function isTakumiExecEvent(value: unknown): value is ExecProtocolEvent {
	if (!value || typeof value !== "object") return false;
	const maybe = value as {
		protocol?: unknown;
		schemaVersion?: unknown;
		kind?: unknown;
		runId?: unknown;
		timestamp?: unknown;
	};
	return (
		maybe.protocol === EXEC_PROTOCOL &&
		maybe.schemaVersion === EXEC_PROTOCOL_VERSION &&
		typeof maybe.kind === "string" &&
		typeof maybe.runId === "string" &&
		typeof maybe.timestamp === "string"
	);
}
