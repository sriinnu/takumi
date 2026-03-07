/**
 * takumi daemon — Manage the chitragupta background daemon.
 *
 * Usage: takumi daemon [start|stop|status|restart|logs]
 *
 * The chitragupta daemon provides persistent memory and session storage
 * across all takumi sessions, eliminating the cold-start penalty of
 * spawning a new MCP subprocess for every session.
 *
 * Daemon entry point is resolved from:
 *   1. CHITRAGUPTA_DAEMON_ENTRY env var (absolute path to dist/entry.js)
 *   2. Auto-discovery relative to CHITRAGUPTA_HOME or cwd
 */

import { fork } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDaemonStatus, getLogDir, getPidPath, getSocketPath, isAlive, probeSocket, readPid } from "./daemon-status.js";

// ── Resolve daemon entry.js ──────────────────────────────────────────────────

function findDaemonEntry(): string | null {
	// 1. Explicit env var
	if (process.env.CHITRAGUPTA_DAEMON_ENTRY) {
		return process.env.CHITRAGUPTA_DAEMON_ENTRY;
	}

	// 2. Auto-discover: look for chitragupta sibling directories from cwd up
	const candidates: string[] = [];
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
		candidates.push(
			path.join(dir, "AUriva", "chitragupta", "packages", "daemon", "dist", "entry.js"),
			path.join(dir, "chitragupta", "packages", "daemon", "dist", "entry.js"),
		);
	}

	for (const c of candidates) {
		if (fs.existsSync(c)) return c;
	}
	return null;
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function doStart(): Promise<void> {
	const socketPath = getSocketPath();
	const pidPath = getPidPath();

	if (await probeSocket(socketPath)) {
		const pid = readPid(pidPath);
		console.log(`chitragupta daemon is already running${pid ? ` (pid ${pid})` : ""}`);
		console.log(`  socket: ${socketPath}`);
		return;
	}

	const entry = findDaemonEntry();
	if (!entry) {
		console.error("Cannot find chitragupta daemon entry.js.");
		console.error("Set CHITRAGUPTA_DAEMON_ENTRY to the path of dist/entry.js:");
		console.error("  export CHITRAGUPTA_DAEMON_ENTRY=/path/to/chitragupta/packages/daemon/dist/entry.js");
		process.exit(1);
	}

	console.log(`Starting chitragupta daemon (${path.basename(path.dirname(path.dirname(entry)))})`);
	const logDir = getLogDir();
	fs.mkdirSync(logDir, { recursive: true });
	const outFd = fs.openSync(path.join(logDir, "daemon.out.log"), "a");
	const errFd = fs.openSync(path.join(logDir, "daemon.err.log"), "a");

	const child = fork(entry, [], {
		detached: true,
		stdio: ["ignore", outFd, errFd, "ipc"],
		env: { ...process.env, CHITRAGUPTA_DAEMON: "1", NODE_OPTIONS: "--max-old-space-size=256" },
	});

	const pid = await new Promise<number>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("Daemon startup timed out (10s)")), 10_000);
		child.on("message", (msg) => {
			if (typeof msg === "object" && msg !== null && (msg as { ready?: boolean }).ready) {
				clearTimeout(timeout);
				resolve(child.pid!);
			}
		});
		child.on("error", (err) => { clearTimeout(timeout); reject(err); });
		child.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Daemon exited during startup (code ${code})`)); });
	});

	child.unref();
	child.disconnect();
	fs.closeSync(outFd);
	fs.closeSync(errFd);

	console.log(`chitragupta daemon started (pid ${pid})`);
	console.log(`  socket: ${socketPath}`);
	console.log(`  logs:   ${logDir}/daemon.out.log`);
}

async function doStop(): Promise<void> {
	const pidPath = getPidPath();
	const socketPath = getSocketPath();
	const pid = readPid(pidPath);

	if (!pid || !isAlive(pid)) {
		console.log("chitragupta daemon is not running");
		return;
	}

	process.kill(pid, "SIGTERM");
	console.log(`Sent SIGTERM to daemon (pid ${pid})`);

	for (let i = 0; i < 50; i++) {
		await new Promise<void>((r) => setTimeout(r, 100));
		if (!isAlive(pid)) {
			try { fs.unlinkSync(pidPath); } catch { /* ok */ }
			console.log("chitragupta daemon stopped");
			return;
		}
	}

	process.kill(pid, "SIGKILL");
	try { fs.unlinkSync(pidPath); } catch { /* ok */ }
	try { fs.unlinkSync(socketPath); } catch { /* ok */ }
	console.log("chitragupta daemon force-killed");
}

async function doStatus(): Promise<void> {
	const status = await getDaemonStatus();

	console.log(`chitragupta daemon status:`);
	console.log(`  running:  ${status.healthy ? "yes" : "no"}`);
	if (status.pid) console.log(`  pid:      ${status.pid}${status.alive ? "" : " (stale)"}`);
	console.log(`  socket:   ${status.socketPath} (${status.listening ? "listening" : "not found"})`);
	console.log(`  logs:     ${status.logDir}/daemon.out.log`);
}

async function doStatusJson(): Promise<void> {
	const status = await getDaemonStatus();
	console.log(JSON.stringify(status, null, 2));
}

async function doLogs(lines = 50): Promise<void> {
	const logFile = path.join(getLogDir(), "daemon.out.log");
	if (!fs.existsSync(logFile)) {
		console.log("No daemon log file found. Is the daemon running?");
		return;
	}
	const content = fs.readFileSync(logFile, "utf-8");
	const tail = content.split("\n").slice(-lines).join("\n");
	console.log(tail);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function cmdDaemon(action = "status", asJson = false): Promise<void> {
	switch (action) {
		case "start":
			await doStart();
			return;
		case "stop":
			await doStop();
			return;
		case "restart":
			await doStop();
			await doStart();
			return;
		case "logs":
			await doLogs();
			return;
		default:
			if (asJson) {
				await doStatusJson();
				return;
			}
			await doStatus();
	}
}
