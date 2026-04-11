import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXEC_EXIT_CODES, EXEC_PROTOCOL, type ExecProtocolEvent } from "@takumi/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliEntrypoint = fileURLToPath(new URL("../takumi.ts", import.meta.url));
const tempDirs: string[] = [];

interface ExecRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	events: ExecProtocolEvent[];
	workingDirectory: string;
}

interface ExecRunOptions {
	isolatedWorkingDirectory?: boolean;
	extraEnv?: Record<string, string>;
}

describe("takumi exec e2e", () => {
	beforeAll(() => {
		buildExecRuntimeDependencies();
	}, 30_000);

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	afterAll(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("emits a usage failure envelope when exec is invoked without a prompt", async () => {
		const result = await runTakumiExec([
			"exec",
			"--headless",
			"--stream=ndjson",
			"--provider",
			"openai",
			"--api-key",
			"test-key",
			"--endpoint",
			"http://127.0.0.1:1/v1/chat/completions",
		]);

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.USAGE);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({
			protocol: EXEC_PROTOCOL,
			kind: "run_failed",
			exitCode: EXEC_EXIT_CODES.USAGE,
			phase: "usage",
		});
		if (result.events[0]?.kind === "run_failed") {
			expect(result.events[0].error.message).toContain("No prompt provided");
		}
		expect(`${result.stdout}\n${result.stderr}`).toContain("No prompt provided");
	}, 20_000);

	it("emits a config failure envelope when no auth path is available", async () => {
		const result = await runTakumiExec([
			"exec",
			"--headless",
			"--stream=ndjson",
			"--provider",
			"openai",
			"review auth flow",
		], { isolatedWorkingDirectory: true });

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.CONFIG);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({
			protocol: EXEC_PROTOCOL,
			kind: "run_failed",
			exitCode: EXEC_EXIT_CODES.CONFIG,
			phase: "config",
		});
		if (result.events[0]?.kind === "run_failed") {
			expect(result.events[0].error.message).toContain("missing API key or local provider config");
		}
	}, 20_000);

	it("fails fast on unsupported stream formats", async () => {
		const result = await runTakumiExec(["exec", "--stream=xml", "review auth flow"]);

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.USAGE);
		expect(result.events).toEqual([]);
		expect(result.stderr).toContain("Unsupported stream format");
	});

	it("streams start, bootstrap, agent events, and terminal completion for a successful run", async () => {
		const server = createServer((request, response) => {
			if (request.method !== "POST") {
				response.writeHead(405).end();
				return;
			}

			void request.resume();
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			response.write(buildChunk({ role: "assistant" }));
			response.write(buildChunk({ content: "hello from exec test" }));
			response.write(
				buildChunk({}, "stop", {
					prompt_tokens: 12,
					completion_tokens: 4,
					total_tokens: 16,
				}),
			);
			response.end("data: [DONE]\n\n");
		});

		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			throw new Error("Could not resolve test server address");
		}

		try {
			const result = await runTakumiExec([
				"exec",
				"--headless",
				"--stream=ndjson",
				"--provider",
				"openai",
				"--api-key",
				"test-key",
				"--model",
				"gpt-4.1",
				"--endpoint",
				`http://127.0.0.1:${address.port}/v1/chat/completions`,
				"say hello",
			]);

			expect(result.exitCode).toBe(EXEC_EXIT_CODES.OK);
			expect(result.events[0]).toMatchObject({ kind: "run_started", protocol: EXEC_PROTOCOL });
			expect(result.events[1]).toMatchObject({ kind: "bootstrap_status", protocol: EXEC_PROTOCOL });
			expect(result.events.some((event) => event.kind === "agent_event")).toBe(true);
			expect(result.events.at(-1)).toMatchObject({ kind: "run_completed", exitCode: EXEC_EXIT_CODES.OK });

		const bootstrapEvent = result.events.find((event) => event.kind === "bootstrap_status");
		expect(bootstrapEvent).toBeDefined();
		if (bootstrapEvent?.kind === "bootstrap_status") {
			expect(bootstrapEvent.bootstrap.connected).toBe(false);
			expect(bootstrapEvent.bootstrap.degraded).toBe(true);
			expect(bootstrapEvent.bootstrap.sideAgents).toMatchObject({
				degraded: true,
				reason: "tmux_unavailable",
			});
		}

			const completedEvent = result.events.at(-1);
			if (completedEvent?.kind === "run_completed") {
				expect(completedEvent.stats.textChars).toBeGreaterThan(0);
				expect(completedEvent.stopReason).toBe("end_turn");
				expect(completedEvent.session?.projectPath.replace(/\/+$/, "")).toBe(repoRoot.replace(/\/+$/, ""));
				expect(Array.isArray(completedEvent.artifacts)).toBe(true);
				expect(Array.isArray(completedEvent.filesChanged)).toBe(true);
			}
		} finally {
			server.close();
			await once(server, "close");
		}
	});

	it("uses daemon bootstrap routing and daemon-vault credentials on the live socket path", async () => {
		const providerServer = await createProviderTestServer();
		const daemonServer = await createDaemonBridgeServer({
			providerCredential: "daemon-vault-key",
			routedModel: "gpt-4.1",
		});

		try {
			const result = await runTakumiExec(
				[
					"exec",
					"--headless",
					"--stream=ndjson",
					"--provider",
					"openai",
					"--model",
					"gpt-4o-mini",
					"--endpoint",
					providerServer.endpoint,
					"say hello through daemon",
				],
				{
					isolatedWorkingDirectory: true,
					extraEnv: {
						CHITRAGUPTA_SOCKET: daemonServer.socketPath,
						CHITRAGUPTA_DAEMON_API_KEY: daemonServer.apiKey,
					},
				},
			);

			expect(result.exitCode).toBe(EXEC_EXIT_CODES.OK);
			const bootstrapEvent = result.events.find((event) => event.kind === "bootstrap_status");
			expect(bootstrapEvent).toBeDefined();
			if (bootstrapEvent?.kind === "bootstrap_status") {
				expect(bootstrapEvent.bootstrap.connected).toBe(true);
				expect(bootstrapEvent.bootstrap.transport).toBe("daemon-socket");
				expect(bootstrapEvent.bootstrap.degraded).toBe(false);
			}

			const startedEvent = result.events.find((event) => event.kind === "run_started");
			expect(startedEvent).toBeDefined();
			if (startedEvent?.kind === "run_started") {
				expect(startedEvent.provider).toBe("openai");
				expect(startedEvent.model).toBe("gpt-4.1");
				expect(startedEvent.routing).toBeDefined();
				if (!startedEvent.routing) {
					throw new Error("Expected routing metadata on run_started event");
				}
				expect(startedEvent.routing.authority).toBe("engine");
				expect(startedEvent.routing.enforcement).toBe("same-provider");
			}

			const completedEvent = result.events.at(-1);
			expect(completedEvent).toBeDefined();
			if (completedEvent?.kind === "run_completed") {
				expect(completedEvent.bootstrapConnected).toBe(true);
				expect(completedEvent.session?.canonicalSessionId).toBe("session-1");
				expect(completedEvent.routing).toBeDefined();
				if (!completedEvent.routing) {
					throw new Error("Expected routing metadata on run_completed event");
				}
				expect(completedEvent.routing.authority).toBe("engine");
				expect(completedEvent.routing.model).toBe("gpt-4.1");
				expect(completedEvent.hubArtifacts.length).toBeGreaterThan(0);
				expect(completedEvent.hubArtifacts[0]).toEqual(
					expect.objectContaining({
						kind: expect.any(String),
						summary: expect.any(String),
					}),
				);
				expect(completedEvent.validation).toEqual({ status: "not-run", checks: [] });
				expect(completedEvent.postRunPolicy).toMatchObject({
					status: "pending",
				});
				expect(completedEvent.postRunPolicy.checks).toEqual(
					expect.arrayContaining(["provider-model-consistency", "session-binding", "artifact-reporting"]),
				);
			}

			expect(providerServer.authorizationHeaders).toContain("Bearer daemon-vault-key");
			expect(providerServer.requestBodies).toContainEqual(
				expect.objectContaining({
					model: "gpt-4.1",
				}),
			);
			const canonicalWorkingDirectory = normalizeMacTmpPathAlias(result.workingDirectory);

			const handshakeCall = daemonServer.calls.find((call) => call.method === "auth.handshake");
			expect(handshakeCall?.params).toEqual({ apiKey: daemonServer.apiKey });

			const bootstrapCall = daemonServer.calls.find((call) => call.method === "bridge.bootstrap");
			expect(bootstrapCall?.params).toMatchObject({
				mode: "exec",
				project: canonicalWorkingDirectory,
				consumer: "takumi",
				session: {
					project: canonicalWorkingDirectory,
					consumer: "takumi",
					provider: "openai",
					model: "gpt-4o-mini",
				},
				route: {
					consumer: "takumi",
					capability: "coding.patch-cheap",
				},
			});

			const credentialsCall = daemonServer.calls.find((call) => call.method === "provider.credentials.resolve");
			expect(credentialsCall?.params).toEqual({ providerId: "openai" });

			const routeCall = daemonServer.calls.find((call) => call.method === "route.resolve");
			expect(routeCall?.params).toMatchObject({
				consumer: "takumi.exec",
				capability: "coding.patch-cheap",
				constraints: {
					requireStreaming: true,
					hardProviderFamily: "openai",
				},
				context: {
					projectPath: canonicalWorkingDirectory,
					configuredProvider: "openai",
					configuredModel: "gpt-4o-mini",
				},
			});
		} finally {
			await providerServer.close();
			await daemonServer.close();
		}
	}, 20_000);

	it("keeps explicit direct credentials authoritative even when the daemon is available", async () => {
		const providerServer = await createProviderTestServer();
		const daemonServer = await createDaemonBridgeServer({
			providerCredential: "daemon-vault-key",
			routedModel: "gpt-4.1",
		});

		try {
			const result = await runTakumiExec(
				[
					"exec",
					"--headless",
					"--stream=ndjson",
					"--provider",
					"openai",
					"--api-key",
					"explicit-direct-key",
					"--model",
					"gpt-4o-mini",
					"--endpoint",
					providerServer.endpoint,
					"say hello through direct binding",
				],
				{
					isolatedWorkingDirectory: true,
					extraEnv: {
						CHITRAGUPTA_SOCKET: daemonServer.socketPath,
						CHITRAGUPTA_DAEMON_API_KEY: daemonServer.apiKey,
					},
				},
			);

			expect(result.exitCode).toBe(EXEC_EXIT_CODES.OK);
			expect(providerServer.authorizationHeaders).toContain("Bearer explicit-direct-key");
			expect(providerServer.authorizationHeaders).not.toContain("Bearer daemon-vault-key");
			expect(providerServer.requestBodies).toContainEqual(
				expect.objectContaining({
					model: "gpt-4.1",
				}),
			);
			expect(daemonServer.calls.some((call) => call.method === "provider.credentials.resolve")).toBe(false);
		} finally {
			await providerServer.close();
			await daemonServer.close();
		}
	}, 20_000);

	it("prefers daemon-vault credentials over ambient local provider env fallback on the live socket path", async () => {
		const providerServer = await createProviderTestServer();
		const daemonServer = await createDaemonBridgeServer({
			providerCredential: "daemon-vault-key",
			routedModel: "gpt-4.1",
		});

		try {
			const result = await runTakumiExec(
				[
					"exec",
					"--headless",
					"--stream=ndjson",
					"--provider",
					"openai",
					"--model",
					"gpt-4o-mini",
					"--endpoint",
					providerServer.endpoint,
					"say hello through daemon vault",
				],
				{
					isolatedWorkingDirectory: true,
					extraEnv: {
						CHITRAGUPTA_SOCKET: daemonServer.socketPath,
						CHITRAGUPTA_DAEMON_API_KEY: daemonServer.apiKey,
						OPENAI_API_KEY: "ambient-local-key",
					},
				},
			);

			expect(result.exitCode).toBe(EXEC_EXIT_CODES.OK);
			expect(providerServer.authorizationHeaders).toContain("Bearer daemon-vault-key");
			expect(providerServer.authorizationHeaders).not.toContain("Bearer ambient-local-key");
			expect(providerServer.requestBodies).toContainEqual(
				expect.objectContaining({
					model: "gpt-4.1",
				}),
			);
			const credentialsCall = daemonServer.calls.find((call) => call.method === "provider.credentials.resolve");
			expect(credentialsCall?.params).toEqual({ providerId: "openai" });
		} finally {
			await providerServer.close();
			await daemonServer.close();
		}
	}, 20_000);

	it("collapses openai-compatible daemon routes to one concrete exec provider before binding", async () => {
		const providerServer = await createProviderTestServer();
		const daemonServer = await createDaemonBridgeServer({
			providerCredential: "daemon-vault-key",
			routedModel: "gpt-4.1",
			routedProviderFamily: "openai-compat",
		});

		try {
			const result = await runTakumiExec(
				[
					"exec",
					"--headless",
					"--stream=ndjson",
					"--provider",
					"openai",
					"--model",
					"gpt-4o-mini",
					"--endpoint",
					providerServer.endpoint,
					"say hello through compat route",
				],
				{
					isolatedWorkingDirectory: true,
					extraEnv: {
						CHITRAGUPTA_SOCKET: daemonServer.socketPath,
						CHITRAGUPTA_DAEMON_API_KEY: daemonServer.apiKey,
					},
				},
			);

			expect(result.exitCode).toBe(EXEC_EXIT_CODES.OK);
			const startedEvent = result.events.find((event) => event.kind === "run_started");
			expect(startedEvent).toBeDefined();
			if (startedEvent?.kind === "run_started") {
				expect(startedEvent.provider).toBe("openai");
				expect(startedEvent.model).toBe("gpt-4.1");
			}
			expect(providerServer.authorizationHeaders).toContain("Bearer daemon-vault-key");
			expect(providerServer.requestBodies).toContainEqual(
				expect.objectContaining({
					model: "gpt-4.1",
				}),
			);
		} finally {
			await providerServer.close();
			await daemonServer.close();
		}
	}, 20_000);
});

async function runTakumiExec(args: string[], options: ExecRunOptions = {}): Promise<ExecRunResult> {
	const home = await mkdtemp(path.join(tmpdir(), "takumi-exec-e2e-"));
	tempDirs.push(home);
	const commandArgs = options.isolatedWorkingDirectory ? ["--cwd", home, ...args] : args;

	const child = spawn(process.execPath, ["--import", "tsx", cliEntrypoint, ...commandArgs], {
		cwd: repoRoot,
		env: buildIsolatedEnv(home, options.extraEnv),
		stdio: ["pipe", "pipe", "pipe"],
	});

	child.stdin.end();

	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

	const [exitCode] = (await once(child, "close")) as [number | null];
	const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
	const stderr = Buffer.concat(stderrChunks).toString("utf-8");

	return {
		exitCode,
		stdout,
		stderr,
		events: parseExecEvents(stdout),
		workingDirectory: options.isolatedWorkingDirectory ? home : repoRoot,
	};
}

function buildIsolatedEnv(home: string, extraEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
	const nodeBinDir = path.dirname(process.execPath);
	return {
		HOME: home,
		PATH: nodeBinDir,
		TERM: "dumb",
		CI: "1",
		TAKUMI_DISABLE_LOCAL_PROVIDER_DISCOVERY: "1",
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local", "share"),
		XDG_CACHE_HOME: path.join(home, ".cache"),
		CODEX_HOME: path.join(home, ".codex"),
		...extraEnv,
	};
}

function normalizeMacTmpPathAlias(value: string): string {
	return value.replace(/^\/var\//u, "/private/var/");
}

function parseExecEvents(stdout: string): ExecProtocolEvent[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ExecProtocolEvent);
}

function buildChunk(delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, unknown>): string {
	const payload: Record<string, unknown> = {
		id: "chatcmpl-test",
		object: "chat.completion.chunk",
		created: 1,
		model: "gpt-4.1",
		choices: [
			{
				index: 0,
				delta,
				finish_reason: finishReason,
			},
		],
	};

	if (usage) {
		payload.usage = usage;
	}

	return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildExecRuntimeDependencies(): void {
	const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const projects = [
		"packages/core/tsconfig.json",
		"packages/bridge/tsconfig.json",
		"packages/agent/tsconfig.json",
		"packages/tui/tsconfig.json",
	];

	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		try {
			for (const project of projects) {
				execFileSync(pnpmCommand, ["exec", "tsc", "-p", project], { cwd: repoRoot, stdio: "pipe" });
			}
			return;
		} catch (error) {
			lastError = normalizeBuildExecError(error, attempt);
		}
	}

	throw lastError ?? new Error("Failed to build Takumi exec runtime dependencies");
}

function normalizeBuildExecError(error: unknown, attempt: number): Error {
	if (!(error instanceof Error)) {
		return new Error(`Takumi exec runtime dependency build failed on attempt ${attempt}`);
	}

	const stderr = readExecBuildStderr(error);
	return new Error(
		stderr
			? `Takumi exec runtime dependency build failed on attempt ${attempt}: ${stderr}`
			: `Takumi exec runtime dependency build failed on attempt ${attempt}: ${error.message}`,
	);
}

function readExecBuildStderr(error: Error): string {
	const stderr = (error as Error & { stderr?: unknown }).stderr;
	return Buffer.isBuffer(stderr) ? stderr.toString("utf-8").trim() : "";
}

interface ProviderTestServer {
	endpoint: string;
	authorizationHeaders: string[];
	requestBodies: Array<Record<string, unknown>>;
	close(): Promise<void>;
}

/** Start one local OpenAI-compatible SSE server and record auth headers. */
async function createProviderTestServer(): Promise<ProviderTestServer> {
	const authorizationHeaders: string[] = [];
	const requestBodies: Array<Record<string, unknown>> = [];
	const sockets = new Set<import("node:net").Socket>();
	const server = createServer((request, response) => {
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}

		authorizationHeaders.push(request.headers.authorization ?? "");
		const bodyChunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
		request.on("end", () => {
			const rawBody = Buffer.concat(bodyChunks).toString("utf-8");
			if (!rawBody) {
				requestBodies.push({});
			} else {
				requestBodies.push(JSON.parse(rawBody) as Record<string, unknown>);
			}
		});
		response.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		response.write(buildChunk({ role: "assistant" }));
		response.write(buildChunk({ content: "hello from daemon route" }));
		response.write(
			buildChunk({}, "stop", {
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
			}),
		);
		response.end("data: [DONE]\n\n");
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	});

	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Could not resolve provider test server address");
	}

	return {
		endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
		authorizationHeaders,
		requestBodies,
		close: async () => {
			for (const socket of sockets) {
				socket.destroy();
			}
			server.close();
			await once(server, "close");
		},
	};
}

interface DaemonBridgeServerOptions {
	providerCredential: string;
	routedModel: string;
	routedProviderFamily?: string;
}

interface DaemonBridgeServer {
	apiKey: string;
	socketPath: string;
	calls: Array<{ method: string; params: Record<string, unknown> }>;
	close(): Promise<void>;
}

/** Start one real Unix-socket JSON-RPC server that speaks the daemon bridge contract Takumi uses. */
async function createDaemonBridgeServer(options: DaemonBridgeServerOptions): Promise<DaemonBridgeServer> {
	const dir = await mkdtemp(path.join(tmpdir(), "takumi-daemon-socket-"));
	tempDirs.push(dir);
	const socketPath = path.join(dir, "chitragupta.sock");
	const apiKey = "chg_0123456789abcdef0123456789abcdef";
	const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	const sockets = new Set<import("node:net").Socket>();
	let nextTurnNumber = 0;
	const importedArtifacts = new Map<string, { canonicalArtifactId: string; contentHash: string }>();
	const server = createNetServer((socket) => {
		sockets.add(socket);
		let buffer = "";
		socket.setEncoding("utf-8");
		socket.on("close", () => {
			sockets.delete(socket);
		});
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				if (line) {
					const message = JSON.parse(line) as {
						id?: string;
						method?: string;
						params?: Record<string, unknown>;
					};
					if (message.id && message.method) {
						calls.push({ method: message.method, params: message.params ?? {} });
						writeRpcResponse(socket, message.id, handleDaemonMethod(message.method, message.params ?? {}));
					}
				}
				newlineIndex = buffer.indexOf("\n");
			}
		});
	});

	server.listen(socketPath);
	await once(server, "listening");

	return {
		apiKey,
		socketPath,
		calls,
		close: async () => {
			for (const socket of sockets) {
				socket.destroy();
			}
			server.close();
			await once(server, "close");
		},
	};

	function handleDaemonMethod(method: string, params: Record<string, unknown>): unknown {
		switch (method) {
			case "auth.handshake":
				return { authenticated: params.apiKey === apiKey };
			case "bridge.bootstrap":
				return {
					contractVersion: 1,
					protocol: {
						name: "chitragupta-daemon-bridge",
						version: 1,
						minCompatibleVersion: 1,
						maxCompatibleVersion: 1,
					},
					connected: true,
					degraded: false,
					transport: "daemon-socket",
					authority: "daemon-bootstrap",
					requestId: "req-1",
					traceId: null,
					taskId: "task-1",
					laneId: "lane-1",
					warnings: [],
					auth: {
						authenticated: true,
						keyId: "key-1",
						tenantId: "daemon",
						scopes: ["bridge:bootstrap", "provider.credentials.resolve"],
					},
					binding: {
						mode: "exec",
						project: String(params.project ?? repoRoot),
						consumer: "takumi",
						clientId: "client-1",
					},
					session: {
						id: "session-1",
						created: true,
						lineageKey: null,
						sessionReusePolicy: null,
					},
					route: null,
					routingDecision: buildRoutingDecision(params),
					lanes: [
						{
							key: "primary",
							role: "primary",
							laneId: "lane-1",
							durableKey: "durable-1",
							snapshotAt: Date.now(),
							policy: {
								contractVersion: 1,
								role: "primary",
								preferLocal: null,
								allowCloud: true,
								maxCostClass: "medium",
								requireStreaming: true,
								hardProviderFamily: null,
								preferredProviderFamilies: ["openai"],
								toolAccess: "inherit",
								privacyBoundary: "cloud-ok",
								fallbackStrategy: "same-provider",
								tags: [],
							},
							requestedPolicy: {
								contractVersion: 1,
								role: "primary",
								preferLocal: null,
								allowCloud: true,
								maxCostClass: "medium",
								requireStreaming: true,
								hardProviderFamily: null,
								preferredProviderFamilies: ["openai"],
								toolAccess: "inherit",
								privacyBoundary: "cloud-ok",
								fallbackStrategy: "same-provider",
								tags: [],
							},
							effectivePolicy: {
								contractVersion: 1,
								role: "primary",
								preferLocal: null,
								allowCloud: true,
								maxCostClass: "medium",
								requireStreaming: true,
								hardProviderFamily: null,
								preferredProviderFamilies: ["openai"],
								toolAccess: "inherit",
								privacyBoundary: "cloud-ok",
								fallbackStrategy: "same-provider",
								tags: [],
							},
							constraintsApplied: { requireStreaming: true },
							policyHash: "policy-1",
							policyWarnings: [],
							route: null,
							routingDecision: buildRoutingDecision(params),
						},
					],
				};
			case "memory.unified_recall":
				return { results: [{ content: "Prefer daemon-first routing", score: 0.98, source: "memory", type: "fact" }] };
			case "vasana.tendencies":
				return { tendencies: [] };
			case "daemon.health":
				return { connections: 1, uptime: 7200 };
			case "provider.credentials.resolve":
				return {
					found: true,
					providerId: "openai",
					boundProviderId: "openai",
					modelId: options.routedModel,
					routeClass: "coding.patch-cheap",
					selectedCapabilityId: "cap-openai",
					consumer: "takumi",
					value: options.providerCredential,
					needsRekey: false,
				};
			case "route.resolve":
				return {
					request: params,
					selected: {
						id: "cap-openai",
						kind: "llm",
						label: "OpenAI route",
						capabilities: [String(params.capability ?? "coding.patch-cheap")],
						costClass: "medium",
						trust: "cloud",
						health: "healthy",
						invocation: {
							id: "openai.chat",
							transport: "http",
							entrypoint: "http://127.0.0.1",
							requestShape: "openai.chat.completions",
							responseShape: "openai.chat.completion",
							timeoutMs: 30000,
							streaming: true,
						},
						tags: ["chat", "coding"],
						providerFamily: options.routedProviderFamily ?? "openai",
						metadata: { model: options.routedModel },
					},
					reason: "Selected openai route",
					fallbackChain: [],
					policyTrace: ["selected:openai"],
					degraded: false,
				};
			case "session.create":
				return { id: "session-1", created: true };
			case "turn.max_number":
				return { maxTurn: nextTurnNumber };
			case "turn.add":
				nextTurnNumber += 1;
				return { added: true };
			case "session.meta.update":
				return { updated: true };
			case "artifact.import_batch": {
				const artifacts = Array.isArray(params.artifacts) ? params.artifacts : [];
				const imported = artifacts.map((artifact, index) => {
					const localArtifactId =
						artifact && typeof artifact === "object" && "localArtifactId" in artifact
							? String(artifact.localArtifactId)
							: `artifact-${index + 1}`;
					const contentHash =
						artifact && typeof artifact === "object" && "contentHash" in artifact && typeof artifact.contentHash === "string"
							? artifact.contentHash
							: `hash-${index + 1}`;
					importedArtifacts.set(localArtifactId, {
						canonicalArtifactId: `canonical-${index + 1}`,
						contentHash,
					});
					return {
						localArtifactId,
						canonicalArtifactId: `canonical-${index + 1}`,
						contentHash,
					};
				});
				return { imported, skipped: [], failed: [] };
			}
			case "artifact.list_imported":
				return {
					items: Array.from(importedArtifacts.entries()).map(([localArtifactId, record]) => ({
						localArtifactId,
						canonicalArtifactId: record.canonicalArtifactId,
						contentHash: record.contentHash,
						localSessionId: "session-1",
					})),
				};
			default:
				return null;
		}
	}
}

/** Write one JSON-RPC success response back to the fake daemon socket. */
function writeRpcResponse(socket: NodeJS.WritableStream, id: string, result: unknown): void {
	socket.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

/** Build one routing decision payload that keeps bootstrap and route.resolve aligned. */
function buildRoutingDecision(params: Record<string, unknown>): Record<string, unknown> {
	return {
		authority: "chitragupta",
		source: "route.resolve",
		routeClass: String(params.route && typeof params.route === "object" && "capability" in params.route ? params.route.capability : "coding.patch-cheap"),
		capability: "coding.patch-cheap",
		selectedCapabilityId: "cap-openai",
		provider: "openai",
		model: "gpt-4.1",
		requestedBudget: null,
		effectiveBudget: null,
		degraded: false,
		reasonCode: "",
		reason: null,
		policyTrace: [],
		fallbackChain: [],
		discoverableOnly: false,
		requestId: "req-1",
		traceId: null,
		snapshotAt: Date.now(),
		expiresAt: null,
		cacheScope: "request",
	};
}
