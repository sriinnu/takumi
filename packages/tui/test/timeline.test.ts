import type { Message } from "@takumi/core";
import { Screen } from "@takumi/render";
import { describe, expect, it } from "vitest";
import { TimelinePanel } from "../src/panels/timeline.js";
import { AppState } from "../src/state.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeMsg(role: "user" | "assistant", text: string, id?: string): Message {
	return {
		id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function makeRect(width = 80, height = 20) {
	return { x: 0, y: 0, width, height };
}

function setupReplay(turns: Message[], index = 0, sessionId = "sess-abc") {
	const state = new AppState();
	state.replayMode.value = true;
	state.replayTurns.value = turns;
	state.replayIndex.value = index;
	state.replaySessionId.value = sessionId;
	const panel = new TimelinePanel({ state });
	return { state, panel };
}

/** Read a row of text from the screen (trims trailing spaces). */
function readRow(screen: Screen, row: number): string {
	let text = "";
	for (let col = 0; col < screen.width; col++) {
		text += screen.get(row, col).char;
	}
	return text.trimEnd();
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("TimelinePanel", () => {
	it("does not render when replayMode is false", () => {
		const state = new AppState();
		const panel = new TimelinePanel({ state });
		const screen = new Screen(80, 24);
		panel.render(screen, makeRect());
		// Screen should remain empty (all spaces)
		const row0 = readRow(screen, 0);
		expect(row0).toBe("");
	});

	it("renders header with session ID and turn count", () => {
		const turns = [makeMsg("user", "Hello"), makeMsg("assistant", "Hi there")];
		const { panel } = setupReplay(turns, 0, "sess-xyz");
		const screen = new Screen(80, 24);
		panel.render(screen, makeRect());

		const header = readRow(screen, 0);
		expect(header).toContain("Replay: sess-xyz");
		expect(header).toContain("Turn 1 of 2");
	});

	it("highlights current turn at replayIndex", () => {
		const turns = [makeMsg("user", "Hello"), makeMsg("assistant", "Reply")];
		const { panel } = setupReplay(turns, 1);
		const screen = new Screen(80, 20);
		panel.render(screen, makeRect(80, 20));

		// Current turn (index 1) at row 2 should have inverted colors (bg=15)
		const currentCell = screen.get(2, 0);
		expect(currentCell.bg).toBe(15);
		expect(currentCell.fg).toBe(0);

		// Non-current turn (index 0) at row 1 should have default bg
		const otherCell = screen.get(1, 0);
		expect(otherCell.bg).toBe(-1);
	});

	it("navigates forward with next()", () => {
		const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
		const { state, panel } = setupReplay(turns, 0);

		panel.next();
		expect(state.replayIndex.value).toBe(1);
		panel.next();
		expect(state.replayIndex.value).toBe(2);
	});

	it("navigates backward with prev()", () => {
		const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
		const { state, panel } = setupReplay(turns, 1);

		panel.prev();
		expect(state.replayIndex.value).toBe(0);
	});

	it("clamps next() at last turn", () => {
		const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
		const { state, panel } = setupReplay(turns, 1);

		panel.next();
		expect(state.replayIndex.value).toBe(1);
	});

	it("clamps prev() at zero", () => {
		const turns = [makeMsg("user", "A")];
		const { state, panel } = setupReplay(turns, 0);

		panel.prev();
		expect(state.replayIndex.value).toBe(0);
	});

	it("shows turn content preview truncated to 60 chars", () => {
		const longText = "A".repeat(80);
		const turns = [makeMsg("user", longText)];
		const { panel } = setupReplay(turns);
		const screen = new Screen(100, 20);
		panel.render(screen, makeRect(100, 20));

		const row1 = readRow(screen, 1);
		// Content should be truncated (max 60 chars + "...")
		expect(row1).toContain("...");
		// The original 80-char text should NOT appear in full
		expect(row1).not.toContain(longText);
	});

	it("handles empty turns array", () => {
		const { panel } = setupReplay([], 0, "empty-sess");
		const screen = new Screen(80, 20);
		panel.render(screen, makeRect());

		const header = readRow(screen, 0);
		expect(header).toContain("Turn 1 of 0");
	});

	it("tracks scroll offset for long lists", () => {
		// Create 30 turns — more than a 10-row viewport can show
		const turns = Array.from({ length: 30 }, (_, i) => makeMsg(i % 2 === 0 ? "user" : "assistant", `Turn ${i}`));
		const { state, panel } = setupReplay(turns, 0);
		const screen = new Screen(80, 12); // 12 rows: 1 header + 10 list + 1 footer
		const rect = makeRect(80, 12);

		// Initially scrollOffset should be 0
		panel.render(screen, rect);
		expect(panel.getScrollOffset()).toBe(0);

		// Navigate past the visible viewport
		state.replayIndex.value = 15;
		panel.render(screen, rect);
		// scrollOffset should have adjusted so turn 15 is visible
		expect(panel.getScrollOffset()).toBeGreaterThan(0);
		expect(panel.getScrollOffset()).toBeLessThanOrEqual(15);
	});

	it("shows role icons for user and assistant", () => {
		const turns = [makeMsg("user", "Hello"), makeMsg("assistant", "World")];
		const { panel } = setupReplay(turns);
		const screen = new Screen(80, 20);
		panel.render(screen, makeRect());

		const row1 = readRow(screen, 1);
		const row2 = readRow(screen, 2);
		// user icon 🧑 and assistant icon 🤖
		expect(row1).toContain("\u{1F9D1}");
		expect(row2).toContain("\u{1F916}");
	});

	it("renders footer with keybind hints", () => {
		const turns = [makeMsg("user", "Hello")];
		const { panel } = setupReplay(turns);
		const screen = new Screen(80, 20);
		panel.render(screen, makeRect());

		const footer = readRow(screen, 19);
		expect(footer).toContain("prev");
		expect(footer).toContain("next");
		expect(footer).toContain("fork");
		expect(footer).toContain("Esc exit");
	});

	it("getCurrentTurn() returns the message at replayIndex", () => {
		const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
		const { panel, state } = setupReplay(turns, 0);

		expect(panel.getCurrentTurn()).toBe(turns[0]);
		state.replayIndex.value = 1;
		expect(panel.getCurrentTurn()).toBe(turns[1]);
	});

	it("getCurrentTurn() returns undefined for empty turns", () => {
		const { panel } = setupReplay([]);
		expect(panel.getCurrentTurn()).toBeUndefined();
	});
});
