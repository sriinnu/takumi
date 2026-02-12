/**
 * CommandPalette — fuzzy-search overlay for slash commands.
 * Ctrl+P opens, type to filter, Enter to execute, Escape to close.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Component, Border, List, Input } from "@takumi/render";
import type { Screen, ListItem } from "@takumi/render";
import type { SlashCommand, SlashCommandRegistry } from "../commands.js";

export interface CommandPaletteProps {
	commands: SlashCommandRegistry;
	onSelect: (command: SlashCommand) => void;
	onClose: () => void;
}

export class CommandPalette extends Component {
	private props: CommandPaletteProps;
	private input: Input;
	private list: List;
	private border: Border;
	private allCommands: SlashCommand[] = [];

	constructor(props: CommandPaletteProps) {
		super();
		this.props = props;

		this.allCommands = props.commands.list();

		this.border = new Border({
			style: "rounded",
			title: "Command Palette",
			color: 5,
			titleColor: 15,
		});

		this.input = new Input({
			prefix: "/ ",
			placeholder: "Type to search commands...",
			onChange: (value) => this.filterCommands(value),
		});

		this.list = new List({
			items: this.commandsToItems(this.allCommands),
			selectedColor: 15,
			selectedBg: 5,
			onSelect: (item) => {
				const cmd = this.allCommands.find((c) => c.name === item.id);
				if (cmd) this.props.onSelect(cmd);
			},
		});
	}

	handleKey(event: KeyEvent): boolean {
		if (event.raw === KEY_CODES.ESCAPE) {
			this.props.onClose();
			return true;
		}

		if (event.raw === KEY_CODES.UP) {
			this.list.selectPrev();
			return true;
		}

		if (event.raw === KEY_CODES.DOWN) {
			this.list.selectNext();
			return true;
		}

		if (event.raw === KEY_CODES.ENTER) {
			this.list.confirm();
			return true;
		}

		return this.input.handleKey(event);
	}

	private filterCommands(query: string): void {
		const lower = query.toLowerCase();
		const filtered = this.allCommands.filter(
			(cmd) =>
				cmd.name.toLowerCase().includes(lower) ||
				cmd.description.toLowerCase().includes(lower),
		);
		this.list.setItems(this.commandsToItems(filtered));
		this.markDirty();
	}

	private commandsToItems(commands: SlashCommand[]): ListItem[] {
		return commands.map((cmd) => ({
			id: cmd.name,
			label: cmd.name,
			description: cmd.description,
		}));
	}

	render(screen: Screen, rect: Rect): void {
		// Center the palette in the screen
		const width = Math.min(60, rect.width - 4);
		const height = Math.min(20, rect.height - 4);
		const x = rect.x + Math.floor((rect.width - width) / 2);
		const y = rect.y + Math.floor((rect.height - height) / 2);

		const paletteRect = { x, y, width, height };

		// Draw border
		this.border.render(screen, paletteRect);

		// Draw input
		if (height > 3) {
			this.input.render(screen, {
				x: x + 1,
				y: y + 1,
				width: width - 2,
				height: 1,
			});
		}

		// Separator
		if (height > 4) {
			const sep = "─".repeat(width - 2);
			screen.writeText(y + 2, x + 1, sep, { fg: 8 });
		}

		// List
		if (height > 5) {
			this.list.render(screen, {
				x: x + 1,
				y: y + 3,
				width: width - 2,
				height: height - 4,
			});
		}
	}
}
