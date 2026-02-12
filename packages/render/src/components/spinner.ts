/**
 * Spinner component — animated progress indicator.
 * Multiple spinner styles, configurable frame rate.
 */

import type { Rect } from "@takumi/core";
import { Component } from "../component.js";
import type { Screen } from "../screen.js";

export interface SpinnerStyle {
	frames: string[];
	interval: number;
}

export const SPINNER_STYLES: Record<string, SpinnerStyle> = {
	dots: {
		frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
		interval: 80,
	},
	line: {
		frames: ["-", "\\", "|", "/"],
		interval: 130,
	},
	arc: {
		frames: ["◜", "◠", "◝", "◞", "◡", "◟"],
		interval: 100,
	},
	braille: {
		frames: ["⡀", "⡁", "⡂", "⡃", "⡄", "⡅", "⡆", "⡇", "⣇", "⣧", "⣷", "⣿", "⣾", "⣴", "⣠", "⡀"],
		interval: 100,
	},
	bounce: {
		frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
		interval: 120,
	},
	clock: {
		frames: ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"],
		interval: 100,
	},
};

export interface SpinnerProps {
	key?: string;
	style?: string | SpinnerStyle;
	label?: string;
	color?: number;
	active?: boolean;
}

export class Spinner extends Component {
	private props: SpinnerProps;
	private frameIndex = 0;
	private timer: ReturnType<typeof setInterval> | null = null;
	private spinnerStyle: SpinnerStyle;

	constructor(props: SpinnerProps = {}) {
		super();
		this.props = props;
		this.key = props.key;
		this.spinnerStyle = resolveStyle(props.style);
	}

	update(props: Partial<SpinnerProps>): void {
		this.props = { ...this.props, ...props };
		if (props.style !== undefined) {
			this.spinnerStyle = resolveStyle(props.style);
		}
		this.markDirty();
	}

	/** Start the animation timer. */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % this.spinnerStyle.frames.length;
			this.markDirty();
		}, this.spinnerStyle.interval);
	}

	/** Stop the animation timer. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	onMount(): void {
		super.onMount();
		if (this.props.active !== false) {
			this.start();
		}
	}

	onUnmount(): void {
		this.stop();
		super.onUnmount();
	}

	render(screen: Screen, rect: Rect): void {
		if (this.props.active === false) return;

		const frame = this.spinnerStyle.frames[this.frameIndex];
		const label = this.props.label ?? "";
		const text = label ? `${frame} ${label}` : frame;
		const color = this.props.color ?? 5;

		screen.writeText(rect.y, rect.x, text, { fg: color });
	}
}

function resolveStyle(style?: string | SpinnerStyle): SpinnerStyle {
	if (!style) return SPINNER_STYLES.dots;
	if (typeof style === "string") return SPINNER_STYLES[style] ?? SPINNER_STYLES.dots;
	return style;
}
