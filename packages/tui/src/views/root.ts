/**
 * RootView — the top-level component that manages the full TUI layout.
 * Handles sidebar visibility, dialog overlays, and focus routing.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { Component } from "@takumi/render";
import type { Screen } from "@takumi/render";
import { effect } from "@takumi/render";
import type { AppState } from "../state.js";
import type { SlashCommandRegistry } from "../commands.js";
import { ChatView } from "./chat.js";
import { SidebarPanel } from "../panels/sidebar.js";

export interface RootViewProps {
	state: AppState;
	commands?: SlashCommandRegistry;
}

export class RootView extends Component {
	private state: AppState;
	readonly chatView: ChatView;
	private sidebar: SidebarPanel;
	private disposeEffect: (() => void) | null = null;

	constructor(props: RootViewProps) {
		super();
		this.state = props.state;

		this.chatView = new ChatView({ state: this.state, commands: props.commands });
		this.sidebar = new SidebarPanel({ state: this.state });

		this.appendChild(this.chatView);
		this.appendChild(this.sidebar);

		// Re-render when sidebar visibility changes
		this.disposeEffect = effect(() => {
			const _visible = this.state.sidebarVisible.value;
			this.markDirty();
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	handleKey(event: KeyEvent): boolean {
		return this.chatView.handleKey(event);
	}

	render(screen: Screen, rect: Rect): void {
		const showSidebar = this.state.sidebarVisible.value;
		const sidebarWidth = showSidebar ? Math.min(30, Math.floor(rect.width * 0.25)) : 0;
		const mainWidth = rect.width - sidebarWidth;

		// Main chat area
		this.chatView.render(screen, {
			x: rect.x,
			y: rect.y,
			width: mainWidth,
			height: rect.height,
		});

		// Sidebar (right side)
		if (showSidebar && sidebarWidth > 0) {
			this.sidebar.render(screen, {
				x: rect.x + mainWidth,
				y: rect.y,
				width: sidebarWidth,
				height: rect.height,
			});
		}
	}
}
