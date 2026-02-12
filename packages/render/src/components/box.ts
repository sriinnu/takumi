/**
 * Box component — a flexbox container that arranges children
 * using Yoga layout. The fundamental building block of the UI.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";
import { getTheme } from "../theme.js";
import { hexToRgb } from "../color.js";

export interface BoxProps {
	key?: string;
	width?: number | string;
	height?: number | string;
	flexGrow?: number;
	flexShrink?: number;
	flexDirection?: "row" | "column";
	padding?: number | [number, number] | [number, number, number, number];
	margin?: number | [number, number] | [number, number, number, number];
	background?: string;
	visible?: boolean;
}

export class Box extends Component {
	private props: BoxProps;

	constructor(props: BoxProps = {}) {
		super();
		this.props = props;
		this.key = props.key;
		this.style = {
			width: props.width as number | undefined,
			height: props.height as number | undefined,
			flexGrow: props.flexGrow ?? 0,
			flexShrink: props.flexShrink ?? 1,
			flexDirection: props.flexDirection ?? "column",
			padding: props.padding,
			margin: props.margin,
			visible: props.visible ?? true,
		};
	}

	update(props: Partial<BoxProps>): void {
		this.props = { ...this.props, ...props };
		this.style = {
			...this.style,
			width: props.width as number | undefined ?? this.style.width,
			height: props.height as number | undefined ?? this.style.height,
			flexGrow: props.flexGrow ?? this.style.flexGrow,
			flexShrink: props.flexShrink ?? this.style.flexShrink,
			flexDirection: props.flexDirection ?? this.style.flexDirection,
			padding: props.padding ?? this.style.padding,
			margin: props.margin ?? this.style.margin,
			visible: props.visible ?? this.style.visible,
		};
		this.onUpdate();
	}

	render(screen: Screen, rect: Rect): void {
		if (!this.props.background) return;

		// Fill background
		const theme = getTheme();
		const bgColor = this.props.background ?? theme.background;
		const [r, g, b] = hexToRgb(bgColor);
		// Convert RGB to 256-color approximation for cell bg
		const bg256 = rgbTo256(r, g, b);

		for (let row = rect.y; row < rect.y + rect.height; row++) {
			for (let col = rect.x; col < rect.x + rect.width; col++) {
				screen.set(row, col, {
					char: " ",
					fg: -1,
					bg: bg256,
					bold: false,
					dim: false,
					italic: false,
					underline: false,
					strikethrough: false,
				});
			}
		}
	}
}

/** Approximate RGB to nearest 256-color palette index. */
function rgbTo256(r: number, g: number, b: number): number {
	// Check if it's a greyscale
	if (r === g && g === b) {
		if (r < 8) return 16;
		if (r > 248) return 231;
		return Math.round((r - 8) / 247 * 24) + 232;
	}
	// Map to 6x6x6 color cube (indices 16-231)
	const ri = Math.round(r / 255 * 5);
	const gi = Math.round(g / 255 * 5);
	const bi = Math.round(b / 255 * 5);
	return 16 + 36 * ri + 6 * gi + bi;
}
