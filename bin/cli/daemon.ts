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
import net from "node:net";
import os from "node:os";
import path from "node:path";

// ── Inline path resolution (mirrors @chitragupta/daemon/paths) ───────────────

function getSocketPath(): string {
	if (process.env.CHITRAGUPTA_SOCKET) return process.env.CHITRAGUPTA_SOCKET;
	const home = process.env.HOME ?? os.homedir();
	let dir: string;
	if (process.env.CHITRAGUPTA_DAEMON_DIR) {
		dir = process.env.CHITRAGUPTA_DAEMON_DIR;
	} else if (process.platform === "darwin") {
		dir = path.join(home, "Library", "Caches", "chitragupta", "daemon");
	} else if (process.env.XDG_RUNTIME_DIR) {
		dir = path.join(process.env.XDG_RUNTIME_DIR, "chitragupta");
	} else {
		dir = path.join(process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta"), "daemon");
	}
	return path.join(dir, "chitragupta.sock");
}

function getPidPath(): string {
	if (process.env.CHITRAGUPTA_PID) return process.env.CHITRAGUPTA_PID;
	const home = process.env.HOME ?? os.homedir();
	return path.join(process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta"), "daemon.pid");
}

function getLogDir(): string {
	const home = process.env.HOME ?? os.homedir();
	return path.join(process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta"), "logs");
}

function readPid(pidFile: string): number | null {
	try {
		const n = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function probeSocketSync(socketPath: string): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const done = (v: boolean) => {
			if (!settled) {
				settled = true;
				s.destroy();
				resolve(v);
			}
		};
		const s = net.createConnection(socketPath);
		s.once("connect", () => done(true));
		s.once("error", () => done(false));
		setTimeout(() => done(false), 600);
	});
}

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

	if (await probeSocketSync(socketPath)) {
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
	const socketPath = getSocketPath();
	const pidPath = getPidPath();
	const pid = readPid(pidPath);
	const alive = pid ? isAlive(pid) : false;
	const listening = await probeSocketSync(socketPath);

	console.log(`chitragupta daemon status:`);
	console.log(`  running:  ${alive && listening ? "yes" : "no"}`);
	if (pid) console.log(`  pid:      ${pid}${alive ? "" : " (stale)"}`);
	console.log(`  socket:   ${socketPath} (${listening ? "listening" : "not found"})`);
	console.log(`  logs:     ${getLogDir()}/daemon.out.log`);
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

export async function cmdDaemon(action = "status"): Promise<void> {
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
			await doStatus();
	}
}
