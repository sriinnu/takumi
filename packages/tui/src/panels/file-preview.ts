/**
 * FilePreviewPanel — read-only file viewer with syntax highlighting,
 * line numbers, and scroll support.
 *
 * Shows a file preview when a file is selected from the file tree
 * or via an @file reference in the editor.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { KeyEvent, Rect } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Screen, Signal } from "@takumi/render";
import { Border, Component, getTheme, hexToRgb, LANGUAGE_MAP, signal, tokenizeLine } from "@takumi/render";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum lines to load from a file. */
const MAX_LINES = 10000;

/** Extension to language mapping for syntax highlighting. */
const EXT_TO_LANG: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".py": "python",
	".go": "go",
	".rs": "rust",
	".sh": "bash",
	".bash": "bash",
	".zsh": "bash",
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".html": "html",
	".htm": "html",
	".xml": "xml",
	".css": "css",
	".scss": "scss",
	".c": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".h": "c",
	".hpp": "cpp",
	".java": "java",
	".rb": "ruby",
	".sql": "sql",
	".md": "markdown",
	".markdown": "markdown",
};

// ── FilePreviewPanel ─────────────────────────────────────────────────────────

export interface FilePreviewPanelProps {
	width?: number;
}

export class FilePreviewPanel extends Component {
	/** Current file path being previewed. */
	readonly filePath: Signal<string> = signal("");
	/** Lines of file content. */
	readonly content: Signal<string[]> = signal<string[]>([]);
	/** Vertical scroll offset (line index of the first visible line). */
	readonly scrollOffset: Signal<number> = signal(0);
	/** Detected language for syntax highlighting. */
	readonly language: Signal<string> = signal("");
	/** Whether the file was truncated. */
	readonly truncated: Signal<boolean> = signal(false);

	private panelWidth: number;
	private border: Border;
	/** Last rendered viewport height for scroll calculations. */
	private viewportHeight = 20;

	constructor(props?: FilePreviewPanelProps) {
		super();
		this.panelWidth = props?.width ?? 40;
		this.border = new Border({
			style: "single",
			title: "Preview",
			color: 8,
			titleColor: 15,
		});
	}

	/**
	 * Load a file for preview.
	 * Reads the file, detects language, and splits into lines.
	 * Files exceeding MAX_LINES are truncated.
	 */
	async loadFile(path: string): Promise<void> {
		try {
			const raw = await readFile(path, "utf-8");
			let lines = raw.split("\n");

			let wasTruncated = false;
			if (lines.length > MAX_LINES) {
				lines = lines.slice(0, MAX_LINES);
				wasTruncated = true;
			}

			this.filePath.value = path;
			this.content.value = lines;
			this.scrollOffset.value = 0;
			this.language.value = detectLanguage(path);
			this.truncated.value = wasTruncated;
			this.markDirty();
		} catch {
			// On error, show empty preview with error in path
			this.filePath.value = path;
			this.content.value = ["(Unable to read file)"];
			this.scrollOffset.value = 0;
			this.language.value = "";
			this.truncated.value = false;
			this.markDirty();
		}
	}

	/** Clear the preview panel. */
	clear(): void {
		this.filePath.value = "";
		this.content.value = [];
		this.scrollOffset.value = 0;
		this.language.value = "";
		this.truncated.value = false;
		this.markDirty();
	}

	/** Scroll up by a number of lines. */
	scrollUp(lines = 1): void {
		this.scrollOffset.value = Math.max(0, this.scrollOffset.value - lines);
		this.markDirty();
	}

	/** Scroll down by a number of lines. */
	scrollDown(lines = 1): void {
		const maxOffset = Math.max(0, this.content.value.length - this.viewportHeight);
		this.scrollOffset.value = Math.min(maxOffset, this.scrollOffset.value + lines);
		this.markDirty();
	}

	/** Handle key events for scrolling. Returns true if consumed. */
	handleKey(event: KeyEvent): boolean {
		switch (event.raw) {
			case KEY_CODES.UP:
				this.scrollUp();
				return true;
			case KEY_CODES.DOWN:
				this.scrollDown();
				return true;
			case KEY_CODES.PAGE_UP:
				this.scrollUp(Math.max(1, this.viewportHeight - 2));
				return true;
			case KEY_CODES.PAGE_DOWN:
				this.scrollDown(Math.max(1, this.viewportHeight - 2));
				return true;
			case KEY_CODES.HOME:
				this.scrollOffset.value = 0;
				this.markDirty();
				return true;
			case KEY_CODES.END:
				this.scrollOffset.value = Math.max(0, this.content.value.length - this.viewportHeight);
				this.markDirty();
				return true;
			default:
				return false;
		}
	}

	render(screen: Screen, rect: Rect): void {
		const panelRect: Rect = {
			x: rect.x,
			y: rect.y,
			width: Math.min(this.panelWidth, rect.width),
			height: rect.height,
		};

		// Draw border
		this.border.render(screen, panelRect);

		const innerX = panelRect.x + 1;
		const innerW = panelRect.width - 2;
		const innerY = panelRect.y + 1;
		const innerH = panelRect.height - 2;

		if (innerW < 1 || innerH < 1) return;

		this.viewportHeight = innerH;

		const lines = this.content.value;
		const filePath = this.filePath.value;

		// Empty state
		if (!filePath) {
			screen.writeText(innerY, innerX, "(no file)", { fg: 8, dim: true });
			return;
		}

		// Header: file name
		const fileName = basename(filePath);
		const headerText = fileName.length > innerW ? `${fileName.slice(0, innerW - 1)}\u2026` : fileName;
		screen.writeText(innerY, innerX, headerText, { fg: 14, bold: true });

		// Content area starts after header
		const contentY = innerY + 1;
		const contentH = innerH - 1;

		if (contentH < 1) return;

		// Clamp scroll offset
		const maxOffset = Math.max(0, lines.length - contentH);
		if (this.scrollOffset.value > maxOffset) {
			this.scrollOffset.value = maxOffset;
		}

		const startLine = this.scrollOffset.value;
		const totalLines = lines.length;
		const gutterWidth = String(totalLines).length + 1; // number width + 1 space

		// Get syntax rules for highlighting
		const lang = this.language.value;
		const rules = lang ? LANGUAGE_MAP[lang.toLowerCase()] : undefined;
		const theme = getTheme();

		for (let i = 0; i < contentH; i++) {
			const lineIdx = startLine + i;
			if (lineIdx >= lines.length) break;

			const row = contentY + i;
			const lineNum = String(lineIdx + 1).padStart(gutterWidth - 1);

			// Draw line number
			screen.writeText(row, innerX, lineNum, { fg: 8, dim: true });
			screen.writeText(row, innerX + gutterWidth - 1, " ", {});

			// Draw content with optional syntax highlighting
			const codeLine = lines[lineIdx];
			const codeWidth = innerW - gutterWidth;

			if (codeWidth < 1) continue;

			if (rules) {
				// Syntax-highlighted rendering
				const tokens = tokenizeLine(codeLine, rules);
				let col = innerX + gutterWidth;

				const colorMap: Record<string, string> = {
					keyword: theme.syntaxKeyword,
					string: theme.syntaxString,
					number: theme.syntaxNumber,
					comment: theme.syntaxComment,
					function: theme.syntaxFunction,
					type: theme.syntaxType,
					operator: theme.syntaxOperator,
					punctuation: theme.syntaxPunctuation,
					preprocessor: theme.syntaxKeyword,
					annotation: theme.syntaxFunction,
					symbol: theme.syntaxString,
					regex: theme.syntaxString,
					heading: theme.syntaxKeyword,
					bold: theme.foreground,
					italic: theme.foreground,
					link: theme.syntaxFunction,
					plain: theme.foreground,
				};

				for (const token of tokens) {
					if (col >= innerX + innerW) break;
					const maxChars = innerX + innerW - col;
					const text = token.text.length > maxChars ? token.text.slice(0, maxChars) : token.text;

					const hex = colorMap[token.type] ?? theme.foreground;
					const [r, g, b] = hexToRgb(hex);
					const fg256 = rgbTo256(r, g, b);

					screen.writeText(row, col, text, {
						fg: fg256,
						bold: token.type === "keyword",
						italic: token.type === "comment",
					});
					col += text.length;
				}
			} else {
				// Plain text rendering
				const displayText = codeLine.length > codeWidth ? codeLine.slice(0, codeWidth) : codeLine;
				screen.writeText(row, innerX + gutterWidth, displayText, {});
			}
		}

		// Show truncation message if file was truncated
		if (this.truncated.value) {
			const truncMsg = `(${MAX_LINES} of ${lines.length}+ lines shown)`;
			const lastRow = contentY + contentH - 1;
			if (startLine + contentH >= lines.length) {
				screen.writeText(lastRow, innerX, truncMsg.slice(0, innerW), {
					fg: 3,
					dim: true,
				});
			}
		}

		// Scrollbar
		if (lines.length > contentH) {
			const scrollbarHeight = Math.max(1, Math.floor((contentH * contentH) / lines.length));
			const scrollbarPos = maxOffset > 0 ? Math.floor((startLine * (contentH - scrollbarHeight)) / maxOffset) : 0;
			for (let i = 0; i < scrollbarHeight; i++) {
				const row = contentY + scrollbarPos + i;
				if (row < contentY + contentH) {
					screen.writeText(row, panelRect.x + panelRect.width - 1, "\u2588", { fg: 8 });
				}
			}
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Detect language from file extension. */
export function detectLanguage(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	return EXT_TO_LANG[ext] ?? "";
}

/** Convert RGB (0-255) to a 256-color palette index. */
function rgbTo256(r: number, g: number, b: number): number {
	return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}
