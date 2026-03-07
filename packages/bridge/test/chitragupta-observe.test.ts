/**
 * Tests for chitragupta-observe ops and ChitraguptaObserver — Phases 49-51.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	capabilitiesQuery,
	healReport,
	healthStatusExtended,
	type NotificationCallbacks,
	observeBatch,
	patternQuery,
	predictNext,
	routeResolve,
	sabhaAsk,
	sabhaDeliberate,
	sabhaEscalate,
	sabhaGather,
	sabhaRecord,
	subscribeNotifications,
} from "../src/chitragupta-observe.js";
import { ChitraguptaObserver } from "../src/chitragupta-observer.js";
import type { CapabilityDescriptor } from "../src/control-plane.js";
import type { ObservationEvent, SabhaState, ToolUsageEvent } from "../src/observation-types.js";

// ── Mock socket ──────────────────────────────────────────────────────────────

function mockSocket(callResult?: unknown) {
	return {
		isConnected: true,
		call: vi.fn().mockResolvedValue(callResult ?? {}),
		onNotification: vi.fn().mockReturnValue(() => {}),
		disconnect: vi.fn(),
	} as any;
}

function makeToolUsage(): ToolUsageEvent {
	return {
		type: "tool_usage",
		tool: "read_file",
		argsHash: "abcdef123456",
		durationMs: 100,
		success: true,
		sessionId: "sess-1",
		timestamp: Date.now(),
	};
}

function makeCapability(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
	return {
		id: "adapter.takumi.executor",
		kind: "adapter",
		label: "Takumi Executor",
		capabilities: ["coding.patch-and-validate"],
		costClass: "medium",
		trust: "privileged",
		health: "healthy",
		invocation: {
			id: "takumi-agent-loop",
			transport: "inproc",
			entrypoint: "@takumi/agent/loop",
			requestShape: "RoutingRequest",
			responseShape: "AgentEvent stream",
			timeoutMs: 120_000,
			streaming: true,
		},
		tags: ["coding"],
		...overrides,
	};
}

function makeSabhaState(overrides: Partial<SabhaState> = {}): SabhaState {
	return {
		id: "sabha-1",
		topic: "Review the current approach",
		status: "active",
		convener: "takumi",
		createdAt: Date.now(),
		participants: [],
		participantCount: 0,
		rounds: [],
		roundCount: 0,
		currentRound: null,
		...overrides,
	};
}

// ── observeBatch ─────────────────────────────────────────────────────────────

describe("observeBatch", () => {
	it("should return { accepted: 0 } for empty events", async () => {
		const result = await observeBatch(null, false, []);
		expect(result).toEqual({ accepted: 0 });
	});

	it("should call socket.call in socket mode", async () => {
		const socket = mockSocket({ accepted: 2 });
		const events: ObservationEvent[] = [makeToolUsage(), makeToolUsage()];
		const result = await observeBatch(socket, true, events);
		expect(socket.call).toHaveBeenCalledWith("observe.batch", { events });
		expect(result.accepted).toBe(2);
	});

	it("should fallback gracefully in MCP mode", async () => {
		const result = await observeBatch(null, false, [makeToolUsage()]);
		expect(result.accepted).toBe(0);
	});

	it("should handle socket errors gracefully", async () => {
		const socket = mockSocket();
		socket.call.mockRejectedValue(new Error("not supported"));
		const result = await observeBatch(socket, true, [makeToolUsage()]);
		expect(result.accepted).toBe(0);
	});
});

// ── predictNext ──────────────────────────────────────────────────────────────

describe("predictNext", () => {
	it("should return empty predictions when not connected", async () => {
		const result = await predictNext(null, false, { sessionId: "s1" });
		expect(result.predictions).toEqual([]);
	});

	it("should call socket with correct params", async () => {
		const socket = mockSocket({ predictions: [{ type: "next_action", confidence: 0.8, action: "run tests" }] });
		const result = await predictNext(socket, true, { currentTool: "bash", sessionId: "s1" });
		expect(socket.call).toHaveBeenCalledWith("predict.next", { currentTool: "bash", sessionId: "s1" });
		expect(result.predictions).toHaveLength(1);
		expect(result.predictions[0].action).toBe("run tests");
	});
});

// ── patternQuery ─────────────────────────────────────────────────────────────

describe("patternQuery", () => {
	it("should return empty patterns when not connected", async () => {
		const result = await patternQuery(null, false);
		expect(result.patterns).toEqual([]);
	});

	it("should forward params to socket", async () => {
		const socket = mockSocket({ patterns: [{ type: "edit_after_read", confidence: 0.9, occurrences: 5 }] });
		const result = await patternQuery(socket, true, { minConfidence: 0.7, limit: 10 });
		expect(socket.call).toHaveBeenCalledWith("pattern.query", { minConfidence: 0.7, limit: 10 });
		expect(result.patterns).toHaveLength(1);
	});
});

// ── healthStatusExtended ─────────────────────────────────────────────────────

describe("healthStatusExtended", () => {
	it("should return null when not connected", async () => {
		expect(await healthStatusExtended(null, false)).toBeNull();
	});

	it("should return health data from socket", async () => {
		const socket = mockSocket({
			errorRate: 0.02,
			anomalies: [],
			costTrajectory: {
				currentCost: 1.2,
				dailyAvg: 1.0,
				projectedCost: 1.4,
			},
		});
		const result = await healthStatusExtended(socket, true);
		expect(result).not.toBeNull();
		expect(result!.errorRate).toBe(0.02);
		expect(result!.costTrajectory.projectedCost).toBe(1.4);
	});
});

// ── healReport ───────────────────────────────────────────────────────────────

describe("healReport", () => {
	it("should return { recorded: false } when not connected", async () => {
		const result = await healReport(null, false, {
			anomalyType: "loop_detected",
			actionTaken: "retry",
			outcome: "success",
			sessionId: "s1",
		});
		expect(result.recorded).toBe(false);
	});

	it("should call socket and return result", async () => {
		const socket = mockSocket({ recorded: true });
		const result = await healReport(socket, true, {
			anomalyType: "loop_detected",
			actionTaken: "retry",
			outcome: "success",
			sessionId: "s1",
		});
		expect(socket.call).toHaveBeenCalledWith("heal.report", {
			anomalyType: "loop_detected",
			actionTaken: "retry",
			outcome: "success",
			sessionId: "s1",
		});
		expect(result.recorded).toBe(true);
	});
});

// ── control-plane queries ───────────────────────────────────────────────────

describe("capabilitiesQuery", () => {
	it("should return empty list when not connected", async () => {
		const result = await capabilitiesQuery(null, false);
		expect(result.capabilities).toEqual([]);
	});

	it("should forward query params to socket", async () => {
		const socket = mockSocket({ capabilities: [makeCapability({ id: "cli.codex" })] });
		const result = await capabilitiesQuery(socket, true, { capability: "coding.patch-and-validate", limit: 1 });
		expect(socket.call).toHaveBeenCalledWith("capabilities", {
			capability: "coding.patch-and-validate",
			limit: 1,
		});
		expect(result.capabilities).toHaveLength(1);
	});
});

describe("routeResolve", () => {
	it("should return null when not connected", async () => {
		const result = await routeResolve(null, false, {
			consumer: "takumi",
			sessionId: "s1",
			capability: "coding.patch-and-validate",
		});
		expect(result).toBeNull();
	});

	it("should forward routing request to socket", async () => {
		const decision = {
			request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-and-validate" },
			selected: makeCapability({ id: "cli.codex" }),
			reason: "Selected cli.codex",
			fallbackChain: ["adapter.takumi.executor"],
			policyTrace: ["requested:coding.patch-and-validate", "selected:cli.codex"],
			degraded: false,
		};
		const socket = mockSocket(decision);
		const result = await routeResolve(socket, true, decision.request);
		expect(socket.call).toHaveBeenCalledWith("route.resolve", decision.request);
		expect(result?.selected?.id).toBe("cli.codex");
	});
});

describe("sabha operations", () => {
	it("should return null from sabhaAsk when not connected", async () => {
		expect(await sabhaAsk(null, false, { topic: "Need review" })).toBeNull();
	});

	it("should forward sabha methods to the socket", async () => {
		const sabha = makeSabhaState();
		const socket = mockSocket({
			sabha,
			question: sabha.topic,
			targets: [],
			targetClientIds: [],
			notificationsSent: 1,
		});

		const asked = await sabhaAsk(socket, true, { topic: sabha.topic, convener: "takumi" });
		expect(socket.call).toHaveBeenCalledWith("sabha.ask", { topic: sabha.topic, convener: "takumi" });
		expect(asked?.sabha.id).toBe(sabha.id);

		socket.call.mockResolvedValueOnce({ sabha, explanation: "Consensus pending" });
		const gathered = await sabhaGather(socket, true, { id: sabha.id });
		expect(socket.call).toHaveBeenCalledWith("sabha.gather", { id: sabha.id });
		expect(gathered?.explanation).toBe("Consensus pending");

		socket.call.mockResolvedValueOnce({ sabha, explanation: null, notificationsSent: 0 });
		const deliberated = await sabhaDeliberate(socket, true, { id: sabha.id, conclude: true });
		expect(socket.call).toHaveBeenCalledWith("sabha.deliberate", { id: sabha.id, conclude: true });
		expect(deliberated?.sabha.id).toBe(sabha.id);

		socket.call.mockResolvedValueOnce({ decision: { id: "decision-1" }, sabha });
		const recorded = await sabhaRecord(socket, true, { id: sabha.id, sessionId: "s1", project: "/tmp/project" });
		expect(socket.call).toHaveBeenCalledWith("sabha.record", {
			id: sabha.id,
			sessionId: "s1",
			project: "/tmp/project",
		});
		expect(recorded?.decision).toEqual({ id: "decision-1" });

		socket.call.mockResolvedValueOnce({ sabha: makeSabhaState({ status: "escalated" }), reason: "Need operator" });
		const escalated = await sabhaEscalate(socket, true, { id: sabha.id, reason: "Need operator" });
		expect(socket.call).toHaveBeenCalledWith("sabha.escalate", { id: sabha.id, reason: "Need operator" });
		expect(escalated?.reason).toBe("Need operator");
	});
});

// ── subscribeNotifications ───────────────────────────────────────────────────

describe("subscribeNotifications", () => {
	it("should return noop unsubscribe when no socket", () => {
		const unsub = subscribeNotifications(null, { onPatternDetected: vi.fn() });
		expect(typeof unsub).toBe("function");
		unsub(); // shouldn't throw
	});

	it("should register handlers for each provided callback", () => {
		const socket = mockSocket();
		const callbacks: NotificationCallbacks = {
			onPatternDetected: vi.fn(),
			onPrediction: vi.fn(),
			onAnomalyAlert: vi.fn(),
			onHealReported: vi.fn(),
			onSabhaConsult: vi.fn(),
			onSabhaUpdated: vi.fn(),
			onSabhaRecorded: vi.fn(),
			onSabhaEscalated: vi.fn(),
		};
		subscribeNotifications(socket, callbacks);
		expect(socket.onNotification).toHaveBeenCalledTimes(8);
		expect(socket.onNotification).toHaveBeenCalledWith("pattern_detected", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("prediction", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("anomaly_alert", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("heal_reported", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("sabha.consult", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("sabha.updated", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("sabha.recorded", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("sabha.escalated", expect.any(Function));
	});

	it("should only register provided callbacks", () => {
		const socket = mockSocket();
		subscribeNotifications(socket, { onPrediction: vi.fn() });
		expect(socket.onNotification).toHaveBeenCalledTimes(1);
		expect(socket.onNotification).toHaveBeenCalledWith("prediction", expect.any(Function));
	});

	it("should call all unsubscribers when unsubscribe is invoked", () => {
		const unsub1 = vi.fn();
		const unsub2 = vi.fn();
		const unsub3 = vi.fn();
		const unsub4 = vi.fn();
		const unsub5 = vi.fn();
		const socket = {
			isConnected: true,
			call: vi.fn(),
			onNotification: vi
				.fn()
				.mockReturnValueOnce(unsub1)
				.mockReturnValueOnce(unsub2)
				.mockReturnValueOnce(unsub3)
				.mockReturnValueOnce(unsub4)
				.mockReturnValueOnce(unsub5),
		} as any;
		const unsubAll = subscribeNotifications(socket, {
			onPatternDetected: vi.fn(),
			onPrediction: vi.fn(),
			onHealReported: vi.fn(),
			onSabhaConsult: vi.fn(),
			onSabhaUpdated: vi.fn(),
		});
		unsubAll();
		expect(unsub1).toHaveBeenCalled();
		expect(unsub2).toHaveBeenCalled();
		expect(unsub3).toHaveBeenCalled();
		expect(unsub4).toHaveBeenCalled();
		expect(unsub5).toHaveBeenCalled();
	});
});

// ── ChitraguptaObserver ──────────────────────────────────────────────────────

describe("ChitraguptaObserver", () => {
	let observer: ChitraguptaObserver;
	let mockBridge: any;

	beforeEach(() => {
		mockBridge = {
			daemonSocket: mockSocket({ accepted: 1 }),
			isSocketMode: true,
		};
		observer = new ChitraguptaObserver(mockBridge);
	});

	it("should delegate observeBatch to bridge socket", async () => {
		const result = await observer.observeBatch([makeToolUsage()]);
		expect(mockBridge.daemonSocket.call).toHaveBeenCalledWith(
			"observe.batch",
			expect.objectContaining({ events: expect.any(Array) }),
		);
		expect(result.accepted).toBe(1);
	});

	it("should delegate predictNext to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({ predictions: [] });
		const result = await observer.predictNext({ sessionId: "s1" });
		expect(result.predictions).toEqual([]);
	});

	it("should delegate patternQuery to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({ patterns: [] });
		const result = await observer.patternQuery();
		expect(result.patterns).toEqual([]);
	});

	it("should delegate healthStatusExtended to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({
			errorRate: 0.01,
			anomalies: [],
			costTrajectory: { currentCost: 2.1, dailyAvg: 1.9, projectedCost: 2.4 },
		});
		const result = await observer.healthStatusExtended();
		expect(result!.errorRate).toBe(0.01);
	});

	it("should delegate healReport to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({ recorded: true });
		const result = await observer.healReport({
			anomalyType: "loop_detected",
			actionTaken: "fix",
			outcome: "success",
			sessionId: "s1",
		});
		expect(result.recorded).toBe(true);
	});

	it("should delegate capabilities query to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({ capabilities: [makeCapability({ id: "cli.codex" })] });
		const result = await observer.capabilities({ capability: "coding.patch-and-validate" });
		expect(result.capabilities[0]?.id).toBe("cli.codex");
	});

	it("should delegate route resolution to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({
			request: { consumer: "takumi", sessionId: "s1", capability: "coding.patch-and-validate" },
			selected: makeCapability({ id: "adapter.takumi.executor" }),
			reason: "Selected adapter.takumi.executor",
			fallbackChain: [],
			policyTrace: ["selected:adapter.takumi.executor"],
			degraded: false,
		});
		const result = await observer.routeResolve({
			consumer: "takumi",
			sessionId: "s1",
			capability: "coding.patch-and-validate",
		});
		expect(result?.selected?.id).toBe("adapter.takumi.executor");
	});

	it("should delegate sabha methods to bridge socket", async () => {
		const sabha = makeSabhaState();
		mockBridge.daemonSocket.call.mockResolvedValueOnce({
			sabha,
			question: sabha.topic,
			targets: [],
			targetClientIds: [],
			notificationsSent: 1,
		});
		const asked = await observer.sabhaAsk({ topic: sabha.topic, convener: "takumi" });
		expect(asked?.sabha.id).toBe(sabha.id);

		mockBridge.daemonSocket.call.mockResolvedValueOnce({ sabha, explanation: "Consensus pending" });
		const gathered = await observer.sabhaGather({ id: sabha.id });
		expect(gathered?.explanation).toBe("Consensus pending");

		mockBridge.daemonSocket.call.mockResolvedValueOnce({ sabha, explanation: null, notificationsSent: 0 });
		const deliberated = await observer.sabhaDeliberate({ id: sabha.id, conclude: true });
		expect(deliberated?.sabha.id).toBe(sabha.id);

		mockBridge.daemonSocket.call.mockResolvedValueOnce({ decision: { id: "decision-1" }, sabha });
		const recorded = await observer.sabhaRecord({ id: sabha.id, sessionId: "s1", project: "/tmp/project" });
		expect(recorded?.decision).toEqual({ id: "decision-1" });

		mockBridge.daemonSocket.call.mockResolvedValueOnce({
			sabha: makeSabhaState({ status: "escalated" }),
			reason: "Need operator",
		});
		const escalated = await observer.sabhaEscalate({ id: sabha.id, reason: "Need operator" });
		expect(escalated?.reason).toBe("Need operator");
	});

	describe("subscribe / teardown", () => {
		it("should subscribe to notifications via socket", () => {
			observer.subscribe({ onAnomalyAlert: vi.fn() });
			expect(mockBridge.daemonSocket.onNotification).toHaveBeenCalledWith("anomaly_alert", expect.any(Function));
		});

		it("should teardown previous subscription on re-subscribe", () => {
			const unsub = vi.fn();
			mockBridge.daemonSocket.onNotification.mockReturnValue(unsub);
			observer.subscribe({ onPrediction: vi.fn() });
			observer.subscribe({ onAnomalyAlert: vi.fn() }); // should teardown first
			expect(unsub).toHaveBeenCalled();
		});

		it("should teardown all subscriptions", () => {
			const unsub = vi.fn();
			mockBridge.daemonSocket.onNotification.mockReturnValue(unsub);
			observer.subscribe({ onPrediction: vi.fn(), onAnomalyAlert: vi.fn() });
			observer.teardown();
			expect(unsub).toHaveBeenCalledTimes(2);
		});
	});
});
