import {
	AlertEngine,
	createAlert,
	DEFAULT_ALERT_THRESHOLDS,
	type ObservabilitySessionSummary,
	resetAlertCounter,
} from "@takumi/core";
import { beforeEach, describe, expect, it } from "vitest";

function makeSession(overrides: Partial<ObservabilitySessionSummary> = {}): ObservabilitySessionSummary {
	return {
		sessionId: "sess-1",
		activity: "working",
		model: "claude-sonnet",
		provider: "anthropic",
		costUsd: 0.05,
		contextPercent: 40,
		pressure: "normal",
		toolFailures: 0,
		lastHeartbeatAt: Date.now(),
		degraded: false,
		turnCount: 5,
		...overrides,
	};
}

describe("observability-types", () => {
	beforeEach(() => resetAlertCounter());

	it("createAlert produces valid alert", () => {
		const alert = createAlert({
			kind: "context_pressure",
			severity: "warning",
			message: "Context at 85%",
			source: "sess-1",
		});
		expect(alert.id).toMatch(/^alert-/);
		expect(alert.kind).toBe("context_pressure");
		expect(alert.acknowledged).toBe(false);
	});
});

describe("AlertEngine", () => {
	let engine: AlertEngine;

	beforeEach(() => {
		resetAlertCounter();
		engine = new AlertEngine();
	});

	describe("evaluateSession", () => {
		it("fires no alerts for healthy session", () => {
			const session = makeSession({ contextPercent: 40, toolFailures: 0 });
			const alerts = engine.evaluateSession(session);
			expect(alerts).toHaveLength(0);
		});

		it("fires warning for context at warning threshold", () => {
			const session = makeSession({
				contextPercent: DEFAULT_ALERT_THRESHOLDS.contextWarningPercent,
			});
			const alerts = engine.evaluateSession(session);
			expect(alerts).toHaveLength(1);
			expect(alerts[0].severity).toBe("warning");
			expect(alerts[0].kind).toBe("context_pressure");
		});

		it("fires critical for context at critical threshold", () => {
			const session = makeSession({
				contextPercent: DEFAULT_ALERT_THRESHOLDS.contextCriticalPercent,
			});
			const alerts = engine.evaluateSession(session);
			expect(alerts).toHaveLength(1);
			expect(alerts[0].severity).toBe("critical");
		});

		it("fires repeated_failure alert", () => {
			const session = makeSession({
				toolFailures: DEFAULT_ALERT_THRESHOLDS.repeatFailureCount,
			});
			const alerts = engine.evaluateSession(session);
			expect(alerts.some((a) => a.kind === "repeated_failure")).toBe(true);
		});

		it("fires degraded_routing alert", () => {
			const session = makeSession({
				degraded: true,
				fallbackChain: ["claude-opus", "claude-sonnet"],
			});
			const alerts = engine.evaluateSession(session);
			expect(alerts.some((a) => a.kind === "degraded_routing")).toBe(true);
		});
	});

	describe("evaluateStaleness", () => {
		it("fires stale_agent for old heartbeat", () => {
			const staleMs = DEFAULT_ALERT_THRESHOLDS.staleAgentSec * 1000;
			const session = makeSession({
				lastHeartbeatAt: Date.now() - staleMs - 1000,
				activity: "working",
			});
			const alerts = engine.evaluateStaleness([session]);
			expect(alerts).toHaveLength(1);
			expect(alerts[0].kind).toBe("stale_agent");
		});

		it("does not fire for idle agents", () => {
			const staleMs = DEFAULT_ALERT_THRESHOLDS.staleAgentSec * 1000;
			const session = makeSession({
				lastHeartbeatAt: Date.now() - staleMs - 1000,
				activity: "idle",
			});
			const alerts = engine.evaluateStaleness([session]);
			expect(alerts).toHaveLength(0);
		});
	});

	describe("acknowledge", () => {
		it("acknowledges an alert", () => {
			const session = makeSession({ contextPercent: 95 });
			const alerts = engine.evaluateSession(session);
			expect(engine.activeAlerts()).toHaveLength(1);

			engine.acknowledge(alerts[0].id);
			expect(engine.activeAlerts()).toHaveLength(0);
			expect(engine.allAlerts()).toHaveLength(1);
		});

		it("returns false for unknown alert", () => {
			expect(engine.acknowledge("nonexistent")).toBe(false);
		});
	});

	describe("buildFleetSummary", () => {
		it("produces correct fleet summary", () => {
			const sessions = [
				makeSession({ sessionId: "s1", activity: "working", costUsd: 0.1 }),
				makeSession({ sessionId: "s2", activity: "idle", costUsd: 0.05 }),
				makeSession({ sessionId: "s3", activity: "error", costUsd: 0.02 }),
			];

			// Fire an alert to populate counts
			engine.evaluateSession(makeSession({ contextPercent: 95 }));

			const summary = engine.buildFleetSummary(sessions);
			expect(summary.totalAgents).toBe(3);
			expect(summary.workingAgents).toBe(1);
			expect(summary.idleAgents).toBe(1);
			expect(summary.errorAgents).toBe(1);
			expect(summary.totalCostUsd).toBeCloseTo(0.17);
			expect(summary.activeAlerts.length).toBeGreaterThan(0);
		});
	});

	describe("degradedRuns", () => {
		it("records and retrieves degraded runs", () => {
			engine.recordDegradedRun({
				sessionId: "s1",
				runId: "run-1",
				reason: "rate_limited",
				fallbackChain: ["claude-opus", "claude-sonnet"],
				succeeded: true,
				durationMs: 5000,
				occurredAt: Date.now(),
			});

			const runs = engine.getDegradedRuns();
			expect(runs).toHaveLength(1);
			expect(runs[0].reason).toBe("rate_limited");
		});
	});
});
