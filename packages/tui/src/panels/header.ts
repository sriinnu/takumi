/**
 * HeaderPanel — top bar showing project name and session info.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component } from "@takumi/render";
import type { AppState } from "../state.js";

export interface HeaderPanelProps {
	state: AppState;
}

export class HeaderPanel extends Component {
	private state: AppState;

	constructor(props: HeaderPanelProps) {
		super();
		this.state = props.state;
	}

	render(screen: Screen, rect: Rect): void {
		// Background fill
		for (let col = rect.x; col < rect.x + rect.width; col++) {
			screen.set(rect.y, col, {
				char: " ",
				fg: 15,
				bg: 54,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}

		// Left: Takumi logo
		const logo = " Takumi ";
		screen.writeText(rect.y, rect.x, logo, { fg: 15, bg: 54, bold: true });

		// Center: working directory
		const cwd = process.cwd();
		const maxCwd = rect.width - logo.length - 20;
		const cwdDisplay = cwd.length > maxCwd ? `...${cwd.slice(-maxCwd + 3)}` : cwd;
		screen.writeText(rect.y, rect.x + logo.length + 2, cwdDisplay, { fg: 7, bg: 54 });

		// Right: session info
		const sessionId = this.state.sessionId.value;
		if (sessionId) {
			const sessionText = ` ${sessionId} `;
			const rightCol = rect.x + rect.width - sessionText.length;
			screen.writeText(rect.y, rightCol, sessionText, { fg: 8, bg: 54 });
		}
	}
}
