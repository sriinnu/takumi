/**
 * Default keybinding handler factory extracted from TakumiApp.
 *
 * Returns the map of action-id → handler used by the keybinding registry.
 */
import type { RenderScheduler } from "@takumi/render";
import type { SlashCommandRegistry } from "./commands/commands.js";
import { cycleProviderModel, cycleThinkingLevel, describeThinkingLevel } from "./runtime-ux.js";
import type { AppState } from "./state.js";
import type { ChatView } from "./views/chat.js";
import type { RootView } from "./views/root.js";

export interface KeybindingHandlerDeps {
	state: AppState;
	rootView: RootView;
	chatView: ChatView;
	commands: SlashCommandRegistry;
	getScheduler(): RenderScheduler | null;
	addInfoMessage(text: string): void;
	quit(): Promise<void>;
}

/** Build the default keybinding handler map for the TUI shell. */
export function createDefaultKeybindingHandlers(deps: KeybindingHandlerDeps): Record<string, () => void> {
	const toggleCommandPalette = () => {
		if (deps.state.topDialog === "command-palette") deps.state.popDialog();
		else deps.state.pushDialog("command-palette");
	};

	return {
		"app.quit": () => deps.quit(),
		"app.screen.clear": () => {
			deps.getScheduler()?.getScreen().invalidate();
			deps.getScheduler()?.scheduleRender();
		},
		"app.command-palette.toggle": toggleCommandPalette,
		"app.preview.toggle": () => {
			deps.rootView.togglePreview();
		},
		"app.model-picker.toggle": () => {
			if (deps.state.topDialog === "model-picker") deps.state.popDialog();
			else deps.state.pushDialog("model-picker");
		},
		"app.sidebar.toggle": () => {
			deps.state.sidebarVisible.value = !deps.state.sidebarVisible.value;
		},
		"app.cluster-status.toggle": () => {
			deps.rootView.sidebar.clusterPanel.toggle();
		},
		"app.sessions.list": () => deps.state.pushDialog("session-list"),
		"app.sessions.tree": () => {
			void deps.commands.execute("/session-tree");
		},
		"app.exit-if-editor-empty": () => {
			if (!deps.chatView.getEditorValue()) void deps.quit();
		},
		"app.thinking.cycle": () => {
			const level = cycleThinkingLevel(deps.state, 1);
			deps.addInfoMessage(`Thinking level: ${describeThinkingLevel(level)}`);
		},
		"app.thinking.show-toggle": () => {
			deps.state.showThinking.value = !deps.state.showThinking.value;
			deps.addInfoMessage(`Thinking text: ${deps.state.showThinking.value ? "visible (capped)" : "collapsed"}`);
		},
		"app.model.cycle": () => {
			const selected = cycleProviderModel(deps.state, 1);
			if (selected) {
				deps.addInfoMessage(`Model cycled to: ${selected} (${deps.state.provider.value})`);
			}
		},
		"app.editor.external": () => {
			void deps.commands.execute("/editor");
		},
	};
}
