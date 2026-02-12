/**
 * EditorPanel — the message input area with multi-line support.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { Component, Input as InputComponent } from "@takumi/render";
import type { Screen } from "@takumi/render";

export interface EditorPanelProps {
	onSubmit: (text: string) => void;
	placeholder?: string;
}

export class EditorPanel extends Component {
	private onSubmit: (text: string) => void;
	private input: InputComponent;

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
		});
	}

	/** Get current input value. */
	getValue(): string {
		return this.input.getValue();
	}

	/** Set input value. */
	setValue(value: string): void {
		this.input.setValue(value);
	}

	/** Handle key events. */
	handleKey(event: KeyEvent): boolean {
		return this.input.handleKey(event);
	}

	render(screen: Screen, rect: Rect): void {
		// Draw separator line
		const separator = "─".repeat(rect.width);
		screen.writeText(rect.y, rect.x, separator, { fg: 8, dim: true });

		// Draw input on the line(s) below
		if (rect.height > 1) {
			this.input.render(screen, {
				x: rect.x,
				y: rect.y + 1,
				width: rect.width,
				height: rect.height - 1,
			});
		}
	}
}
