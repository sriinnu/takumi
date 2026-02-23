/**
 * DarpanaClient — HTTP client for the Darpana API proxy.
 * Checks health, auto-launches if configured, and provides
 * a clean interface to the proxy.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createLogger } from "@takumi/core";

const log = createLogger("darpana-client");

export interface DarpanaConfig {
	/** Base URL of the Darpana proxy. */
	url: string;

	/** Path to the Darpana binary for auto-launch. */
	binaryPath?: string;

	/** Port for auto-launched Darpana. */
	port?: number;

	/** Whether to auto-launch if not running. */
	autoLaunch?: boolean;
}

export class DarpanaClient {
	private config: DarpanaConfig;
	private childProcess: ChildProcess | null = null;
	private _healthy = false;

	constructor(config: DarpanaConfig) {
		this.config = {
			url: config.url || "http://localhost:3141",
			binaryPath: config.binaryPath,
			port: config.port ?? 3141,
			autoLaunch: config.autoLaunch ?? false,
		};
	}

	/** Check if Darpana is reachable. */
	async healthCheck(): Promise<boolean> {
		try {
			const response = await fetch(`${this.config.url}/health`, {
				method: "GET",
				signal: AbortSignal.timeout(3000),
			});
			this._healthy = response.ok;
			return this._healthy;
		} catch {
			this._healthy = false;
			return false;
		}
	}

	/** Ensure Darpana is running, auto-launching if needed. */
	async ensureRunning(): Promise<boolean> {
		// Check if already running
		if (await this.healthCheck()) {
			log.info("Darpana is already running");
			return true;
		}

		// Try to auto-launch
		if (this.config.autoLaunch && this.config.binaryPath) {
			log.info("Auto-launching Darpana...");
			return this.launch();
		}

		log.warn("Darpana is not running and auto-launch is disabled");
		return false;
	}

	/** Launch Darpana as a background process. */
	private async launch(): Promise<boolean> {
		if (!this.config.binaryPath) return false;

		try {
			this.childProcess = spawn(this.config.binaryPath, ["--port", String(this.config.port)], {
				stdio: ["ignore", "pipe", "pipe"],
				detached: true,
				env: { ...process.env },
			});

			this.childProcess.unref();

			this.childProcess.stderr?.on("data", (data: Buffer) => {
				log.warn(`Darpana stderr: ${data.toString().trim()}`);
			});

			this.childProcess.on("error", (err) => {
				log.error(`Darpana launch error: ${err.message}`);
			});

			// Wait for it to become healthy
			for (let i = 0; i < 20; i++) {
				await sleep(500);
				if (await this.healthCheck()) {
					log.info("Darpana launched successfully");
					return true;
				}
			}

			log.error("Darpana failed to start within 10 seconds");
			return false;
		} catch (err) {
			log.error(`Failed to launch Darpana: ${(err as Error).message}`);
			return false;
		}
	}

	/** Get the base URL. */
	get url(): string {
		return this.config.url;
	}

	/** Check if Darpana is healthy. */
	get healthy(): boolean {
		return this._healthy;
	}

	/** Get available models from Darpana. */
	async listModels(): Promise<any[]> {
		try {
			const response = await fetch(`${this.config.url}/v1/models`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) return [];
			const data: any = await response.json();
			return data.models ?? [];
		} catch {
			return [];
		}
	}

	/** Stop the auto-launched Darpana process. */
	stop(): void {
		if (this.childProcess) {
			this.childProcess.kill();
			this.childProcess = null;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
