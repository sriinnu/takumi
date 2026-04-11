// App

// Agent runner
export { AgentRunner } from "./agent/agent-runner.js";
export type { CodingPhase, CodingTask } from "./agent/coding-agent.js";
// Coding agent
export { CodingAgent } from "./agent/coding-agent.js";
export type { TakumiAppOptions } from "./app.js";
export { formatMessagesAsMarkdown, parseMouseEvent, TakumiApp } from "./app.js";
export { applyStartupControlPlaneState, formatStartupSummary, mapBootstrapLanesToSessionState } from "./app-startup.js";
export type { AutocycleAgentOptions } from "./autocycle/autocycle-agent.js";
// Autocycle agent
export { AutocycleAgent } from "./autocycle/autocycle-agent.js";
export type { SlashCommand, SlashCommandMetadata } from "./commands/commands.js";
// Commands
export { SlashCommandRegistry } from "./commands/commands.js";
export type { CompletionItem, CompletionKind } from "./completion.js";
// Completion
export { CompletionEngine, CompletionPopup, MAX_VISIBLE_ITEMS, PROVIDER_MODELS } from "./completion.js";
export type { CommandPaletteItem } from "./dialogs/command-palette.js";
// Dialogs
export { CommandPalette } from "./dialogs/command-palette.js";
export { FilePicker } from "./dialogs/file-picker.js";
export { ModelPicker } from "./dialogs/model-picker.js";
export type { PermissionResponse } from "./dialogs/permission.js";
export { PermissionDialog } from "./dialogs/permission.js";
export type { SessionEntry } from "./dialogs/session-list.js";
export { SessionList } from "./dialogs/session-list.js";
export type { EditorOptions, EditorPosition, EditorSelection } from "./editor/editor.js";
// Editor
export { Editor } from "./editor/editor.js";
export type { VimModeType } from "./editor/vim.js";
// Vim
export { VimMode } from "./editor/vim.js";
export { formatError, formatErrorBrief } from "./formatters/error.js";
// Formatters
export { formatAssistantMessage, formatMessage, formatUserMessage } from "./formatters/message.js";
export { formatThinkingBlock, formatThinkingSummary } from "./formatters/thinking.js";
export { formatToolCall, formatToolResult, formatToolSummary } from "./formatters/tool-call.js";
export type {
	KeybindingConfigEntry,
	KeybindingConfigFile,
	KeybindingConfigLoadResult,
	ResolvedKeybindingDefinition,
} from "./input/keybinding-config.js";
export {
	buildKeybindingConfigFile,
	DEFAULT_KEYBINDING_DEFINITIONS,
	ensureUserKeybindingConfigFile,
	formatKeybindingConfigFile,
	formatKeybindingReloadSummary,
	formatKeybindingStartupNotice,
	getUserKeybindingConfigPath,
	loadUserKeybindingDefinitions,
	syncDefaultKeybindingRegistry,
	tryRevealKeybindingConfigFile,
} from "./input/keybinding-config.js";
export type { KeyBinding } from "./input/keybinds.js";
// Keybinds
export { KeyBindingRegistry } from "./input/keybinds.js";
export type { ReplayKeyContext } from "./input/replay-keybinds.js";
// Replay
export { handleReplayKey } from "./input/replay-keybinds.js";
export { EditorPanel } from "./panels/editor.js";
export { detectLanguage, FilePreviewPanel } from "./panels/file-preview.js";
export type { FileNode, FileTreePanelProps, FlatRow } from "./panels/file-tree.js";
export {
	applyGitStatus,
	FileTreePanel,
	flattenTree,
	loadGitignore,
	matchesGitignore,
	parseGitignore,
	scanDirectory,
} from "./panels/file-tree.js";
export { HeaderPanel } from "./panels/header.js";
export type { LineSegment, RenderedLine } from "./panels/message-list.js";
// Panels
export { getToolArgSummary, MessageListPanel, truncateArg } from "./panels/message-list.js";
export { SidebarPanel } from "./panels/sidebar.js";
export { StatusBarPanel } from "./panels/status-bar.js";
export type { TimelinePanelProps } from "./panels/timeline.js";
export { TimelinePanel } from "./panels/timeline.js";
export { ToolOutputPanel } from "./panels/tool-output.js";
export type {
	BuildScarlettIntegrityReportInput,
	ScarlettIntegrityFinding,
	ScarlettIntegrityReport,
	ScarlettIntegrityState,
} from "./scarlett-runtime.js";
export { buildScarlettIntegrityReport, formatScarlettIntegrityReport } from "./scarlett-runtime.js";
export type {
	SlashCommandContribution,
	SlashCommandContributionSpec,
	SlashCommandPack,
} from "./slash-commands/pack.js";
export {
	formatSlashCommandOrigin,
	registerSlashCommandContribution,
	registerSlashCommandPack,
} from "./slash-commands/pack.js";
export type { SpinnerLine, ToolSpinnerEntry } from "./spinner.js";
// Spinner
export { TOOL_SPINNER_FRAMES, ToolSpinner } from "./spinner.js";
// State
export { AppState } from "./state.js";
export type { ResolvedTheme } from "./themes.js";
// Themes
export { BUILT_IN_THEMES, resolveTheme, THEME_NAMES } from "./themes.js";
export { ChatView } from "./views/chat.js";
export type { FileChange } from "./views/code.js";
// Code view
export { CodeView } from "./views/code.js";
export type { LogEntry, LogLevel } from "./views/logs.js";
// Logs view
export { LogsView } from "./views/logs.js";
// Views
export { RootView } from "./views/root.js";
