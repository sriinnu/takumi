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
		expect(result.stderr).toContain("No prompt provided");
	});

	it("emits a config failure envelope when no auth path is available", async () => {
		const result = await runTakumiExec([
			"exec",
			"--headless",
			"--stream=ndjson",
			"--provider",
			"openai",
			"review auth flow",
		]);

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.CONFIG);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({
			protocol: EXEC_PROTOCOL,
			kind: "run_failed",
			exitCode: EXEC_EXIT_CODES.CONFIG,
			phase: "config",
		});
		expect(result.stderr).toContain("No API key found");
	});

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
});

async function runTakumiExec(args: string[]): Promise<ExecRunResult> {
	const home = await mkdtemp(path.join(tmpdir(), "takumi-exec-e2e-"));
	tempDirs.push(home);

	const child = spawn(process.execPath, ["--import", "tsx", cliEntrypoint, ...args], {
		cwd: repoRoot,
		env: buildIsolatedEnv(home),
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
	};
}

function buildIsolatedEnv(home: string): NodeJS.ProcessEnv {
	const nodeBinDir = path.dirname(process.execPath);
	return {
		HOME: home,
		PATH: nodeBinDir,
		TERM: "dumb",
		CI: "1",
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local", "share"),
		XDG_CACHE_HOME: path.join(home, ".cache"),
		CODEX_HOME: path.join(home, ".codex"),
	};
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
	execFileSync(pnpmCommand, ["exec", "tsc", "-p", "packages/core/tsconfig.json"], { cwd: repoRoot, stdio: "pipe" });
	execFileSync(pnpmCommand, ["exec", "tsc", "-p", "packages/agent/tsconfig.json"], { cwd: repoRoot, stdio: "pipe" });
	execFileSync(pnpmCommand, ["exec", "tsc", "-p", "packages/bridge/tsconfig.json"], { cwd: repoRoot, stdio: "pipe" });
	execFileSync(pnpmCommand, ["exec", "tsc", "-p", "packages/tui/tsconfig.json"], { cwd: repoRoot, stdio: "pipe" });
}
