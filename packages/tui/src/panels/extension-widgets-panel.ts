/**
 * ExtensionWidgetsPanel — sidebar surface for extension-owned widgets.
 *
 * I keep widget rendering isolated so extension output cannot sprawl through
 * the main sidebar logic and so later hosts can reuse the same width contract.
 */

import type { Rect } from "@takumi/core";
import type { Screen } from "@takumi/render";
import { Component, effect } from "@takumi/render";
import type { ExtensionUiStore, ExtensionWidgetEntry } from "../extension-ui-store.js";

export interface ExtensionWidgetsPanelProps {
	extensionUiStore: ExtensionUiStore;
}

interface WidgetView {
	key: string;
	lines: string[];
	error: boolean;
}

const HEADER_COLOR = 6;
const LABEL_COLOR = 15;
const TEXT_COLOR = 7;
const ERROR_COLOR = 196;
const MAX_WIDGET_LINES = 4;

function normalizeWidgetLabel(key: string): string {
	return key.replace(/[-_]+/g, " ").trim() || "widget";
}

export class ExtensionWidgetsPanel extends Component {
	private readonly extensionUiStore: ExtensionUiStore;
	private readonly disposeEffect: (() => void) | null;

	constructor(props: ExtensionWidgetsPanelProps) {
		super();
		this.extensionUiStore = props.extensionUiStore;
		this.disposeEffect = effect(() => {
			const _widgets = this.extensionUiStore.widgets.value;
			this.markDirty();
			return undefined;
		});
	}

	onUnmount(): void {
		this.disposeEffect?.();
		super.onUnmount();
	}

	/** Measure the rows required at the provided width. */
	measure(width: number): number {
		const views = this.buildViews(width);
		if (views.length === 0) return 0;
		return 1 + views.reduce((total, view) => total + 1 + view.lines.length, 0);
	}

	render(screen: Screen, rect: Rect): void {
		const views = this.buildViews(rect.width);
		if (views.length === 0) return;
		let cursorY = rect.y;
		const maxY = rect.y + rect.height;
		if (cursorY >= maxY) return;
		screen.writeText(cursorY++, rect.x, "EXTENSIONS", { fg: HEADER_COLOR, bold: true });
		for (const view of views) {
			if (cursorY >= maxY) break;
			screen.writeText(cursorY++, rect.x, this.trunc(normalizeWidgetLabel(view.key), rect.width), {
				fg: view.error ? ERROR_COLOR : LABEL_COLOR,
				bold: true,
			});
			for (const line of view.lines) {
				if (cursorY >= maxY) break;
				screen.writeText(cursorY++, rect.x, this.trunc(line, rect.width), {
					fg: view.error ? ERROR_COLOR : TEXT_COLOR,
					dim: !line.trim(),
				});
			}
		}
	}

	private buildViews(width: number): WidgetView[] {
		return this.extensionUiStore.widgets.value.map((entry) => this.renderWidget(entry, width));
	}

	private renderWidget(entry: ExtensionWidgetEntry, width: number): WidgetView {
		try {
			const rawLines = entry.renderer(Math.max(1, width));
			const lines = this.limitLines(rawLines.length > 0 ? rawLines : ["(empty)"]);
			return { key: entry.key, lines, error: false };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { key: entry.key, lines: this.limitLines([`Widget failed: ${message}`]), error: true };
		}
	}

	private limitLines(lines: string[]): string[] {
		if (lines.length <= MAX_WIDGET_LINES) {
			return lines;
		}
		const visible = lines.slice(0, MAX_WIDGET_LINES - 1);
		visible.push(`+${lines.length - visible.length} more`);
		return visible;
	}

	private trunc(text: string, width: number): string {
		if (text.length <= width) return text;
		return `${text.slice(0, width - 1)}…`;
	}
}
