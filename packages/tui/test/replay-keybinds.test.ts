import type { KeyEvent, Message } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { describe, expect, it, vi } from "vitest";
import { handleReplayKey, type ReplayKeyContext } from "../src/replay-keybinds.js";
import { AppState } from "../src/state.js";

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function makeMsg(role: "user" | "assistant", text: string): Message {
	return {
		id: `msg-${Math.random().toString(36).slice(2, 8)}`,
		role,
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function makeKeyEvent(overrides?: Partial<KeyEvent>): KeyEvent {
	return {
		key: "",
		ctrl: false,
		alt: false,
		shift: false,
		meta: false,
		raw: "",
		...overrides,
	};
}

function setupReplay(turns: Message[], index = 0, sessionId = "sess-abc") {
	const state = new AppState();
	state.replayMode.value = true;
	state.replayTurns.value = turns;
	state.replayIndex.value = index;
	state.replaySessionId.value = sessionId;
	const addInfoMessage = vi.fn<(text: string) => void>();
	const scheduleRender = vi.fn();
	const ctx: ReplayKeyContext = { state, addInfoMessage, scheduleRender };
	return { state, ctx, addInfoMessage, scheduleRender };
}

/* ── Tests ──────────────────────────────────────────────────────────────────── */

describe("handleReplayKey", () => {
	// ── Navigation: ArrowLeft / h ──────────────────────────────────────────

	describe("previous turn (ArrowLeft / h)", () => {
		it("decrements replayIndex on ArrowLeft", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
			const { state, ctx } = setupReplay(turns, 1);

			const consumed = handleReplayKey(makeKeyEvent({ raw: KEY_CODES.LEFT }), ctx);

			expect(consumed).toBe(true);
			expect(state.replayIndex.value).toBe(0);
		});

		it("decrements replayIndex on h key", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
			const { state, ctx } = setupReplay(turns, 2);

			const consumed = handleReplayKey(makeKeyEvent({ key: "h", raw: "h" }), ctx);

			expect(consumed).toBe(true);
			expect(state.replayIndex.value).toBe(1);
		});

		it("clamps at 0 on ArrowLeft", () => {
			const turns = [makeMsg("user", "A")];
			const { state, ctx } = setupReplay(turns, 0);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.LEFT }), ctx);

			expect(state.replayIndex.value).toBe(0);
		});
	});

	// ── Navigation: ArrowRight / l ─────────────────────────────────────────

	describe("next turn (ArrowRight / l)", () => {
		it("increments replayIndex on ArrowRight", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
			const { state, ctx } = setupReplay(turns, 0);

			const consumed = handleReplayKey(makeKeyEvent({ raw: KEY_CODES.RIGHT }), ctx);

			expect(consumed).toBe(true);
			expect(state.replayIndex.value).toBe(1);
		});

		it("increments replayIndex on l key", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
			const { state, ctx } = setupReplay(turns, 0);

			handleReplayKey(makeKeyEvent({ key: "l", raw: "l" }), ctx);

			expect(state.replayIndex.value).toBe(1);
		});

		it("clamps at last turn on ArrowRight", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
			const { state, ctx } = setupReplay(turns, 1);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.RIGHT }), ctx);

			expect(state.replayIndex.value).toBe(1);
		});
	});

	// ── Jump: Home / g ─────────────────────────────────────────────────────

	describe("jump to first (Home / g)", () => {
		it("sets replayIndex to 0 on Home", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
			const { state, ctx } = setupReplay(turns, 2);

			const consumed = handleReplayKey(makeKeyEvent({ raw: KEY_CODES.HOME }), ctx);

			expect(consumed).toBe(true);
			expect(state.replayIndex.value).toBe(0);
		});

		it("sets replayIndex to 0 on g", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
			const { state, ctx } = setupReplay(turns, 1);

			handleReplayKey(makeKeyEvent({ key: "g", raw: "g" }), ctx);

			expect(state.replayIndex.value).toBe(0);
		});
	});

	// ── Jump: End / G ──────────────────────────────────────────────────────

	describe("jump to last (End / G)", () => {
		it("sets replayIndex to last on End", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
			const { state, ctx } = setupReplay(turns, 0);

			const consumed = handleReplayKey(makeKeyEvent({ raw: KEY_CODES.END }), ctx);

			expect(consumed).toBe(true);
			expect(state.replayIndex.value).toBe(2);
		});

		it("sets replayIndex to last on G (shift+g)", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
			const { state, ctx } = setupReplay(turns, 0);

			handleReplayKey(makeKeyEvent({ key: "G", shift: true, raw: "G" }), ctx);

			expect(state.replayIndex.value).toBe(2);
		});

		it("does nothing for empty turns on End", () => {
			const { state, ctx } = setupReplay([], 0);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.END }), ctx);

			expect(state.replayIndex.value).toBe(0);
		});
	});

	// ── Escape — exit replay mode ──────────────────────────────────────────

	describe("exit replay (Escape)", () => {
		it("resets all replay signals", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
			const { state, ctx } = setupReplay(turns, 1, "sess-xyz");

			const consumed = handleReplayKey(makeKeyEvent({ raw: KEY_CODES.ESCAPE }), ctx);

			expect(consumed).toBe(true);
			expect(state.replayMode.value).toBe(false);
			expect(state.replayIndex.value).toBe(0);
			expect(state.replayTurns.value).toEqual([]);
			expect(state.replaySessionId.value).toBe("");
		});
	});

	// ── Fork (f) ───────────────────────────────────────────────────────────

	describe("fork session (f)", () => {
		it("calls forkSessionAtTurn and returns true", async () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B")];
			const { ctx } = setupReplay(turns, 1, "sess-fork");

			// Mock forkSessionAtTurn — the actual module calls fs, which we don't want
			const { forkSessionAtTurn } = await import("@takumi/bridge");
			vi.spyOn({ forkSessionAtTurn }, "forkSessionAtTurn");

			const consumed = handleReplayKey(makeKeyEvent({ key: "f", raw: "f" }), ctx);

			expect(consumed).toBe(true);
		});

		it("does not trigger on ctrl+f", () => {
			const turns = [makeMsg("user", "A")];
			const { ctx } = setupReplay(turns, 0);

			const consumed = handleReplayKey(makeKeyEvent({ key: "f", ctrl: true, raw: "\x06" }), ctx);

			expect(consumed).toBe(false);
		});

		it("does not trigger on alt+f", () => {
			const turns = [makeMsg("user", "A")];
			const { ctx } = setupReplay(turns, 0);

			const consumed = handleReplayKey(makeKeyEvent({ key: "f", alt: true, raw: "\x1bf" }), ctx);

			expect(consumed).toBe(false);
		});
	});

	// ── Unrecognized keys ──────────────────────────────────────────────────

	describe("unrecognized keys", () => {
		it("returns false for unrecognized key", () => {
			const turns = [makeMsg("user", "A")];
			const { ctx } = setupReplay(turns);

			const consumed = handleReplayKey(makeKeyEvent({ key: "x", raw: "x" }), ctx);

			expect(consumed).toBe(false);
		});

		it("returns false for ctrl+k", () => {
			const turns = [makeMsg("user", "A")];
			const { ctx } = setupReplay(turns);

			const consumed = handleReplayKey(makeKeyEvent({ key: "k", ctrl: true, raw: "\x0b" }), ctx);

			expect(consumed).toBe(false);
		});
	});

	// ── Integration: sequential navigation ─────────────────────────────────

	describe("sequential navigation", () => {
		it("navigates forward then backward through turns", () => {
			const turns = [makeMsg("user", "A"), makeMsg("assistant", "B"), makeMsg("user", "C")];
			const { state, ctx } = setupReplay(turns, 0);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.RIGHT }), ctx);
			expect(state.replayIndex.value).toBe(1);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.RIGHT }), ctx);
			expect(state.replayIndex.value).toBe(2);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.LEFT }), ctx);
			expect(state.replayIndex.value).toBe(1);
		});

		it("jumps to end then back to start", () => {
			const turns = Array.from({ length: 10 }, (_, i) => makeMsg(i % 2 === 0 ? "user" : "assistant", `Turn ${i}`));
			const { state, ctx } = setupReplay(turns, 3);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.END }), ctx);
			expect(state.replayIndex.value).toBe(9);

			handleReplayKey(makeKeyEvent({ raw: KEY_CODES.HOME }), ctx);
			expect(state.replayIndex.value).toBe(0);
		});
	});
});
