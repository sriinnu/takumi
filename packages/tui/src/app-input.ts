import type { KeyEvent, MouseEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

/**
 * Parse SGR-encoded mouse escape sequences into a MouseEvent.
 */
export function parseMouseEvent(raw: string): MouseEvent | null {
	const match = raw.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
	if (!match) return null;

	const code = parseInt(match[1], 10);
	const x = parseInt(match[2], 10) - 1;
	const y = parseInt(match[3], 10) - 1;
	const isRelease = match[4] === "m";

	const shift = (code & 4) !== 0;
	const alt = (code & 8) !== 0;
	const ctrl = (code & 16) !== 0;
	const baseCode = code & ~(4 | 8 | 16);

	if (baseCode === 64 || baseCode === 65) {
		return {
			type: "wheel",
			x,
			y,
			button: 0,
			shift,
			alt,
			ctrl,
			wheelDelta: baseCode === 64 ? 1 : -1,
		};
	}

	if (baseCode >= 32 && baseCode < 64) {
		return {
			type: "mousemove",
			x,
			y,
			button: baseCode - 32,
			shift,
			alt,
			ctrl,
			wheelDelta: 0,
		};
	}

	return {
		type: isRelease ? "mouseup" : "mousedown",
		x,
		y,
		button: baseCode,
		shift,
		alt,
		ctrl,
		wheelDelta: 0,
	};
}

/** Parse raw terminal input into a KeyEvent. */
export function parseKeyEvent(raw: string): KeyEvent {
	// CR (Enter) and Tab are control chars at the byte level, but in UI semantics
	// they should not be decoded as Ctrl+M / Ctrl+I shortcuts.
	if (raw === KEY_CODES.ENTER) {
		return { key: "return", ctrl: false, alt: false, shift: false, meta: false, raw };
	}
	if (raw === KEY_CODES.TAB) {
		return { key: "tab", ctrl: false, alt: false, shift: false, meta: false, raw };
	}

	const ctrl = raw.length === 1 && raw.charCodeAt(0) < 32;
	const alt = raw.startsWith("\x1b") && raw.length === 2;
	const shift = false;

	let key = raw;
	if (ctrl) key = String.fromCharCode(raw.charCodeAt(0) + 96);
	else if (alt) key = raw[1];

	return { key, ctrl, alt, shift, meta: false, raw };
}
