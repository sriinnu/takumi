import { describe, expect, it } from "vitest";
import {
	buildCliAdapterSpawnPlan,
	type CliAdapterContract,
	resolveCliAdapterCommand,
} from "../src/cli-adapter-contract.js";

const CLAUDE_CONTRACT: CliAdapterContract = {
	id: "agent.delegate.cli-claude",
	transport: "local-process",
	binaryEnv: "CLAUDE_EXEC_BIN",
	binaryCandidates: ["claude"],
	defaultArgs: ["--print"],
	stdoutProtocol: "text",
	stderrMode: "diagnostic-text",
	timeoutMs: 60_000,
	workingDirectoryFromRequest: true,
	retry: {
		maxAttempts: 1,
		retryOnTransportFailure: false,
		nonRetryableExitCodes: [64, 78],
	},
};

describe("cli adapter contract", () => {
	it("prefers the env override when resolving a CLI binary", () => {
		expect(resolveCliAdapterCommand(CLAUDE_CONTRACT, { CLAUDE_EXEC_BIN: "/opt/bin/claude-dev" })).toBe(
			"/opt/bin/claude-dev",
		);
	});

	it("builds a generic local-process spawn plan", () => {
		const plan = buildCliAdapterSpawnPlan(
			CLAUDE_CONTRACT,
			{
				cwd: "/repo",
				args: ["review auth flow"],
				stdinText: "extra context",
				env: { PROJECT_KIND: "monorepo" },
			},
			{ PATH: "/usr/bin", HOME: "/Users/test" },
		);

		expect(plan.command).toBe("claude");
		expect(plan.args).toEqual(["--print", "review auth flow"]);
		expect(plan.cwd).toBe("/repo");
		expect(plan.stdinText).toBe("extra context");
		expect(plan.stdoutProtocol).toBe("text");
		expect(plan.stderrMode).toBe("diagnostic-text");
		expect(plan.env.PROJECT_KIND).toBe("monorepo");
	});
});
