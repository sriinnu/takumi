import type { DetachedJobRecord } from "./types.js";
import { homedir } from "node:os";
import { join } from "node:path";

function getTakumiDirs(): { root: string; logs: string; jobs: string } {
	const root = join(homedir(), ".takumi");
	return { root, logs: join(root, "logs"), jobs: join(root, "jobs") };
}

export function isProcessRunning(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function loadDetachedJobs(): Promise<DetachedJobRecord[]> {
	const { readdir, readFile } = await import("node:fs/promises");
	const { basename, extname, join } = await import("node:path");
	const dirs = getTakumiDirs();

	let files: string[] = [];
	try {
		files = await readdir(dirs.jobs);
	} catch {
		return [];
	}

	const records: DetachedJobRecord[] = [];
	for (const file of files) {
		const ext = extname(file);
		if (ext !== ".json" && ext !== ".pid") continue;
		const fullPath = join(dirs.jobs, file);
		try {
			if (ext === ".json") {
				const text = await readFile(fullPath, "utf-8");
				const parsed = JSON.parse(text) as DetachedJobRecord;
				if (parsed?.id && Number.isFinite(parsed.pid)) records.push(parsed);
			} else {
				const pidText = await readFile(fullPath, "utf-8");
				const pid = Number.parseInt(pidText.trim(), 10);
				if (Number.isFinite(pid)) {
					const id = basename(file, ".pid");
					records.push({ id, pid, logFile: join(dirs.logs, `${id}.log`), cwd: process.cwd(), startedAt: Date.now() });
				}
			}
		} catch {
			// ignore malformed files
		}
	}

	return records.sort((a, b) => b.startedAt - a.startedAt);
}

export async function cmdJobs(): Promise<void> {
	const jobs = await loadDetachedJobs();
	if (jobs.length === 0) {
		console.log("No detached jobs found.");
		return;
	}
	console.log(`\nDetached jobs (${jobs.length}):\n`);
	for (const j of jobs) {
		const running = isProcessRunning(j.pid);
		const state = running ? "running" : (j.status ?? "exited");
		const date = new Date(j.startedAt).toLocaleString();
		console.log(`  \x1b[1;36m${j.id}\x1b[0m`);
		console.log(`    PID:     ${j.pid}`);
		console.log(`    State:   ${state}`);
		console.log(`    Started: ${date}`);
		console.log(`    CWD:     ${j.cwd}`);
		console.log(`    Log:     ${j.logFile}`);
		console.log();
	}
}

function formatAge(startedAt: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function truncateMiddle(text: string, max = 56): string {
	if (text.length <= max) return text;
	const keep = Math.max(6, Math.floor((max - 1) / 2));
	return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

export async function cmdWatch(id?: string): Promise<void> {
	const onStdoutError = (err: NodeJS.ErrnoException) => {
		if (err.code === "EPIPE") {
			process.exit(0);
		}
	};
	process.stdout.on("error", onStdoutError);

	const render = async () => {
		const jobs = await loadDetachedJobs();
		const filtered = id ? jobs.filter((j) => j.id === id) : jobs;

		if (id && filtered.length === 0) {
			console.error(`Detached job not found: ${id}`);
			process.exit(1);
		}

		process.stdout.write("\x1b[2J\x1b[H");
		const ts = new Date().toLocaleTimeString();
		console.log(`Takumi detached jobs watcher — ${ts}`);
		console.log("Press Ctrl+C to exit.\n");

		if (filtered.length === 0) {
			console.log("No detached jobs found.");
			return;
		}

		console.log("ID                STATE     PID      AGE       CWD");
		console.log("────────────────  ────────  ───────  ────────  ─────────────────────────────────────────────────────");

		for (const j of filtered) {
			const running = isProcessRunning(j.pid);
			const state = (running ? "running" : (j.status ?? "exited")).padEnd(8);
			const jobId = j.id.padEnd(16);
			const pid = String(j.pid).padEnd(7);
			const age = formatAge(j.startedAt).padEnd(8);
			const cwd = truncateMiddle(j.cwd);
			console.log(`${jobId}  ${state}  ${pid}  ${age}  ${cwd}`);
		}
	};

	await render();
	const interval = setInterval(render, 1000);

	process.on("SIGINT", () => {
		clearInterval(interval);
		process.stdout.off("error", onStdoutError);
		process.stdout.write("\n");
		process.exit(0);
	});
}

export async function cmdAttach(id: string): Promise<void> {
	const jobs = await loadDetachedJobs();
	const job = jobs.find((j) => j.id === id);
	if (!job) {
		console.error(`Detached job not found: ${id}`);
		process.exit(1);
	}

	const { createReadStream } = await import("node:fs");
	const { stat, access } = await import("node:fs/promises");

	console.log(`Attaching to ${job.id} (pid=${job.pid})`);
	console.log(`Log: ${job.logFile}`);
	console.log("Press Ctrl+C to detach.\n");

	let offset = 0;
	let exitedSeen = !isProcessRunning(job.pid);

	try {
		await access(job.logFile);
		const s = await stat(job.logFile);
		if (s.size > 0) {
			const rs = createReadStream(job.logFile, { start: 0, end: s.size - 1 });
			rs.pipe(process.stdout, { end: false });
			await new Promise<void>((resolve) => rs.on("end", () => resolve()));
			offset = s.size;
		}
	} catch {
		console.log("(log file not available yet; waiting for output...)\n");
	}

	const poll = setInterval(async () => {
		try {
			const s = await stat(job.logFile);
			if (s.size > offset) {
				const rs = createReadStream(job.logFile, { start: offset, end: s.size - 1 });
				rs.pipe(process.stdout, { end: false });
				await new Promise<void>((resolve) => rs.on("end", () => resolve()));
				offset = s.size;
			}
		} catch {
			// ignore while waiting for file
		}

		const running = isProcessRunning(job.pid);
		if (!running) {
			if (exitedSeen) {
				clearInterval(poll);
				console.log(`\n[attach] job ${job.id} exited.`);
				process.exit(0);
			}
			exitedSeen = true;
		} else {
			exitedSeen = false;
		}
	}, 400);

	process.on("SIGINT", () => {
		clearInterval(poll);
		console.log("\n[attach] detached.");
		process.exit(0);
	});
}

export async function cmdStop(id: string): Promise<void> {
	const jobs = await loadDetachedJobs();
	const job = jobs.find((j) => j.id === id);
	if (!job) {
		console.error(`Detached job not found: ${id}`);
		process.exit(1);
	}

	if (!isProcessRunning(job.pid)) {
		console.log(`Job ${id} is not running (pid ${job.pid}).`);
		return;
	}

	console.log(`Stopping ${id} (pid ${job.pid})...`);
	try {
		process.kill(job.pid, "SIGTERM");
	} catch {
		console.log(`Could not send SIGTERM to pid ${job.pid}.`);
		return;
	}

	for (let i = 0; i < 10; i++) {
		if (!isProcessRunning(job.pid)) break;
		await new Promise((r) => setTimeout(r, 200));
	}

	if (isProcessRunning(job.pid)) {
		console.log("Process still running; sending SIGKILL...");
		try {
			process.kill(job.pid, "SIGKILL");
		} catch {
			console.log(`Failed to SIGKILL pid ${job.pid}.`);
		}
	}

	try {
		const { writeFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const dirs = getTakumiDirs();
		const updated: DetachedJobRecord = { ...job, status: "stopped", stoppedAt: Date.now() };
		await writeFile(join(dirs.jobs, `${job.id}.json`), JSON.stringify(updated, null, 2), "utf-8");
	} catch {
		// ignore metadata write failures
	}

	console.log(`Stopped ${id}.`);
}

export async function startDetachedJob(): Promise<never> {
	const { mkdirSync, openSync, constants: fsConst } = await import("node:fs");
	const { join: pathJoin } = await import("node:path");
	const { homedir } = await import("node:os");
	const { spawn: spawnProc } = await import("node:child_process");
	const fs = await import("node:fs/promises");

	const jobId = `job-${Date.now().toString(36)}`;
	const logsDir = pathJoin(homedir(), ".takumi", "logs");
	const jobsDir = pathJoin(homedir(), ".takumi", "jobs");
	mkdirSync(logsDir, { recursive: true });
	mkdirSync(jobsDir, { recursive: true });

	const logFile = pathJoin(logsDir, `${jobId}.log`);
	const logFd = openSync(logFile, fsConst.O_WRONLY | fsConst.O_CREAT | fsConst.O_TRUNC, 0o644);
	const child = spawnProc(process.execPath, process.argv.slice(1), {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: { ...process.env, TAKUMI_DETACHED: "1" },
	});
	child.unref();

	const jobRecord: DetachedJobRecord = {
		id: jobId,
		pid: child.pid ?? -1,
		logFile,
		cwd: process.cwd(),
		startedAt: Date.now(),
		status: "running",
		command: process.execPath,
		args: process.argv.slice(1),
	};
	await fs.writeFile(pathJoin(jobsDir, `${jobId}.json`), JSON.stringify(jobRecord, null, 2), "utf-8");
	console.log(`[detached] job ${jobId}  pid=${child.pid}  log=${logFile}`);
	process.exit(0);
}
