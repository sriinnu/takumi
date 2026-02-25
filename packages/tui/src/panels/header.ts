/**
 * HeaderPanel — top bar showing project name and session info.
 * Uses the active theme's brand colours.
 */

import type { Rect, TakumiConfig } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component } from "@takumi/render";
import type { AppState } from "../state.js";
import { resolveTheme } from "../themes.js";

export interface HeaderPanelProps {
	state: AppState;
	config?: TakumiConfig;
}

export class HeaderPanel extends Component {
	private state: AppState;
	private config: TakumiConfig | undefined;

	constructor(props: HeaderPanelProps) {
		super();
		this.state = props.state;
		this.config = props.config;
	}

	render(screen: Screen, rect: Rect): void {
		const theme = resolveTheme(this.config?.theme);
		const bgBrand = theme.ansi.bgBrand; // deep accent bg (brand strip)
		const fgBrand = theme.ansi.fg; // foreground on brand
		const bgBar = theme.ansi.bgBar; // normal header bg
		const primary = theme.ansi.primary; // accent colour

		// Background fill
		for (let col = rect.x; col < rect.x + rect.width; col++) {
			screen.set(rect.y, col, {
				char: " ",
				fg: fgBrand,
				bg: bgBrand,
				bold: false,
				dim: false,
				italic: false,
				underline: false,
				strikethrough: false,
			});
		}

		// Left: 匠 Takumi branded logo
		const logo = " 匠 Takumi ";
		screen.writeText(rect.y, rect.x, logo, { fg: primary, bg: bgBrand, bold: true });

		// Separator
		screen.writeText(rect.y, rect.x + logo.length, "│", { fg: theme.ansi.separator, bg: bgBrand });

		// Center: working directory
		const cwd = process.cwd();
		const maxCwd = rect.width - logo.length - 20;
		const cwdDisplay = cwd.length > maxCwd ? `...${cwd.slice(-maxCwd + 3)}` : cwd;
		screen.writeText(rect.y, rect.x + logo.length + 2, cwdDisplay, { fg: fgBrand, bg: bgBrand });

		// Right: session info
		const sessionId = this.state.sessionId.value;
		if (sessionId) {
			const sessionText = ` ${sessionId} `;
			const rightCol = rect.x + rect.width - sessionText.length;
			screen.writeText(rect.y, rightCol, sessionText, { fg: theme.ansi.muted, bg: bgBrand });
		}
	}
}
