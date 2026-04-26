/**
 * Terminal input parser — the byte-level bridge between raw stdin and the TUI.
 *
 * A single `data` event from Node's stdin can carry *multiple* terminal events
 * when the operator types faster than the event loop drains, or when the kernel
 * TTY buffer flushes after a blocking syscall (clipboard read, child process).
 * The tokenizer splits these chunks into individual events so nothing gets
 * silently dropped.
 *
 * I follow the ECMA-48 §5.4 grammar for control/escape sequences:
 *
 *   CSI  = ESC [ <params 0x30–0x3F>* <intermediates 0x20–0x2F>* <final 0x40–0x7E>
 *   SS3  = ESC O <final byte>
 *   Alt  = ESC <printable>
 *
 * Bare ESC at the end of a buffer is emitted as-is. The ~50 ms ESC timeout
 * required to disambiguate it from the start-of-sequence case (slow SSH) is
 * left to a future enhancement — the trade-off is worth documenting: on very
 * slow links, arrow keys can occasionally misfire as ESC + literal.
 */

import type { KeyEvent, MouseEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

// ── Input tokenizer ─────────────────────────────────────────────────

/**
 * Split raw terminal input into individual event tokens.
 *
 * Each returned string is exactly one of:
 * - CSI sequence (`\x1b[...final`)
 * - SS3 sequence (`\x1bO.`)
 * - Alt+key (`\x1b<char>`)
 * - Control char (0x00–0x1F except ESC, or DEL 0x7F)
 * - Single Unicode codepoint (printable — may span 2 UTF-16 code units)
 * - Bare ESC (`\x1b` alone at end of buffer)
 */
export function tokenizeInput(raw: string): string[] {
	const tokens: string[] = [];
	let i = 0;

	while (i < raw.length) {
		if (raw.charCodeAt(i) === 0x1b) {
			/* ── Escape-initiated sequence ── */
			if (i + 1 >= raw.length) {
				tokens.push("\x1b");
				i++;
				continue;
			}
			const next = raw.charCodeAt(i + 1);

			if (next === 0x5b) {
				/* CSI: ESC [ <param/intermediate bytes> <final byte> */
				let j = i + 2;
				while (j < raw.length && raw.charCodeAt(j) >= 0x20 && raw.charCodeAt(j) <= 0x3f) j++;
				/* Intermediate bytes 0x20–0x2F (rare but spec-legal) */
				while (j < raw.length && raw.charCodeAt(j) >= 0x20 && raw.charCodeAt(j) <= 0x2f) j++;
				if (j < raw.length && raw.charCodeAt(j) >= 0x40 && raw.charCodeAt(j) <= 0x7e) {
					tokens.push(raw.slice(i, j + 1));
					i = j + 1;
				} else {
					/* Incomplete or malformed CSI — emit what I have */
					tokens.push(raw.slice(i, Math.max(j, i + 2)));
					i = Math.max(j, i + 2);
				}
				continue;
			}

			if (next === 0x4f) {
				/* SS3: ESC O <byte> — function keys F1–F4 */
				tokens.push(raw.slice(i, Math.min(i + 3, raw.length)));
				i = Math.min(i + 3, raw.length);
				continue;
			}

			/* Alt+key: ESC followed by one printable character */
			tokens.push(raw.slice(i, i + 2));
			i += 2;
			continue;
		}

		/* Single codepoint — control char or printable (handles surrogates) */
		const cp = raw.codePointAt(i)!;
		const len = cp > 0xffff ? 2 : 1;
		tokens.push(raw.slice(i, i + len));
		i += len;
	}

	return tokens;
}

// ── Mouse parser ────────────────────────────────────────────────────

/** Parse SGR-encoded mouse escape sequences into a MouseEvent. */
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
