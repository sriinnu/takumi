import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { SideLanesPanel } from "../src/panels/side-lanes-panel.js";
import { formatSideLaneDigest, SideLaneStore } from "../src/side-lane-store.js";
import { AppState } from "../src/state.js";

function readRow(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		text += screen.get(row, col).char;
	}
	return text.trimEnd();
}

describe("SideLaneStore", () => {
	it("merges successive updates and keeps the newest lane first", () => {
		const store = new SideLaneStore();

		store.upsert({
			id: "side-1",
			commandName: "/co-plan",
			title: "Independent planning lane",
			state: "running",
			tmuxWindow: "agent-side-1",
			updatedAt: 10,
		});
		store.upsert({
			id: "side-2",
			commandName: "/question-chain",
			title: "Risk lane",
			state: "starting",
			tmuxWindow: "agent-side-2",
			updatedAt: 20,
		});
		store.upsert({
			id: "side-1",
			responseSummary: "Alt plan",
			recentOutput: "planning",
			updatedAt: 30,
		});

		expect(store.list().map((lane) => lane.id)).toEqual(["side-1", "side-2"]);
		expect(store.list()[0]).toMatchObject({
			commandName: "/co-plan",
			tmuxWindow: "agent-side-1",
			state: "running",
			responseSummary: "Alt plan",
			recentOutput: "planning",
		});
	});

	it("formats a compact digest for prompt context", () => {
		const store = new SideLaneStore();
		store.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
		});

		expect(formatSideLaneDigest(store.list()[0]!)).toBe("/co-plan:running@agent-side-1");
	});
});

describe("SideLanesPanel", () => {
	it("renders the tracked lane with a visible focus target", () => {
		const state = new AppState();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			title: "Independent planning lane",
			state: "running",
			tmuxWindow: "agent-side-1",
			responseSummary: "Alt plan",
		});

		const panel = new SideLanesPanel({ state });
		const screen = new Screen(40, 8);
		panel.render(screen, { x: 0, y: 0, width: 40, height: 8 });

		expect(panel.height).toBe(3);
		expect(readRow(screen, 0)).toContain("SIDE LANES");
		expect(readRow(screen, 1)).toContain("/co-plan");
		expect(readRow(screen, 2)).toContain("agent-side-1");
		expect(readRow(screen, 2)).toContain("Alt plan");
	});

	it("is cleared when app state resets", () => {
		const state = new AppState();
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
		});

		state.reset();

		expect(state.sideLanes.list()).toEqual([]);
	});
});
