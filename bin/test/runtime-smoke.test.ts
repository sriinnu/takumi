import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXEC_EXIT_CODES, type ExecProtocolEvent } from "@takumi/core";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

interface CliRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

/**
 * I keep one real CLI smoke lane around inspect, repair, and exec so the
 * runtime contract is verified through the packaged entrypoint instead of only
 * through unit mocks.
 */
describe("runtime smoke", () => {
	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("repairs persisted side-agent drift and completes a headless exec run", async () => {
		const workspace = await mkdtemp(path.join(tmpdir(), "takumi-runtime-smoke-"));
		const home = await mkdtemp(path.join(tmpdir(), "takumi-runtime-home-"));
		tempDirs.push(workspace, home);
		execFileSync("git", ["init", "-q"], { cwd: workspace, stdio: "pipe" });
		await mkdir(path.join(workspace, ".takumi", "side-agents"), { recursive: true });
		await writeFile(path.join(workspace, ".takumi", "side-agents", "registry.json"), '{"broken":', "utf-8");

		const inspect = await runTakumiCli(["side-agents", "inspect", "--json", "--cwd", workspace], home);
		expect(inspect.exitCode).toBe(0);
		expect(JSON.parse(extractJson(inspect.stdout))).toMatchObject({
			action: "inspect",
			status: "needs_repair",
			repairSuggested: true,
		});

		const repair = await runTakumiCli(["side-agents", "repair", "--json", "--cwd", workspace], home);
		expect(repair.exitCode).toBe(0);
		expect(JSON.parse(extractJson(repair.stdout))).toMatchObject({
			action: "repair",
			result: {
				changed: true,
			},
		});

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
			response.write(buildChunk({ content: "runtime smoke ok" }));
			response.write(buildChunk({}, "stop", { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }));
			response.end("data: [DONE]\n\n");
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			throw new Error("Could not resolve runtime smoke server address");
		}

		try {
			const textRun = await runTakumiCli(
				[
					"exec",
					"--headless",
					"--provider",
					"openai",
					"--api-key",
					"test-key",
					"--model",
					"gpt-4.1",
					"--endpoint",
					`http://127.0.0.1:${address.port}/v1/chat/completions`,
					"--cwd",
					workspace,
					"say hello",
				],
				home,
			);
			expect(textRun.exitCode).toBe(EXEC_EXIT_CODES.OK);
			expect(/Side agents:|Chitragupta:/.test(textRun.stderr)).toBe(true);

			const ndjsonRun = await runTakumiCli(
				[
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
					"--cwd",
					workspace,
					"say hello again",
				],
				home,
			);
			expect(ndjsonRun.exitCode).toBe(EXEC_EXIT_CODES.OK);
			const events = parseExecEvents(ndjsonRun.stdout);
			expect(events.some((event) => event.kind === "bootstrap_status")).toBe(true);
			expect(events.at(-1)).toMatchObject({ kind: "run_completed", exitCode: EXEC_EXIT_CODES.OK });
		} finally {
			server.close();
			await once(server, "close");
		}
	}, 60_000);
});

async function runTakumiCli(args: string[], home: string): Promise<CliRunResult> {
	const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const child = spawn(pnpmCommand, ["run", "--silent", "takumi", ...args], {
		cwd: repoRoot,
		env: buildCliEnv(home),
		stdio: ["ignore", "pipe", "pipe"],
	});

	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

	const [exitCode] = (await once(child, "close")) as [number | null];
	return {
		exitCode,
		stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
		stderr: Buffer.concat(stderrChunks).toString("utf-8"),
	};
}

function buildCliEnv(home: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: home,
		XDG_CONFIG_HOME: path.join(home, ".config"),
		XDG_DATA_HOME: path.join(home, ".local", "share"),
		XDG_CACHE_HOME: path.join(home, ".cache"),
		CODEX_HOME: path.join(home, ".codex"),
		CI: "1",
		TERM: "dumb",
	};
}

function extractJson(stdout: string): string {
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const start = lines.findIndex((line) => line.startsWith("{"));
	if (start < 0) {
		throw new Error(`Could not locate JSON payload in output: ${stdout}`);
	}
	return lines.slice(start).join("\n");
}

function parseExecEvents(stdout: string): ExecProtocolEvent[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as ExecProtocolEvent);
}

function buildChunk(delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, unknown>): string {
	const payload: Record<string, unknown> = {
		id: "chatcmpl-runtime-smoke",
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
