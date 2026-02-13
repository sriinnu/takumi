// App
export { TakumiApp, parseMouseEvent, formatMessagesAsMarkdown } from "./app.js";
export type { TakumiAppOptions } from "./app.js";

// Agent runner
export { AgentRunner } from "./agent-runner.js";

// Coding agent
export { CodingAgent } from "./coding-agent.js";
export type { CodingPhase, CodingTask } from "./coding-agent.js";

// State
export { AppState } from "./state.js";

// Spinner
export { ToolSpinner, TOOL_SPINNER_FRAMES } from "./spinner.js";
export type { ToolSpinnerEntry, SpinnerLine } from "./spinner.js";

// Keybinds
export { KeyBindingRegistry } from "./keybinds.js";
export type { KeyBinding } from "./keybinds.js";

// Commands
export { SlashCommandRegistry } from "./commands.js";
export type { SlashCommand } from "./commands.js";

// Views
export { RootView } from "./views/root.js";
export { ChatView } from "./views/chat.js";

// Panels
export { MessageListPanel, getToolArgSummary, truncateArg } from "./panels/message-list.js";
export type { LineSegment, RenderedLine } from "./panels/message-list.js";
export { EditorPanel } from "./panels/editor.js";
export { StatusBarPanel } from "./panels/status-bar.js";
export { HeaderPanel } from "./panels/header.js";
export { SidebarPanel } from "./panels/sidebar.js";
export { ToolOutputPanel } from "./panels/tool-output.js";
export { FileTreePanel } from "./panels/file-tree.js";
export type { FileNode, FlatRow, FileTreePanelProps } from "./panels/file-tree.js";
export { scanDirectory, loadGitignore, flattenTree, parseGitignore, matchesGitignore, applyGitStatus } from "./panels/file-tree.js";
export { FilePreviewPanel, detectLanguage } from "./panels/file-preview.js";

// Completion
export { CompletionEngine, CompletionPopup, MAX_VISIBLE_ITEMS } from "./completion.js";
export type { CompletionItem, CompletionKind } from "./completion.js";

// Dialogs
export { CommandPalette } from "./dialogs/command-palette.js";
export type { CommandPaletteItem } from "./dialogs/command-palette.js";
export { PermissionDialog } from "./dialogs/permission.js";
export type { PermissionResponse } from "./dialogs/permission.js";
export { ModelPicker } from "./dialogs/model-picker.js";
export { SessionList } from "./dialogs/session-list.js";
export type { SessionEntry } from "./dialogs/session-list.js";
export { FilePicker } from "./dialogs/file-picker.js";

// Editor
export { Editor } from "./editor.js";
export type { EditorPosition, EditorSelection, EditorOptions } from "./editor.js";

// Formatters
export { formatUserMessage, formatAssistantMessage, formatMessage } from "./formatters/message.js";
export { formatToolCall, formatToolResult, formatToolSummary } from "./formatters/tool-call.js";
export { formatThinkingBlock, formatThinkingSummary } from "./formatters/thinking.js";
export { formatError, formatErrorBrief } from "./formatters/error.js";
