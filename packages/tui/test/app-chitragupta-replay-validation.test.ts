import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockEnsureCanonicalSessionBinding,
	mockLoadMcpConfig,
	mockRefreshControlPlaneLanesFromDaemon,
	mockSetupChitraguptaNotifications,
	mockValidateReplayBeforeCanonicalImport,
} = vi.hoisted(() => ({
	mockEnsureCanonicalSessionBinding: vi.fn(async () => {}),
	mockLoadMcpConfig: vi.fn(() => null),
	mockRefreshControlPlaneLanesFromDaemon: vi.fn(),
	mockSetupChitraguptaNotifications: vi.fn(),
	mockValidateReplayBeforeCanonicalImport: vi.fn(),
}));

const mockBridge = vi.hoisted(() => ({
	connect: vi.fn(async () => {}),
	disconnect: vi.fn(async () => {}),
	mcpClient: { on: vi.fn() },
	isConnected: true,
}));

vi.mock("@takumi/bridge", async () => {
	const actual = await vi.importActual<typeof import("@takumi/bridge")>("@takumi/bridge");
	class MockChitraguptaBridge {
		connect = mockBridge.connect;
		disconnect = mockBridge.disconnect;
		mcpClient = mockBridge.mcpClient;
		isConnected = mockBridge.isConnected;
	}
	class MockChitraguptaObserver {
		teardown = vi.fn();
	}
	return {
		...actual,
		ChitraguptaBridge: MockChitraguptaBridge,
		ChitraguptaObserver: MockChitraguptaObserver,
	};
});

vi.mock("../src/app-session-replay-validation.js", async () => {
	const actual = await vi.importActual<typeof import("../src/app-session-replay-validation.js")>(
		"../src/app-session-replay-validation.js",
	);
	return {
		...actual,
		validateReplayBeforeCanonicalImport: mockValidateReplayBeforeCanonicalImport,
	};
});

vi.mock("../src/chitragupta/control-plane-lanes.js", () => ({
	refreshControlPlaneLanesFromDaemon: mockRefreshControlPlaneLanesFromDaemon,
}));

vi.mock("../src/chitragupta/chitragupta-executor-runtime.js", () => ({
	ensureCanonicalSessionBinding: mockEnsureCanonicalSessionBinding,
}));

vi.mock("../src/chitragupta/chitragupta-runtime-helpers.js", () => ({
	loadMcpConfig: mockLoadMcpConfig,
	resetRecentDirectiveHistory: vi.fn(),
}));

vi.mock("../src/chitragupta/app-chitragupta-notifications.js", () => ({
	setupChitraguptaNotifications: mockSetupChitraguptaNotifications,
}));

const { connectChitragupta } = await import("../src/chitragupta/app-chitragupta.js");
const { AppState } = await import("../src/state.js");

describe("connectChitragupta replay validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRefreshControlPlaneLanesFromDaemon.mockResolvedValue({
			source: "route.lanes.refresh",
			warnings: [],
			lanes: [],
		});
		mockValidateReplayBeforeCanonicalImport.mockReturnValue({
			ok: false,
			blocking: true,
			summary: "Replay validation blocked canonical rebind for canon-live while 1 local turn(s) were pending.",
			warnings: [],
			conflicts: [],
		});
	});

	it("records blocking replay validation as degraded sync history", async () => {
		const state = new AppState();
		state.canonicalSessionId.value = "canon-live";
		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-4-20250514";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Pending local replay" }],
				timestamp: 1,
				sessionTurn: true,
			},
		];

		const result = await connectChitragupta(state, null, vi.fn(), "");

		expect(result.syncStatus).toBe("failed");
		expect(result.lastError).toContain("Replay validation blocked canonical rebind");
		expect(state.degradedExecutionContext.value).toEqual(
			expect.objectContaining({
				sources: [
					expect.objectContaining({
						kind: "sync_failure",
						pendingLocalTurns: 1,
						reason: "Replay validation blocked canonical rebind for canon-live while 1 local turn(s) were pending.",
					}),
				],
			}),
		);
	});

	it("emits before_session_rebind before canonical replay validation runs", async () => {
		const state = new AppState();
		state.sessionId.value = "local-session";
		state.canonicalSessionId.value = "canon-live";
		state.provider.value = "anthropic";
		state.model.value = "claude-sonnet-4-20250514";
		state.messages.value = [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Pending local replay" }],
				timestamp: 1,
				sessionTurn: true,
			},
		];
		const agentRunner = {
			emitExtensionEvent: vi.fn(async () => undefined),
		} as never;

		await connectChitragupta(state, agentRunner, vi.fn(), "");

		expect(agentRunner.emitExtensionEvent).toHaveBeenCalledTimes(1);
		expect(agentRunner.emitExtensionEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "before_session_rebind",
				localSessionId: "local-session",
				canonicalSessionId: "canon-live",
				pendingLocalTurns: 1,
				currentProvider: "anthropic",
				currentModel: "claude-sonnet-4-20250514",
				syncStatus: "idle",
			}),
		);
	});
});
