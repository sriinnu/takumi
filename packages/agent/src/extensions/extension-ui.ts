/**
 * Extension UI surface — Phase 45
 *
 * Interactive UI API for extensions when a TUI session is active.
 * Exposed as `ctx.ui` on ExtensionContext. All methods degrade safely
 * (return defaults, no-op) when ctx.hasUI is false — no guard required.
 *
 *   ctx.notify("done")          // flat on ctx: works headless too (logs)
 *   ctx.ui.confirm("Sure?")      // TUI-only: returns false when headless
 *   ctx.ui.pick([...], "Choose") // TUI-only: returns undefined when headless
 *   ctx.ui.setWidget("key", fn)  // TUI-only: no-op when headless
 */

/** Severity level for transient notification toasts. */
export type NotifyLevel = "info" | "warning" | "error";

/**
 * A selectable item in a pick dialog.
 * `label` is what the user sees; `value` is returned on selection.
 */
export interface PickItem<T = string> {
	label: string;
	/** Optional secondary description shown below the label. */
	description?: string;
	value: T;
}

/**
 * Widget renderer — called on each TUI redraw.
 * Receives available terminal width; returns lines to display.
 */
export type WidgetRenderer = (width: number) => string[];

/**
 * Interactive TUI surface on ExtensionContext (ctx.ui).
 * Methods are safe to call when ctx.hasUI is false — they return neutral
 * defaults rather than throwing.
 */
export interface ExtensionUI {
	/**
	 * Show a yes/no confirmation dialog.
	 * Returns false immediately when TUI is not active.
	 */
	confirm(message: string, title?: string): Promise<boolean>;

	/**
	 * Show a pick dialog from a list of items.
	 * Returns undefined when the user cancels or TUI is not active.
	 */
	pick<T>(items: PickItem<T>[], title?: string): Promise<T | undefined>;

	/**
	 * Register a persistent widget in the TUI sidebar panel.
	 * The renderer is called each render cycle.
	 * Call with the same key to replace an existing widget.
	 * No-op when TUI is not active.
	 */
	setWidget(key: string, renderer: WidgetRenderer): void;

	/**
	 * Remove a previously registered sidebar widget.
	 * No-op when the key doesn't exist or TUI is not active.
	 */
	removeWidget(key: string): void;
}

/** Host-provided UI action implementations — injected via bindActions(). */
export interface UIContextActions {
	hasUI: () => boolean;
	notify: (message: string, level: NotifyLevel) => void;
	confirm: (message: string, title?: string) => Promise<boolean>;
	pick: <T>(items: PickItem<T>[], title?: string) => Promise<T | undefined>;
	setWidget: (key: string, renderer: WidgetRenderer) => void;
	removeWidget: (key: string) => void;
}

/** Safe no-op defaults used before a TUI host calls bindActions(). */
export const DEFAULT_UI_ACTIONS: UIContextActions = {
	hasUI: () => false,
	notify: () => {},
	confirm: async () => false,
	pick: async () => undefined,
	setWidget: () => {},
	removeWidget: () => {},
};
