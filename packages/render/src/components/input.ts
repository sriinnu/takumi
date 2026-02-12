/**
 * Input component — single-line text input with cursor, history,
 * and Emacs-style keybindings.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { measureText, segmentGraphemes } from "../text.js";

export interface InputProps {
	key?: string;
	placeholder?: string;
	prefix?: string;
	maxLength?: number;
	onChange?: (value: string) => void;
	onSubmit?: (value: string) => void;
}

export class Input extends Component {
	private props: InputProps;
	private value = "";
	private cursorPos = 0;
	private scrollOffset = 0;
	private history: string[] = [];
	private historyIndex = -1;

	constructor(props: InputProps = {}) {
		super();
		this.props = props;
		this.key = props.key;
	}

	/** Get current input value. */
	getValue(): string {
		return this.value;
	}

	/** Set the input value programmatically. */
	setValue(value: string): void {
		this.value = value;
		this.cursorPos = segmentGraphemes(value).length;
		this.markDirty();
	}

	/** Clear the input and optionally save to history. */
	clear(saveToHistory = true): void {
		if (saveToHistory && this.value.length > 0) {
			this.history.push(this.value);
			if (this.history.length > 500) {
				this.history.shift();
			}
		}
		this.value = "";
		this.cursorPos = 0;
		this.scrollOffset = 0;
		this.historyIndex = -1;
		this.markDirty();
	}

	/** Handle a key event. Returns true if the event was consumed. */
	handleKey(event: KeyEvent): boolean {
		const { key, ctrl } = event;

		// Submit
		if (key === "return" || event.raw === KEY_CODES.ENTER) {
			this.props.onSubmit?.(this.value);
			return true;
		}

		// Ctrl shortcuts
		if (ctrl) {
			switch (key) {
				case "a": // Home
					this.cursorPos = 0;
					this.markDirty();
					return true;
				case "e": // End
					this.cursorPos = this.graphemes.length;
					this.markDirty();
					return true;
				case "k": // Kill to end
					this.value = this.graphemes.slice(0, this.cursorPos).join("");
					this.markDirty();
					this.props.onChange?.(this.value);
					return true;
				case "u": // Kill to start
					this.value = this.graphemes.slice(this.cursorPos).join("");
					this.cursorPos = 0;
					this.markDirty();
					this.props.onChange?.(this.value);
					return true;
				case "w": // Kill word backward
					this.killWordBackward();
					return true;
			}
		}

		// Arrow keys
		if (event.raw === KEY_CODES.LEFT) {
			if (this.cursorPos > 0) this.cursorPos--;
			this.markDirty();
			return true;
		}
		if (event.raw === KEY_CODES.RIGHT) {
			if (this.cursorPos < this.graphemes.length) this.cursorPos++;
			this.markDirty();
			return true;
		}
		if (event.raw === KEY_CODES.HOME) {
			this.cursorPos = 0;
			this.markDirty();
			return true;
		}
		if (event.raw === KEY_CODES.END) {
			this.cursorPos = this.graphemes.length;
			this.markDirty();
			return true;
		}

		// History
		if (event.raw === KEY_CODES.UP) {
			this.navigateHistory(-1);
			return true;
		}
		if (event.raw === KEY_CODES.DOWN) {
			this.navigateHistory(1);
			return true;
		}

		// Backspace
		if (event.raw === KEY_CODES.BACKSPACE || key === "backspace") {
			if (this.cursorPos > 0) {
				const g = this.graphemes;
				g.splice(this.cursorPos - 1, 1);
				this.value = g.join("");
				this.cursorPos--;
				this.markDirty();
				this.props.onChange?.(this.value);
			}
			return true;
		}

		// Delete
		if (event.raw === KEY_CODES.DELETE) {
			if (this.cursorPos < this.graphemes.length) {
				const g = this.graphemes;
				g.splice(this.cursorPos, 1);
				this.value = g.join("");
				this.markDirty();
				this.props.onChange?.(this.value);
			}
			return true;
		}

		// Printable characters
		if (key.length === 1 && !ctrl && !event.alt) {
			this.insert(key);
			return true;
		}

		return false;
	}

	private insert(char: string): void {
		if (this.props.maxLength && this.value.length >= this.props.maxLength) return;
		const g = this.graphemes;
		g.splice(this.cursorPos, 0, char);
		this.value = g.join("");
		this.cursorPos++;
		this.markDirty();
		this.props.onChange?.(this.value);
	}

	private get graphemes(): string[] {
		return segmentGraphemes(this.value);
	}

	private killWordBackward(): void {
		const g = this.graphemes;
		let pos = this.cursorPos;
		// Skip whitespace
		while (pos > 0 && g[pos - 1] === " ") pos--;
		// Skip word
		while (pos > 0 && g[pos - 1] !== " ") pos--;
		g.splice(pos, this.cursorPos - pos);
		this.value = g.join("");
		this.cursorPos = pos;
		this.markDirty();
		this.props.onChange?.(this.value);
	}

	private navigateHistory(direction: number): void {
		if (this.history.length === 0) return;

		if (this.historyIndex === -1 && direction === -1) {
			this.historyIndex = this.history.length - 1;
		} else {
			this.historyIndex += direction;
		}

		if (this.historyIndex < 0) {
			this.historyIndex = -1;
			this.value = "";
		} else if (this.historyIndex >= this.history.length) {
			this.historyIndex = -1;
			this.value = "";
		} else {
			this.value = this.history[this.historyIndex];
		}

		this.cursorPos = this.graphemes.length;
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		const prefix = this.props.prefix ?? "> ";
		const prefixWidth = measureText(prefix);
		const inputWidth = rect.width - prefixWidth;

		if (inputWidth <= 0) return;

		// Draw prefix
		screen.writeText(rect.y, rect.x, prefix, { fg: 5, bold: true });

		// Determine visible portion of input
		if (this.cursorPos - this.scrollOffset >= inputWidth) {
			this.scrollOffset = this.cursorPos - inputWidth + 1;
		}
		if (this.cursorPos < this.scrollOffset) {
			this.scrollOffset = this.cursorPos;
		}

		const g = this.graphemes;
		const visible = g.slice(this.scrollOffset, this.scrollOffset + inputWidth).join("");

		if (visible.length > 0 || this.value.length > 0) {
			screen.writeText(rect.y, rect.x + prefixWidth, visible);
		} else if (this.props.placeholder) {
			// Show placeholder
			screen.writeText(rect.y, rect.x + prefixWidth, this.props.placeholder, { dim: true });
		}

		// Draw cursor (inverted cell)
		const cursorCol = rect.x + prefixWidth + (this.cursorPos - this.scrollOffset);
		if (cursorCol >= rect.x + prefixWidth && cursorCol < rect.x + rect.width) {
			const cursorChar = this.cursorPos < g.length ? g[this.cursorPos] : " ";
			screen.set(rect.y, cursorCol, {
				char: cursorChar,
				fg: 0,
				bg: 15,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}
	}
}
