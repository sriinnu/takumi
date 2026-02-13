/**
 * StatusBarPanel — bottom status bar showing model, tokens, cost, etc.
 */

import type { Rect } from "@takumi/core";
import { Component } from "@takumi/render";
import type { Screen } from "@takumi/render";
import { effect } from "@takumi/render";
import { truncate } from "@takumi/render";
import type { AppState } from "../state.js";

export interface StatusBarPanelProps {
	state: AppState;
}

export class StatusBarPanel extends Component {
	private state: AppState;
	private disposeEffect: (() => void) | null = null;

	constructor(props: StatusBarPanelProps) {
		super();
		this.state = props.state;

		this.disposeEffect = effect(() => {
			const _status = this.state.statusText.value;
			const _chi = this.state.chitraguptaConnected.value;
			this.markDirty();
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	render(screen: Screen, rect: Rect): void {
		const model = this.state.model.value;
		const status = this.state.statusText.value;
		const isStreaming = this.state.isStreaming.value;

		// Background fill
		for (let col = rect.x; col < rect.x + rect.width; col++) {
			screen.set(rect.y, col, {
				char: " ",
				fg: 7,
				bg: 236,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}

		// Left side: model name
		const leftText = ` ${model} `;
		screen.writeText(rect.y, rect.x, leftText, { fg: 15, bg: 236, bold: true });

		// Chitragupta connection indicator (right after model name)
		const chiConnected = this.state.chitraguptaConnected.value;
		const chiIndicator = chiConnected ? " \u091A\u093F " : " \u091A\u093F ";
		const chiCol = rect.x + leftText.length;
		screen.writeText(rect.y, chiCol, chiIndicator, {
			fg: chiConnected ? 2 : 8,  // green when connected, gray when not
			bg: 236,
			dim: !chiConnected,
		});

		// Center: status
		const centerText = ` ${status} `;
		const centerCol = rect.x + Math.floor((rect.width - centerText.length) / 2);
		screen.writeText(rect.y, centerCol, centerText, {
			fg: isStreaming ? 3 : 7,
			bg: 236,
		});

		// Right side: keybind hints
		const rightText = "Ctrl+C quit  Ctrl+K cmd  Ctrl+L clear ";
		const rightCol = rect.x + rect.width - rightText.length;
		if (rightCol > centerCol + centerText.length) {
			screen.writeText(rect.y, rightCol, rightText, { fg: 8, bg: 236, dim: true });
		}
	}
}
