/**
 * Tests for chitragupta-observe ops and ChitraguptaObserver — Phases 49-51.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	healReport,
	healthStatusExtended,
	type NotificationCallbacks,
	observeBatch,
	patternQuery,
	predictNext,
	subscribeNotifications,
} from "../src/chitragupta-observe.js";
import { ChitraguptaObserver } from "../src/chitragupta-observer.js";
import type { ObservationEvent, ToolUsageEvent } from "../src/observation-types.js";

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
			costTrajectory: "stable",
		});
		const result = await healthStatusExtended(socket, true);
		expect(result).not.toBeNull();
		expect(result!.errorRate).toBe(0.02);
		expect(result!.costTrajectory).toBe("stable");
	});
});

// ── healReport ───────────────────────────────────────────────────────────────

describe("healReport", () => {
	it("should return { recorded: false } when not connected", async () => {
		const result = await healReport(null, false, { action: "retry", outcome: "success", sessionId: "s1" });
		expect(result.recorded).toBe(false);
	});

	it("should call socket and return result", async () => {
		const socket = mockSocket({ recorded: true });
		const result = await healReport(socket, true, { action: "retry", outcome: "success", sessionId: "s1" });
		expect(socket.call).toHaveBeenCalledWith("heal.report", {
			action: "retry",
			outcome: "success",
			sessionId: "s1",
		});
		expect(result.recorded).toBe(true);
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
		};
		subscribeNotifications(socket, callbacks);
		expect(socket.onNotification).toHaveBeenCalledTimes(3);
		expect(socket.onNotification).toHaveBeenCalledWith("pattern_detected", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("prediction", expect.any(Function));
		expect(socket.onNotification).toHaveBeenCalledWith("anomaly_alert", expect.any(Function));
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
		const socket = {
			isConnected: true,
			call: vi.fn(),
			onNotification: vi.fn().mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2),
		} as any;
		const unsubAll = subscribeNotifications(socket, {
			onPatternDetected: vi.fn(),
			onPrediction: vi.fn(),
		});
		unsubAll();
		expect(unsub1).toHaveBeenCalled();
		expect(unsub2).toHaveBeenCalled();
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
		mockBridge.daemonSocket.call.mockResolvedValue({ errorRate: 0.01, anomalies: [], costTrajectory: "declining" });
		const result = await observer.healthStatusExtended();
		expect(result!.errorRate).toBe(0.01);
	});

	it("should delegate healReport to bridge socket", async () => {
		mockBridge.daemonSocket.call.mockResolvedValue({ recorded: true });
		const result = await observer.healReport({ action: "fix", outcome: "pass", sessionId: "s1" });
		expect(result.recorded).toBe(true);
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
