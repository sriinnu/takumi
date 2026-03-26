import { describe, expect, it } from "vitest";
import { ExtensionUiStore } from "../src/extension-ui-store.js";
import {
	buildAgentStateSnapshot,
	buildFleetSummary,
	buildOperatorAlerts,
	buildSessionSummary,
} from "../src/http-bridge-runtime.js";
import { AppState } from "../src/state.js";

function createState(): AppState {
	const state = new AppState();
	state.sessionId.value = "session-build-window";
	state.provider.value = "anthropic";
	state.model.value = "claude-sonnet-4-20250514";
	state.totalCost.value = 0.12;
	state.turnCount.value = 7;
	state.contextPercent.value = 88;
	state.contextPressure.value = "near_limit";
	state.chitraguptaConnected.value = true;
	state.routingDecisions.value = [
		{
			request: { consumer: "takumi", sessionId: "session-build-window", capability: "coding.patch-cheap" },
			selected: { id: "lane-main", providerFamily: "anthropic" } as never,
			reason: "Selected primary lane",
			fallbackChain: ["lane-fallback"],
			policyTrace: ["selected primary lane"],
			degraded: false,
		},
	] as never;
	return state;
}

describe("http-bridge-runtime helpers", () => {
	it("buildAgentStateSnapshot includes routing and approval metadata", () => {
		const state = createState();
		const extensionUiStore = new ExtensionUiStore();
		state.pendingPermission.value = {
			tool: "write_file",
			args: { filePath: "README.md" },
			resolve: () => undefined,
		};
		void extensionUiStore.requestPick(
			[
				{ label: "Alpha", value: "a" },
				{ label: "Beta", value: "b" },
			],
			"Select task",
		);
		extensionUiStore.setWidget("status", () => ["ready", "steady"]);

		const snapshot = buildAgentStateSnapshot(state, extensionUiStore);
		expect(snapshot.bridgeConnected).toBe(true);
		expect(snapshot.contextPressure).toBe("near_limit");
		expect(snapshot.routing).toMatchObject({
			capability: "coding.patch-cheap",
			authority: "engine",
			enforcement: "same-provider",
			laneCount: 1,
		});
		expect(snapshot.approval).toMatchObject({
			pendingCount: 1,
			tool: "write_file",
		});
		expect(snapshot.extensionUi).toMatchObject({
			prompt: {
				kind: "pick",
				title: "Select task",
				optionCount: 2,
				options: [
					{ index: 0, label: "Alpha" },
					{ index: 1, label: "Beta" },
				],
			},
			widgets: [{ key: "status", previewLines: ["ready", "steady"], truncated: false }],
		});
	});

	it("buildSessionSummary maps state to observability summary", () => {
		const state = createState();
		const summary = buildSessionSummary(state);
		expect(summary.sessionId).toBe("session-build-window");
		expect(summary.contextPercent).toBe(88);
		expect(summary.pressure).toBe("near_limit");
		expect(summary.provider).toBe("anthropic");
		expect(summary.costUsd).toBe(0.12);
	});

	it("buildOperatorAlerts emits approval, context, and anomaly alerts", () => {
		const state = createState();
		state.pendingPermission.value = {
			tool: "shell",
			args: { command: "rm -rf /tmp/test" },
			resolve: () => undefined,
		};
		state.chitraguptaAnomaly.value = {
			severity: "critical",
			details: "Repeated tool failures detected",
			suggestion: "Review recent commands",
			at: Date.now(),
		};

		const alerts = buildOperatorAlerts(state);
		expect(alerts.some((alert) => alert.kind === "approval_pressure")).toBe(true);
		expect(alerts.some((alert) => alert.kind === "context_pressure")).toBe(true);
		expect(alerts.some((alert) => alert.source === "session-build-window")).toBe(true);
	});

	it("buildFleetSummary aggregates active session state", () => {
		const state = createState();
		const fleet = buildFleetSummary(state);
		expect(fleet.totalAgents).toBe(1);
		expect(fleet.totalCostUsd).toBeCloseTo(0.12);
		expect(fleet.sessions).toHaveLength(1);
		expect(fleet.sessions[0]?.sessionId).toBe("session-build-window");
	});
});
