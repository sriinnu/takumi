/**
 * PermissionDialog — modal asking the user to allow/deny a tool action.
 * Shows tool name, action details, and allow/deny/always-allow options.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Component, Border } from "@takumi/render";
import type { Screen } from "@takumi/render";
import { wrapText } from "@takumi/render";

export type PermissionResponse = "allow" | "deny" | "always_allow" | "always_deny";

export interface PermissionDialogProps {
	toolName: string;
	description: string;
	details?: string;
	onRespond: (response: PermissionResponse) => void;
}

export class PermissionDialog extends Component {
	private props: PermissionDialogProps;
	private selectedIndex = 0;
	private border: Border;

	private readonly options: Array<{ label: string; key: string; response: PermissionResponse }> = [
		{ label: "(y) Allow once", key: "y", response: "allow" },
		{ label: "(n) Deny", key: "n", response: "deny" },
		{ label: "(a) Always allow this tool", key: "a", response: "always_allow" },
		{ label: "(d) Always deny this tool", key: "d", response: "always_deny" },
	];

	constructor(props: PermissionDialogProps) {
		super();
		this.props = props;
		this.border = new Border({
			style: "rounded",
			title: "Permission Required",
			color: 3,
			titleColor: 3,
		});
	}

	handleKey(event: KeyEvent): boolean {
		// Quick keys
		for (const opt of this.options) {
			if (event.key === opt.key) {
				this.props.onRespond(opt.response);
				return true;
			}
		}

		if (event.raw === KEY_CODES.UP) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.markDirty();
			return true;
		}

		if (event.raw === KEY_CODES.DOWN) {
			this.selectedIndex = Math.min(this.options.length - 1, this.selectedIndex + 1);
			this.markDirty();
			return true;
		}

		if (event.raw === KEY_CODES.ENTER) {
			this.props.onRespond(this.options[this.selectedIndex].response);
			return true;
		}

		if (event.raw === KEY_CODES.ESCAPE) {
			this.props.onRespond("deny");
			return true;
		}

		return false;
	}

	render(screen: Screen, rect: Rect): void {
		const width = Math.min(50, rect.width - 4);
		const height = Math.min(14, rect.height - 4);
		const x = rect.x + Math.floor((rect.width - width) / 2);
		const y = rect.y + Math.floor((rect.height - height) / 2);

		const dialogRect = { x, y, width, height };
		this.border.render(screen, dialogRect);

		let row = y + 1;
		const innerWidth = width - 2;

		// Tool name
		screen.writeText(row, x + 1, `Tool: ${this.props.toolName}`, { fg: 3, bold: true });
		row += 2;

		// Description
		const descLines = wrapText(this.props.description, innerWidth);
		for (const line of descLines) {
			if (row >= y + height - 1) break;
			screen.writeText(row, x + 1, line, { fg: 7 });
			row++;
		}

		// Details
		if (this.props.details) {
			row++;
			const detailLines = wrapText(this.props.details, innerWidth);
			for (const line of detailLines) {
				if (row >= y + height - 1) break;
				screen.writeText(row, x + 1, line, { fg: 8, dim: true });
				row++;
			}
		}

		row++;

		// Options
		for (let i = 0; i < this.options.length; i++) {
			if (row >= y + height - 1) break;
			const opt = this.options[i];
			const isSelected = i === this.selectedIndex;
			screen.writeText(row, x + 2, opt.label, {
				fg: isSelected ? 15 : 7,
				bg: isSelected ? 4 : -1,
				bold: isSelected,
			});
			row++;
		}
	}
}
