import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import type { ExecProtocolEvent, ExecRunCompletedEvent, ExecRunFailedEvent } from "@takumi/core";
import {
	buildTakumiExecSpawnPlan,
	isTakumiExecEvent,
	type TakumiExecRequest,
	type TakumiExecSpawnPlan,
} from "./takumi-exec-contract.js";

export type TakumiExecTerminalEvent = ExecRunCompletedEvent | ExecRunFailedEvent;

export interface TakumiExecRunnerOptions {
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	maxStderrBytes?: number;
	onEvent?: (event: ExecProtocolEvent) => void | Promise<void>;
	spawnImpl?: SpawnLike;
}

export interface TakumiExecRunResult {
	request: TakumiExecRequest;
	plan: TakumiExecSpawnPlan;
	events: ExecProtocolEvent[];
	terminalEvent: TakumiExecTerminalEvent | null;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
	transportFailure: boolean;
	transportFailureReason?: string;
	timedOut: boolean;
}

export class TakumiExecTransportError extends Error {
	readonly result: TakumiExecRunResult;

	constructor(message: string, result: TakumiExecRunResult) {
		super(message);
		this.name = "TakumiExecTransportError";
		this.result = result;
	}
}

type SpawnLike = (
	command: string,
	args: readonly string[],
	options: SpawnOptions,
) => ChildProcess & { stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream };

export async function runTakumiExec(
	request: TakumiExecRequest,
	options: TakumiExecRunnerOptions = {},
): Promise<TakumiExecRunResult> {
	const plan = buildTakumiExecSpawnPlan(request, options.env ?? process.env);
	const timeoutMs = options.timeoutMs ?? plan.timeoutMs;
	const maxStderrBytes = options.maxStderrBytes ?? 32_768;
	const spawnImpl = options.spawnImpl ?? spawn;
	const child = spawnImpl(plan.command, plan.args, {
		cwd: plan.cwd,
		env: plan.env,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const events: ExecProtocolEvent[] = [];
	let terminalEvent: TakumiExecTerminalEvent | null = null;
	let stderr = "";
	let transportFailureReason: string | undefined;
	let timedOut = false;

	child.stderr.on("data", (chunk: Buffer | string) => {
		if (stderr.length >= maxStderrBytes) return;
		stderr += chunk.toString("utf-8");
		if (stderr.length > maxStderrBytes) {
			stderr = stderr.slice(0, maxStderrBytes);
		}
	});

	const timer = setTimeout(() => {
		timedOut = true;
		transportFailureReason = `Takumi exec timed out after ${timeoutMs}ms`;
		child.kill("SIGTERM");
	}, timeoutMs);

	const stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity });

	const parsePromise = (async () => {
		for await (const rawLine of stdoutReader) {
			const line = rawLine.trim();
			if (!line) continue;

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				transportFailureReason = `Invalid JSON line on stdout: ${line.slice(0, 120)}`;
				child.kill("SIGTERM");
				break;
			}

			if (!isTakumiExecEvent(parsed)) {
				transportFailureReason = `Non-protocol stdout event encountered`;
				child.kill("SIGTERM");
				break;
			}

			events.push(parsed);
			if (isTakumiExecTerminalEvent(parsed)) {
				terminalEvent = parsed;
			}

			await options.onEvent?.(parsed);
		}
	})();

	const closePromise = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;

	try {
		const [closeResult] = await Promise.all([closePromise, parsePromise]);
		const [exitCode, signal] = closeResult;
		const result: TakumiExecRunResult = {
			request,
			plan,
			events,
			terminalEvent,
			exitCode,
			signal,
			stderr,
			transportFailure: Boolean(transportFailureReason) || terminalEvent === null,
			transportFailureReason:
				transportFailureReason ??
				(terminalEvent === null ? `Missing terminal envelope (exit ${exitCode ?? "null"})` : undefined),
			timedOut,
		};

		if (result.transportFailure) {
			throw new TakumiExecTransportError(result.transportFailureReason ?? "Takumi exec transport failure", result);
		}

		return result;
	} finally {
		clearTimeout(timer);
		stdoutReader.close();
	}
}

export function isTakumiExecTerminalEvent(event: ExecProtocolEvent): event is TakumiExecTerminalEvent {
	return event.kind === "run_completed" || event.kind === "run_failed";
}
