import { describe, expect, it } from "vitest";
import {
	buildTakumiExecArgs,
	buildTakumiExecSpawnPlan,
	EXEC_PROTOCOL,
	EXEC_PROTOCOL_VERSION,
	isTakumiExecEvent,
	resolveTakumiExecCommand,
	TAKUMI_EXEC_BINARY_ENV,
	TAKUMI_EXEC_PARENT_CONTRACT,
} from "../src/index.js";

describe("takumi exec contract", () => {
	it("resolves the takumi binary from env override first", () => {
		expect(resolveTakumiExecCommand({ [TAKUMI_EXEC_BINARY_ENV]: "/usr/local/bin/takumi-dev" })).toBe(
			"/usr/local/bin/takumi-dev",
		);
	});

	it("builds canonical headless args for parent process invocation", () => {
		const args = buildTakumiExecArgs({
			prompt: "fix login bug",
			cwd: "/repo",
			issue: "#42",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			fallbackProvider: "openai",
		});

		expect(args).toEqual([
			"exec",
			"--headless",
			"--stream=ndjson",
			"fix login bug",
			"--issue",
			"#42",
			"--provider",
			"anthropic",
			"--model",
			"claude-sonnet-4-20250514",
			"--fallback",
			"openai",
		]);
	});

	it("builds a spawn plan with project/socket env wiring", () => {
		const plan = buildTakumiExecSpawnPlan(
			{
				prompt: "review auth router",
				cwd: "/repo/takumi",
				chitraguptaSocketPath: "/tmp/chitragupta.sock",
			},
			{ HOME: "/Users/test", PATH: "/usr/bin" },
		);

		expect(plan.command).toBe("takumi");
		expect(plan.cwd).toBe("/repo/takumi");
		expect(plan.stdoutProtocol).toBe(EXEC_PROTOCOL);
		expect(plan.env.CHITRAGUPTA_PROJECT).toBe("/repo/takumi");
		expect(plan.env.CHITRAGUPTA_SOCKET).toBe("/tmp/chitragupta.sock");
	});

	it("recognizes valid takumi exec protocol envelopes", () => {
		expect(
			isTakumiExecEvent({
				protocol: EXEC_PROTOCOL,
				schemaVersion: EXEC_PROTOCOL_VERSION,
				kind: "run_started",
				runId: "exec-123",
				timestamp: new Date().toISOString(),
			}),
		).toBe(true);
		expect(isTakumiExecEvent({ protocol: "other" })).toBe(false);
		expect(TAKUMI_EXEC_PARENT_CONTRACT.transport).toBe("local-process");
	});

	it("lets additional env override the inherited socket path", () => {
		const plan = buildTakumiExecSpawnPlan(
			{
				prompt: "review auth router",
				cwd: "/repo/takumi",
				additionalEnv: { CHITRAGUPTA_SOCKET: "" },
			},
			{ CHITRAGUPTA_SOCKET: "/tmp/chitragupta.sock" },
		);

		expect(plan.env.CHITRAGUPTA_SOCKET).toBe("");
	});
});
