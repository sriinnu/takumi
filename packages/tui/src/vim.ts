/**
 * vim.ts — Lightweight single-line Vi modal input for EditorPanel.
 *
 * Modes: INSERT (default) and NORMAL.
 * In INSERT mode only Escape is intercepted; all other keys passthrough.
 * In NORMAL mode keys produce EditorOp commands consumed by EditorPanel.
 *
 * Supported NORMAL commands:
 *   Movement : h l 0 ^ $ w b G gg
 *   Insert   : i a A I
 *   Delete   : x dd dw
 *   Submit   : Enter
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type VimModeType = "INSERT" | "NORMAL";

/**
 * Structured operation the EditorPanel applies after processVimKey().
 * `passthrough` means let the underlying InputComponent handle the raw key.
 */
export type EditorOp =
	| { op: "noop" }
	| { op: "passthrough" }
	| { op: "setMode"; mode: VimModeType }
	| { op: "setCursor"; col: number }
	| { op: "setText"; text: string; cursor: number }
	| { op: "submit" };

// ── VimMode state machine ─────────────────────────────────────────────────────

export class VimMode {
	mode: VimModeType = "INSERT";

	/** Cursor column tracked independently from InputComponent. */
	cursor = 0;

	/** Accumulated prefix for multi-key sequences (e.g. "d" before "d"/"w"). */
	private pending = "";

	/** Reset to initial INSERT state (called on /clear or after submit). */
	reset(): void {
		this.mode = "INSERT";
		this.cursor = 0;
		this.pending = "";
	}

	/** Sync cursor to a known column from outside (after external setValue). */
	sync(col: number): void {
		this.cursor = col;
		this.pending = "";
	}

	/**
	 * Process a raw terminal key sequence given the current editor value.
	 * Returns the EditorOp the panel should execute.
	 */
	process(raw: string, value: string): EditorOp {
		// ── INSERT mode: only intercept Escape ───────────────────────────────
		if (this.mode === "INSERT") {
			if (raw === "\x1b") {
				this.mode = "NORMAL";
				// Clamp so cursor is never past the last character
				this.cursor = Math.max(0, Math.min(this.cursor, value.length - 1));
				this.pending = "";
				return { op: "setCursor", col: this.cursor };
			}
			// Track cursor naively: assume it stays at insertion point (end of text)
			this.cursor = value.length;
			return { op: "passthrough" };
		}

		// ── NORMAL mode ──────────────────────────────────────────────────────
		const full = this.pending + raw;
		this.pending = "";

		// ── Multi-char sequences ─────────────────────────────────────────────
		if (full === "gg") {
			this.cursor = 0;
			return { op: "setCursor", col: 0 };
		}
		if (full === "dd") {
			this.cursor = 0;
			return { op: "setText", text: "", cursor: 0 };
		}
		if (full === "dw") {
			const after = value.slice(this.cursor);
			const len = after.match(/^\S*\s*/)?.[0]?.length ?? 0;
			const text = value.slice(0, this.cursor) + value.slice(this.cursor + len);
			this.cursor = Math.min(this.cursor, Math.max(0, text.length - 1));
			return { op: "setText", text, cursor: this.cursor };
		}

		// ── Single-char sequences ────────────────────────────────────────────
		switch (raw) {
			// Enter insert mode
			case "i":
				this.mode = "INSERT";
				return { op: "setMode", mode: "INSERT" };
			case "a":
				this.mode = "INSERT";
				this.cursor = Math.min(this.cursor + 1, value.length);
				return { op: "setMode", mode: "INSERT" };
			case "A":
				this.mode = "INSERT";
				this.cursor = value.length;
				return { op: "setMode", mode: "INSERT" };
			case "I":
				this.mode = "INSERT";
				this.cursor = 0;
				return { op: "setMode", mode: "INSERT" };

			// Cursor movement
			case "h":
			case "\x1b[D": // Left arrow in normal mode
				if (this.cursor > 0) this.cursor--;
				return { op: "setCursor", col: this.cursor };
			case "l":
			case "\x1b[C": // Right arrow in normal mode
				if (this.cursor < Math.max(0, value.length - 1)) this.cursor++;
				return { op: "setCursor", col: this.cursor };
			case "0":
			case "^":
				this.cursor = 0;
				return { op: "setCursor", col: 0 };
			case "$": {
				this.cursor = Math.max(0, value.length - 1);
				return { op: "setCursor", col: this.cursor };
			}
			case "G":
				this.cursor = Math.max(0, value.length - 1);
				return { op: "setCursor", col: this.cursor };
			case "w": {
				let i = this.cursor;
				while (i < value.length && /\S/.test(value[i])) i++;
				while (i < value.length && /\s/.test(value[i])) i++;
				this.cursor = Math.min(i, Math.max(0, value.length - 1));
				return { op: "setCursor", col: this.cursor };
			}
			case "b": {
				let i = this.cursor - 1;
				while (i > 0 && /\s/.test(value[i])) i--;
				while (i > 0 && /\S/.test(value[i - 1])) i--;
				this.cursor = Math.max(0, i);
				return { op: "setCursor", col: this.cursor };
			}

			// Delete
			case "x": {
				if (!value.length) return { op: "noop" };
				const text = value.slice(0, this.cursor) + value.slice(this.cursor + 1);
				this.cursor = Math.min(this.cursor, Math.max(0, text.length - 1));
				return { op: "setText", text, cursor: this.cursor };
			}
			case "d":
				this.pending = "d";
				return { op: "noop" };
			case "g":
				this.pending = "g";
				return { op: "noop" };

			// Submit / Escape
			case "\r":
				return { op: "submit" };
			case "\x1b":
				return { op: "noop" };

			default:
				return { op: "noop" };
		}
	}

	/** Human-readable label shown in the editor's separator line. */
	get label(): string {
		return this.mode === "NORMAL" ? " [N] " : " [I] ";
	}
}
