/**
 * RootView -- the top-level component that manages the full TUI layout.
 * Handles sidebar visibility, dialog overlays, file preview, and focus routing.
 *
 * Layout modes:
 * - No sidebar:  [messages]
 * - Sidebar:     [file tree | messages | info sidebar]
 * - With preview: [file tree | messages | file preview]  (replaces info sidebar)
 */

import type { KeyEvent, Rect, TakumiConfig } from "@takumi/core";
import { KEY_CODES } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { SlashCommandRegistry } from "../commands.js";
import { FilePreviewPanel } from "../panels/file-preview.js";
import { FileTreePanel } from "../panels/file-tree.js";
import { SidebarPanel } from "../panels/sidebar.js";
import type { AppState } from "../state.js";
import { ChatView } from "./chat.js";

export interface RootViewProps {
	state: AppState;
	config: TakumiConfig;
	commands?: SlashCommandRegistry;
	onFileSelect?: (filePath: string) => void;
	projectRoot?: string;
}

export class RootView extends Component {
	private state: AppState;
	private config: TakumiConfig;
	readonly chatView: ChatView;
	readonly sidebar: SidebarPanel;
	readonly fileTree: FileTreePanel;
	readonly filePreview: FilePreviewPanel;
	private disposeEffects: (() => void)[] = [];
	/** Which panel currently has focus: "input" | "fileTree" | "preview". */
	private focusedPane: "input" | "fileTree" | "preview" = "input";

	constructor(props: RootViewProps) {
		super();
		this.state = props.state;
		this.config = props.config;

		this.chatView = new ChatView({
			state: this.state,
			config: this.config,
			commands: props.commands,
			projectRoot: props.projectRoot,
		});
		this.sidebar = new SidebarPanel({ state: this.state });
		this.fileTree = new FileTreePanel({
			state: this.state,
			onFileSelect: (filePath: string) => {
				// When a file is selected from tree, show preview
				this.showFilePreview(filePath);
				props.onFileSelect?.(filePath);
			},
		});
		this.filePreview = new FilePreviewPanel();

		this.appendChild(this.chatView);
		this.appendChild(this.sidebar);
		this.appendChild(this.fileTree);
		this.appendChild(this.filePreview);

		// Re-render when sidebar or preview visibility changes
		this.disposeEffects.push(
			effect(() => {
				const _visible = this.state.sidebarVisible.value;
				const _preview = this.state.previewVisible.value;
				const _previewFile = this.state.previewFile.value;
				this.markDirty();
				return undefined;
			}),
		);
	}

	onUnmount(): void {
		for (const dispose of this.disposeEffects) {
			dispose();
		}
		this.disposeEffects = [];
		super.onUnmount();
	}

	handleKey(event: KeyEvent): boolean {
		// Ctrl+P: toggle file preview pane
		if (event.raw === KEY_CODES.CTRL_P) {
			this.togglePreview();
			return true;
		}

		// If preview has focus and is visible, route keys there
		if (this.focusedPane === "preview" && this.state.previewVisible.value) {
			const consumed = this.filePreview.handleKey(event);
			if (consumed) return true;
			// Escape returns focus to input
			if (event.raw === KEY_CODES.ESCAPE) {
				this.focusedPane = "input";
				return true;
			}
		}

		// If file tree has focus and sidebar is visible, route keys there
		if (this.focusedPane === "fileTree" && this.state.sidebarVisible.value) {
			const consumed = this.fileTree.handleKey(event);
			if (consumed) return true;
			// Escape returns focus to input
			if (event.raw === KEY_CODES.ESCAPE) {
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

	/** Switch focus to the file preview panel. */
	focusPreview(): void {
		this.focusedPane = "preview";
	}

	/** Get the current focused pane name. */
	get activeFocus(): "input" | "fileTree" | "preview" {
		return this.focusedPane;
	}

	/** Toggle the file preview pane visibility. */
	togglePreview(): void {
		this.state.previewVisible.value = !this.state.previewVisible.value;
		if (!this.state.previewVisible.value && this.focusedPane === "preview") {
			this.focusedPane = "input";
		}
		this.markDirty();
	}

	/** Show the file preview for a specific file path. */
	showFilePreview(filePath: string): void {
		this.state.previewFile.value = filePath;
		this.state.previewVisible.value = true;
		this.filePreview
			.loadFile(filePath)
			.then(() => {
				this.markDirty();
			})
			.catch(() => {
				// loadFile handles errors internally
			});
	}

	/** Hide the file preview pane. */
	hideFilePreview(): void {
		this.state.previewVisible.value = false;
		this.state.previewFile.value = "";
		this.filePreview.clear();
		if (this.focusedPane === "preview") {
			this.focusedPane = "input";
		}
		this.markDirty();
	}

	render(screen: Screen, rect: Rect): void {
		const showSidebar = this.state.sidebarVisible.value;
		const showPreview = this.state.previewVisible.value;

		const leftSidebarWidth = showSidebar ? Math.min(30, Math.floor(rect.width * 0.2)) : 0;

		// Right pane: either file preview or info sidebar (preview takes priority)
		let rightPaneWidth = 0;
		if (showPreview) {
			// Preview pane takes ~40% of remaining space after left sidebar
			const remaining = rect.width - leftSidebarWidth;
			rightPaneWidth = Math.min(60, Math.floor(remaining * 0.4));
		} else if (showSidebar) {
			rightPaneWidth = Math.min(30, Math.floor(rect.width * 0.2));
		}

		const mainWidth = rect.width - leftSidebarWidth - rightPaneWidth;

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

		// Right pane
		if (rightPaneWidth > 0) {
			if (showPreview) {
				// File preview pane
				this.filePreview.render(screen, {
					x: rect.x + leftSidebarWidth + mainWidth,
					y: rect.y,
					width: rightPaneWidth,
					height: rect.height,
				});
			} else if (showSidebar) {
				// Info sidebar
				this.sidebar.render(screen, {
					x: rect.x + leftSidebarWidth + mainWidth,
					y: rect.y,
					width: rightPaneWidth,
					height: rect.height,
				});
			}
		}
	}
}
