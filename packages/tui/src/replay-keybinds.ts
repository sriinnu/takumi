/**
 * Replay-mode keybind handler for Phase 19 (Session Recovery & Replay).
 *
 * Active only when `state.replayMode` is true.
 * Keys:
 *   ArrowLeft / h   — previous turn
 *   ArrowRight / l  — next turn
 *   Home / g        — jump to first turn
 *   End / G         — jump to last turn
 *   f               — fork session at current turn
 *   Escape          — exit replay mode
 */

import { forkSessionAtTurn } from "@takumi/bridge";
import type { KeyEvent } from "@takumi/core";
import { createLogger, KEY_CODES } from "@takumi/core";
import type { AppState } from "./state.js";

const log = createLogger("replay-keybinds");

export interface ReplayKeyContext {
	state: AppState;
	addInfoMessage: (text: string) => void;
	scheduleRender: () => void;
}

/**
 * Handle a key event when replay mode is active.
 * Returns `true` if the key was consumed (caller should stop propagation).
 */
export function handleReplayKey(event: KeyEvent, ctx: ReplayKeyContext): boolean {
	const raw = event.raw;
	const { state } = ctx;
	const turns = state.replayTurns.value;
	const current = state.replayIndex.value;

	// ArrowLeft or h — previous turn
	if (raw === KEY_CODES.LEFT || event.key === "h") {
		if (current > 0) state.replayIndex.value = current - 1;
		return true;
	}

	// ArrowRight or l — next turn
	if (raw === KEY_CODES.RIGHT || event.key === "l") {
		if (current < turns.length - 1) state.replayIndex.value = current + 1;
		return true;
	}

	// Home or g — jump to first turn
	if (raw === KEY_CODES.HOME || (event.key === "g" && !event.shift)) {
		state.replayIndex.value = 0;
		return true;
	}

	// End or G (shift+g) — jump to last turn
	if (raw === KEY_CODES.END || event.key === "G") {
		if (turns.length > 0) state.replayIndex.value = turns.length - 1;
		return true;
	}

	// f — fork session at current turn
	if (event.key === "f" && !event.ctrl && !event.alt) {
		const sessionId = state.replaySessionId.value;
		void forkSessionAtTurn(sessionId, current).then((newId) => {
			if (newId) {
				ctx.addInfoMessage(`Forked session: ${newId}`);
				log.info(`Forked session ${sessionId} at turn ${current} → ${newId}`);
			} else {
				ctx.addInfoMessage("Fork failed — session or turn index not found.");
				log.warn(`Fork failed for session ${sessionId} at turn ${current}`);
			}
			ctx.scheduleRender();
		});
		return true;
	}

	// Escape — exit replay mode
	if (raw === KEY_CODES.ESCAPE) {
		state.replayMode.value = false;
		state.replayIndex.value = 0;
		state.replayTurns.value = [];
		state.replaySessionId.value = "";
		return true;
	}

	return false;
}
