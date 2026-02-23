/**
 * Editor — a fully-featured multi-line text editor widget for the TUI.
 *
 * Supports cursor movement, selection, undo/redo, bracket matching,
 * auto-indent, word movement, and configurable tab size.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";

// ── Types ────────────────────────────────────────────────────────────────────

export interface EditorPosition {
	row: number;
	col: number;
}

export interface EditorSelection {
	start: EditorPosition;
	end: EditorPosition;
}

export interface EditorOptions {
	/** Number of spaces inserted for a tab. Default: 2 */
	tabSize?: number;
	/** Maximum undo/redo history entries. Default: 100 */
	maxHistory?: number;
}

// ── History snapshot ─────────────────────────────────────────────────────────

interface EditorSnapshot {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
}

// ── Bracket pairs ────────────────────────────────────────────────────────────

const OPEN_BRACKETS = new Set(["(", "[", "{", "<"]);
const _CLOSE_BRACKETS = new Set([")", "]", "}", ">"]);
const BRACKET_PAIRS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"<": ">",
	")": "(",
	"]": "[",
	"}": "{",
	">": "<",
};

// ── Word boundary detection ──────────────────────────────────────────────────

function isWordChar(ch: string): boolean {
	return /[\w]/.test(ch);
}

// ── Editor ───────────────────────────────────────────────────────────────────

export class Editor {
	private lines: string[] = [""];
	private _cursorRow = 0;
	private _cursorCol = 0;
	private anchor: EditorPosition | null = null;
	private undoStack: EditorSnapshot[] = [];
	private redoStack: EditorSnapshot[] = [];
	private readonly tabSize: number;
	private readonly maxHistory: number;

	constructor(options?: EditorOptions) {
		this.tabSize = options?.tabSize ?? 2;
		this.maxHistory = options?.maxHistory ?? 100;
	}

	// ── Properties ─────────────────────────────────────────────────────────

	/** The current buffer text (all lines joined with newlines). */
	get text(): string {
		return this.lines.join("\n");
	}

	set text(value: string) {
		this.pushUndo();
		this.lines = value.length === 0 ? [""] : value.split("\n");
		this._cursorRow = this.lines.length - 1;
		this._cursorCol = this.lines[this._cursorRow].length;
		this.anchor = null;
	}

	/** Current cursor row (0-based). */
	get cursorRow(): number {
		return this._cursorRow;
	}

	/** Current cursor column (0-based). */
	get cursorCol(): number {
		return this._cursorCol;
	}

	/** Number of lines in the buffer. */
	get lineCount(): number {
		return this.lines.length;
	}

	// ── Line access ────────────────────────────────────────────────────────

	/** Get a specific line by row index. Returns empty string for out-of-range. */
	getLine(row: number): string {
		if (row < 0 || row >= this.lines.length) return "";
		return this.lines[row];
	}

	// ── Key handling ───────────────────────────────────────────────────────

	/** Handle a key event. Returns true if the event was consumed. */
	handleKey(event: KeyEvent): boolean {
		const { key, ctrl, shift, raw } = event;

		// ── Ctrl combos ──
		if (ctrl) {
			if (key === "a") {
				this.selectAll();
				return true;
			}
			if (key === "z") {
				if (shift) {
					this.redo();
				} else {
					this.undo();
				}
				return true;
			}
			if (key === "y") {
				this.redo();
				return true;
			}
			// Ctrl+Left / Ctrl+Right (word movement)
			if (raw === KEY_CODES.CTRL_LEFT) {
				if (shift) {
					this.startSelection();
					this.moveWordLeft();
				} else {
					this.anchor = null;
					this.moveWordLeft();
				}
				return true;
			}
			if (raw === KEY_CODES.CTRL_RIGHT) {
				if (shift) {
					this.startSelection();
					this.moveWordRight();
				} else {
					this.anchor = null;
					this.moveWordRight();
				}
				return true;
			}
			return false;
		}

		// ── Arrow keys (with shift for selection) ──
		if (raw === KEY_CODES.LEFT || raw === KEY_CODES.SHIFT_LEFT) {
			const extending = raw === KEY_CODES.SHIFT_LEFT || shift;
			if (extending) {
				this.startSelection();
				this.moveLeft();
			} else {
				if (this.anchor !== null) {
					// Collapse selection to left edge
					const sel = this.getOrderedSelection();
					if (sel) {
						this._cursorRow = sel.start.row;
						this._cursorCol = sel.start.col;
					}
					this.anchor = null;
				} else {
					this.moveLeft();
				}
			}
			return true;
		}
		if (raw === KEY_CODES.RIGHT || raw === KEY_CODES.SHIFT_RIGHT) {
			const extending = raw === KEY_CODES.SHIFT_RIGHT || shift;
			if (extending) {
				this.startSelection();
				this.moveRight();
			} else {
				if (this.anchor !== null) {
					// Collapse selection to right edge
					const sel = this.getOrderedSelection();
					if (sel) {
						this._cursorRow = sel.end.row;
						this._cursorCol = sel.end.col;
					}
					this.anchor = null;
				} else {
					this.moveRight();
				}
			}
			return true;
		}
		if (raw === KEY_CODES.UP || raw === KEY_CODES.SHIFT_UP) {
			const extending = raw === KEY_CODES.SHIFT_UP || shift;
			if (extending) {
				this.startSelection();
			} else {
				this.anchor = null;
			}
			this.moveUp();
			return true;
		}
		if (raw === KEY_CODES.DOWN || raw === KEY_CODES.SHIFT_DOWN) {
			const extending = raw === KEY_CODES.SHIFT_DOWN || shift;
			if (extending) {
				this.startSelection();
			} else {
				this.anchor = null;
			}
			this.moveDown();
			return true;
		}

		// ── Home / End ──
		if (raw === KEY_CODES.HOME) {
			if (shift) {
				this.startSelection();
			} else {
				this.anchor = null;
			}
			this.moveHome();
			return true;
		}
		if (raw === KEY_CODES.END) {
			if (shift) {
				this.startSelection();
			} else {
				this.anchor = null;
			}
			this.moveEnd();
			return true;
		}

		// ── Tab ──
		if (raw === KEY_CODES.TAB) {
			this.insert(" ".repeat(this.tabSize));
			return true;
		}

		// ── Enter / Shift+Enter → newline ──
		if (key === "return" || raw === KEY_CODES.ENTER) {
			if (shift) {
				this.newline();
				return true;
			}
			// Non-shift Enter is not handled by the editor (submit is external)
			return false;
		}

		// ── Backspace ──
		if (raw === KEY_CODES.BACKSPACE || key === "backspace") {
			this.backspace();
			return true;
		}

		// ── Delete ──
		if (raw === KEY_CODES.DELETE) {
			this.delete();
			return true;
		}

		// ── Printable characters ──
		if (key.length === 1 && !event.alt) {
			this.insert(key);
			return true;
		}

		return false;
	}

	// ── Text mutation ──────────────────────────────────────────────────────

	/** Insert text at cursor position, replacing any selection. */
	insert(text: string): void {
		this.pushUndo();
		this.deleteSelectionInternal();
		this.redoStack.length = 0;

		const insertLines = text.split("\n");
		const currentLine = this.lines[this._cursorRow];
		const before = currentLine.slice(0, this._cursorCol);
		const after = currentLine.slice(this._cursorCol);

		if (insertLines.length === 1) {
			// Single-line insert
			this.lines[this._cursorRow] = before + insertLines[0] + after;
			this._cursorCol += insertLines[0].length;
		} else {
			// Multi-line insert
			const firstLine = before + insertLines[0];
			const lastLine = insertLines[insertLines.length - 1] + after;
			const middleLines = insertLines.slice(1, -1);

			this.lines.splice(this._cursorRow, 1, firstLine, ...middleLines, lastLine);

			this._cursorRow += insertLines.length - 1;
			this._cursorCol = insertLines[insertLines.length - 1].length;
		}
	}

	/** Delete character before cursor (backspace behavior). */
	backspace(): void {
		if (this.anchor !== null) {
			this.deleteSelection();
			return;
		}

		if (this._cursorCol === 0 && this._cursorRow === 0) return;

		this.pushUndo();
		this.redoStack.length = 0;

		if (this._cursorCol > 0) {
			const line = this.lines[this._cursorRow];
			this.lines[this._cursorRow] = line.slice(0, this._cursorCol - 1) + line.slice(this._cursorCol);
			this._cursorCol--;
		} else {
			// Merge with previous line
			const prevLine = this.lines[this._cursorRow - 1];
			const currentLine = this.lines[this._cursorRow];
			this._cursorCol = prevLine.length;
			this.lines[this._cursorRow - 1] = prevLine + currentLine;
			this.lines.splice(this._cursorRow, 1);
			this._cursorRow--;
		}
	}

	/** Delete character at cursor (delete key behavior). */
	delete(): void {
		if (this.anchor !== null) {
			this.deleteSelection();
			return;
		}

		const line = this.lines[this._cursorRow];
		if (this._cursorCol >= line.length && this._cursorRow >= this.lines.length - 1) {
			return; // At end of buffer
		}

		this.pushUndo();
		this.redoStack.length = 0;

		if (this._cursorCol < line.length) {
			this.lines[this._cursorRow] = line.slice(0, this._cursorCol) + line.slice(this._cursorCol + 1);
		} else {
			// Merge with next line
			const nextLine = this.lines[this._cursorRow + 1];
			this.lines[this._cursorRow] = line + nextLine;
			this.lines.splice(this._cursorRow + 1, 1);
		}
	}

	/** Insert a newline at cursor, applying auto-indent. */
	newline(): void {
		this.pushUndo();
		this.deleteSelectionInternal();
		this.redoStack.length = 0;

		const currentLine = this.lines[this._cursorRow];
		const before = currentLine.slice(0, this._cursorCol);
		const after = currentLine.slice(this._cursorCol);

		const indent = this.getAutoIndent(before);

		this.lines[this._cursorRow] = before;
		this.lines.splice(this._cursorRow + 1, 0, indent + after);
		this._cursorRow++;
		this._cursorCol = indent.length;
	}

	/** Clear the entire buffer. */
	clear(): void {
		this.pushUndo();
		this.redoStack.length = 0;
		this.lines = [""];
		this._cursorRow = 0;
		this._cursorCol = 0;
		this.anchor = null;
	}

	// ── Cursor movement ────────────────────────────────────────────────────

	/** Move cursor one position left. Wraps to previous line if at col 0. */
	moveLeft(): void {
		if (this._cursorCol > 0) {
			this._cursorCol--;
		} else if (this._cursorRow > 0) {
			this._cursorRow--;
			this._cursorCol = this.lines[this._cursorRow].length;
		}
	}

	/** Move cursor one position right. Wraps to next line if at end. */
	moveRight(): void {
		const line = this.lines[this._cursorRow];
		if (this._cursorCol < line.length) {
			this._cursorCol++;
		} else if (this._cursorRow < this.lines.length - 1) {
			this._cursorRow++;
			this._cursorCol = 0;
		}
	}

	/** Move cursor up one line. Clamp column to line length. */
	moveUp(): void {
		if (this._cursorRow > 0) {
			this._cursorRow--;
			this._cursorCol = Math.min(this._cursorCol, this.lines[this._cursorRow].length);
		}
	}

	/** Move cursor down one line. Clamp column to line length. */
	moveDown(): void {
		if (this._cursorRow < this.lines.length - 1) {
			this._cursorRow++;
			this._cursorCol = Math.min(this._cursorCol, this.lines[this._cursorRow].length);
		}
	}

	/** Move cursor to beginning of current line. */
	moveHome(): void {
		this._cursorCol = 0;
	}

	/** Move cursor to end of current line. */
	moveEnd(): void {
		this._cursorCol = this.lines[this._cursorRow].length;
	}

	/** Move cursor to the beginning of the previous word. */
	moveWordLeft(): void {
		if (this._cursorCol === 0 && this._cursorRow > 0) {
			// Wrap to end of previous line
			this._cursorRow--;
			this._cursorCol = this.lines[this._cursorRow].length;
			return;
		}

		const line = this.lines[this._cursorRow];
		let col = this._cursorCol;

		// Skip whitespace/punctuation backwards
		while (col > 0 && !isWordChar(line[col - 1])) {
			col--;
		}
		// Skip word characters backwards
		while (col > 0 && isWordChar(line[col - 1])) {
			col--;
		}

		this._cursorCol = col;
	}

	/** Move cursor to the beginning of the next word. */
	moveWordRight(): void {
		const line = this.lines[this._cursorRow];

		if (this._cursorCol >= line.length && this._cursorRow < this.lines.length - 1) {
			// Wrap to beginning of next line
			this._cursorRow++;
			this._cursorCol = 0;
			return;
		}

		let col = this._cursorCol;

		// Skip word characters forward
		while (col < line.length && isWordChar(line[col])) {
			col++;
		}
		// Skip whitespace/punctuation forward
		while (col < line.length && !isWordChar(line[col])) {
			col++;
		}

		this._cursorCol = col;
	}

	// ── Selection ──────────────────────────────────────────────────────────

	/** Select all text in the buffer. */
	selectAll(): void {
		this.anchor = { row: 0, col: 0 };
		this._cursorRow = this.lines.length - 1;
		this._cursorCol = this.lines[this._cursorRow].length;
	}

	/**
	 * Get the current selection range, or null if nothing is selected.
	 * Returns { start, end } where start is always before end.
	 */
	getSelection(): EditorSelection | null {
		return this.getOrderedSelection();
	}

	/** Delete the currently selected text. No-op if nothing is selected. */
	deleteSelection(): void {
		if (this.anchor === null) return;
		this.pushUndo();
		this.redoStack.length = 0;
		this.deleteSelectionInternal();
	}

	// ── History ────────────────────────────────────────────────────────────

	/** Undo the last edit. */
	undo(): void {
		if (this.undoStack.length === 0) return;

		// Save current state to redo stack
		this.redoStack.push(this.snapshot());
		if (this.redoStack.length > this.maxHistory) {
			this.redoStack.shift();
		}

		const snap = this.undoStack.pop()!;
		this.restoreSnapshot(snap);
	}

	/** Redo the last undone edit. */
	redo(): void {
		if (this.redoStack.length === 0) return;

		// Save current state to undo stack
		this.undoStack.push(this.snapshot());
		if (this.undoStack.length > this.maxHistory) {
			this.undoStack.shift();
		}

		const snap = this.redoStack.pop()!;
		this.restoreSnapshot(snap);
	}

	// ── Bracket matching ───────────────────────────────────────────────────

	/**
	 * Find the matching bracket for the character at/near the cursor.
	 * Checks the character at cursor, then the one before cursor.
	 * Returns the position of the matching bracket, or null if not found.
	 */
	findMatchingBracket(): EditorPosition | null {
		const line = this.lines[this._cursorRow];

		// Check at cursor position first, then before cursor
		const positions = [this._cursorCol, this._cursorCol - 1];

		for (const col of positions) {
			if (col < 0 || col >= line.length) continue;
			const ch = line[col];
			if (!BRACKET_PAIRS[ch]) continue;

			const match = BRACKET_PAIRS[ch];
			const isOpen = OPEN_BRACKETS.has(ch);

			return this.scanForBracket(this._cursorRow, col, ch, match, isOpen);
		}

		return null;
	}

	// ── Auto-indent ────────────────────────────────────────────────────────

	/**
	 * Compute the indentation string for a new line following the given line.
	 * Copies leading whitespace and adds extra indent after { or :.
	 */
	getAutoIndent(line: string): string {
		const leadingMatch = line.match(/^(\s*)/);
		const leading = leadingMatch ? leadingMatch[1] : "";

		const trimmed = line.trimEnd();
		if (trimmed.endsWith("{") || trimmed.endsWith(":")) {
			return leading + " ".repeat(this.tabSize);
		}

		return leading;
	}

	// ── Internal helpers ───────────────────────────────────────────────────

	/** If no anchor is set, place it at the current cursor position. */
	private startSelection(): void {
		if (this.anchor === null) {
			this.anchor = { row: this._cursorRow, col: this._cursorCol };
		}
	}

	/**
	 * Get the selection ordered so start <= end.
	 * Returns null if no selection or anchor === cursor.
	 */
	private getOrderedSelection(): EditorSelection | null {
		if (this.anchor === null) return null;

		const a = this.anchor;
		const b = { row: this._cursorRow, col: this._cursorCol };

		// Same position means no selection
		if (a.row === b.row && a.col === b.col) return null;

		const before = a.row < b.row || (a.row === b.row && a.col < b.col);

		return {
			start: before ? { ...a } : { ...b },
			end: before ? { ...b } : { ...a },
		};
	}

	/**
	 * Internal delete-selection that does NOT push undo (caller must do that).
	 * Clears the anchor after deletion.
	 */
	private deleteSelectionInternal(): void {
		const sel = this.getOrderedSelection();
		if (!sel) {
			this.anchor = null;
			return;
		}

		const { start, end } = sel;
		const startLine = this.lines[start.row];
		const endLine = this.lines[end.row];

		const newLine = startLine.slice(0, start.col) + endLine.slice(end.col);
		this.lines.splice(start.row, end.row - start.row + 1, newLine);

		this._cursorRow = start.row;
		this._cursorCol = start.col;
		this.anchor = null;
	}

	/** Push a snapshot onto the undo stack. */
	private pushUndo(): void {
		this.undoStack.push(this.snapshot());
		if (this.undoStack.length > this.maxHistory) {
			this.undoStack.shift();
		}
	}

	/** Create a snapshot of the current state. */
	private snapshot(): EditorSnapshot {
		return {
			lines: [...this.lines],
			cursorRow: this._cursorRow,
			cursorCol: this._cursorCol,
		};
	}

	/** Restore state from a snapshot. */
	private restoreSnapshot(snap: EditorSnapshot): void {
		this.lines = [...snap.lines];
		this._cursorRow = snap.cursorRow;
		this._cursorCol = snap.cursorCol;
		this.anchor = null;
	}

	/**
	 * Scan for a matching bracket starting from (row, col).
	 * Handles nesting: increments depth for same-type brackets,
	 * decrements for matching brackets.
	 */
	private scanForBracket(
		startRow: number,
		startCol: number,
		openChar: string,
		closeChar: string,
		forward: boolean,
	): EditorPosition | null {
		let depth = 0;

		if (forward) {
			// Scan forward
			for (let row = startRow; row < this.lines.length; row++) {
				const line = this.lines[row];
				const startC = row === startRow ? startCol : 0;
				for (let col = startC; col < line.length; col++) {
					const ch = line[col];
					if (ch === openChar) {
						depth++;
					} else if (ch === closeChar) {
						depth--;
						if (depth === 0) {
							return { row, col };
						}
					}
				}
			}
		} else {
			// Scan backward
			for (let row = startRow; row >= 0; row--) {
				const line = this.lines[row];
				const startC = row === startRow ? startCol : line.length - 1;
				for (let col = startC; col >= 0; col--) {
					const ch = line[col];
					if (ch === openChar) {
						depth++;
					} else if (ch === closeChar) {
						depth--;
						if (depth === 0) {
							return { row, col };
						}
					}
				}
			}
		}

		return null;
	}
}
