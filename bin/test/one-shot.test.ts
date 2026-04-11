import { afterEach, describe, expect, it, vi } from "vitest";
import { EXEC_EXIT_CODES, EXEC_PROTOCOL, type AgentEvent } from "@takumi/core";
import { StartupTrace } from "../cli/startup-trace.js";

const emitted: string[] = [];
const mockCreateResolvedProvider = vi.fn(async () => createResolvedProviderResult());
const mockBootstrapChitraguptaForExec = vi.fn(async () => createBootstrapResult(false));
const mockCollectFastProviderStatus = vi.fn(async () => [
	{ id: "ollama", authenticated: true, credentialSource: "none", models: ["llama3:8b", "qwen2.5-coder:7b"] },
]);
const mockProbeSideAgentBootstrap = vi.fn(async () => ({
	enabled: false,
	degraded: true,
	reason: "tmux_unavailable",
	summary: "tmux is unavailable",
}));
const mockRegisterOptionalSideAgentTools = vi.fn(async () => ({
	enabled: false,
	degraded: true,
	reason: "tmux_unavailable",
	summary: "tmux is unavailable",
}));
const mockEnsureExecCanonicalSession = vi.fn(async () => ({
	projectPath: process.cwd(),
	canonicalSessionId: "canon-1",
}));
const mockResolveExecRouting = vi.fn(async () => ({
	authority: "takumi-fallback",
	enforcement: "capability-only",
	provider: "openai",
	model: "gpt-4.1",
	laneId: undefined as string | undefined,
	degraded: false,
}));

/** Mock the provider helpers so one-shot tests can classify startup failures deterministically. */
vi.mock("../cli/provider.js", () => ({
	createResolvedProvider: mockCreateResolvedProvider,
	isProviderConfigurationError: (error: unknown) => {
		const candidate = error as { code?: string; name?: string } | null;
		return candidate?.code === "PROVIDER_CONFIG_UNAVAILABLE" || candidate?.name === "ProviderConfigurationError";
	},
	isRouteIncompatibleError: (error: unknown) => {
		const candidate = error as { code?: string; name?: string } | null;
		return candidate?.code === "ROUTE_INCOMPATIBLE" || candidate?.name === "RouteIncompatibleError";
	},
}));

vi.mock("../cli/cli-auth.js", () => ({
	collectFastProviderStatus: mockCollectFastProviderStatus,
}));

vi.mock("../cli/side-agent-tools.js", () => ({
	probeSideAgentBootstrap: mockProbeSideAgentBootstrap,
	registerOptionalSideAgentTools: mockRegisterOptionalSideAgentTools,
}));

vi.mock("@takumi/agent", () => ({
	bootstrapChitraguptaForExec: mockBootstrapChitraguptaForExec,
	ToolRegistry: class {
		getDefinitions() {
			return [];
		}
	},
	registerBuiltinTools: vi.fn(),
	buildContext: vi.fn(async () => "system"),
	agentLoop: vi.fn((_prompt: string, _messages: unknown[], _options: unknown) => makeEvents()),
}));

vi.mock("../cli/one-shot-helpers.js", async () => {
	const actual = await vi.importActual<typeof import("../cli/one-shot-helpers.js")>("../cli/one-shot-helpers.js");
	return {
		...actual,
		ensureExecCanonicalSession: mockEnsureExecCanonicalSession,
	};
});

vi.mock("../cli/exec-routing.js", () => ({
	resolveExecRouting: mockResolveExecRouting,
}));

/** Simulate a short headless run that immediately hits a permission denial. */
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
		vi.clearAllMocks();
		mockCreateResolvedProvider.mockImplementation(async () => createResolvedProviderResult());
		mockBootstrapChitraguptaForExec.mockImplementation(async () => createBootstrapResult(false));
		mockCollectFastProviderStatus.mockImplementation(async () => [
			{ id: "ollama", authenticated: true, credentialSource: "none", models: ["llama3:8b", "qwen2.5-coder:7b"] },
		]);
		mockEnsureExecCanonicalSession.mockImplementation(async () => ({
			projectPath: process.cwd(),
			canonicalSessionId: "canon-1",
		}));
		mockResolveExecRouting.mockImplementation(async () => ({
			authority: "takumi-fallback",
			enforcement: "capability-only",
			provider: "openai",
			model: "gpt-4.1",
			laneId: undefined as string | undefined,
			degraded: false,
		}));
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
		expect(stderrChunks.join("")).toContain("[warning] Degraded local mode:");
		expect(stderrChunks.join("")).toContain("[startup] Startup trace:");
		expect(stderrChunks.join("")).toContain("provider.create");
	});

	it("treats side-agent workers as lane-only runtimes during bootstrap", async () => {
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
			{ runId: "exec-worker-role", headless: true, runtimeRole: "side-agent-worker" },
		);

		stdoutSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.POLICY);
		expect(mockProbeSideAgentBootstrap).not.toHaveBeenCalled();
		expect(mockRegisterOptionalSideAgentTools).not.toHaveBeenCalled();
		const events = emitted
			.join("")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) =>
				JSON.parse(line) as {
					kind: string;
					bootstrap?: { sideAgents?: { reason?: string; summary?: string } };
				},
			);
		const bootstrapEvent = events.find((event) => event.kind === "bootstrap_status");
		expect(bootstrapEvent?.bootstrap?.sideAgents).toMatchObject({
			reason: "worker_runtime",
			summary: "disabled inside a side-agent worker",
		});
	});

	it("emits vertical-contract warnings in bootstrap status events", async () => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			emitted.push(String(chunk));
			return true;
		}) as never);

		mockBootstrapChitraguptaForExec.mockResolvedValueOnce(
			createBootstrapResult(true, [
				"Vertical profile takumi does not allow daemon runtime startup.",
				"Vertical profile takumi does not advertise daemon bridge-token auth.",
			]),
		);

		const { runOneShot } = await import("../cli/one-shot.js");
		const result = await runOneShot(
			{
				provider: "openai",
				model: "gpt-4.1",
				maxTurns: 4,
				permissions: [],
			} as never,
			"review the auth flow",
			undefined,
			"ndjson",
			{ runId: "exec-bootstrap-warnings", headless: true, enableChitraguptaBootstrap: true },
		);

		stdoutSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.POLICY);
		const events = emitted
			.join("")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { kind: string; bootstrap?: { warnings?: string[] } });

		const bootstrapEvent = events.find((event) => event.kind === "bootstrap_status");
		expect(bootstrapEvent?.bootstrap?.warnings).toContain(
			"Vertical profile takumi does not allow daemon runtime startup.",
		);
		expect(bootstrapEvent?.bootstrap?.warnings).toContain(
			"Vertical profile takumi does not advertise daemon bridge-token auth.",
		);
	});

	it("passes Chitragupta provider handoff into provider resolution before emitting run_started", async () => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			emitted.push(String(chunk));
			return true;
		}) as never);

		mockBootstrapChitraguptaForExec.mockResolvedValueOnce(createBootstrapResult(true));
		mockResolveExecRouting.mockResolvedValueOnce({
			authority: "engine",
			enforcement: "same-provider",
			provider: "gemini",
			model: "gemini-2.5-pro",
			laneId: "lane-7",
			degraded: false,
		});
		mockCreateResolvedProvider.mockResolvedValueOnce(createResolvedProviderResult("gemini", "gemini-2.5-pro"));

		const { runOneShot } = await import("../cli/one-shot.js");
		const result = await runOneShot(
			{
				provider: "openai",
				model: "gpt-4.1",
				maxTurns: 4,
				permissions: [],
			} as never,
			"review the auth flow",
			undefined,
			"ndjson",
			{ runId: "exec-route-test", headless: true, enableChitraguptaBootstrap: true },
		);

		stdoutSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.POLICY);
		expect(mockCreateResolvedProvider).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openai", model: "gpt-4.1" }),
			expect.objectContaining({ preferredProvider: "gemini", preferredModel: "gemini-2.5-pro" }),
		);

		const events = emitted
			.join("")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { kind: string; provider?: string; model?: string; routing?: Record<string, unknown> });

		expect(events[0]).toMatchObject({
			kind: "run_started",
			provider: "gemini",
			model: "gemini-2.5-pro",
			routing: {
				authority: "engine",
				provider: "gemini",
				model: "gemini-2.5-pro",
			},
		});
		expect(events[1]).toMatchObject({ kind: "bootstrap_status" });
	});

	it("fails with a config error when an authoritative route cannot be honored", async () => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			emitted.push(String(chunk));
			return true;
		}) as never);

		mockBootstrapChitraguptaForExec.mockResolvedValueOnce(createBootstrapResult(true));
		mockResolveExecRouting.mockResolvedValueOnce({
			authority: "engine",
			enforcement: "same-provider",
			provider: "gemini",
			model: "gemini-2.5-pro",
			laneId: undefined,
			degraded: false,
		});
		mockCreateResolvedProvider.mockRejectedValueOnce(Object.assign(new Error("route mismatch"), {
			name: "RouteIncompatibleError",
			code: "ROUTE_INCOMPATIBLE",
		}));

		const { runOneShot } = await import("../cli/one-shot.js");
		const result = await runOneShot(
			{
				provider: "openai",
				model: "gpt-4.1",
				maxTurns: 4,
				permissions: [],
			} as never,
			"review the auth flow",
			undefined,
			"ndjson",
			{ runId: "exec-route-incompatible", headless: true, enableChitraguptaBootstrap: true },
		);

		stdoutSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.CONFIG);
		const events = emitted
			.join("")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { kind: string; exitCode?: number; phase?: string; category?: string });

		expect(events.at(-1)).toMatchObject({
			kind: "run_failed",
			exitCode: EXEC_EXIT_CODES.CONFIG,
			phase: "config",
			category: "route_incompatible",
		});
	});

	it("fails with a config error when no executable provider path remains after bootstrap", async () => {
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
			emitted.push(String(chunk));
			return true;
		}) as never);

		mockCreateResolvedProvider.mockRejectedValueOnce(Object.assign(new Error("no executable provider"), {
			name: "ProviderConfigurationError",
			code: "PROVIDER_CONFIG_UNAVAILABLE",
		}));

		const { runOneShot } = await import("../cli/one-shot.js");
		const result = await runOneShot(
			{
				provider: "openai",
				model: "gpt-4.1",
				maxTurns: 4,
				permissions: [],
			} as never,
			"review the auth flow",
			undefined,
			"ndjson",
			{ runId: "exec-provider-config", headless: true, enableChitraguptaBootstrap: true },
		);

		stdoutSpy.mockRestore();

		expect(result.exitCode).toBe(EXEC_EXIT_CODES.CONFIG);
		const events = emitted
			.join("")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { kind: string; exitCode?: number; phase?: string; category?: string });

		expect(events.at(-1)).toMatchObject({
			kind: "run_failed",
			exitCode: EXEC_EXIT_CODES.CONFIG,
			phase: "config",
			category: "config",
		});
	});
});

/**
 * Build a resolved-provider result with the smallest surface needed by the
 * headless startup tests.
 */
function createResolvedProviderResult(provider = "openai", model = "gpt-4.1") {
	return {
		provider: {
			sendMessage: vi.fn(),
		},
		resolvedConfig: {
			provider,
			model,
		},
		source: "configured provider",
		usedStandaloneFallback: false,
		warnings: [],
	};
}

/** Create a minimal bootstrap snapshot for connected and offline states. */
function createBootstrapResult(connected: boolean, warnings: string[] = []) {
	const bridge = connected
		? {
				isConnected: true,
				disconnect: vi.fn(async () => undefined),
			}
		: null;

	return {
		connected,
		bridge,
		memoryContext: "",
		degraded: !connected,
		transport: connected ? "daemon-socket" : "unavailable",
		memoryEntries: connected ? 3 : 0,
		vasanaCount: connected ? 1 : 0,
		hasHealth: connected,
		summary: connected ? "connected" : "offline",
		warnings,
	};
}
