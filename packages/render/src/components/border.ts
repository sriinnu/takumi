/**
 * Border decorator — wraps a child component in a box-drawing border.
 * Supports multiple border styles (single, double, rounded, bold, ascii).
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";

export type BorderStyle = "single" | "double" | "rounded" | "bold" | "ascii" | "none";

interface BorderChars {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
}

const BORDER_CHARS: Record<BorderStyle, BorderChars> = {
	single: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
	},
	double: {
		topLeft: "╔",
		topRight: "╗",
		bottomLeft: "╚",
		bottomRight: "╝",
		horizontal: "═",
		vertical: "║",
	},
	rounded: {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
	},
	bold: {
		topLeft: "┏",
		topRight: "┓",
		bottomLeft: "┗",
		bottomRight: "┛",
		horizontal: "━",
		vertical: "┃",
	},
	ascii: {
		topLeft: "+",
		topRight: "+",
		bottomLeft: "+",
		bottomRight: "+",
		horizontal: "-",
		vertical: "|",
	},
	none: {
		topLeft: " ",
		topRight: " ",
		bottomLeft: " ",
		bottomRight: " ",
		horizontal: " ",
		vertical: " ",
	},
};

export interface BorderProps {
	key?: string;
	style?: BorderStyle;
	title?: string;
	color?: number;
	titleColor?: number;
}

export class Border extends Component {
	private props: BorderProps;

	constructor(props: BorderProps = {}) {
		super();
		this.props = props;
		this.key = props.key;
	}

	update(props: Partial<BorderProps>): void {
		this.props = { ...this.props, ...props };
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		const borderStyle = this.props.style ?? "single";
		if (borderStyle === "none") return;

		const chars = BORDER_CHARS[borderStyle];
		const fg = this.props.color ?? 8;
		const cellStyle = { fg, bg: -1 as number, bold: false, dim: false, italic: false, underline: false, strikethrough: false };

		const { x, y, width, height } = rect;
		if (width < 2 || height < 2) return;

		// Top edge
		screen.set(y, x, { ...cellStyle, char: chars.topLeft });
		for (let col = x + 1; col < x + width - 1; col++) {
			screen.set(y, col, { ...cellStyle, char: chars.horizontal });
		}
		screen.set(y, x + width - 1, { ...cellStyle, char: chars.topRight });

		// Bottom edge
		screen.set(y + height - 1, x, { ...cellStyle, char: chars.bottomLeft });
		for (let col = x + 1; col < x + width - 1; col++) {
			screen.set(y + height - 1, col, { ...cellStyle, char: chars.horizontal });
		}
		screen.set(y + height - 1, x + width - 1, { ...cellStyle, char: chars.bottomRight });

		// Left and right edges
		for (let row = y + 1; row < y + height - 1; row++) {
			screen.set(row, x, { ...cellStyle, char: chars.vertical });
			screen.set(row, x + width - 1, { ...cellStyle, char: chars.vertical });
		}

		// Title
		if (this.props.title && width > 4) {
			const title = ` ${this.props.title} `;
			const titleFg = this.props.titleColor ?? 15;
			const maxTitleLen = width - 4;
			const truncTitle = title.length > maxTitleLen ? title.slice(0, maxTitleLen) : title;
			screen.writeText(y, x + 2, truncTitle, { fg: titleFg, bold: true });
		}
	}
}
