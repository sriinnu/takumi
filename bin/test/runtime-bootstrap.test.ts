import { beforeEach, describe, expect, it, vi } from "vitest";

const probeSideAgentBootstrap = vi.fn();
const registerOptionalSideAgentTools = vi.fn();
const bootstrapChitraguptaForExec = vi.fn();

vi.mock("../cli/side-agent-tools.js", () => ({
	probeSideAgentBootstrap,
	registerOptionalSideAgentTools,
}));

vi.mock("@takumi/agent", () => ({
	bootstrapChitraguptaForExec,
}));

describe("runtime bootstrap", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("merges side-agent and Chitragupta degradation into one snapshot", async () => {
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
		});

		const { collectRuntimeBootstrap } = await import("../cli/runtime-bootstrap.js");
		const result = await collectRuntimeBootstrap({} as never, {
			cwd: "/repo",
			tools: {} as never,
			enableChitraguptaBootstrap: true,
		});

		expect(registerOptionalSideAgentTools).toHaveBeenCalledWith(expect.anything(), expect.anything(), "/repo");
		expect(bootstrapChitraguptaForExec).toHaveBeenCalledWith({ cwd: "/repo" });
		expect(result.bootstrap).toMatchObject({
			connected: false,
			degraded: true,
			summary: "offline",
			sideAgents: {
				degraded: true,
				reason: "tmux_unavailable",
			},
		});
		expect(result.warningLines).toEqual(["Side agents: tmux is unavailable", "Chitragupta: offline"]);
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
		expect(result.chitragupta).toBeNull();
		expect(result.bootstrap).toMatchObject({
			connected: false,
			degraded: false,
			summary: "bootstrap not requested",
		});
		expect(result.warningLines).toEqual([]);
	});
});
