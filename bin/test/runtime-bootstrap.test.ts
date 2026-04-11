import { beforeEach, describe, expect, it, vi } from "vitest";

const probeSideAgentBootstrap = vi.fn();
const registerOptionalSideAgentTools = vi.fn();
const bootstrapChitraguptaForExec = vi.fn();
const collectFastProviderStatus = vi.fn();

vi.mock("../cli/side-agent-tools.js", () => ({
	probeSideAgentBootstrap,
	registerOptionalSideAgentTools,
}));

vi.mock("../cli/cli-auth.js", () => ({
	collectFastProviderStatus,
}));

vi.mock("@takumi/agent", () => ({
	bootstrapChitraguptaForExec,
}));

describe("runtime bootstrap", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("merges side-agent and Chitragupta degradation into one snapshot", async () => {
		collectFastProviderStatus.mockResolvedValueOnce([
			{ id: "github", authenticated: true, credentialSource: "oauth", models: ["gpt-4.1"] },
			{ id: "ollama", authenticated: true, credentialSource: "none", models: ["llama3:8b", "qwen2.5-coder:7b"] },
		]);
		registerOptionalSideAgentTools.mockResolvedValueOnce({
			enabled: false,
			degraded: true,
			reason: "tmux_unavailable",
			summary: "tmux is unavailable",
		});
		bootstrapChitraguptaForExec.mockResolvedValueOnce({
			bridge: null,
			connected: false,
			degraded: true,
			transport: "unavailable",
			memoryEntries: 0,
			vasanaCount: 0,
			hasHealth: false,
			summary: "offline",
			memoryContext: "",
			warnings: ["Vertical profile takumi does not advertise daemon bridge-token auth."],
		});

		const { collectRuntimeBootstrap } = await import("../cli/runtime-bootstrap.js");
		const result = await collectRuntimeBootstrap({ provider: "github", model: "gpt-4.1" } as never, {
			cwd: "/repo",
			tools: {} as never,
			enableChitraguptaBootstrap: true,
			includeProviderStatus: true,
		});

		expect(registerOptionalSideAgentTools).toHaveBeenCalledWith(expect.anything(), expect.anything(), "/repo");
		expect(bootstrapChitraguptaForExec).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/repo",
				mode: "exec",
				consumer: "takumi",
				configuredProvider: "github",
				configuredModel: "gpt-4.1",
				agentLabel: "takumi.exec",
			}),
		);
		expect(collectFastProviderStatus).toHaveBeenCalledTimes(1);
		expect(result.bootstrap).toMatchObject({
			connected: false,
			degraded: true,
			summary: "offline",
			warnings: expect.arrayContaining([
				"Vertical profile takumi does not advertise daemon bridge-token auth.",
				"Side agents: tmux is unavailable",
			]),
			localFallback: {
				active: true,
				providerCount: 2,
				currentTarget: "github / gpt-4.1",
			},
			sideAgents: {
				degraded: true,
				reason: "tmux_unavailable",
			},
		});
		expect(result.degradedLocalMode).toMatchObject({
			active: true,
			requiresOperatorConsent: true,
			providerCount: 2,
		});
		expect(result.warningLines).toEqual([
			"Vertical profile takumi does not advertise daemon bridge-token auth.",
			"Side agents: tmux is unavailable",
			"Chitragupta: offline",
			expect.stringContaining("Degraded local mode:"),
		]);
	});

	it("uses probe mode when no tool registry is provided", async () => {
		probeSideAgentBootstrap.mockResolvedValueOnce({
			enabled: true,
			degraded: false,
			reason: "enabled",
			summary: "preflight ready",
		});

		const { collectRuntimeBootstrap } = await import("../cli/runtime-bootstrap.js");
		const result = await collectRuntimeBootstrap({} as never, {
			cwd: "/repo",
			enableChitraguptaBootstrap: false,
		});

		expect(probeSideAgentBootstrap).toHaveBeenCalledWith(expect.anything(), "/repo");
		expect(registerOptionalSideAgentTools).not.toHaveBeenCalled();
		expect(collectFastProviderStatus).not.toHaveBeenCalled();
		expect(result.chitragupta).toBeNull();
		expect(result.bootstrap).toMatchObject({
			connected: false,
			degraded: false,
			summary: "bootstrap not requested",
		});
		expect(result.warningLines).toEqual([]);
	});

	it("skips side-agent bootstrap entirely inside worker runtimes", async () => {
		const { collectRuntimeBootstrap } = await import("../cli/runtime-bootstrap.js");
		const result = await collectRuntimeBootstrap({} as never, {
			cwd: "/repo",
			runtimeRole: "side-agent-worker",
			enableChitraguptaBootstrap: false,
			tools: {} as never,
		});

		expect(probeSideAgentBootstrap).not.toHaveBeenCalled();
		expect(registerOptionalSideAgentTools).not.toHaveBeenCalled();
		expect(result.sideAgents).toMatchObject({
			enabled: false,
			degraded: false,
			reason: "worker_runtime",
			summary: "disabled inside a side-agent worker",
		});
		expect(result.warningLines).toEqual([]);
	});
});
