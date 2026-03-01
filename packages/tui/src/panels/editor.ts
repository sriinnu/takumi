/**
 * EditorPanel — the message input area with multi-line support
 * and tab-completion popup overlay.
 */

import type { KeyEvent, Rect } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, Input as InputComponent } from "@takumi/render";
import type { SlashCommandRegistry } from "../commands.js";
import type { CompletionItem } from "../completion.js";
import { CompletionEngine, CompletionPopup, MAX_VISIBLE_ITEMS } from "../completion.js";
import type { EditorOp } from "../vim.js";
import { VimMode } from "../vim.js";

export interface EditorPanelProps {
	onSubmit: (text: string) => void;
	placeholder?: string;
	commands?: SlashCommandRegistry;
	projectRoot?: string;
}

export class EditorPanel extends Component {
	private onSubmit: (text: string) => void;
	private input: InputComponent;
	readonly completion: CompletionPopup;
	private engine: CompletionEngine;
	/** Debounce timer for async file completions (@ prefix). */
	private completionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	readonly vimMode = new VimMode();

	constructor(props: EditorPanelProps) {
		super();
		this.onSubmit = props.onSubmit;
		this.input = new InputComponent({
			prefix: "> ",
			placeholder: props.placeholder ?? "Message Takumi... (Ctrl+C to quit)",
			onSubmit: (value) => {
				this.onSubmit(value);
				this.input.clear();
			},
			onChange: (value) => {
				this.onInputChange(value);
			},
		});

		this.completion = new CompletionPopup();
		this.engine = new CompletionEngine();

		if (props.commands) {
			this.engine.setCommands(props.commands);
		}
		if (props.projectRoot) {
			this.engine.setProjectRoot(props.projectRoot);
		}
	}

	/** Update the project root for file completions. */
	setProjectRoot(root: string): void {
		this.engine.setProjectRoot(root);
	}

	/** Update the command registry for slash completions. */
	setCommands(commands: SlashCommandRegistry): void {
		this.engine.setCommands(commands);
	}

	/** Get current input value. */
	getValue(): string {
		return this.input.getValue();
	}

	/** Set input value. */
	setValue(value: string): void {
		this.input.setValue(value);
	}

	/** Handle key events, with completion popup interception and vim modal input. */
	handleKey(event: KeyEvent): boolean {
		// Completion popup takes priority: intercept confirm / navigation / close
		if (this.completion.isVisible.value) {
			if (event.raw === KEY_CODES.TAB || event.raw === KEY_CODES.ENTER) {
				const item = this.completion.confirm();
				if (item) {
					this.applyCompletion(item);
					return true;
				}
			}
			if (this.completion.handleKey(event)) {
				this.markDirty();
				return true;
			}
			// Escape: close popup without toggling vim mode
			if (event.raw === KEY_CODES.ESCAPE) {
				this.completion.hide();
				this.markDirty();
				return true;
			}
		}

		// Tab with popup hidden: trigger completion
		if (event.raw === KEY_CODES.TAB && !this.completion.isVisible.value) {
			this.triggerCompletion();
			return true;
		}

		// Vi modal input — intercepts in NORMAL mode, and Escape in INSERT mode
		const op = this.vimMode.process(event.raw, this.input.getValue());
		if (op.op !== "passthrough") {
			this.markDirty();
			return this.applyEditorOp(op);
		}

		// INSERT mode passthrough
		return this.input.handleKey(event);
	}

	/** Apply a VimMode EditorOp to the underlying InputComponent. */
	private applyEditorOp(op: EditorOp): boolean {
		const ke = (raw: string): KeyEvent => ({ raw, key: raw, ctrl: false, alt: false, shift: false, meta: false });
		const moveTo = (col: number): void => {
			this.input.handleKey(ke(KEY_CODES.CTRL_A));
			for (let i = 0; i < col; i++) this.input.handleKey(ke(KEY_CODES.RIGHT));
		};
		switch (op.op) {
			case "noop":
				return true;
			case "setMode":
				moveTo(this.vimMode.cursor);
				return true;
			case "setCursor":
				moveTo(op.col);
				return true;
			case "setText":
				this.input.setValue(op.text);
				moveTo(op.cursor);
				return true;
			case "submit":
				this.onSubmit(this.input.getValue());
				this.input.clear();
				this.vimMode.reset();
				return true;
			default:
				return false;
		}
	}

	/** Reset vim to INSERT mode (call after /clear or session change). */
	resetVim(): void {
		this.vimMode.reset();
	}

	/** Trigger completion based on current input. */
	private triggerCompletion(): void {
		const value = this.input.getValue();
		// Cursor is always at the end for single-line input
		const cursorCol = value.length;

		this.engine
			.getCompletions(value, cursorCol)
			.then((items) => {
				if (items.length > 0) {
					this.completion.show(items);
				} else {
					this.completion.hide();
				}
				this.markDirty();
			})
			.catch(() => {
				this.completion.hide();
				this.markDirty();
			});
	}

	/** Called when input text changes — auto-trigger completions for @ and / . */
	private onInputChange(value: string): void {
		// Synchronous path: slash commands, /model, /provider — no I/O, instant response
		const syncItems = this.engine.getCompletionsSync(value, value.length);
		if (syncItems !== null) {
			// Cancel any pending async (file) completion
			if (this.completionDebounceTimer !== null) {
				clearTimeout(this.completionDebounceTimer);
				this.completionDebounceTimer = null;
			}
			if (syncItems.length > 0) {
				this.completion.show(syncItems);
			} else {
				this.completion.hide();
			}
			this.markDirty();
			return;
		}

		// Async path: @ file completions — debounce to avoid readdir on every keystroke
		const isFileTrigger = value.includes("@");
		if (isFileTrigger) {
			if (this.completionDebounceTimer !== null) {
				clearTimeout(this.completionDebounceTimer);
			}
			this.completionDebounceTimer = setTimeout(() => {
				this.completionDebounceTimer = null;
				const cursorCol = value.length;
				this.engine
					.getCompletions(value, cursorCol)
					.then((items) => {
						if (items.length > 0) {
							this.completion.show(items);
						} else {
							this.completion.hide();
						}
						this.markDirty();
					})
					.catch(() => {
						// Silently fail
					});
			}, 150);
		} else if (this.completion.isVisible.value) {
			// Text changed to something without a trigger — hide popup immediately
			if (this.completionDebounceTimer !== null) {
				clearTimeout(this.completionDebounceTimer);
				this.completionDebounceTimer = null;
			}
			this.completion.hide();
			this.markDirty();
		}
	}

	/** Apply a confirmed completion item by replacing the input text. */
	private applyCompletion(item: CompletionItem): void {
		this.input.setValue(item.insertText);
		this.completion.hide();
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		// Draw separator line with vim mode indicator (e.g. " [N] ───")
		const label = this.vimMode.label;
		const bar = label + "\u2500".repeat(Math.max(0, rect.width - label.length));
		const labelColor = this.vimMode.mode === "NORMAL" ? 11 : 8; // yellow for NORMAL
		screen.writeText(rect.y, rect.x, label, { fg: labelColor, bold: this.vimMode.mode === "NORMAL" });
		screen.writeText(rect.y, rect.x + label.length, bar.slice(label.length), { fg: 8, dim: true });

		// Draw input on the line(s) below
		if (rect.height > 1) {
			this.input.render(screen, {
				x: rect.x,
				y: rect.y + 1,
				width: rect.width,
				height: rect.height - 1,
			});
		}

		// Draw completion popup overlay above the editor
		if (this.completion.isVisible.value) {
			this.renderCompletionPopup(screen, rect);
		}
	}

	/** Render the completion popup above the editor input. */
	private renderCompletionPopup(screen: Screen, rect: Rect): void {
		const items = this.completion.items.value;
		if (items.length === 0) return;

		const visibleCount = Math.min(items.length, MAX_VISIBLE_ITEMS);
		const popupWidth = Math.min(
			Math.max(...items.map((i) => i.label.length + (i.detail ? i.detail.length + 3 : 0))) + 4,
			rect.width - 4,
		);
		const popupHeight = visibleCount + 2; // +2 for top/bottom border

		// Position: above the editor, left-aligned with some margin
		const popupX = rect.x + 2;
		const popupY = rect.y - popupHeight;

		if (popupY < 0) return; // Not enough room above

		const selectedIdx = this.completion.selectedIndex.value;
		const scrollOff = this.completion.scrollOffset.value;

		// Draw border
		const topBorder = `\u250C${"\u2500".repeat(popupWidth - 2)}\u2510`;
		const bottomBorder = `\u2514${"\u2500".repeat(popupWidth - 2)}\u2518`;

		screen.writeText(popupY, popupX, topBorder, { fg: 8 });
		screen.writeText(popupY + popupHeight - 1, popupX, bottomBorder, { fg: 8 });

		// Draw items
		for (let i = 0; i < visibleCount; i++) {
			const itemIdx = scrollOff + i;
			if (itemIdx >= items.length) break;

			const item = items[itemIdx];
			const isSelected = itemIdx === selectedIdx;
			const row = popupY + 1 + i;
			const innerWidth = popupWidth - 4; // 2 for borders + 2 for padding

			// Build display text
			let displayText = item.label;
			if (item.detail) {
				const remaining = innerWidth - displayText.length - 2;
				if (remaining > 0) {
					const detail = item.detail.length > remaining ? `${item.detail.slice(0, remaining - 1)}\u2026` : item.detail;
					displayText += `  ${detail}`;
				}
			}

			// Truncate to fit
			if (displayText.length > innerWidth) {
				displayText = `${displayText.slice(0, innerWidth - 1)}\u2026`;
			}

			// Pad to fill width
			displayText = displayText.padEnd(innerWidth);

			// Left border
			screen.writeText(row, popupX, "\u2502", { fg: 8 });
			// Selection indicator
			const prefix = isSelected ? "\u25B8" : " ";

			if (isSelected) {
				screen.writeText(row, popupX + 1, prefix, { fg: 14, bold: true });
				screen.writeText(row, popupX + 2, displayText, { fg: 0, bg: 7, bold: true });
			} else {
				screen.writeText(row, popupX + 1, prefix, { fg: 8 });
				screen.writeText(row, popupX + 2, displayText, { fg: -1 });
			}

			// Right border
			screen.writeText(row, popupX + popupWidth - 1, "\u2502", { fg: 8 });
		}
	}
}
