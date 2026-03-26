import { describe, expect, it, vi } from "vitest";
import { bindAppRenderSignals } from "../src/app-render-signals.js";
import { AppState } from "../src/state.js";

describe("bindAppRenderSignals", () => {
	it("schedules renders for sidebar and operator-surface state changes", () => {
		const state = new AppState();
		const scheduler = { scheduleRender: vi.fn() };
		const disposers = bindAppRenderSignals(state, scheduler);

		scheduler.scheduleRender.mockClear();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
		});

		expect(scheduler.scheduleRender).toHaveBeenCalled();
		for (const dispose of disposers) {
			dispose();
		}
	});

	it("schedules renders for route and sabha state changes", () => {
		const state = new AppState();
		const scheduler = { scheduleRender: vi.fn() };
		const disposers = bindAppRenderSignals(state, scheduler);

		scheduler.scheduleRender.mockClear();
		state.routingDecisions.value = [
			{
				request: { capability: "coding" },
				selected: null,
				fallbackChain: [],
				policyTrace: [],
				reason: "fallback",
				degraded: false,
			},
		] as never;
		state.lastSabhaId.value = "sabha-1";

		expect(scheduler.scheduleRender).toHaveBeenCalled();
		for (const dispose of disposers) {
			dispose();
		}
	});
});
