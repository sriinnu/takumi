/**
 * ToolOutputPanel — displays the output of the currently executing tool.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Border, Component, effect, wrapText } from "@takumi/render";
import type { AppState } from "../state.js";

export interface ToolOutputPanelProps {
	state: AppState;
}

export class ToolOutputPanel extends Component {
	private state: AppState;
	private border: Border;
	private lines: string[] = [];
	private scrollOffset = 0;
	private disposeEffect: (() => void) | null = null;

	constructor(props: ToolOutputPanelProps) {
		super();
		this.state = props.state;
		this.border = new Border({ style: "single", color: 8 });

		this.disposeEffect = effect(() => {
			const tool = this.state.activeTool.value;
			const _output = this.state.toolOutput.value;
			this.border.update({
				title: tool ? `Tool: ${tool}` : "Tool Output",
			});
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	/** Append output text. */
	appendOutput(text: string): void {
		this.state.toolOutput.value += text;
		this.scrollOffset = Number.MAX_SAFE_INTEGER; // auto-scroll
		this.markDirty();
	}

	/** Clear output. */
	clearOutput(): void {
		this.state.toolOutput.value = "";
		this.scrollOffset = 0;
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		// Draw border
		this.border.render(screen, rect);

		// Wrap and render content inside border
		const innerWidth = rect.width - 2;
		const innerHeight = rect.height - 2;
		if (innerWidth <= 0 || innerHeight <= 0) return;

		const output = this.state.toolOutput.value;
		this.lines = wrapText(output, innerWidth);

		// Clamp scroll
		const maxScroll = Math.max(0, this.lines.length - innerHeight);
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		// Render visible lines
		for (let i = 0; i < innerHeight; i++) {
			const lineIdx = this.scrollOffset + i;
			if (lineIdx >= this.lines.length) break;
			screen.writeText(rect.y + 1 + i, rect.x + 1, this.lines[lineIdx], { fg: 7 });
		}
	}
}
