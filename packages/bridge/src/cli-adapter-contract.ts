export type CliOutputProtocol = "text" | "json" | "line-json" | "ndjson" | "custom";
export type CliStderrMode = "diagnostic-text" | "protocol-mirror" | "ignore";

export interface CliAdapterRetryPolicy {
	maxAttempts: number;
	retryOnTransportFailure: boolean;
	nonRetryableExitCodes?: number[];
}

export interface CliAdapterContract {
	id: string;
	transport: "local-process";
	binaryEnv?: string;
	binaryCandidates: readonly string[];
	defaultArgs?: readonly string[];
	stdoutProtocol: CliOutputProtocol;
	stderrMode: CliStderrMode;
	timeoutMs: number;
	workingDirectoryFromRequest?: boolean;
	retry?: CliAdapterRetryPolicy;
	metadata?: Record<string, unknown>;
}

export interface CliAdapterRequest {
	cwd: string;
	args?: string[];
	stdinText?: string;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
}

export interface CliAdapterSpawnPlan {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	stdinText?: string;
	stdoutProtocol: CliOutputProtocol;
	stderrMode: CliStderrMode;
	timeoutMs: number;
	retry?: CliAdapterRetryPolicy;
}

export function resolveCliAdapterCommand(contract: CliAdapterContract, env: NodeJS.ProcessEnv = process.env): string {
	if (contract.binaryEnv && env[contract.binaryEnv]) {
		return env[contract.binaryEnv] as string;
	}
	return contract.binaryCandidates[0];
}

export function buildCliAdapterSpawnPlan(
	contract: CliAdapterContract,
	request: CliAdapterRequest,
	env: NodeJS.ProcessEnv = process.env,
): CliAdapterSpawnPlan {
	return {
		command: resolveCliAdapterCommand(contract, env),
		args: [...(contract.defaultArgs ?? []), ...(request.args ?? [])],
		cwd: request.cwd,
		env: {
			...env,
			...request.env,
		},
		stdinText: request.stdinText,
		stdoutProtocol: contract.stdoutProtocol,
		stderrMode: contract.stderrMode,
		timeoutMs: request.timeoutMs ?? contract.timeoutMs,
		retry: contract.retry,
	};
}
