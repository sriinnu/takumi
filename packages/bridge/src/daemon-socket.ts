/**
 * @takumi/bridge — Thin chitragupta daemon socket client.
 *
 * Mirrors @chitragupta/daemon wire format without importing it,
 * avoiding transitive dependency issues. Uses JSON-RPC 2.0 over
 * NDJSON (identical to the real DaemonClient wire protocol).
 *
 * @module
 */

import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createLogger } from "@takumi/core";

const log = createLogger("daemon-socket");

// ── Path resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the chitragupta daemon Unix socket path.
 *
 * Mirrors @chitragupta/daemon resolvePaths() — respects the same
 * env overrides so users only configure once.
 *
 * macOS:  ~/Library/Caches/chitragupta/daemon/chitragupta.sock
 * Linux:  $XDG_RUNTIME_DIR/chitragupta/chitragupta.sock (or ~/.chitragupta/daemon/)
 * Windows: ~/.chitragupta/daemon/chitragupta.sock
 */
export function resolveSocketPath(): string {
	if (process.env.CHITRAGUPTA_SOCKET) return process.env.CHITRAGUPTA_SOCKET;

	const home = process.env.HOME ?? os.homedir();
	let daemonDir: string;

	if (process.env.CHITRAGUPTA_DAEMON_DIR) {
		daemonDir = process.env.CHITRAGUPTA_DAEMON_DIR;
	} else if (process.platform === "darwin") {
		daemonDir = path.join(home, "Library", "Caches", "chitragupta", "daemon");
	} else if (process.platform !== "win32" && process.env.XDG_RUNTIME_DIR) {
		daemonDir = path.join(process.env.XDG_RUNTIME_DIR, "chitragupta");
	} else {
		const chitHome = process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta");
		daemonDir = path.join(chitHome, "daemon");
	}

	return path.join(daemonDir, "chitragupta.sock");
}

/**
 * Resolve the chitragupta daemon PID file path.
 * Mirrors @chitragupta/daemon resolvePaths().pid.
 */
export function resolvePidPath(): string {
	if (process.env.CHITRAGUPTA_PID) return process.env.CHITRAGUPTA_PID;
	const home = process.env.HOME ?? os.homedir();
	const chitHome = process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta");
	return path.join(chitHome, "daemon.pid");
}

/**
 * Resolve the chitragupta daemon log directory.
 * Mirrors @chitragupta/daemon resolvePaths().logDir.
 */
export function resolveLogDir(): string {
	const home = process.env.HOME ?? os.homedir();
	const chitHome = process.env.CHITRAGUPTA_HOME ?? path.join(home, ".chitragupta");
	return path.join(chitHome, "logs");
}

/**
 * Non-blocking probe: returns true if a daemon is listening on socketPath.
 * Times out after 500 ms to avoid blocking the TUI startup.
 */
export function probeSocket(socketPath: string): Promise<boolean> {
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
		// Hard timeout — daemon probe must not block TUI startup
		setTimeout(() => done(false), 500);
	});
}

// ── DaemonSocketClient ───────────────────────────────────────────────────────

interface Pending {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** Handler for server-push notifications (JSON-RPC messages without an id). */
export type NotificationHandler = (params: Record<string, unknown>) => void;

/** JSON-RPC 2.0 NDJSON socket client for the chitragupta daemon. */
export class DaemonSocketClient {
	private sock: net.Socket | null = null;
	private buf = "";
	private readonly pending = new Map<string, Pending>();
	private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>();
	private seq = 0;

	readonly socketPath: string;
	readonly timeout: number;

	constructor(socketPath?: string, timeoutMs = 10_000) {
		this.socketPath = socketPath ?? resolveSocketPath();
		this.timeout = timeoutMs;
	}

	/** Connect to the daemon socket. */
	connect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const s = net.createConnection(this.socketPath);

			s.once("connect", () => {
				this.sock = s;
				log.debug("Connected to chitragupta daemon socket");
				resolve();
			});

			s.once("error", (err) => {
				reject(err);
			});

			s.on("data", (chunk: Buffer) => {
				this.buf += chunk.toString("utf-8");
				this.flush();
			});

			s.on("close", () => {
				this.sock = null;
				log.debug("Daemon socket closed");
			});
		});
	}

	/**
	 * Send a JSON-RPC 2.0 request and await the response.
	 * Rejects on timeout or daemon error.
	 */
	async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		if (!this.sock || this.sock.destroyed) {
			throw new Error("Daemon socket not connected");
		}

		const id = `t${++this.seq}`;
		const wire = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;

		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Daemon RPC timeout: ${method} (${this.timeout}ms)`));
			}, this.timeout);

			this.pending.set(id, {
				resolve: resolve as (v: unknown) => void,
				reject,
				timer,
			});

			try {
				this.sock!.write(wire);
			} catch (err) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(err);
			}
		});
	}

	/** Disconnect and reject all in-flight requests. */
	disconnect(): void {
		for (const { timer, reject } of this.pending.values()) {
			clearTimeout(timer);
			reject(new Error("Daemon socket disconnected"));
		}
		this.pending.clear();
		this.sock?.destroy();
		this.sock = null;
		this.buf = "";
	}

	/** True if the socket is alive. */
	get isConnected(): boolean {
		return this.sock !== null && !this.sock.destroyed;
	}

	/**
	 * Subscribe to server-push notifications (JSON-RPC messages without an `id`).
	 * Returns an unsubscribe function.
	 */
	onNotification(method: string, handler: NotificationHandler): () => void {
		const set = this.notificationHandlers.get(method) ?? new Set();
		set.add(handler);
		this.notificationHandlers.set(method, set);
		return () => {
			set.delete(handler);
			if (set.size === 0) this.notificationHandlers.delete(method);
		};
	}

	/** Process the NDJSON buffer, resolving pending requests. */
	private flush(): void {
		let idx = this.buf.indexOf("\n");
		while (idx !== -1) {
			const line = this.buf.slice(0, idx).trim();
			this.buf = this.buf.slice(idx + 1);

			if (line) {
				try {
					const msg = JSON.parse(line) as {
						id?: string;
						method?: string;
						params?: Record<string, unknown>;
						result?: unknown;
						error?: { message: string; code: number };
					};

					if (msg.id) {
						const pend = this.pending.get(String(msg.id));
						if (pend) {
							clearTimeout(pend.timer);
							this.pending.delete(String(msg.id));

							if (msg.error) {
								pend.reject(new Error(`${msg.error.message} (code: ${msg.error.code})`));
							} else {
								pend.resolve(msg.result);
							}
						}
					} else if (msg.method) {
						// Server-push notification (no id)
						const handlers = this.notificationHandlers.get(msg.method);
						if (handlers) {
							for (const handler of handlers) {
								try {
									handler(msg.params ?? {});
								} catch (err) {
									log.debug(`Notification handler error [${msg.method}]: ${(err as Error).message}`);
								}
							}
						}
					}
				} catch {
					// Malformed NDJSON line — skip
				}
			}

			idx = this.buf.indexOf("\n");
		}
	}
}
