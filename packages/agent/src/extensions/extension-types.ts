/**
 * Extension system types — Phase 42
 *
 * Defines the contract for Takumi extensions: lifecycle events,
 * tool/command/shortcut registration, and the context API.
 * Typed event system with discriminated unions, cancellable "before_*"
 * events, and a single ExtensionAPI surface passed to factory functions.
 */

import type { AgentEvent, ToolDefinition as CoreToolDef, Message, ToolResult, Usage } from "@takumi/core";

export type {
	AgentBusMessageEvent,
	AgentCompleteEvent,
	AgentSpawnEvent,
	ClusterExtensionEvent,
	ClusterPhaseChangeEvent,
	ClusterStartEvent,
} from "./cluster-events.js";

import type {
	AgentBusMessageEvent,
	AgentCompleteEvent,
	AgentSpawnEvent,
	ClusterExtensionEvent,
	ClusterPhaseChangeEvent,
	ClusterStartEvent,
} from "./cluster-events.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Session Events
// ═══════════════════════════════════════════════════════════════════════════════

/** Fired on initial session load. */
export interface SessionStartEvent {
	type: "session_start";
	sessionId: string;
}

/** Fired before switching to another session (cancellable). */
export interface SessionBeforeSwitchEvent {
	type: "session_before_switch";
	reason: "new" | "resume";
	targetSessionId?: string;
}

/** Fired after switching to another session. */
export interface SessionSwitchEvent {
	type: "session_switch";
	reason: "new" | "resume";
	previousSessionId: string | undefined;
}

/** Fired before context compaction (cancellable / overridable). */
export interface SessionBeforeCompactEvent {
	type: "session_before_compact";
	messageCount: number;
	estimatedTokens: number;
	signal: AbortSignal;
}

/** Fired after context compaction. */
export interface SessionCompactEvent {
	type: "session_compact";
	summary: string;
	tokensBefore: number;
	tokensAfter: number;
}

/** Fired on process exit / graceful shutdown. */
export interface SessionShutdownEvent {
	type: "session_shutdown";
}

export type SessionEvent =
	| SessionStartEvent
	| SessionBeforeSwitchEvent
	| SessionSwitchEvent
	| SessionBeforeCompactEvent
	| SessionCompactEvent
	| SessionShutdownEvent;

// ═══════════════════════════════════════════════════════════════════════════════
// Agent Loop Events
// ═══════════════════════════════════════════════════════════════════════════════

/** Fired before each LLM call. Can modify messages. */
export interface ContextEvent {
	type: "context";
	messages: Message[];
}

/** Fired after user submits prompt but before the agent loop starts. */
export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	prompt: string;
	systemPrompt: string;
}

/** Fired when an agent loop starts. */
export interface AgentStartEvent {
	type: "agent_start";
}

/** Fired when an agent loop ends. */
export interface AgentEndEvent {
	type: "agent_end";
	messages: Message[];
}

/** Fired at start of each turn (LLM call + tool execution cycle). */
export interface TurnStartEvent {
	type: "turn_start";
	turnIndex: number;
	timestamp: number;
}

/** Fired at end of each turn. */
export interface TurnEndEvent {
	type: "turn_end";
	turnIndex: number;
	usage: Usage;
}

/** Fired during assistant streaming with token deltas. */
export interface MessageUpdateEvent {
	type: "message_update";
	event: AgentEvent;
}

export type AgentLoopEvent =
	| ContextEvent
	| BeforeAgentStartEvent
	| AgentStartEvent
	| AgentEndEvent
	| TurnStartEvent
	| TurnEndEvent
	| MessageUpdateEvent;

// ── Tool Events ──────────────────────────────────────────────────────────────

/** Fired before a tool executes. Can block execution. */
export interface ToolCallEvent {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
}

/** Fired after a tool finishes executing. Can modify the result. */
export interface ToolResultEvent {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	result: ToolResult;
	isError: boolean;
}

export type ToolEvent = ToolCallEvent | ToolResultEvent;

// ── Model Events ─────────────────────────────────────────────────────────────

/** Fired when a new model is selected. */
export interface ModelSelectEvent {
	type: "model_select";
	model: string;
	previousModel: string | undefined;
	source: "set" | "cycle" | "restore" | "failover";
}

// ── Input Events ─────────────────────────────────────────────────────────────

/** Source of user input. */
export type InputSource = "interactive" | "rpc" | "extension" | "one-shot";

/** Fired when user input is received, before agent processing. */
export interface InputEvent {
	type: "input";
	text: string;
	source: InputSource;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Event Union & Result Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Union of all extension events. */
export type ExtensionEvent =
	| SessionEvent
	| AgentLoopEvent
	| ToolEvent
	| ModelSelectEvent
	| InputEvent
	| ClusterExtensionEvent;

/** Extract the event type string literal from an event. */
export type ExtensionEventType = ExtensionEvent["type"];

/** Result from session_before_switch handler. */
export interface SessionBeforeSwitchResult {
	cancel?: boolean;
}

/** Result from session_before_compact handler. */
export interface SessionBeforeCompactResult {
	cancel?: boolean;
	/** Extension-generated compaction summary (overrides default). */
	summary?: string;
}

/** Result from context event handler. */
export interface ContextEventResult {
	/** Modified messages to use instead. */
	messages?: Message[];
}

/** Result from before_agent_start handler. */
export interface BeforeAgentStartEventResult {
	/** Replace the system prompt for this turn. */
	systemPrompt?: string;
	/** Inject a custom message before agent processing. */
	injectMessage?: { content: string };
}

/** Result from tool_call handler. */
export interface ToolCallEventResult {
	/** Block tool execution with a reason. */
	block?: boolean;
	reason?: string;
}

/** Result from tool_result handler. */
export interface ToolResultEventResult {
	/** Modified tool output. */
	output?: string;
	isError?: boolean;
}

/** Result from input handler. */
export type InputEventResult = { action: "continue" } | { action: "transform"; text: string } | { action: "handled" };

// ═══════════════════════════════════════════════════════════════════════════════
// Extension Tool Definition
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tool definition for `api.registerTool()`.
 * Extends core ToolDefinition with extension-specific fields.
 */
export interface ExtensionToolDefinition extends CoreToolDef {
	/** Execute the tool. Extensions provide the handler inline. */
	execute: (
		args: Record<string, unknown>,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	) => Promise<ToolResult>;

	/** Optional one-line snippet for the system prompt tools section. */
	promptSnippet?: string;

	/** Optional guideline bullets appended to the system prompt. */
	promptGuidelines?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extension Context
// ═══════════════════════════════════════════════════════════════════════════════

/** Read-only context usage info. */
export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

/**
 * Context passed to extension event handlers and tool execute functions.
 * Provides read-only access to session state and controlled mutation APIs.
 */
export interface ExtensionContext {
	/** Current working directory. */
	cwd: string;
	/** Whether the agent is idle (not streaming). */
	isIdle(): boolean;
	/** Abort the current agent operation. */
	abort(): void;
	/** Get current context usage for the active model. */
	getContextUsage(): ContextUsage | undefined;
	/** Get the current effective system prompt. */
	getSystemPrompt(): string;
	/** Current model identifier. */
	model: string | undefined;
	/** Session ID. */
	sessionId: string | undefined;
	/** Trigger compaction without awaiting completion. */
	compact(): void;
	/** Gracefully shutdown. */
	shutdown(): void;
}

/**
 * Extended context for command handlers.
 * Includes session control methods only safe in user-initiated commands.
 */
export interface ExtensionCommandContext extends ExtensionContext {
	/** Wait for the agent to finish the current turn. */
	waitForIdle(): Promise<void>;
	/** Start a new session. */
	newSession(): Promise<{ cancelled: boolean }>;
	/** Switch to a different session by ID. */
	switchSession(sessionId: string): Promise<{ cancelled: boolean }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Command & Shortcut Registration
// ═══════════════════════════════════════════════════════════════════════════════

/** Registered slash command definition. */
export interface RegisteredCommand {
	name: string;
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

/** Registered keyboard shortcut. */
export interface RegisteredShortcut {
	key: string;
	description?: string;
	handler: (ctx: ExtensionContext) => Promise<void> | void;
	extensionPath: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extension Handler Type
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handler function type for events.
 * Returns void for fire-and-forget, or a typed result for events that accept feedback.
 */
export type ExtensionHandler<TEvent, TResult = undefined> = (
	event: TEvent,
	ctx: ExtensionContext,
) => Promise<TResult | undefined> | TResult | undefined;

// ═══════════════════════════════════════════════════════════════════════════════
// Extension API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * API passed to extension factory functions.
 * Provides event subscription, tool/command/shortcut registration, and actions.
 */
export interface ExtensionAPI {
	// ── Event Subscription ────────────────────────────────────────────────────

	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(
		event: "session_before_switch",
		handler: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>,
	): void;
	on(event: "session_switch", handler: ExtensionHandler<SessionSwitchEvent>): void;
	on(
		event: "session_before_compact",
		handler: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>,
	): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;

	on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
	on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
	on(event: "agent_start", handler: ExtensionHandler<AgentStartEvent>): void;
	on(event: "agent_end", handler: ExtensionHandler<AgentEndEvent>): void;
	on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
	on(event: "turn_end", handler: ExtensionHandler<TurnEndEvent>): void;
	on(event: "message_update", handler: ExtensionHandler<MessageUpdateEvent>): void;

	on(event: "tool_call", handler: ExtensionHandler<ToolCallEvent, ToolCallEventResult>): void;
	on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;

	on(event: "model_select", handler: ExtensionHandler<ModelSelectEvent>): void;
	on(event: "input", handler: ExtensionHandler<InputEvent, InputEventResult>): void;

	on(event: "cluster_start", handler: ExtensionHandler<ClusterStartEvent>): void;
	on(event: "cluster_phase_change", handler: ExtensionHandler<ClusterPhaseChangeEvent>): void;
	on(event: "agent_spawn", handler: ExtensionHandler<AgentSpawnEvent>): void;
	on(event: "agent_message", handler: ExtensionHandler<AgentBusMessageEvent>): void;
	on(event: "agent_complete", handler: ExtensionHandler<AgentCompleteEvent>): void;

	// ── Tool Registration ─────────────────────────────────────────────────────

	/** Register a tool that the LLM can call. */
	registerTool(tool: ExtensionToolDefinition): void;

	// ── Command & Shortcut Registration ───────────────────────────────────────

	/** Register a slash command (e.g., `/my-command`). */
	registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void;

	/** Register a keyboard shortcut. */
	registerShortcut(
		key: string,
		options: { description?: string; handler: (ctx: ExtensionContext) => Promise<void> | void },
	): void;

	// ── Actions ───────────────────────────────────────────────────────────────

	/** Send a user message to the agent, triggering a new turn. */
	sendUserMessage(content: string): void;

	/** Get the list of currently active tool names. */
	getActiveTools(): string[];

	/** Set the active tools by name. */
	setActiveTools(toolNames: string[]): void;

	/** Execute a shell command. */
	exec(command: string, args?: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Extension Factory & Loaded State
// ═══════════════════════════════════════════════════════════════════════════════

/** Extension factory — the default export of an extension module. */
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

/** Loaded extension with all registered items. */
export interface LoadedExtension {
	path: string;
	resolvedPath: string;
	handlers: Map<string, Array<(...args: unknown[]) => unknown>>;
	tools: Map<string, ExtensionToolDefinition>;
	commands: Map<string, RegisteredCommand>;
	shortcuts: Map<string, RegisteredShortcut>;
}

/** Result of loading extensions. */
export interface LoadExtensionsResult {
	extensions: LoadedExtension[];
	errors: Array<{ path: string; error: string }>;
}

/** Error from extension execution. */
export interface ExtensionError {
	extensionPath: string;
	event: string;
	error: string;
	stack?: string;
}
