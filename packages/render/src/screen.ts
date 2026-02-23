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
		this.back[idx] = cell;
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
		let c = col;
		for (const ch of text) {
			if (c >= this.width) break;
			this.set(row, c, {
				char: ch,
				fg: style?.fg ?? -1,
				bg: style?.bg ?? -1,
				bold: style?.bold ?? false,
				dim: style?.dim ?? false,
				italic: style?.italic ?? false,
				underline: style?.underline ?? false,
				strikethrough: style?.strikethrough ?? false,
			});
			c++;
		}
	}

	/** Clear the back buffer to empty cells. */
	clear(): void {
		for (let i = 0; i < this.back.length; i++) {
			this.back[i] = { ...EMPTY_CELL };
		}
	}

	/**
	 * Diff front and back buffers. Returns the minimal ANSI output
	 * to bring the terminal in sync, then swaps buffers.
	 */
	diff(): ScreenPatch {
		let output = "";
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
					output += cursorTo(row + 1, col + 1);
				}

				// Apply styles
				output += cellStyle(backCell);
				output += backCell.char;
				output += reset();

				lastRow = row;
				lastCol = col + 1;
			}
		}

		// Swap buffers
		for (let i = 0; i < this.back.length; i++) {
			this.front[i] = { ...this.back[i] };
		}

		return { output, changedCells };
	}

	/** Force full redraw by clearing front buffer. */
	invalidate(): void {
		for (let i = 0; i < this.front.length; i++) {
			this.front[i] = { ...EMPTY_CELL, char: "\0" };
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
