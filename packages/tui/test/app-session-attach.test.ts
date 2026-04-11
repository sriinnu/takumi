import type { SessionControlPlaneLaneState, SessionData } from "@takumi/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadSession = vi.fn();
const mockReconstructFromDaemon = vi.fn();
const mockRefreshControlPlaneLanesFromDaemon = vi.fn();

vi.mock("@takumi/core", async () => {
	const actual = await vi.importActual<typeof import("@takumi/core")>("@takumi/core");
	return {
		...actual,
		loadSession: mockLoadSession,
	};
});

vi.mock("@takumi/bridge", async () => {
	const actual = await vi.importActual<typeof import("@takumi/bridge")>("@takumi/bridge");
	return {
		...actual,
		reconstructFromDaemon: mockReconstructFromDaemon,
	};
});

vi.mock("../src/chitragupta/control-plane-lanes.js", () => ({
	refreshControlPlaneLanesFromDaemon: mockRefreshControlPlaneLanesFromDaemon,
}));

const { attachSessionToRuntime } = await import("../src/app-session-attach.js");

function makeLane(overrides: Partial<SessionControlPlaneLaneState> = {}): SessionControlPlaneLaneState {
	return {
		key: "primary",
		role: "primary",
		laneId: "lane-primary",
		durableKey: "durable-primary",
		snapshotAt: 123,
		capability: "coding.patch-cheap",
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		degraded: false,
		policyHash: "policy-a",
		policy: {
			contractVersion: 1,
			role: "primary",
			preferLocal: null,
			allowCloud: true,
			maxCostClass: "medium",
			requireStreaming: true,
			hardProviderFamily: null,
			preferredProviderFamilies: ["anthropic"],
			toolAccess: "inherit",
			privacyBoundary: "cloud-ok",
			fallbackStrategy: "same-provider",
			tags: ["session"],
		},
		...overrides,
	};
}

describe("attachSessionToRuntime", () => {
	beforeEach(() => {
		mockLoadSession.mockReset();
		mockReconstructFromDaemon.mockReset();
		mockRefreshControlPlaneLanesFromDaemon.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("activates an already-saved local session without touching daemon recovery", async () => {
		const session: SessionData = {
			id: "session-local",
			title: "Local session",
			createdAt: 1,
			updatedAt: 2,
			messages: [],
			model: "claude-sonnet-4-20250514",
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		};
		mockLoadSession.mockResolvedValue(session);
		const activateSession = vi.fn(async () => undefined);

		const result = await attachSessionToRuntime({
			sessionId: "session-local",
			model: null,
			chitragupta: null,
			activateSession,
		});

		expect(result).toEqual({ success: true });
		expect(activateSession).toHaveBeenCalledWith(session, "Resumed session session-local (0 messages).");
		expect(mockReconstructFromDaemon).not.toHaveBeenCalled();
	});

	it("refreshes canonical lane truth for saved sessions before activation", async () => {
		const session: SessionData = {
			id: "session-local",
			title: "Local session",
			createdAt: 1,
			updatedAt: 2,
			messages: [
				{
					id: "msg-1",
					role: "user",
					content: [{ type: "text", text: "Need a rebind check" }],
					timestamp: 1,
					sessionTurn: true,
				},
				{
					id: "msg-2",
					role: "assistant",
					content: [{ type: "text", text: "Pending local turn" }],
					timestamp: 2,
					sessionTurn: true,
				},
			],
			model: "claude-sonnet-4-20250514",
			tokenUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
			controlPlane: {
				canonicalSessionId: "canon-attach",
				lanes: [makeLane()],
				sync: {
					status: "ready",
					lastSyncedMessageId: "msg-1",
				},
			},
		};
		mockLoadSession.mockResolvedValue(session);
		mockRefreshControlPlaneLanesFromDaemon.mockResolvedValue({
			source: "route.lanes.refresh",
			warnings: [],
			lanes: [
				makeLane({
					provider: "openai",
					model: "gpt-4o",
					policyHash: "policy-b",
					policy: {
						...makeLane().policy,
						contractVersion: 2,
					},
				}),
			],
		});
		const activateSession = vi.fn(async () => undefined);
		const bridge = { isConnected: true };

		const result = await attachSessionToRuntime({
			sessionId: session.id,
			model: session.model,
			chitragupta: bridge as never,
			activateSession,
		});

		expect(result).toEqual({ success: true });
		expect(mockReconstructFromDaemon).not.toHaveBeenCalled();
		expect(mockRefreshControlPlaneLanesFromDaemon).toHaveBeenCalledWith(bridge, "canon-attach", expect.any(String));
		expect(activateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "gpt-4o",
				controlPlane: expect.objectContaining({
					canonicalSessionId: "canon-attach",
					lanes: [expect.objectContaining({ provider: "openai", model: "gpt-4o" })],
					degradedContext: expect.objectContaining({
						sources: [
							expect.objectContaining({
								kind: "sync_failure",
								pendingLocalTurns: 1,
								reason: expect.stringContaining("Replay validation blocked canonical rebind"),
							}),
						],
					}),
					sync: expect.objectContaining({
						status: "failed",
						lastError: expect.stringContaining("Replay validation blocked canonical rebind"),
					}),
				}),
			}),
			expect.stringContaining(
				"Replay validation blocked canonical rebind for canon-attach while 1 local turn(s) were pending",
			),
		);
	});

	it("hydrates daemon-backed sessions with canonical lane truth before activation", async () => {
		mockLoadSession.mockResolvedValue(null);
		mockReconstructFromDaemon.mockResolvedValue({
			sessionId: "canon-attach",
			turnCount: 3,
			createdAt: 10,
			updatedAt: 20,
			messages: [
				{
					id: "msg-1",
					role: "user",
					content: [{ type: "text", text: "Recover this session" }],
					timestamp: 10,
				},
			],
		});
		mockRefreshControlPlaneLanesFromDaemon.mockResolvedValue({
			source: "route.lanes.refresh",
			warnings: [],
			lanes: [
				{
					key: "primary",
					role: "primary",
					laneId: "lane-primary",
					durableKey: "durable-primary",
					snapshotAt: 33,
					capability: "coding.patch-cheap",
					provider: "openai",
					model: "gpt-4o",
					degraded: false,
					policyHash: "policy-1",
					policy: {
						contractVersion: 1,
						role: "primary",
						preferLocal: null,
						allowCloud: true,
						maxCostClass: "medium",
						requireStreaming: true,
						hardProviderFamily: null,
						preferredProviderFamilies: ["openai"],
						toolAccess: "inherit",
						privacyBoundary: "cloud-ok",
						fallbackStrategy: "same-provider",
						tags: ["session"],
					},
				},
			],
		});
		const activateSession = vi.fn(async () => undefined);
		const bridge = { isConnected: true };

		const result = await attachSessionToRuntime({
			sessionId: "session-daemon",
			model: "claude-sonnet-4-20250514",
			chitragupta: bridge as never,
			activateSession,
		});

		expect(result).toEqual({ success: true });
		expect(mockRefreshControlPlaneLanesFromDaemon).toHaveBeenCalledWith(bridge, "canon-attach", expect.any(String));
		expect(activateSession).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "canon-attach",
				model: "gpt-4o",
				controlPlane: expect.objectContaining({
					canonicalSessionId: "canon-attach",
					lanes: [expect.objectContaining({ key: "primary", provider: "openai", model: "gpt-4o" })],
					sync: { status: "ready" },
				}),
			}),
			"Attached daemon session canon-attach (3 turns).",
		);
	});
});
