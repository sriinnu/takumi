/**
 * Event-based stdin buffer — stateful ECMA-48 §5.4 parser that handles SSH
 * split reads, CSI/OSC/DCS sequences across chunk boundaries, and a
 * configurable ESC timeout for disambiguating bare ESC from escape starts.
 *
 * States: GROUND → ESC → CSI | SS3 | OSC | DCS
 *
 * Cross-chunk safe: partial sequences survive between `push()` calls.
 * Bracketed paste (DEC 2004) content spanning chunks is accumulated and
 * emitted as a single `'paste'` event on the closing delimiter.
 */

import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const DEFAULT_ESC_TIMEOUT_MS = 50;

/** Max bytes for an escape sequence buffer before forced flush. */
const MAX_SEQ_LENGTH = 4096;
/** Max bytes for a bracketed paste before forced flush. */
const MAX_PASTE_LENGTH = 1024 * 1024; // 1 MB

/** Configuration accepted by the StdinBuffer constructor. */
export interface StdinBufferOptions {
	/** Milliseconds to wait for a follow-up byte after a bare ESC. Default 50. */
	escTimeout?: number;
	/** Max accumulated escape sequence length before forced flush. Default 4096. */
	maxSeqLength?: number;
	/** Max accumulated paste content length before forced flush. Default 1 MB. */
	maxPasteLength?: number;
}

/** A single tokenised terminal input event. */
export type StdinTokenEvent = { type: "token"; value: string };

/** Accumulated bracketed-paste content. */
export type StdinPasteEvent = { type: "paste"; content: string };

/** Typed event map for StdinBuffer. */
export interface StdinBufferEvents {
	token: [value: string];
	paste: [content: string];
	"paste-start": [];
	"paste-end": [];
}

/** Union of events the buffer can produce. */
export type StdinEvent = StdinTokenEvent | StdinPasteEvent;

enum State {
	GROUND = 0,
	ESC = 1,
	CSI = 2,
	SS3 = 3,
	OSC = 4,
	DCS = 5,
}

/**
 * I accept raw `Buffer` chunks from stdin, reassemble UTF-8 via StringDecoder,
 * run them through an ECMA-48 state machine, and emit `'token'` / `'paste'` /
 * `'paste-start'` / `'paste-end'` events.
 */
export class StdinBuffer extends EventEmitter {
	private readonly escTimeout: number;
	private readonly maxSeqLength: number;
	private readonly maxPasteLength: number;
	private readonly decoder = new StringDecoder("utf8");
	private state: State = State.GROUND;
	private seqBuf = "";
	private escTimer: ReturnType<typeof setTimeout> | null = null;
	private inPaste = false;
	private pasteBuf = "";
	/** Set when ESC arrives at the end of a chunk in OSC/DCS state. */
	private pendingST = false;

	constructor(options?: StdinBufferOptions) {
		super();
		this.escTimeout = options?.escTimeout ?? DEFAULT_ESC_TIMEOUT_MS;
		this.maxSeqLength = options?.maxSeqLength ?? MAX_SEQ_LENGTH;
		this.maxPasteLength = options?.maxPasteLength ?? MAX_PASTE_LENGTH;
	}

	/** I accept a raw stdin chunk, decode UTF-8, and drive the state machine. */
	push(chunk: Buffer): void {
		const str = this.decoder.write(chunk);
		if (str.length > 0) this.feed(str);
	}

	/** I tear down timers and reset state. Safe to call more than once. */
	destroy(): void {
		this.clearEscTimer();
		this.state = State.GROUND;
		this.seqBuf = "";
		this.inPaste = false;
		this.pasteBuf = "";
		this.pendingST = false;
		this.removeAllListeners();
	}

	/** I feed decoded characters into the state machine one at a time. */
	private feed(chars: string): void {
		let i = 0;
		while (i < chars.length) {
			const ch = chars[i];
			const code = chars.charCodeAt(i);

			switch (this.state) {
				case State.GROUND:
					i = this.handleGround(chars, i, ch, code);
					break;
				case State.ESC:
					i = this.handleEsc(chars, i, ch, code);
					break;
				case State.CSI:
					i = this.handleCsi(chars, i, ch, code);
					break;
				case State.SS3:
					i = this.handleSs3(chars, i, ch);
					break;
				case State.OSC:
					i = this.handleOsc(chars, i, ch, code);
					break;
				case State.DCS:
					i = this.handleDcs(chars, i, ch, code);
					break;
			}
		}
	}

	private handleGround(chars: string, i: number, _ch: string, code: number): number {
		if (code === 0x1b) {
			this.seqBuf = "\x1b";
			this.state = State.ESC;
			this.startEscTimer();
			return i + 1;
		}
		const cp = chars.codePointAt(i)!;
		const len = cp > 0xffff ? 2 : 1;
		this.emitToken(chars.slice(i, i + len));
		return i + len;
	}

	private handleEsc(_chars: string, i: number, ch: string, code: number): number {
		this.clearEscTimer();
		if (code === 0x5b) {
			this.seqBuf += "[";
			this.state = State.CSI;
			return i + 1;
		}
		if (code === 0x4f) {
			this.seqBuf += "O";
			this.state = State.SS3;
			return i + 1;
		}
		if (code === 0x5d) {
			this.seqBuf += "]";
			this.state = State.OSC;
			return i + 1;
		}
		if (code === 0x50) {
			this.seqBuf += "P";
			this.state = State.DCS;
			return i + 1;
		}
		// Alt+key: ESC followed by a printable character
		this.emitToken(this.seqBuf + ch);
		this.resetToGround();
		return i + 1;
	}

	/** CSI — accumulate param/intermediate bytes, wait for final byte 0x40–0x7E. */
	private handleCsi(_chars: string, i: number, ch: string, code: number): number {
		this.seqBuf += ch;
		if (this.seqBuf.length > this.maxSeqLength) {
			// Sequence too long — flush and reset to prevent unbounded growth.
			this.emitToken(this.seqBuf);
			this.resetToGround();
			return i + 1;
		}
		if (code >= 0x20 && code <= 0x3f) return i + 1; // param or intermediate
		if (code >= 0x40 && code <= 0x7e) {
			this.flushCsiSequence();
			return i + 1;
		}
		// Unexpected byte — flush accumulated sequence as-is
		this.emitToken(this.seqBuf);
		this.resetToGround();
		return i + 1;
	}

	private handleSs3(_chars: string, i: number, ch: string): number {
		this.seqBuf += ch;
		this.emitToken(this.seqBuf);
		this.resetToGround();
		return i + 1;
	}

	/** OSC / DCS share termination logic — BEL (0x07) or ESC \. */
	private handleOsc(chars: string, i: number, ch: string, code: number): number {
		return this.accumulateUntilST(chars, i, ch, code);
	}

	private handleDcs(chars: string, i: number, ch: string, code: number): number {
		return this.accumulateUntilST(chars, i, ch, code);
	}

	/** I accumulate bytes until String Terminator (BEL 0x07 or ESC \). */
	private accumulateUntilST(chars: string, i: number, ch: string, code: number): number {
		// Cross-chunk ESC \ fix: if previous chunk ended with ESC in OSC/DCS,
		// check if this chunk starts with \ to complete the ST.
		if (this.pendingST) {
			this.pendingST = false;
			if (code === 0x5c) {
				this.seqBuf += "\x1b\\";
				this.emitToken(this.seqBuf);
				this.resetToGround();
				return i + 1;
			}
			// Not \, the ESC was part of the data — accumulate it.
			this.seqBuf += "\x1b";
		}

		if (code === 0x07) {
			this.seqBuf += ch;
			this.emitToken(this.seqBuf);
			this.resetToGround();
			return i + 1;
		}
		if (code === 0x1b) {
			if (i + 1 < chars.length) {
				if (chars.charCodeAt(i + 1) === 0x5c) {
					this.seqBuf += "\x1b\\";
					this.emitToken(this.seqBuf);
					this.resetToGround();
					return i + 2;
				}
				// ESC followed by non-\, just accumulate
				this.seqBuf += ch;
				return i + 1;
			}
			// ESC at end of chunk — defer until next push()
			this.pendingST = true;
			return i + 1;
		}

		// Enforce maximum sequence length to prevent unbounded growth.
		if (this.seqBuf.length > this.maxSeqLength) {
			this.emitToken(this.seqBuf);
			this.resetToGround();
			return i + 1;
		}

		this.seqBuf += ch;
		return i + 1;
	}

	/** I check completed CSI sequences for bracketed paste delimiters. */
	private flushCsiSequence(): void {
		const seq = this.seqBuf;
		this.resetToGround();

		if (seq === PASTE_START) {
			this.inPaste = true;
			this.pasteBuf = "";
			this.emit("paste-start");
			return;
		}
		if (seq === PASTE_END) {
			const content = this.pasteBuf;
			this.inPaste = false;
			this.pasteBuf = "";
			this.emit("paste-end");
			this.emit("paste", content);
			return;
		}
		this.emitToken(seq);
	}

	/** I route a completed token through paste accumulation or direct emit. */
	private emitToken(value: string): void {
		if (this.inPaste) {
			this.pasteBuf += value;
			// Cap paste buffer to prevent unbounded growth from missing PASTE_END.
			if (this.pasteBuf.length > this.maxPasteLength) {
				const content = this.pasteBuf;
				this.inPaste = false;
				this.pasteBuf = "";
				this.emit("paste-end");
				this.emit("paste", content);
			}
			return;
		}
		this.emit("token", value);
	}

	/** I start the timeout that flushes a bare ESC if no follow-up byte arrives. */
	private startEscTimer(): void {
		this.clearEscTimer();
		this.escTimer = setTimeout(() => {
			this.escTimer = null;
			if (this.state === State.ESC) {
				this.emitToken(this.seqBuf);
				this.resetToGround();
			}
		}, this.escTimeout);
	}

	private clearEscTimer(): void {
		if (this.escTimer !== null) {
			clearTimeout(this.escTimer);
			this.escTimer = null;
		}
	}

	private resetToGround(): void {
		this.state = State.GROUND;
		this.seqBuf = "";
	}
}
