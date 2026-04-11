import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeSummary } from "@takumi/bridge";

const require = createRequire(import.meta.url);

interface RuntimeJobRecord {
	id: string;
	pid: number;
	logFile: string;
	cwd: string;
	startedAt: number;
	status?: "running" | "stopped" | "exited";
	stoppedAt?: number;
	command?: string;
	args?: string[];
	sessionId?: string;
	runtimeSource?: string;
}

interface RuntimeStartOptions {
	sessionId?: string;
	provider?: string;
	model?: string;
	workingDirectory?: string;
}

const pendingRuntimeStarts = new Map<string, Promise<RuntimeSummary>>();

class DesktopRuntimeSingletonError extends Error {
	constructor(readonly activeRuntime: RuntimeSummary) {
		super(
			`Desktop runtime singleton is already active (${activeRuntime.runtimeId}, pid ${activeRuntime.pid}). Attach to it or stop it before starting another runtime.`,
		);
		this.name = "DesktopRuntimeSingletonError";
	}
}

function getRuntimeDirs(): { logs: string; jobs: string } {
	const root = join(homedir(), ".takumi");
	return { logs: join(root, "logs"), jobs: join(root, "jobs") };
}

function isProcessRunning(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function resolveLaunchCommand(): { command: string; args: string[] } {
	const scriptPath = process.argv[1] ?? "";
	if (scriptPath.endsWith(".ts")) {
		return {
			command: process.execPath,
			args: [require.resolve("tsx/dist/cli.mjs"), scriptPath],
		};
	}
	if (scriptPath.endsWith(".js") || scriptPath.endsWith(".mjs") || scriptPath.endsWith(".cjs")) {
		return { command: process.execPath, args: [scriptPath] };
	}
	return { command: process.platform === "win32" ? "pnpm.cmd" : "pnpm", args: ["takumi"] };
}

function trimToUndefined(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeRuntimeStartOptions(
	options?: RuntimeStartOptions,
): Required<Pick<RuntimeStartOptions, "workingDirectory">> & RuntimeStartOptions {
	return {
		sessionId: trimToUndefined(options?.sessionId),
		provider: trimToUndefined(options?.provider),
		model: trimToUndefined(options?.model),
		workingDirectory: trimToUndefined(options?.workingDirectory) ?? process.cwd(),
	};
}

function extractCliFlagValue(args: string[] | undefined, flag: string): string | undefined {
	if (!args?.length) return undefined;
	const flagIndex = args.indexOf(flag);
	if (flagIndex === -1 || flagIndex === args.length - 1) return undefined;
	return trimToUndefined(args[flagIndex + 1]);
}

function runtimeMatchesStartRequest(
	record: RuntimeJobRecord,
	options: Required<Pick<RuntimeStartOptions, "workingDirectory">> & RuntimeStartOptions,
): boolean {
	if (!isProcessRunning(record.pid)) return false;
	if (record.cwd !== options.workingDirectory) return false;
	if (trimToUndefined(record.sessionId) !== options.sessionId) return false;
	if (extractCliFlagValue(record.args, "--provider") !== options.provider) return false;
	if (extractCliFlagValue(record.args, "--model") !== options.model) return false;
	return true;
}

function buildRuntimeStartKey(
	options: Required<Pick<RuntimeStartOptions, "workingDirectory">> & RuntimeStartOptions,
): string {
	return JSON.stringify({
		sessionId: options.sessionId ?? null,
		provider: options.provider ?? null,
		model: options.model ?? null,
		workingDirectory: options.workingDirectory,
	});
}

async function readRuntimeJobRecords(): Promise<RuntimeJobRecord[]> {
	const { jobs } = getRuntimeDirs();
	let files: string[] = [];
	try {
		files = await readdir(jobs);
	} catch {
		return [];
	}

	const runtimes: RuntimeJobRecord[] = [];
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		try {
			const raw = await readFile(join(jobs, file), "utf-8");
			const parsed = JSON.parse(raw) as RuntimeJobRecord;
			if (parsed?.id && Number.isFinite(parsed.pid)) runtimes.push(parsed);
		} catch {
			// ignore malformed records
		}
	}

	return runtimes.sort((a, b) => b.startedAt - a.startedAt);
}

function resolveReusableRuntime(
	records: RuntimeJobRecord[],
	options: Required<Pick<RuntimeStartOptions, "workingDirectory">> & RuntimeStartOptions,
): RuntimeSummary | null {
	const reusable = records.find((record) => runtimeMatchesStartRequest(record, options));
	return reusable ? toRuntimeSummary(reusable) : null;
}

function resolveActiveRuntime(records: RuntimeJobRecord[]): RuntimeSummary | null {
	const activeRecord = records.find((record) => isProcessRunning(record.pid));
	return activeRecord ? toRuntimeSummary(activeRecord) : null;
}

function toRuntimeSummary(record: RuntimeJobRecord): RuntimeSummary {
	return {
		runtimeId: record.id,
		pid: record.pid,
		state: isProcessRunning(record.pid) ? "running" : (record.status ?? "exited"),
		startedAt: record.startedAt,
		cwd: record.cwd,
		logFile: record.logFile,
		command: record.command,
		args: record.args,
		sessionId: record.sessionId,
		runtimeSource: record.runtimeSource ?? "desktop",
	};
}

export async function listLocalRuntimes(): Promise<RuntimeSummary[]> {
	return (await readRuntimeJobRecords()).map(toRuntimeSummary);
}

async function startLocalRuntimeInternal(options: RuntimeStartOptions = {}): Promise<RuntimeSummary> {
	const dirs = getRuntimeDirs();
	await mkdir(dirs.logs, { recursive: true });
	await mkdir(dirs.jobs, { recursive: true });
	const requestedWorkingDirectory = trimToUndefined(options.workingDirectory);
	const normalizedOptions = normalizeRuntimeStartOptions(options);
	const existingRecords = await readRuntimeJobRecords();
	const reusableRuntime = resolveReusableRuntime(existingRecords, normalizedOptions);
	if (reusableRuntime) {
		return reusableRuntime;
	}

	const activeRuntime = resolveActiveRuntime(existingRecords);
	if (activeRuntime) {
		throw new DesktopRuntimeSingletonError(activeRuntime);
	}

	const runtimeId = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const logFile = join(dirs.logs, `${runtimeId}.log`);
	const logFd = openSync(logFile, "w", 0o644);
	const launch = resolveLaunchCommand();
	const args = [...launch.args];
	if (normalizedOptions.provider) args.push("--provider", normalizedOptions.provider);
	if (normalizedOptions.model) args.push("--model", normalizedOptions.model);
	if (normalizedOptions.sessionId) args.push("--resume", normalizedOptions.sessionId);
	if (requestedWorkingDirectory) args.push("--working-directory", requestedWorkingDirectory);

	const child = spawn(launch.command, args, {
		cwd: normalizedOptions.workingDirectory,
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: { ...process.env, TAKUMI_RUNTIME_SOURCE: "desktop" },
	});
	child.unref();

	const record: RuntimeJobRecord = {
		id: runtimeId,
		pid: child.pid ?? -1,
		logFile,
		cwd: normalizedOptions.workingDirectory,
		startedAt: Date.now(),
		status: "running",
		command: launch.command,
		args,
		sessionId: normalizedOptions.sessionId,
		runtimeSource: "desktop",
	};
	await writeFile(join(dirs.jobs, `${runtimeId}.json`), JSON.stringify(record, null, 2), "utf-8");
	return toRuntimeSummary(record);
}

/**
 * Start or reuse one detached local runtime for the desktop Build Window.
 *
 * I intentionally dedupe identical in-flight starts, reuse matching live
 * runtimes, and enforce one live desktop runtime at a time so one noisy
 * caller cannot fork-bomb the machine with detached Takumi children.
 */
export async function startLocalRuntime(options?: RuntimeStartOptions): Promise<RuntimeSummary> {
	const normalizedOptions = normalizeRuntimeStartOptions(options);
	const startKey = buildRuntimeStartKey(normalizedOptions);
	const pendingStart = pendingRuntimeStarts.get(startKey);
	if (pendingStart) {
		return pendingStart;
	}

	const startPromise = startLocalRuntimeInternal(normalizedOptions).finally(() => {
		pendingRuntimeStarts.delete(startKey);
	});
	pendingRuntimeStarts.set(startKey, startPromise);
	return startPromise;
}

export async function stopLocalRuntime(runtimeId: string): Promise<boolean> {
	const { jobs } = getRuntimeDirs();
	const filePath = join(jobs, `${runtimeId}.json`);
	let record: RuntimeJobRecord;
	try {
		record = JSON.parse(await readFile(filePath, "utf-8")) as RuntimeJobRecord;
	} catch {
		return false;
	}

	if (isProcessRunning(record.pid)) {
		try {
			process.kill(record.pid, "SIGTERM");
		} catch {
			return false;
		}
	}

	const updated: RuntimeJobRecord = { ...record, status: "stopped", stoppedAt: Date.now() };
	await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
	return true;
}
