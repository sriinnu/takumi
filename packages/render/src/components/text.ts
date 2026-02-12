/**
 * Text component — renders styled text within a layout box.
 * Handles word wrapping, truncation, and ANSI styling.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { wrapText, measureText } from "../text.js";
import { COLORS, type ColorName } from "../color.js";

export interface TextProps {
	key?: string;
	content: string;
	color?: ColorName | number;
	background?: ColorName | number;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	wrap?: boolean;
	align?: "left" | "center" | "right";
}

export class TextComponent extends Component {
	private props: TextProps;

	constructor(props: TextProps) {
		super();
		this.props = props;
		this.key = props.key;
	}

	update(newContent: string): void;
	update(newProps: Partial<TextProps>): void;
	update(arg: string | Partial<TextProps>): void {
		if (typeof arg === "string") {
			this.props = { ...this.props, content: arg };
		} else {
			this.props = { ...this.props, ...arg };
		}
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		const { content, wrap, align } = this.props;
		const fg = resolveColor(this.props.color);
		const bg = resolveColor(this.props.background);

		const lines = wrap !== false
			? wrapText(content, rect.width)
			: content.split("\n").map((l) => l.slice(0, rect.width));

		for (let i = 0; i < lines.length && i < rect.height; i++) {
			const line = lines[i];
			const lineWidth = measureText(line);
			let col = rect.x;

			if (align === "center") {
				col += Math.max(0, Math.floor((rect.width - lineWidth) / 2));
			} else if (align === "right") {
				col += Math.max(0, rect.width - lineWidth);
			}

			screen.writeText(rect.y + i, col, line, {
				fg,
				bg,
				bold: this.props.bold ?? false,
				dim: this.props.dim ?? false,
				italic: this.props.italic ?? false,
				underline: this.props.underline ?? false,
				strikethrough: this.props.strikethrough ?? false,
			});
		}
	}
}

function resolveColor(color: ColorName | number | undefined): number {
	if (color === undefined) return -1;
	if (typeof color === "number") return color;
	return COLORS[color] ?? -1;
}
