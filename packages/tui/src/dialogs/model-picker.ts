/**
 * ModelPicker — dialog for selecting the AI model.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Component, Border, List } from "@takumi/render";
import type { Screen, ListItem } from "@takumi/render";

const AVAILABLE_MODELS: ListItem[] = [
	{ id: "claude-opus-4-20250514", label: "Claude Opus 4", description: "Most capable, highest quality" },
	{ id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", description: "Best balance of speed and quality" },
	{ id: "claude-haiku-3-20250307", label: "Claude Haiku 3", description: "Fastest, most affordable" },
];

export interface ModelPickerProps {
	currentModel: string;
	onSelect: (model: string) => void;
	onClose: () => void;
}

export class ModelPicker extends Component {
	private props: ModelPickerProps;
	private border: Border;
	private list: List;

	constructor(props: ModelPickerProps) {
		super();
		this.props = props;

		this.border = new Border({
			style: "rounded",
			title: "Select Model",
			color: 5,
			titleColor: 15,
		});

		const currentIdx = AVAILABLE_MODELS.findIndex((m) => m.id === props.currentModel);
		this.list = new List({
			items: AVAILABLE_MODELS,
			selectedIndex: currentIdx >= 0 ? currentIdx : 0,
			selectedColor: 15,
			selectedBg: 5,
			onSelect: (item) => {
				this.props.onSelect(item.id);
				this.props.onClose();
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

		return false;
	}

	render(screen: Screen, rect: Rect): void {
		const width = Math.min(50, rect.width - 4);
		const height = Math.min(10, rect.height - 4);
		const x = rect.x + Math.floor((rect.width - width) / 2);
		const y = rect.y + Math.floor((rect.height - height) / 2);

		this.border.render(screen, { x, y, width, height });

		if (height > 2) {
			this.list.render(screen, {
				x: x + 1,
				y: y + 1,
				width: width - 2,
				height: height - 2,
			});
		}
	}
}
