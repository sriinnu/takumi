/**
 * Extension system types — Phase 45
 *
 * Defines the contract for Takumi extensions: lifecycle events,
 * tool/command/shortcut registration, and the context API.
 * Typed event system with discriminated unions, cancellable "before_*"
 * events, and a single ExtensionAPI surface passed to factory functions.
 *
 * Phase 45 additions:
 * - ctx.hasUI / ctx.notify / ctx.ui / ctx.session — UI + session surfaces
 * - message_start/end, tool_execution_*, before_provider_request, user_bash
 * - ExtensionAPI split to extension-api.ts; use that for the full API surface
 */

import type { AgentEvent, ToolDefinition as CoreToolDef, Message, ToolResult, Usage } from "@takumi/core";
import type { ExtensionSession } from "./extension-session.js";
import type {
	BeforeProviderRequestEvent,
	MessageEndEvent,
	MessageStartEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	UserBashEvent,
} from "./extension-tool-events.js";
import type { ExtensionUI, NotifyLevel } from "./extension-ui.js";

export type {
	AgentBusMessageEvent,
	AgentCompleteEvent,
	AgentProfileUpdatedEvent,
	AgentSpawnEvent,
	ClusterBudgetEvent,
	ClusterEndEvent,
	ClusterExtensionEvent,
	ClusterPhaseChangeEvent,
	ClusterStartEvent,
	ClusterTopologyAdaptEvent,
	ClusterValidationAttemptEvent,
	SabhaEscalationEvent,
} from "./cluster-events.js";

import type { ClusterExtensionEvent } from "./cluster-events.js";

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
	| ClusterExtensionEvent
	| MessageStartEvent
	| MessageEndEvent
	| ToolExecutionStartEvent
	| ToolExecutionUpdateEvent
	| ToolExecutionEndEvent
	| BeforeProviderRequestEvent
	| UserBashEvent;

export type { ExtensionSession, SessionEntry, SessionSnapshot } from "./extension-session.js";
// Re-export new event types so consumers can import from extension-types.ts
export type {
	BeforeProviderRequestEvent,
	BeforeProviderRequestResult,
	MessageEndEvent,
	MessageStartEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	UserBashEvent,
	UserBashResult,
} from "./extension-tool-events.js";
export type { ExtensionUI, NotifyLevel, PickItem, WidgetRenderer } from "./extension-ui.js";

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

	// ── Phase 45: UI + Session surfaces ────────────────────────────────────

	/**
	 * Whether an interactive TUI is currently active.
	 * Use this when you only want to run logic in interactive sessions.
	 */
	hasUI: boolean;

	/**
	 * Send a notification. In TUI mode: shows as a toast.
	 * In headless mode: writes to the session log. Always safe to call.
	 */
	notify(message: string, level?: NotifyLevel): void;

	/**
	 * Interactive TUI surface. All methods degrade safely when ctx.hasUI is false
	 * (confirm → false, pick → undefined, setWidget → no-op).
	 */
	ui: ExtensionUI;

	/**
	 * Session history and metadata. Always available — snapshot is empty
	 * in headless or pre-session contexts.
	 */
	session: ExtensionSession;
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
	/**
	 * Optional tab-completion for this command's arguments.
	 * Called when the user types `/command ` and requests completions.
	 * Return an array of completion strings.
	 */
	getArgumentCompletions?: (partial: string, ctx: ExtensionContext) => string[] | Promise<string[]>;
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

// ── ExtensionAPI re-export ────────────────────────────────────────────────────
// The interface lives in extension-api.ts (split out to stay under LOC limit).
// Import from either file — both resolve to the same type.
export type { ExtensionAPI } from "./extension-api.js";

export type {
	ExtensionError,
	ExtensionFactory,
	LoadExtensionsResult,
	LoadedExtension,
} from "./extension-loader-types.js";
