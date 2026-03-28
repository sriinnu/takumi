import { afterEach, describe, expect, it, vi } from "vitest";
import { EXEC_EXIT_CODES, EXEC_PROTOCOL, type AgentEvent } from "@takumi/core";
import { StartupTrace } from "../cli/startup-trace.js";

const emitted: string[] = [];

vi.mock("../cli/provider.js", () => ({
	createProvider: vi.fn(async () => ({
		sendMessage: vi.fn(),
	})),
}));

vi.mock("../cli/side-agent-tools.js", () => ({
	probeSideAgentBootstrap: vi.fn(async () => ({
		enabled: false,
		degraded: true,
		reason: "tmux_unavailable",
		summary: "tmux is unavailable",
	})),
	registerOptionalSideAgentTools: vi.fn(async () => ({
		enabled: false,
		degraded: true,
		reason: "tmux_unavailable",
		summary: "tmux is unavailable",
	})),
}));

vi.mock("@takumi/agent", () => ({
	bootstrapChitraguptaForExec: vi.fn(async () => ({
		connected: false,
		bridge: null,
		memoryContext: "",
		degraded: true,
		transport: "unavailable",
		memoryEntries: 0,
		vasanaCount: 0,
		hasHealth: false,
		summary: "offline",
	})),
	ToolRegistry: class {
		getDefinitions() {
			return [];
		}
	},
	registerBuiltinTools: vi.fn(),
	buildContext: vi.fn(async () => "system"),
	agentLoop: vi.fn((_prompt: string, _messages: unknown[], _options: unknown) => makeEvents()),
}));

async function* makeEvents(): AsyncGenerator<AgentEvent> {
	yield {
		type: "tool_use",
		id: "tool-1",
		name: "write_file",
		input: { filePath: "README.md" },
	} as AgentEvent;
	yield {
		type: "tool_result",
		id: "tool-1",
		name: "write_file",
		output: "Headless run denied permission-required tool: write_file",
		isError: true,
	} as AgentEvent;
	yield {
		type: "done",
		stopReason: "end_turn",
	} as AgentEvent;
}

describe("runOneShot", () => {
	afterEach(() => {
		emitted.length = 0;
		vi.restoreAllMocks();
	});

	it("returns a policy exit code for headless permission denials and reports side-agent bootstrap in ndjson mode", async () => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			emitted.push(String(chunk));
			return true;
		}) as never);

		const { runOneShot } = await import("../cli/one-shot.js");
		const result = await runOneShot(
			{
				provider: "openai",
				model: "gpt-4.1",
				maxTurns: 4,
				permissions: [],
			} as never,
			"modify the readme",
			undefined,
			"ndjson",
			{ runId: "exec-policy-test", headless: true },
		);

		stdoutSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.POLICY);
		const events = emitted
			.join("")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) =>
				JSON.parse(line) as {
					kind: string;
					exitCode?: number;
					phase?: string;
					category?: string;
					protocol?: string;
					bootstrap?: { summary?: string; sideAgents?: { reason?: string } };
				},
			);

		const bootstrapEvent = events.find((event) => event.kind === "bootstrap_status");
		expect(bootstrapEvent?.bootstrap?.summary).toBe("bootstrap not requested");
		expect(bootstrapEvent?.bootstrap?.sideAgents?.reason).toBe("tmux_unavailable");

		expect(events.at(-1)).toMatchObject({
			protocol: EXEC_PROTOCOL,
			kind: "run_failed",
			exitCode: EXEC_EXIT_CODES.POLICY,
			phase: "policy",
			category: "policy",
		});
	});

	it("prints bootstrap warnings consistently in text mode", async () => {
		const stderrChunks: string[] = [];
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
			stderrChunks.push(String(chunk));
			return true;
		}) as never);

		const { runOneShot } = await import("../cli/one-shot.js");
		const result = await runOneShot(
			{
				provider: "openai",
				model: "gpt-4.1",
				maxTurns: 4,
				permissions: [],
			} as never,
			"modify the readme",
			undefined,
			"text",
			{
				runId: "exec-policy-text",
				headless: true,
				enableChitraguptaBootstrap: true,
				startupTrace: new StartupTrace(true),
			},
		);

		stderrSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.POLICY);
		expect(stderrChunks.join("")).toContain("[warning] Side agents: tmux is unavailable");
		expect(stderrChunks.join("")).toContain("[warning] Chitragupta: offline");
		expect(stderrChunks.join("")).toContain("[startup] Startup trace:");
		expect(stderrChunks.join("")).toContain("provider.create");
	});
});
