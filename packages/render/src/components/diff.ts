/**
 * Diff viewer component — renders unified diff output with
 * color-coded additions, deletions, and context lines.
 */

import type { Rect } from "@takumi/core";
import { hexToRgb } from "../color.js";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { getTheme } from "../theme.js";

export type DiffLineType = "add" | "remove" | "context" | "hunk" | "header";

export interface DiffLine {
	type: DiffLineType;
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
}

export interface DiffProps {
	key?: string;
	lines: DiffLine[];
	showLineNumbers?: boolean;
}

export class Diff extends Component {
	private props: DiffProps;

	constructor(props: DiffProps) {
		super();
		this.props = props;
		this.key = props.key;
	}

	update(lines: DiffLine[]): void {
		this.props = { ...this.props, lines };
		this.markDirty();
	}

	/**
	 * Parse a unified diff string into structured DiffLine[].
	 */
	static parse(diffText: string): DiffLine[] {
		const lines: DiffLine[] = [];
		const rawLines = diffText.split("\n");
		let oldLine = 0;
		let newLine = 0;

		for (const raw of rawLines) {
			if (raw.startsWith("@@")) {
				// Hunk header: @@ -a,b +c,d @@
				const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
				if (match) {
					oldLine = Number.parseInt(match[1], 10);
					newLine = Number.parseInt(match[2], 10);
				}
				lines.push({ type: "hunk", content: raw });
			} else if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("diff ")) {
				lines.push({ type: "header", content: raw });
			} else if (raw.startsWith("+")) {
				lines.push({ type: "add", content: raw.slice(1), newLineNum: newLine });
				newLine++;
			} else if (raw.startsWith("-")) {
				lines.push({ type: "remove", content: raw.slice(1), oldLineNum: oldLine });
				oldLine++;
			} else {
				// Context line (may start with space)
				const content = raw.startsWith(" ") ? raw.slice(1) : raw;
				lines.push({ type: "context", content, oldLineNum: oldLine, newLineNum: newLine });
				oldLine++;
				newLine++;
			}
		}

		return lines;
	}

	render(screen: Screen, rect: Rect): void {
		const theme = getTheme();
		const showLineNums = this.props.showLineNumbers ?? true;
		const gutterWidth = showLineNums ? 10 : 0; // "1234 1234 "

		const colorMap: Record<DiffLineType, string> = {
			add: theme.diffAdd,
			remove: theme.diffRemove,
			context: theme.diffContext,
			hunk: theme.diffHunkHeader,
			header: theme.muted,
		};

		const prefixMap: Record<DiffLineType, string> = {
			add: "+",
			remove: "-",
			context: " ",
			hunk: "",
			header: "",
		};

		for (let i = 0; i < this.props.lines.length && i < rect.height; i++) {
			const line = this.props.lines[i];
			const row = rect.y + i;
			const hexColor = colorMap[line.type];
			const [r, g, b] = hexToRgb(hexColor);
			const fg256 = 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);

			let col = rect.x;

			// Line numbers
			if (showLineNums && line.type !== "hunk" && line.type !== "header") {
				const oldNum = line.oldLineNum !== undefined ? String(line.oldLineNum).padStart(4) : "    ";
				const newNum = line.newLineNum !== undefined ? String(line.newLineNum).padStart(4) : "    ";
				screen.writeText(row, col, `${oldNum} ${newNum} `, { fg: 8, dim: true });
				col += gutterWidth;
			} else if (showLineNums) {
				col += gutterWidth;
			}

			// Prefix (+, -, space)
			const prefix = prefixMap[line.type];
			if (prefix) {
				screen.writeText(row, col, prefix, { fg: fg256, bold: line.type === "hunk" });
				col++;
			}

			// Content
			const maxWidth = rect.x + rect.width - col;
			const content = line.content.slice(0, maxWidth);

			const bgColor = line.type === "add" ? 22 : line.type === "remove" ? 52 : -1;
			screen.writeText(row, col, content, {
				fg: fg256,
				bg: bgColor,
				bold: line.type === "hunk" || line.type === "header",
				dim: line.type === "context",
			});
		}
	}
}
