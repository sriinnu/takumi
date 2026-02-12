/**
 * ChitraguptaClient — MCP client for the Chitragupta memory server.
 * Spawns the Chitragupta MCP server process and communicates via JSON-RPC
 * over stdio.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "@takumi/core";

const log = createLogger("chitragupta-client");

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: any;
	error?: { code: number; message: string; data?: any };
}

export class ChitraguptaClient {
	private process: ChildProcess | null = null;
	private nextId = 1;
	private pendingRequests = new Map<number, {
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	}>();
	private buffer = "";
	private connected = false;

	constructor(
		private binaryPath: string = "chitragupta-mcp",
		private args: string[] = ["--transport", "stdio"],
	) {}

	/** Spawn the MCP server and establish connection. */
	async connect(): Promise<void> {
		if (this.connected) return;

		log.info(`Spawning Chitragupta MCP: ${this.binaryPath} ${this.args.join(" ")}`);

		this.process = spawn(this.binaryPath, this.args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		this.process.stdout?.on("data", (data: Buffer) => {
			this.handleData(data.toString());
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			log.warn(`MCP stderr: ${data.toString().trim()}`);
		});

		this.process.on("close", (code) => {
			log.info(`MCP process exited with code ${code}`);
			this.connected = false;
			// Reject all pending requests
			for (const [, pending] of this.pendingRequests) {
				pending.reject(new Error("MCP process exited"));
			}
			this.pendingRequests.clear();
		});

		this.process.on("error", (err) => {
			log.error(`MCP process error: ${err.message}`);
			this.connected = false;
		});

		// Initialize the connection
		await this.initialize();
		this.connected = true;
		log.info("Connected to Chitragupta MCP");
	}

	/** Initialize the MCP protocol handshake. */
	private async initialize(): Promise<void> {
		const result = await this.sendRequest("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "takumi",
				version: "0.1.0",
			},
		});

		log.info("MCP initialized", result);

		// Send initialized notification
		this.sendNotification("notifications/initialized");
	}

	/** Call an MCP tool. */
	async callTool(name: string, args: Record<string, unknown>): Promise<any> {
		return this.sendRequest("tools/call", {
			name,
			arguments: args,
		});
	}

	/** List available MCP tools. */
	async listTools(): Promise<any[]> {
		const result = await this.sendRequest("tools/list", {});
		return result.tools ?? [];
	}

	/** Search Chitragupta memory. */
	async memorySearch(query: string): Promise<any> {
		return this.callTool("chitragupta_memory_search", { query });
	}

	/** List recent sessions. */
	async sessionList(limit?: number): Promise<any> {
		return this.callTool("chitragupta_session_list", { limit });
	}

	/** Get a work-state handover summary. */
	async handover(): Promise<any> {
		return this.callTool("chitragupta_handover", {});
	}

	/** Disconnect from the MCP server. */
	disconnect(): void {
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this.connected = false;
		this.pendingRequests.clear();
	}

	/** Check if connected. */
	isConnected(): boolean {
		return this.connected;
	}

	// ── Internal JSON-RPC ─────────────────────────────────────────────────────

	private sendRequest(method: string, params?: Record<string, unknown>): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id,
				method,
				params,
			};

			this.pendingRequests.set(id, { resolve, reject });

			const data = JSON.stringify(request) + "\n";
			this.process?.stdin?.write(data, (err) => {
				if (err) {
					this.pendingRequests.delete(id);
					reject(new Error(`Failed to send request: ${err.message}`));
				}
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`Request ${method} timed out`));
				}
			}, 30_000);
		});
	}

	private sendNotification(method: string, params?: Record<string, unknown>): void {
		const notification = {
			jsonrpc: "2.0",
			method,
			params,
		};
		this.process?.stdin?.write(JSON.stringify(notification) + "\n");
	}

	private handleData(data: string): void {
		this.buffer += data;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const response: JsonRpcResponse = JSON.parse(line);
				if (response.id !== undefined) {
					const pending = this.pendingRequests.get(response.id);
					if (pending) {
						this.pendingRequests.delete(response.id);
						if (response.error) {
							pending.reject(new Error(response.error.message));
						} else {
							pending.resolve(response.result);
						}
					}
				}
			} catch (err) {
				log.warn(`Failed to parse MCP response: ${line.slice(0, 100)}`);
			}
		}
	}
}
