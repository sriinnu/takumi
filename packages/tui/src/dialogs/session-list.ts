/**
 * SessionList — dialog for browsing and restoring past sessions.
 */

import type { Rect, KeyEvent, SessionInfo } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import { Component, Border, List } from "@takumi/render";
import type { Screen, ListItem } from "@takumi/render";

export interface SessionListProps {
	sessions: SessionInfo[];
	onSelect: (session: SessionInfo) => void;
	onClose: () => void;
}

export class SessionList extends Component {
	private props: SessionListProps;
	private border: Border;
	private list: List;

	constructor(props: SessionListProps) {
		super();
		this.props = props;

		this.border = new Border({
			style: "rounded",
			title: "Sessions",
			color: 5,
			titleColor: 15,
		});

		const items: ListItem[] = props.sessions.map((s) => {
			const date = new Date(s.startedAt).toLocaleDateString();
			const time = new Date(s.startedAt).toLocaleTimeString();
			return {
				id: s.id,
				label: s.id,
				description: `${date} ${time} | ${s.turnCount} turns | ${s.model}`,
			};
		});

		this.list = new List({
			items,
			selectedColor: 15,
			selectedBg: 5,
			onSelect: (item) => {
				const session = props.sessions.find((s) => s.id === item.id);
				if (session) {
					this.props.onSelect(session);
					this.props.onClose();
				}
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
		const width = Math.min(70, rect.width - 4);
		const height = Math.min(20, rect.height - 4);
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
