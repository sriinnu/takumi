/**
 * McpClient -- Generic JSON-RPC over stdio MCP client.
 * Spawns a child process, communicates via newline-delimited JSON-RPC 2.0,
 * and provides request/response correlation, timeouts, and crash recovery.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createLogger } from "@takumi/core";

const log = createLogger("mcp-client");

// ── JSON-RPC types ───────────────────────────────────────────────────────────

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

// ── Options & events ─────────────────────────────────────────────────────────

export interface McpClientOptions {
	/** Command to spawn (e.g. "chitragupta-mcp"). */
	command: string;
	/** Arguments for the command (e.g. ["--stdio"]). */
	args?: string[];
	/** Extra environment variables merged with process.env. */
	env?: Record<string, string>;
	/** Working directory for the child process. */
	cwd?: string;
	/** Milliseconds to wait for the initialize handshake. Default: 5000. */
	startupTimeoutMs?: number;
	/** Milliseconds to wait for each request response. Default: 10000. */
	requestTimeoutMs?: number;
}

export interface McpClientEvents {
	connected: [];
	disconnected: [code: number | null];
	error: [error: Error];
	notification: [method: string, params?: Record<string, unknown>];
}

// ── Pending request bookkeeping ──────────────────────────────────────────────

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

// ── McpClient ────────────────────────────────────────────────────────────────

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY_MS = 1000;

export class McpClient extends EventEmitter {
	private readonly options: Required<
		Pick<McpClientOptions, "command" | "args" | "startupTimeoutMs" | "requestTimeoutMs">
	> &
		McpClientOptions;

	private child: ChildProcess | null = null;
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private buffer = "";
	private _connected = false;
	private restartCount = 0;
	private stopping = false;

	constructor(options: McpClientOptions) {
		super();
		this.options = {
			args: [],
			startupTimeoutMs: 5_000,
			requestTimeoutMs: 10_000,
			...options,
		};
	}

	// ── Public API ────────────────────────────────────────────────────────

	/** Spawn the child process and wait for MCP initialization. */
	async start(): Promise<void> {
		if (this._connected) return;
		this.stopping = false;
		await this.spawn();
	}

	/** Send a JSON-RPC request and wait for the response. */
	async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		if (!this._connected) {
			throw new Error("McpClient is not connected");
		}
		return this.sendRequest<T>(method, params);
	}

	/** Send a JSON-RPC notification (fire-and-forget, no response expected). */
	notify(method: string, params?: Record<string, unknown>): void {
		if (!this._connected) return;
		const notification: JsonRpcNotification = {
			jsonrpc: "2.0",
			method,
			params,
		};
		this.child?.stdin?.write(JSON.stringify(notification) + "\n");
	}

	/** Gracefully stop the child process. */
	async stop(): Promise<void> {
		this.stopping = true;
		this._connected = false;
		this.rejectAllPending("McpClient stopped");
		if (this.child) {
			const child = this.child;
			this.child = null;
			// Remove listeners to prevent auto-restart from firing
			child.removeAllListeners("close");
			child.removeAllListeners("error");
			child.kill();
		}
	}

	/** Whether the client is connected and ready. */
	get isConnected(): boolean {
		return this._connected;
	}

	/** Restart the child process (for crash recovery). */
	async restart(): Promise<void> {
		await this.stop();
		this.stopping = false;
		this.restartCount = 0;
		await this.spawn();
	}

	// ── Internal: process lifecycle ───────────────────────────────────────

	private async spawn(): Promise<void> {
		const { command, args, env, cwd, startupTimeoutMs } = this.options;

		log.info(`Spawning MCP server: ${command} ${args.join(" ")}`);

		this.buffer = "";
		this.nextId = 1;

		this.child = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: env ? { ...process.env, ...env } : { ...process.env },
			cwd,
		});

		this.child.stdout?.on("data", (data: Buffer) => {
			this.handleData(data.toString());
		});

		this.child.stderr?.on("data", (data: Buffer) => {
			log.warn(`MCP stderr: ${data.toString().trim()}`);
		});

		this.child.on("close", (code) => {
			const wasConnected = this._connected;
			this._connected = false;
			this.rejectAllPending("MCP process exited");
			log.info(`MCP process exited with code ${code}`);

			if (wasConnected) {
				this.emit("disconnected", code);
			}

			// Auto-restart if we didn't initiate the stop
			if (!this.stopping && this.restartCount < MAX_RESTART_ATTEMPTS) {
				this.restartCount++;
				log.info(
					`Auto-restart attempt ${this.restartCount}/${MAX_RESTART_ATTEMPTS} in ${RESTART_DELAY_MS}ms`,
				);
				setTimeout(() => {
					if (!this.stopping) {
						this.spawn().catch((err) => {
							log.error(`Auto-restart failed: ${(err as Error).message}`);
							this.emit("error", err as Error);
						});
					}
				}, RESTART_DELAY_MS);
			}
		});

		this.child.on("error", (err) => {
			log.error(`MCP process error: ${err.message}`);
			this._connected = false;
			this.emit("error", err);
		});

		// Run the MCP initialization handshake
		await this.initialize(startupTimeoutMs);
		this._connected = true;
		this.restartCount = 0;
		this.emit("connected");
		log.info("MCP client connected");
	}

	private async initialize(timeoutMs: number): Promise<void> {
		const result = await this.sendRequest(
			"initialize",
			{
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: {
					name: "takumi",
					version: "0.1.0",
				},
			},
			timeoutMs,
		);

		log.info("MCP initialized", result as Record<string, unknown>);

		// Send the initialized notification
		const notification: JsonRpcNotification = {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		};
		this.child?.stdin?.write(JSON.stringify(notification) + "\n");
	}

	// ── Internal: JSON-RPC messaging ──────────────────────────────────────

	private sendRequest<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
		timeoutMs?: number,
	): Promise<T> {
		const timeout = timeoutMs ?? this.options.requestTimeoutMs;

		return new Promise<T>((resolve, reject) => {
			const id = this.nextId++;
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id,
				method,
				params,
			};

			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`Request ${method} timed out after ${timeout}ms`));
				}
			}, timeout);

			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			});

			const data = JSON.stringify(request) + "\n";
			this.child?.stdin?.write(data, (err) => {
				if (err) {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(new Error(`Failed to write request: ${err.message}`));
				}
			});
		});
	}

	private handleData(data: string): void {
		this.buffer += data;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;

				// Response (has id)
				if ("id" in msg && msg.id !== undefined) {
					const response = msg as JsonRpcResponse;
					const entry = this.pending.get(response.id);
					if (entry) {
						clearTimeout(entry.timer);
						this.pending.delete(response.id);
						if (response.error) {
							entry.reject(new Error(response.error.message));
						} else {
							entry.resolve(response.result);
						}
					}
				} else {
					// Server-initiated notification
					const notif = msg as JsonRpcNotification;
					this.emit("notification", notif.method, notif.params);
				}
			} catch {
				log.warn(`Failed to parse MCP message: ${line.slice(0, 200)}`);
			}
		}
	}

	private rejectAllPending(reason: string): void {
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.reject(new Error(reason));
		}
		this.pending.clear();
	}
}
