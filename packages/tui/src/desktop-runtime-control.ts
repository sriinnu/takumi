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

	return runtimes.sort((a, b) => b.startedAt - a.startedAt).map(toRuntimeSummary);
}

export async function startLocalRuntime(options?: {
	sessionId?: string;
	provider?: string;
	model?: string;
	workingDirectory?: string;
}): Promise<RuntimeSummary> {
	const dirs = getRuntimeDirs();
	await mkdir(dirs.logs, { recursive: true });
	await mkdir(dirs.jobs, { recursive: true });

	const runtimeId = `rt-${Date.now().toString(36)}`;
	const logFile = join(dirs.logs, `${runtimeId}.log`);
	const logFd = openSync(logFile, "w", 0o644);
	const launch = resolveLaunchCommand();
	const args = [...launch.args];
	if (options?.provider) args.push("--provider", options.provider);
	if (options?.model) args.push("--model", options.model);
	if (options?.sessionId) args.push("--resume", options.sessionId);
	if (options?.workingDirectory) args.push("--working-directory", options.workingDirectory);

	const child = spawn(launch.command, args, {
		cwd: options?.workingDirectory ?? process.cwd(),
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: { ...process.env, TAKUMI_RUNTIME_SOURCE: "desktop" },
	});
	child.unref();

	const record: RuntimeJobRecord = {
		id: runtimeId,
		pid: child.pid ?? -1,
		logFile,
		cwd: options?.workingDirectory ?? process.cwd(),
		startedAt: Date.now(),
		status: "running",
		command: launch.command,
		args,
		sessionId: options?.sessionId,
		runtimeSource: "desktop",
	};
	await writeFile(join(dirs.jobs, `${runtimeId}.json`), JSON.stringify(record, null, 2), "utf-8");
	return toRuntimeSummary(record);
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
