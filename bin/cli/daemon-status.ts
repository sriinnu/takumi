import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface DaemonStatusSummary {
	pid: number | null;
	alive: boolean;
	listening: boolean;
	healthy: boolean;
	socketPath: string;
	pidPath: string;
	logDir: string;
}

export function getSocketPath(): string {
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

export function getPidPath(): string {
	if (process.env.CHITRAGUPTA_PID) return process.env.CHITRAGUPTA_PID;
	const home = process.env.HOME ?? os.homedir();
	return path.join(process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta"), "daemon.pid");
}

export function getLogDir(): string {
	const home = process.env.HOME ?? os.homedir();
	return path.join(process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta"), "logs");
}

export function readPid(pidFile: string): number | null {
	try {
		const n = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function probeSocket(socketPath: string, timeoutMs = 600): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const done = (value: boolean) => {
			if (!settled) {
				settled = true;
				socket.destroy();
				resolve(value);
			}
		};
		const socket = net.createConnection(socketPath);
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
		setTimeout(() => done(false), timeoutMs);
	});
}

export async function getDaemonStatus(): Promise<DaemonStatusSummary> {
	const socketPath = getSocketPath();
	const pidPath = getPidPath();
	const pid = readPid(pidPath);
	const alive = pid ? isAlive(pid) : false;
	const listening = await probeSocket(socketPath);
	return {
		pid,
		alive,
		listening,
		healthy: alive && listening,
		socketPath,
		pidPath,
		logDir: getLogDir(),
	};
}