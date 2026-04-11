import { type RoutingDecision, TAKUMI_CAPABILITY } from "@takumi/bridge";
import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { buildOperatorBoardLines, OperatorBoardPanel } from "../src/panels/operator-board.js";
import { SidebarPanel } from "../src/panels/sidebar.js";
import { AppState } from "../src/state.js";

function readRow(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		text += screen.get(row, col).char;
	}
	return text.trimEnd();
}

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
	return {
		request: {
			consumer: "takumi",
			sessionId: "canon-1",
			capability: "coding.patch-cheap",
		},
		selected: TAKUMI_CAPABILITY,
		reason: "Selected adapter.takumi.executor",
		fallbackChain: ["cli.codex"],
		policyTrace: ["requested:coding.patch-cheap", "selected:adapter.takumi.executor"],
		degraded: false,
		...overrides,
	};
}

describe("buildOperatorBoardLines", () => {
	it("renders the highest-signal operator rows in priority order", () => {
		const state = new AppState();
		state.routingDecisions.value = [makeDecision({ degraded: true, reason: "provider degraded" })];
		state.canonicalSessionId.value = "canon-1";
		state.chitraguptaSync.value = {
			status: "failed",
			lastSyncedMessageId: "assistant-1",
			lastFailedMessageId: "user-2",
			lastError: "bridge unavailable",
		};
		state.artifactPromotion.value = {
			status: "pending",
			pendingArtifactIds: ["artifact-1", "artifact-2"],
			importedArtifactIds: ["artifact-0"],
		};
		state.pendingPermission.value = {
			tool: "write_file",
			args: { filePath: "README.md" },
			approvalId: "approval-1",
			resolve: () => undefined,
		};
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			title: "Independent planning lane",
			state: "running",
			tmuxWindow: "agent-side-1",
			responseSummary: "Alt plan ready",
		});

		const lines = buildOperatorBoardLines(state);

		expect(lines[0]?.text).toContain("route degraded");
		expect(lines[0]?.text).toContain("sync stalled");
		expect(lines[0]?.text).toContain("artifact review");
		expect(lines[1]?.text).toContain("route");
		expect(lines[2]?.text).toContain("sync");
		expect(lines[3]?.text).toContain("review");
		expect(lines.some((line) => line.text.includes("approval write_file"))).toBe(true);
		expect(lines.some((line) => line.text.includes("side ● /co-plan"))).toBe(true);
		expect(lines.some((line) => line.text.includes("open /route"))).toBe(true);
		expect(lines.some((line) => line.text.includes("/artifacts"))).toBe(true);
		expect(lines.some((line) => line.text.includes("/approvals"))).toBe(true);
		expect(lines.some((line) => line.text.includes("/lanes"))).toBe(true);
	});

	it("stays hidden when there is no operator work to show", () => {
		const state = new AppState();
		expect(buildOperatorBoardLines(state)).toEqual([]);
	});
});

describe("OperatorBoardPanel", () => {
	it("renders a compact cockpit with route, sync, review, and side-lane rows", () => {
		const state = new AppState();
		state.routingDecisions.value = [makeDecision()];
		state.canonicalSessionId.value = "canon-1";
		state.chitraguptaSync.value = {
			status: "ready",
			lastSyncedMessageId: "assistant-1",
			lastSyncedAt: 123,
		};
		state.artifactPromotion.value = {
			status: "ready",
			pendingArtifactIds: [],
			importedArtifactIds: ["artifact-1"],
		};
		state.sideLanes.upsert({
			id: "side-1",
			commandName: "/co-plan",
			state: "running",
			tmuxWindow: "agent-side-1",
			responseSummary: "Alt plan ready",
		});

		const panel = new OperatorBoardPanel({ state });
		const screen = new Screen(80, 12);
		panel.render(screen, { x: 0, y: 0, width: 80, height: 12 });

		expect(panel.height).toBeGreaterThan(1);
		expect(readRow(screen, 0)).toContain("OPERATOR BOARD");
		expect(readRow(screen, 2)).toContain("route");
		expect(readRow(screen, 3)).toContain("sync");
		expect(readRow(screen, 4)).toContain("review");
		expect(readRow(screen, 6)).toContain("side");
		expect(Array.from({ length: 12 }, (_value, row) => readRow(screen, row)).join("\n")).toContain("open /route");
	});

	it("replaces the fragmented route widgets inside the sidebar", () => {
		const state = new AppState();
		state.sidebarVisible.value = true;
		state.routingDecisions.value = [makeDecision({ degraded: true })];
		state.artifactPromotion.value = {
			status: "pending",
			pendingArtifactIds: ["artifact-1"],
			importedArtifactIds: [],
		};

		const panel = new SidebarPanel({ state, width: 36 });
		const screen = new Screen(120, 24);
		panel.render(screen, { x: 0, y: 0, width: 36, height: 24 });

		const rows = Array.from({ length: 24 }, (_, row) => readRow(screen, row)).join("\n");
		expect(rows).toContain("OPERATOR BOARD");
		expect(rows).not.toContain("ROUTE\n");
		expect(rows).not.toContain("LANES\n");
		expect(rows).not.toContain("SIDE LANES\n");
	});
});
