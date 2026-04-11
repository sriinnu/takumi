/**
 * EditorPanel — the main chat composer with multi-line editing,
 * command/file completion, and honest submit behavior.
 */

import type { KeyEvent, Rect } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component } from "@takumi/render";
import type { SlashCommandRegistry } from "../commands/commands.js";
import type { CompletionItem, ProviderModelCatalog } from "../completion.js";
import { applyCompletionEdit, CompletionEngine, CompletionPopup } from "../completion.js";
import { Editor } from "../editor/editor.js";
import { renderEditorCompletionPopup } from "./editor-completion-popup.js";

export interface EditorPanelProps {
	onSubmit: (text: string) => boolean;
	placeholder?: string;
	commands?: SlashCommandRegistry;
	projectRoot?: string;
	getProviderCatalog?: () => ProviderModelCatalog;
	getCurrentProvider?: () => string | undefined;
}

const TAB_SIZE = 2;
const MAX_SUBMITTED_HISTORY = 50;

export class EditorPanel extends Component {
	private readonly onSubmit: (text: string) => boolean;
	private readonly editor = new Editor({ tabSize: TAB_SIZE });
	readonly completion: CompletionPopup;
	private readonly engine: CompletionEngine;
	private completionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private submittedHistory: string[] = [];
	private historyIndex: number | null = null;
	private draftBeforeHistory = "";

	constructor(props: EditorPanelProps) {
		super();
		this.onSubmit = props.onSubmit;
		this.completion = new CompletionPopup();
		this.engine = new CompletionEngine();
		if (props.commands) this.engine.setCommands(props.commands);
		if (props.projectRoot) this.engine.setProjectRoot(props.projectRoot);
		if (props.getProviderCatalog) this.engine.setProviderCatalog(props.getProviderCatalog);
		if (props.getCurrentProvider) this.engine.setCurrentProvider(props.getCurrentProvider);
	}

	/** Update the project root used for file completion. */
	setProjectRoot(root: string): void {
		this.engine.setProjectRoot(root);
	}

	/** Update the slash command registry used for completion. */
	setCommands(commands: SlashCommandRegistry): void {
		this.engine.setCommands(commands);
	}

	/** Return the current editor text. */
	getValue(): string {
		return this.editor.text;
	}

	/** Replace the current editor text. */
	setValue(value: string): void {
		this.editor.setText(value);
		this.resetHistoryNavigation();
		this.onInputChange();
		this.markDirty();
	}

	/** Return the editor height Takumi should reserve in chat layout. */
	getPreferredHeight(maxRows = 8): number {
		return Math.min(Math.max(3, this.editor.lineCount + 2), maxRows);
	}

	/** Handle keys for completion, multiline editing, and submit. */
	handleKey(event: KeyEvent): boolean {
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
			if (event.raw === KEY_CODES.ESCAPE) {
				this.completion.hide();
				this.markDirty();
				return true;
			}
		}

		if (event.raw === KEY_CODES.ALT_UP) {
			return this.navigateSubmittedHistory(-1);
		}
		if (event.raw === KEY_CODES.ALT_DOWN) {
			return this.navigateSubmittedHistory(1);
		}

		if ((event.ctrl && event.key === "j") || (event.shift && event.raw === KEY_CODES.ENTER)) {
			this.editor.newline();
			this.afterEditorMutation();
			return true;
		}

		if (event.raw === KEY_CODES.ENTER) {
			return this.submitCurrentValue();
		}

		if (event.raw === KEY_CODES.TAB) {
			return this.handleTab();
		}

		const before = this.snapshot();
		const consumed = this.editor.handleKey(event);
		if (consumed) {
			this.afterEditorMutation(before);
		}
		return consumed;
	}

	private handleTab(): boolean {
		const value = this.editor.text;
		const cursor = this.getCursorOffset();
		const syncItems = this.engine.getCompletionsSync(value, cursor);
		if (syncItems !== null) {
			if (syncItems.length > 0) {
				this.completion.show(syncItems);
				this.markDirty();
				return true;
			}
			this.editor.insert(" ".repeat(TAB_SIZE));
			this.afterEditorMutation();
			return true;
		}

		if (this.hasFileTrigger(value, cursor)) {
			this.triggerCompletion();
			return true;
		}

		this.editor.insert(" ".repeat(TAB_SIZE));
		this.afterEditorMutation();
		return true;
	}

	private submitCurrentValue(): boolean {
		const text = this.editor.text;
		if (!text.trim()) return true;
		const accepted = this.onSubmit(text);
		if (!accepted) return true;
		this.recordSubmittedDraft(text);
		this.editor.clear();
		this.resetHistoryNavigation();
		this.completion.hide();
		this.markDirty();
		return true;
	}

	private snapshot(): { text: string; row: number; col: number } {
		return {
			text: this.editor.text,
			row: this.editor.cursorRow,
			col: this.editor.cursorCol,
		};
	}

	private afterEditorMutation(before = this.snapshot()): void {
		const after = this.snapshot();
		if (before.text !== after.text || before.row !== after.row || before.col !== after.col) {
			if (this.historyIndex !== null) {
				this.historyIndex = null;
			}
			this.onInputChange();
		}
		this.markDirty();
	}

	/**
	 * I let operators recall recent submitted drafts with Alt+Up/Alt+Down.
	 */
	private navigateSubmittedHistory(direction: -1 | 1): boolean {
		if (this.submittedHistory.length === 0) return false;
		if (direction < 0) {
			if (this.historyIndex === null) {
				this.draftBeforeHistory = this.editor.text;
				this.historyIndex = this.submittedHistory.length - 1;
			} else if (this.historyIndex > 0) {
				this.historyIndex -= 1;
			}
		} else {
			if (this.historyIndex === null) return false;
			if (this.historyIndex >= this.submittedHistory.length - 1) {
				this.historyIndex = null;
				this.editor.setText(this.draftBeforeHistory);
				this.completion.hide();
				this.onInputChange();
				this.markDirty();
				return true;
			}
			this.historyIndex += 1;
		}

		const nextValue = this.submittedHistory[this.historyIndex];
		if (typeof nextValue !== "string") return false;
		this.editor.setText(nextValue);
		this.completion.hide();
		this.onInputChange();
		this.markDirty();
		return true;
	}

	private recordSubmittedDraft(text: string): void {
		if (this.submittedHistory.at(-1) === text) return;
		this.submittedHistory.push(text);
		if (this.submittedHistory.length > MAX_SUBMITTED_HISTORY) {
			this.submittedHistory.shift();
		}
	}

	private resetHistoryNavigation(): void {
		this.historyIndex = null;
		this.draftBeforeHistory = "";
	}

	private triggerCompletion(): void {
		const value = this.editor.text;
		const cursor = this.getCursorOffset();
		this.engine
			.getCompletions(value, cursor)
			.then((items) => {
				if (items.length > 0) this.completion.show(items);
				else this.completion.hide();
				this.markDirty();
			})
			.catch(() => {
				this.completion.hide();
				this.markDirty();
			});
	}

	private onInputChange(): void {
		const value = this.editor.text;
		const cursor = this.getCursorOffset();
		const syncItems = this.engine.getCompletionsSync(value, cursor);
		if (syncItems !== null) {
			if (this.completionDebounceTimer !== null) {
				clearTimeout(this.completionDebounceTimer);
				this.completionDebounceTimer = null;
			}
			if (syncItems.length > 0) this.completion.show(syncItems);
			else this.completion.hide();
			return;
		}

		if (!this.hasFileTrigger(value, cursor)) {
			if (this.completionDebounceTimer !== null) {
				clearTimeout(this.completionDebounceTimer);
				this.completionDebounceTimer = null;
			}
			if (this.completion.isVisible.value) this.completion.hide();
			return;
		}

		if (this.completionDebounceTimer !== null) clearTimeout(this.completionDebounceTimer);
		this.completionDebounceTimer = setTimeout(() => {
			this.completionDebounceTimer = null;
			this.triggerCompletion();
		}, 120);
	}

	private hasFileTrigger(value: string, cursor: number): boolean {
		const prefix = value.slice(0, cursor);
		return /(^|\s)@[^\s]*$/.test(prefix);
	}

	private getCursorOffset(): number {
		let offset = 0;
		for (let row = 0; row < this.editor.cursorRow; row++) {
			offset += this.editor.getLine(row).length + 1;
		}
		return offset + this.editor.cursorCol;
	}

	private offsetToPosition(text: string, offset: number): { row: number; col: number } {
		const lines = text.split("\n");
		let remaining = Math.max(0, Math.min(offset, text.length));
		for (let row = 0; row < lines.length; row++) {
			const lineLength = lines[row].length;
			if (remaining <= lineLength) return { row, col: remaining };
			remaining -= lineLength + 1;
		}
		const lastRow = Math.max(0, lines.length - 1);
		return { row: lastRow, col: lines[lastRow]?.length ?? 0 };
	}

	private applyCompletion(item: CompletionItem): void {
		const next = applyCompletionEdit(this.editor.text, item);
		const cursor = this.offsetToPosition(next.text, next.cursorCol);
		this.editor.setText(next.text, cursor);
		this.completion.hide();
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		const hint =
			this.editor.text.trim().length === 0
				? " Enter send • Ctrl+J newline • Alt+↑ history • Tab complete "
				: " Composer ";
		const label = `⛩${hint}`;
		const bar = label + "─".repeat(Math.max(0, rect.width - label.length));
		screen.writeText(rect.y, rect.x, bar.slice(0, rect.width), { fg: 8, dim: true });

		const contentHeight = Math.max(1, rect.height - 1);
		const topRow = Math.max(0, this.editor.cursorRow - contentHeight + 1);
		const cursorLine = this.editor.getLine(this.editor.cursorRow);
		const horizontalOffset = Math.max(0, this.editor.cursorCol - rect.width + 3);

		for (let visualRow = 0; visualRow < contentHeight; visualRow++) {
			const bufferRow = topRow + visualRow;
			const lineY = rect.y + 1 + visualRow;
			if (bufferRow >= this.editor.lineCount) continue;
			const line = this.editor.getLine(bufferRow);
			const lineOffset = bufferRow === this.editor.cursorRow ? horizontalOffset : 0;
			const visible = line.slice(lineOffset, lineOffset + rect.width);
			if (visible.length > 0) {
				screen.writeText(lineY, rect.x, visible);
			} else if (bufferRow === 0 && this.editor.text.length === 0) {
				screen.writeText(lineY, rect.x, "Message Takumi...", { fg: 8, dim: true });
			}
		}

		const cursorRow = this.editor.cursorRow - topRow;
		if (cursorRow >= 0 && cursorRow < contentHeight) {
			const cursorCol = this.editor.cursorCol - horizontalOffset;
			if (cursorCol >= 0 && cursorCol < rect.width) {
				const lineY = rect.y + 1 + cursorRow;
				const cursorChar =
					cursorCol + horizontalOffset < cursorLine.length ? cursorLine[cursorCol + horizontalOffset] : " ";
				screen.set(lineY, rect.x + cursorCol, {
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

		if (this.completion.isVisible.value) {
			renderEditorCompletionPopup(this, screen, rect);
		}
	}
}
