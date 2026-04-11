import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { EXEC_EXIT_CODES, EXEC_PROTOCOL, EXEC_PROTOCOL_VERSION } from "@takumi/core";
import { describe, expect, it } from "vitest";
import { isTakumiExecTerminalEvent, runTakumiExec, type TakumiExecRunnerOptions } from "../src/index.js";

describe("takumi exec runner", () => {
	it("parses events and returns a completed run result", async () => {
		const seenKinds: string[] = [];
		const result = await runTakumiExec(
			{ prompt: "fix auth", cwd: "/repo" },
			createRunnerOptions(
				[
					makeEvent("run_started", { cwd: "/repo", prompt: "fix auth", headless: true, streamFormat: "ndjson" }),
					makeEvent("bootstrap_status", {
						bootstrap: {
							connected: false,
							degraded: true,
							transport: "unavailable",
							memoryEntries: 0,
							vasanaCount: 0,
							hasHealth: false,
							summary: "offline",
						},
					}),
					makeEvent("run_completed", {
						success: true,
						exitCode: EXEC_EXIT_CODES.OK,
						durationMs: 120,
						stats: { textChars: 42, toolCalls: 1, toolErrors: 0 },
						bootstrapConnected: false,
						stopReason: "end_turn",
					}),
				],
				{
					onEvent: (event) => seenKinds.push(event.kind),
				},
			),
		);

		expect(result.exitCode).toBe(0);
		expect(result.events).toHaveLength(3);
		expect(result.terminalEvent?.kind).toBe("run_completed");
		expect(seenKinds).toEqual(["run_started", "bootstrap_status", "run_completed"]);
		expect(isTakumiExecTerminalEvent(result.terminalEvent!)).toBe(true);
	});

	it("throws when stdout ends without a terminal envelope", async () => {
		await expect(
			runTakumiExec(
				{ prompt: "fix auth", cwd: "/repo" },
				createRunnerOptions([
					makeEvent("run_started", { cwd: "/repo", prompt: "fix auth", headless: true, streamFormat: "ndjson" }),
				]),
			),
		).rejects.toMatchObject({
			name: "TakumiExecTransportError",
			result: expect.objectContaining({ transportFailure: true }),
		});
	});

	it("throws on invalid stdout payloads while preserving stderr", async () => {
		await expect(
			runTakumiExec({ prompt: "fix auth", cwd: "/repo" }, createRunnerOptions(["not-json"], { stderr: "boom\n" })),
		).rejects.toMatchObject({
			name: "TakumiExecTransportError",
			result: expect.objectContaining({ stderr: "boom\n", transportFailure: true }),
		});
	});
});

function createRunnerOptions(
	stdoutLines: Array<string | Record<string, unknown>>,
	overrides: Partial<TakumiExecRunnerOptions> & { stderr?: string } = {},
): TakumiExecRunnerOptions {
	return {
		spawnImpl: () => createMockChild(stdoutLines, overrides.stderr ?? ""),
		...overrides,
	};
}

function createMockChild(stdoutLines: Array<string | Record<string, unknown>>, stderrText: string) {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		kill: (signal?: NodeJS.Signals) => boolean;
	};

	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.kill = () => {
		process.nextTick(() => child.emit("close", 1, "SIGTERM"));
		return true;
	};

	process.nextTick(() => {
		if (stderrText) child.stderr.end(stderrText);
		for (const line of stdoutLines) {
			child.stdout.write(typeof line === "string" ? `${line}\n` : `${JSON.stringify(line)}\n`);
		}
		child.stdout.end();
		child.emit("close", 0, null);
	});

	return child as never;
}

function makeEvent(kind: string, extra: Record<string, unknown>) {
	return {
		protocol: EXEC_PROTOCOL,
		schemaVersion: EXEC_PROTOCOL_VERSION,
		kind,
		runId: "exec-123",
		timestamp: new Date().toISOString(),
		...extra,
	};
}
