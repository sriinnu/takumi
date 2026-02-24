/**
 * Double-buffered terminal screen.
 *
 * Maintains a front buffer (what's on screen) and a back buffer
 * (what we want on screen). On flush, diffs the two and emits
 * minimal ANSI to update only changed cells.
 */

import type { Cell, Size } from "@takumi/core";
import { bg, cursorTo, fg, reset } from "./ansi.js";

const EMPTY_CELL: Cell = {
	char: " ",
	fg: -1,
	bg: -1,
	bold: false,
	dim: false,
	italic: false,
	underline: false,
	strikethrough: false,
};

export interface ScreenPatch {
	/** ANSI string to write to stdout. */
	output: string;
	/** Number of cells that changed. */
	changedCells: number;
}

export class Screen {
	width: number;
	height: number;
	private front: Cell[];
	private back: Cell[];

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		const size = width * height;
		this.front = new Array<Cell>(size);
		this.back = new Array<Cell>(size);
		for (let i = 0; i < size; i++) {
			this.front[i] = { ...EMPTY_CELL };
			this.back[i] = { ...EMPTY_CELL };
		}
	}

	/** Resize buffers. Clears both buffers. */
	resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
		const size = width * height;
		this.front = new Array<Cell>(size);
		this.back = new Array<Cell>(size);
		for (let i = 0; i < size; i++) {
			this.front[i] = { ...EMPTY_CELL };
			this.back[i] = { ...EMPTY_CELL };
		}
	}

	/** Write a cell to the back buffer. */
	set(row: number, col: number, cell: Cell): void {
		if (row < 0 || row >= this.height || col < 0 || col >= this.width) return;
		const idx = row * this.width + col;
		const c = this.back[idx];
		c.char = cell.char;
		c.fg = cell.fg;
		c.bg = cell.bg;
		c.bold = cell.bold;
		c.dim = cell.dim;
		c.italic = cell.italic;
		c.underline = cell.underline;
		c.strikethrough = cell.strikethrough;
	}

	/** Read a cell from the back buffer. */
	get(row: number, col: number): Cell {
		if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
			return { ...EMPTY_CELL };
		}
		return this.back[row * this.width + col];
	}

	/** Write a string to the back buffer at the given position. */
	writeText(row: number, col: number, text: string, style?: Partial<Cell>): void {
		if (row < 0 || row >= this.height) return;
		const fgVal = style?.fg ?? -1;
		const bgVal = style?.bg ?? -1;
		const bold = style?.bold ?? false;
		const dim = style?.dim ?? false;
		const italic = style?.italic ?? false;
		const underline = style?.underline ?? false;
		const strikethrough = style?.strikethrough ?? false;
		let c = col;
		for (const ch of text) {
			if (c >= this.width) break;
			if (c < 0) {
				c++;
				continue;
			}
			const cell = this.back[row * this.width + c];
			cell.char = ch;
			cell.fg = fgVal;
			cell.bg = bgVal;
			cell.bold = bold;
			cell.dim = dim;
			cell.italic = italic;
			cell.underline = underline;
			cell.strikethrough = strikethrough;
			c++;
		}
	}

	/** Clear the back buffer to empty cells (in-place, zero allocation). */
	clear(): void {
		for (let i = 0; i < this.back.length; i++) {
			const c = this.back[i];
			c.char = " ";
			c.fg = -1;
			c.bg = -1;
			c.bold = false;
			c.dim = false;
			c.italic = false;
			c.underline = false;
			c.strikethrough = false;
		}
	}

	/**
	 * Diff front and back buffers. Returns the minimal ANSI output
	 * to bring the terminal in sync, then swaps buffers.
	 */
	diff(): ScreenPatch {
		const parts: string[] = [];
		let changedCells = 0;
		let lastRow = -1;
		let lastCol = -1;

		for (let row = 0; row < this.height; row++) {
			for (let col = 0; col < this.width; col++) {
				const idx = row * this.width + col;
				const frontCell = this.front[idx];
				const backCell = this.back[idx];

				if (cellsEqual(frontCell, backCell)) continue;

				changedCells++;

				// Move cursor if not adjacent to last write
				if (row !== lastRow || col !== lastCol) {
					parts.push(cursorTo(row + 1, col + 1));
				}

				// Apply styles
				parts.push(cellStyle(backCell));
				parts.push(backCell.char);
				parts.push(reset());

				lastRow = row;
				lastCol = col + 1;
			}
		}

		// Copy back → front in-place (zero new object allocations)
		for (let i = 0; i < this.back.length; i++) {
			const f = this.front[i];
			const b = this.back[i];
			f.char = b.char;
			f.fg = b.fg;
			f.bg = b.bg;
			f.bold = b.bold;
			f.dim = b.dim;
			f.italic = b.italic;
			f.underline = b.underline;
			f.strikethrough = b.strikethrough;
		}

		return { output: parts.join(""), changedCells };
	}

	/** Force full redraw by clearing front buffer. */
	invalidate(): void {
		for (let i = 0; i < this.front.length; i++) {
			this.front[i].char = "\0";
		}
	}

	/** Get current terminal size. */
	get size(): Size {
		return { width: this.width, height: this.height };
	}
}

function cellsEqual(a: Cell, b: Cell): boolean {
	return (
		a.char === b.char &&
		a.fg === b.fg &&
		a.bg === b.bg &&
		a.bold === b.bold &&
		a.dim === b.dim &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strikethrough === b.strikethrough
	);
}

function cellStyle(cell: Cell): string {
	let out = "";
	if (cell.bold) out += "\x1b[1m";
	if (cell.dim) out += "\x1b[2m";
	if (cell.italic) out += "\x1b[3m";
	if (cell.underline) out += "\x1b[4m";
	if (cell.strikethrough) out += "\x1b[9m";
	if (cell.fg >= 0) out += fg(cell.fg);
	if (cell.bg >= 0) out += bg(cell.bg);
	return out;
}
