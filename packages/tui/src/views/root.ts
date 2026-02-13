/**
 * RootView -- the top-level component that manages the full TUI layout.
 * Handles sidebar visibility, dialog overlays, and focus routing.
 * When the sidebar is visible, a file tree panel is shown on the left
 * and the info sidebar on the right.
 */

import type { Rect, KeyEvent } from "@takumi/core";
import { Component } from "@takumi/render";
import type { Screen } from "@takumi/render";
import { effect } from "@takumi/render";
import type { AppState } from "../state.js";
import type { SlashCommandRegistry } from "../commands.js";
import { ChatView } from "./chat.js";
import { SidebarPanel } from "../panels/sidebar.js";
import { FileTreePanel } from "../panels/file-tree.js";

export interface RootViewProps {
	state: AppState;
	commands?: SlashCommandRegistry;
	onFileSelect?: (filePath: string) => void;
}

export class RootView extends Component {
	private state: AppState;
	readonly chatView: ChatView;
	private sidebar: SidebarPanel;
	readonly fileTree: FileTreePanel;
	private disposeEffect: (() => void) | null = null;
	/** Which panel currently has focus: "input" | "fileTree". */
	private focusedPane: "input" | "fileTree" = "input";

	constructor(props: RootViewProps) {
		super();
		this.state = props.state;

		this.chatView = new ChatView({ state: this.state, commands: props.commands });
		this.sidebar = new SidebarPanel({ state: this.state });
		this.fileTree = new FileTreePanel({
			state: this.state,
			onFileSelect: props.onFileSelect,
		});

		this.appendChild(this.chatView);
		this.appendChild(this.sidebar);
		this.appendChild(this.fileTree);

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
		// If file tree has focus and sidebar is visible, route keys there
		if (this.focusedPane === "fileTree" && this.state.sidebarVisible.value) {
			const consumed = this.fileTree.handleKey(event);
			if (consumed) return true;
			// Escape returns focus to input
			if (event.raw === "\x1b") {
				this.focusedPane = "input";
				return true;
			}
		}
		return this.chatView.handleKey(event);
	}

	/** Switch focus to the file tree panel. */
	focusFileTree(): void {
		this.focusedPane = "fileTree";
	}

	/** Switch focus to the input panel. */
	focusInput(): void {
		this.focusedPane = "input";
	}

	/** Get the current focused pane name. */
	get activeFocus(): "input" | "fileTree" {
		return this.focusedPane;
	}

	render(screen: Screen, rect: Rect): void {
		const showSidebar = this.state.sidebarVisible.value;
		const rightSidebarWidth = showSidebar ? Math.min(30, Math.floor(rect.width * 0.2)) : 0;
		const leftSidebarWidth = showSidebar ? Math.min(30, Math.floor(rect.width * 0.2)) : 0;
		const mainWidth = rect.width - leftSidebarWidth - rightSidebarWidth;

		// File tree (left side)
		if (showSidebar && leftSidebarWidth > 0) {
			this.fileTree.render(screen, {
				x: rect.x,
				y: rect.y,
				width: leftSidebarWidth,
				height: rect.height,
			});
		}

		// Main chat area
		this.chatView.render(screen, {
			x: rect.x + leftSidebarWidth,
			y: rect.y,
			width: mainWidth,
			height: rect.height,
		});

		// Info sidebar (right side)
		if (showSidebar && rightSidebarWidth > 0) {
			this.sidebar.render(screen, {
				x: rect.x + leftSidebarWidth + mainWidth,
				y: rect.y,
				width: rightSidebarWidth,
				height: rect.height,
			});
		}
	}
}
