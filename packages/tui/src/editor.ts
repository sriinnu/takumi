/**
 * Multi-line text editor widget for the TUI.
 */

import type { KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { getBracketTarget, isWordChar, scanForBracket } from "./editor-helpers.js";

export interface EditorPosition {
	row: number;
	col: number;
}

export interface EditorSelection {
	start: EditorPosition;
	end: EditorPosition;
}

export interface EditorOptions {
	/** Spaces inserted for Tab. */
	tabSize?: number;
	/** Maximum undo/redo snapshots. */
	maxHistory?: number;
}

interface EditorSnapshot {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
}

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

	get text(): string {
		return this.lines.join("\n");
	}

	set text(value: string) {
		this.setText(value);
	}

	/** Replace the entire buffer and optionally place the cursor explicitly. */
	setText(value: string, cursor?: EditorPosition): void {
		this.pushUndo();
		this.lines = value.length === 0 ? [""] : value.split("\n");
		if (cursor) {
			this.setCursor(cursor.row, cursor.col);
		} else {
			this._cursorRow = this.lines.length - 1;
			this._cursorCol = this.lines[this._cursorRow].length;
		}
		this.anchor = null;
	}

	get cursorRow(): number {
		return this._cursorRow;
	}

	get cursorCol(): number {
		return this._cursorCol;
	}

	get lineCount(): number {
		return this.lines.length;
	}

	getLine(row: number): string {
		if (row < 0 || row >= this.lines.length) return "";
		return this.lines[row];
	}

	/** Place the cursor on a clamped row and column within the current buffer. */
	setCursor(row: number, col: number): void {
		const nextRow = Math.max(0, Math.min(row, this.lines.length - 1));
		this._cursorRow = nextRow;
		this._cursorCol = Math.max(0, Math.min(col, this.lines[nextRow].length));
	}

	handleKey(event: KeyEvent): boolean {
		const { key, ctrl, shift, raw } = event;

		if (ctrl) {
			if (key === "a") return this.act(() => this.selectAll());
			if (key === "z") return this.act(() => (shift ? this.redo() : this.undo()));
			if (key === "y") return this.act(() => this.redo());
			if (raw === KEY_CODES.CTRL_LEFT) return this.act(() => this.handleWordMove("left", shift));
			if (raw === KEY_CODES.CTRL_RIGHT) return this.act(() => this.handleWordMove("right", shift));
			return false;
		}

		if (raw === KEY_CODES.LEFT || raw === KEY_CODES.SHIFT_LEFT) {
			return this.act(() => this.handleArrowMove("left", raw === KEY_CODES.SHIFT_LEFT || shift));
		}
		if (raw === KEY_CODES.RIGHT || raw === KEY_CODES.SHIFT_RIGHT) {
			return this.act(() => this.handleArrowMove("right", raw === KEY_CODES.SHIFT_RIGHT || shift));
		}
		if (raw === KEY_CODES.UP || raw === KEY_CODES.SHIFT_UP) {
			return this.act(() => this.handleVerticalMove("up", raw === KEY_CODES.SHIFT_UP || shift));
		}
		if (raw === KEY_CODES.DOWN || raw === KEY_CODES.SHIFT_DOWN) {
			return this.act(() => this.handleVerticalMove("down", raw === KEY_CODES.SHIFT_DOWN || shift));
		}

		if (raw === KEY_CODES.HOME) return this.act(() => this.handleHomeEnd("home", shift));
		if (raw === KEY_CODES.END) return this.act(() => this.handleHomeEnd("end", shift));
		if (raw === KEY_CODES.TAB) return this.act(() => this.insert(" ".repeat(this.tabSize)));

		if (key === "return" || raw === KEY_CODES.ENTER) {
			if (shift) return this.act(() => this.newline());
			return false;
		}
		if (raw === KEY_CODES.BACKSPACE || key === "backspace") return this.act(() => this.backspace());
		if (raw === KEY_CODES.DELETE) return this.act(() => this.delete());
		if (key.length === 1 && !event.alt) return this.act(() => this.insert(key));
		return false;
	}

	insert(text: string): void {
		this.pushUndo();
		this.deleteSelectionInternal();
		this.redoStack.length = 0;

		const insertLines = text.split("\n");
		const currentLine = this.lines[this._cursorRow];
		const before = currentLine.slice(0, this._cursorCol);
		const after = currentLine.slice(this._cursorCol);

		if (insertLines.length === 1) {
			this.lines[this._cursorRow] = before + insertLines[0] + after;
			this._cursorCol += insertLines[0].length;
			return;
		}

		const firstLine = before + insertLines[0];
		const lastLine = insertLines[insertLines.length - 1] + after;
		const middleLines = insertLines.slice(1, -1);
		this.lines.splice(this._cursorRow, 1, firstLine, ...middleLines, lastLine);
		this._cursorRow += insertLines.length - 1;
		this._cursorCol = insertLines[insertLines.length - 1].length;
	}

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
			return;
		}

		const prevLine = this.lines[this._cursorRow - 1];
		const currentLine = this.lines[this._cursorRow];
		this._cursorCol = prevLine.length;
		this.lines[this._cursorRow - 1] = prevLine + currentLine;
		this.lines.splice(this._cursorRow, 1);
		this._cursorRow--;
	}

	delete(): void {
		if (this.anchor !== null) {
			this.deleteSelection();
			return;
		}
		const line = this.lines[this._cursorRow];
		if (this._cursorCol >= line.length && this._cursorRow >= this.lines.length - 1) return;

		this.pushUndo();
		this.redoStack.length = 0;
		if (this._cursorCol < line.length) {
			this.lines[this._cursorRow] = line.slice(0, this._cursorCol) + line.slice(this._cursorCol + 1);
			return;
		}
		const nextLine = this.lines[this._cursorRow + 1];
		this.lines[this._cursorRow] = line + nextLine;
		this.lines.splice(this._cursorRow + 1, 1);
	}

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

	clear(): void {
		this.pushUndo();
		this.redoStack.length = 0;
		this.lines = [""];
		this._cursorRow = 0;
		this._cursorCol = 0;
		this.anchor = null;
	}

	moveLeft(): void {
		if (this._cursorCol > 0) this._cursorCol--;
		else if (this._cursorRow > 0) {
			this._cursorRow--;
			this._cursorCol = this.lines[this._cursorRow].length;
		}
	}

	moveRight(): void {
		const line = this.lines[this._cursorRow];
		if (this._cursorCol < line.length) this._cursorCol++;
		else if (this._cursorRow < this.lines.length - 1) {
			this._cursorRow++;
			this._cursorCol = 0;
		}
	}

	moveUp(): void {
		if (this._cursorRow > 0) {
			this._cursorRow--;
			this._cursorCol = Math.min(this._cursorCol, this.lines[this._cursorRow].length);
		}
	}

	moveDown(): void {
		if (this._cursorRow < this.lines.length - 1) {
			this._cursorRow++;
			this._cursorCol = Math.min(this._cursorCol, this.lines[this._cursorRow].length);
		}
	}

	moveHome(): void {
		this._cursorCol = 0;
	}

	moveEnd(): void {
		this._cursorCol = this.lines[this._cursorRow].length;
	}

	moveWordLeft(): void {
		if (this._cursorCol === 0 && this._cursorRow > 0) {
			this._cursorRow--;
			this._cursorCol = this.lines[this._cursorRow].length;
			return;
		}
		const line = this.lines[this._cursorRow];
		let col = this._cursorCol;
		while (col > 0 && !isWordChar(line[col - 1])) col--;
		while (col > 0 && isWordChar(line[col - 1])) col--;
		this._cursorCol = col;
	}

	moveWordRight(): void {
		const line = this.lines[this._cursorRow];
		if (this._cursorCol >= line.length && this._cursorRow < this.lines.length - 1) {
			this._cursorRow++;
			this._cursorCol = 0;
			return;
		}
		let col = this._cursorCol;
		while (col < line.length && isWordChar(line[col])) col++;
		while (col < line.length && !isWordChar(line[col])) col++;
		this._cursorCol = col;
	}

	selectAll(): void {
		this.anchor = { row: 0, col: 0 };
		this._cursorRow = this.lines.length - 1;
		this._cursorCol = this.lines[this._cursorRow].length;
	}

	getSelection(): EditorSelection | null {
		return this.getOrderedSelection();
	}

	deleteSelection(): void {
		if (this.anchor === null) return;
		this.pushUndo();
		this.redoStack.length = 0;
		this.deleteSelectionInternal();
	}

	undo(): void {
		if (this.undoStack.length === 0) return;
		this.redoStack.push(this.snapshot());
		if (this.redoStack.length > this.maxHistory) this.redoStack.shift();
		this.restoreSnapshot(this.undoStack.pop()!);
	}

	redo(): void {
		if (this.redoStack.length === 0) return;
		this.undoStack.push(this.snapshot());
		if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
		this.restoreSnapshot(this.redoStack.pop()!);
	}

	findMatchingBracket(): EditorPosition | null {
		const line = this.lines[this._cursorRow];
		for (const col of [this._cursorCol, this._cursorCol - 1]) {
			if (col < 0 || col >= line.length) continue;
			const ch = line[col];
			const target = getBracketTarget(ch);
			if (!target) continue;
			return scanForBracket(this.lines, this._cursorRow, col, ch, target.pair, target.forward);
		}
		return null;
	}

	getAutoIndent(line: string): string {
		const leading = line.match(/^(\s*)/)?.[1] ?? "";
		const trimmed = line.trimEnd();
		if (trimmed.endsWith("{") || trimmed.endsWith(":")) {
			return leading + " ".repeat(this.tabSize);
		}
		return leading;
	}

	private act(fn: () => void): boolean {
		fn();
		return true;
	}

	private handleWordMove(dir: "left" | "right", shift: boolean): void {
		if (shift) this.startSelection();
		else this.anchor = null;
		if (dir === "left") this.moveWordLeft();
		else this.moveWordRight();
	}

	private handleArrowMove(dir: "left" | "right", extending: boolean): void {
		if (extending) {
			this.startSelection();
			if (dir === "left") this.moveLeft();
			else this.moveRight();
			return;
		}

		if (this.anchor !== null) {
			const sel = this.getOrderedSelection();
			if (sel) {
				this._cursorRow = dir === "left" ? sel.start.row : sel.end.row;
				this._cursorCol = dir === "left" ? sel.start.col : sel.end.col;
			}
			this.anchor = null;
			return;
		}

		if (dir === "left") this.moveLeft();
		else this.moveRight();
	}

	private handleVerticalMove(dir: "up" | "down", extending: boolean): void {
		if (extending) this.startSelection();
		else this.anchor = null;
		if (dir === "up") this.moveUp();
		else this.moveDown();
	}

	private handleHomeEnd(dir: "home" | "end", extending: boolean): void {
		if (extending) this.startSelection();
		else this.anchor = null;
		if (dir === "home") this.moveHome();
		else this.moveEnd();
	}

	private startSelection(): void {
		if (this.anchor === null) {
			this.anchor = { row: this._cursorRow, col: this._cursorCol };
		}
	}

	private getOrderedSelection(): EditorSelection | null {
		if (this.anchor === null) return null;
		const a = this.anchor;
		const b = { row: this._cursorRow, col: this._cursorCol };
		if (a.row === b.row && a.col === b.col) return null;
		const before = a.row < b.row || (a.row === b.row && a.col < b.col);
		return { start: before ? { ...a } : { ...b }, end: before ? { ...b } : { ...a } };
	}

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

	private pushUndo(): void {
		this.undoStack.push(this.snapshot());
		if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
	}

	private snapshot(): EditorSnapshot {
		return { lines: [...this.lines], cursorRow: this._cursorRow, cursorCol: this._cursorCol };
	}

	private restoreSnapshot(snap: EditorSnapshot): void {
		this.lines = [...snap.lines];
		this._cursorRow = snap.cursorRow;
		this._cursorCol = snap.cursorCol;
		this.anchor = null;
	}
}
