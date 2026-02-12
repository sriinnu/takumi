/**
 * FilePicker — dialog for browsing and selecting files.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Component, Border, List, Input } from "@takumi/render";
import type { Screen, ListItem } from "@takumi/render";
import { readdirSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";

export interface FilePickerProps {
	initialPath: string;
	onSelect: (filePath: string) => void;
	onClose: () => void;
	filter?: (name: string) => boolean;
}

export class FilePicker extends Component {
	private props: FilePickerProps;
	private currentDir: string;
	private border: Border;
	private list: List;
	private input: Input;
	private items: ListItem[] = [];

	constructor(props: FilePickerProps) {
		super();
		this.props = props;
		this.currentDir = props.initialPath;

		this.border = new Border({
			style: "rounded",
			title: "File Picker",
			color: 5,
			titleColor: 15,
		});

		this.input = new Input({
			prefix: "Filter: ",
			placeholder: "Type to filter...",
			onChange: (value) => this.filterItems(value),
		});

		this.list = new List({
			items: [],
			selectedColor: 15,
			selectedBg: 5,
			onSelect: (item) => this.handleItemSelect(item),
		});

		this.loadDirectory(this.currentDir);
	}

	private loadDirectory(dir: string): void {
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			this.items = [];

			// Parent directory
			if (dirname(dir) !== dir) {
				this.items.push({ id: "..", label: "..", icon: "\u{1F4C1}", description: "Parent directory" });
			}

			// Directories first, then files
			const dirs: ListItem[] = [];
			const files: ListItem[] = [];

			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue; // skip hidden

				if (entry.isDirectory()) {
					dirs.push({
						id: join(dir, entry.name),
						label: entry.name + "/",
						icon: "\u{1F4C1}",
					});
				} else {
					if (this.props.filter && !this.props.filter(entry.name)) continue;
					files.push({
						id: join(dir, entry.name),
						label: entry.name,
						icon: "\u{1F4C4}",
					});
				}
			}

			this.items.push(
				...dirs.sort((a, b) => a.label.localeCompare(b.label)),
				...files.sort((a, b) => a.label.localeCompare(b.label)),
			);

			this.list.setItems(this.items);
			this.currentDir = dir;
			this.border.update({ title: `File Picker: ${basename(dir) || dir}` });
			this.markDirty();
		} catch {
			// Can't read directory
		}
	}

	private filterItems(query: string): void {
		if (!query) {
			this.list.setItems(this.items);
			return;
		}
		const lower = query.toLowerCase();
		const filtered = this.items.filter((item) =>
			item.label.toLowerCase().includes(lower),
		);
		this.list.setItems(filtered);
		this.markDirty();
	}

	private handleItemSelect(item: ListItem): void {
		if (item.id === "..") {
			this.loadDirectory(dirname(this.currentDir));
			return;
		}

		try {
			const stat = statSync(item.id);
			if (stat.isDirectory()) {
				this.loadDirectory(item.id);
			} else {
				this.props.onSelect(item.id);
				this.props.onClose();
			}
		} catch {
			this.props.onSelect(item.id);
		}
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

	render(screen: Screen, rect: Rect): void {
		const width = Math.min(60, rect.width - 4);
		const height = Math.min(20, rect.height - 4);
		const x = rect.x + Math.floor((rect.width - width) / 2);
		const y = rect.y + Math.floor((rect.height - height) / 2);

		this.border.render(screen, { x, y, width, height });

		if (height > 4) {
			this.input.render(screen, {
				x: x + 1,
				y: y + 1,
				width: width - 2,
				height: 1,
			});

			const sep = "\u2500".repeat(width - 2);
			screen.writeText(y + 2, x + 1, sep, { fg: 8 });

			this.list.render(screen, {
				x: x + 1,
				y: y + 3,
				width: width - 2,
				height: height - 4,
			});
		}
	}
}
